-- Approved unpaid-source retention only. Payment lineage and historical records are retained.
begin;
create table public.ap_unpaid_source_cleanup (
 document_id uuid primary key references public.ap_document_versions(id),
 state text not null default 'QUEUED' check(state in ('QUEUED','LEASED','DELETE_AUTHORIZED','COMPLETED')),
 lease_token uuid, lease_expires_at timestamptz, attempts integer not null default 0,
 deletion_authorized_at timestamptz, deleted_at timestamptz,
 last_error_code text check(last_error_code is null or last_error_code='storage_delete_failed'),
 check((state in ('LEASED','DELETE_AUTHORIZED'))=(lease_token is not null and lease_expires_at is not null))
);
alter table public.ap_unpaid_source_cleanup enable row level security;
revoke all on public.ap_unpaid_source_cleanup from public,anon,authenticated,service_role;
grant select on public.ap_unpaid_source_cleanup to service_role;

create function public.ap_unpaid_source_retention_eligible(p_document_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ap_document_versions doc join public.ap_anonymous_drafts draft on draft.id=doc.draft_id
 cross join public.ap_retention_configuration config
 where doc.id=p_document_id and config.singleton and config.cleanup_enabled
 and doc.customer_id is null and doc.intake_id is null and doc.retention_state in ('ACTIVE','DELETE_PENDING')
 and draft.converted_customer_id is null and draft.converted_intake_id is null
 and draft.state in ('IN_PROGRESS','COMPLETE','EXPIRED') and draft.retention_state in ('ACTIVE','EXPIRY_PENDING')
 and draft.expires_at<=now()
 and greatest(draft.expires_at,draft.created_at+make_interval(secs=>config.unpaid_draft_seconds),coalesce(draft.retention_due_at,draft.expires_at))<=now()
 and greatest(doc.created_at+make_interval(secs=>config.unpaid_file_seconds),coalesce(doc.retention_due_at,doc.created_at))<=now()
 and not exists(select 1 from public.ap_checkout_attempts checkout where checkout.draft_id=draft.id)
 and not exists(select 1 from public.ap_sensitive_payloads payload where payload.draft_id=draft.id and payload.retention_state='LEGAL_HOLD')
 and not exists(select 1 from public.ap_document_versions held where held.draft_id=draft.id and held.retention_state='LEGAL_HOLD'));
$$;

create function public.ap_claim_unpaid_source_cleanup(p_limit integer default 10)
returns table(document_id uuid,lease_token uuid) language plpgsql security definer set search_path='' as $$
declare item record; draft_id uuid; token uuid;
begin
 if p_limit is null or p_limit<1 or p_limit>20 then raise exception 'invalid_retention_limit'; end if;
 if not coalesce((select cleanup_enabled from public.ap_retention_configuration where singleton),false) then return; end if;
 update public.ap_anonymous_drafts draft set state='EXPIRED',retention_state='EXPIRY_PENDING'
 where draft.id in (select d.id from public.ap_anonymous_drafts d cross join public.ap_retention_configuration config
   where config.singleton and d.state in ('IN_PROGRESS','COMPLETE') and d.retention_state='ACTIVE'
   and d.converted_customer_id is null and d.converted_intake_id is null and d.expires_at<=now()
   and greatest(d.expires_at,d.created_at+make_interval(secs=>config.unpaid_draft_seconds),coalesce(d.retention_due_at,d.expires_at))<=now()
   and not exists(select 1 from public.ap_document_versions doc where doc.draft_id=d.id)
   and not exists(select 1 from public.ap_checkout_attempts checkout where checkout.draft_id=d.id)
   and not exists(select 1 from public.ap_sensitive_payloads payload where payload.draft_id=d.id)
   order by d.id for update of d skip locked limit p_limit);
 insert into public.ap_unpaid_source_cleanup(document_id)
 select doc.id from public.ap_document_versions doc where public.ap_unpaid_source_retention_eligible(doc.id)
 and not exists(select 1 from public.ap_unpaid_source_cleanup existing where existing.document_id=doc.id)
 order by doc.id limit p_limit
 on conflict do nothing;
 for item in select job.document_id from public.ap_unpaid_source_cleanup job
 where (job.state='QUEUED' or (job.state in ('LEASED','DELETE_AUTHORIZED') and job.lease_expires_at<=now()))
 and public.ap_unpaid_source_retention_eligible(job.document_id)
 order by job.document_id for update skip locked limit p_limit loop
   select doc.draft_id into draft_id from public.ap_document_versions doc where doc.id=item.document_id;
   perform 1 from public.ap_anonymous_drafts draft where draft.id=draft_id for update;
   perform 1 from public.ap_document_versions doc where doc.id=item.document_id for update;
   if not public.ap_unpaid_source_retention_eligible(item.document_id) then continue; end if;
   token:=gen_random_uuid();
   update public.ap_unpaid_source_cleanup job set state=case when deletion_authorized_at is null then 'LEASED' else 'DELETE_AUTHORIZED' end,
     lease_token=token,lease_expires_at=now()+interval '5 minutes',attempts=attempts+1 where job.document_id=item.document_id;
   return query select item.document_id::uuid,token;
 end loop;
end;
$$;

create function public.ap_authorize_unpaid_source_delete(p_document_id uuid,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.ap_unpaid_source_cleanup; doc public.ap_document_versions;
begin
 select * into job from public.ap_unpaid_source_cleanup where document_id=p_document_id for update;
 if not found or job.lease_token is distinct from p_lease_token or job.lease_expires_at<=now()
   or job.state not in ('LEASED','DELETE_AUTHORIZED') then return null; end if;
 select * into doc from public.ap_document_versions where id=p_document_id;
 perform 1 from public.ap_anonymous_drafts where id=doc.draft_id for update;
 perform 1 from public.ap_document_versions where id=p_document_id for update;
 if not public.ap_unpaid_source_retention_eligible(p_document_id) then return null; end if;
 -- Irreversible-delete intent is the serialization boundary. A later hold cannot claim
 -- protection after deletion was authorized; its update is rejected explicitly below.
 update public.ap_unpaid_source_cleanup set state='DELETE_AUTHORIZED',deletion_authorized_at=coalesce(deletion_authorized_at,now()) where document_id=p_document_id;
 update public.ap_document_versions set retention_state='DELETE_PENDING' where id=p_document_id;
 update public.ap_anonymous_drafts set state='EXPIRED',retention_state='EXPIRY_PENDING' where id=doc.draft_id;
 insert into public.ap_audit_events(action,entity_type,entity_id,non_sensitive_details,audit_version)
 values('UNPAID_SOURCE_DELETE_AUTHORIZED','DOCUMENT_VERSION',p_document_id,'{}','unpaid-retention-v1');
 return jsonb_build_object('bucket',doc.storage_bucket,'path',doc.storage_path);
end;
$$;

create function public.ap_finish_unpaid_source_delete(p_document_id uuid,p_lease_token uuid,p_succeeded boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare job public.ap_unpaid_source_cleanup;
begin
 select * into job from public.ap_unpaid_source_cleanup where document_id=p_document_id for update;
 if not found then return false; end if;
 if job.state='COMPLETED' then return true; end if;
 if job.state<>'DELETE_AUTHORIZED' or job.lease_token is distinct from p_lease_token or p_succeeded is null then return false; end if;
 if not p_succeeded then
   update public.ap_unpaid_source_cleanup set lease_expires_at=now()+interval '5 minutes',last_error_code='storage_delete_failed' where document_id=p_document_id;
   return true;
 end if;
 update public.ap_document_versions set retention_state='DELETED' where id=p_document_id;
 update public.ap_unpaid_source_cleanup set state='COMPLETED',lease_token=null,lease_expires_at=null,deleted_at=now(),last_error_code=null where document_id=p_document_id;
 insert into public.ap_audit_events(action,entity_type,entity_id,non_sensitive_details,audit_version)
 values('UNPAID_SOURCE_BYTES_DELETED','DOCUMENT_VERSION',p_document_id,'{}','unpaid-retention-v1');
 return true;
end;
$$;

create function public.ap_guard_unpaid_delete_hold() returns trigger language plpgsql security definer set search_path='' as $$
declare related_draft uuid;
begin
 if new.retention_state='LEGAL_HOLD' and (tg_op='INSERT' or old.retention_state is distinct from new.retention_state) then
   if tg_table_name='ap_anonymous_drafts' then related_draft:=new.id; else related_draft:=new.draft_id; end if;
   perform 1 from public.ap_anonymous_drafts where id=related_draft for update;
   if exists(select 1 from public.ap_unpaid_source_cleanup job join public.ap_document_versions doc on doc.id=job.document_id
     where doc.draft_id=related_draft and job.deletion_authorized_at is not null) then raise exception 'retention_delete_already_authorized'; end if;
 end if;
 return new;
end;
$$;
create trigger ap_unpaid_draft_hold_guard before insert or update on public.ap_anonymous_drafts for each row execute function public.ap_guard_unpaid_delete_hold();
create trigger ap_unpaid_document_hold_guard before insert or update on public.ap_document_versions for each row execute function public.ap_guard_unpaid_delete_hold();
create trigger ap_unpaid_payload_hold_guard before insert or update on public.ap_sensitive_payloads for each row execute function public.ap_guard_unpaid_delete_hold();
revoke all on function public.ap_unpaid_source_retention_eligible(uuid),public.ap_claim_unpaid_source_cleanup(integer),public.ap_authorize_unpaid_source_delete(uuid,uuid),public.ap_finish_unpaid_source_delete(uuid,uuid,boolean),public.ap_guard_unpaid_delete_hold() from public,anon,authenticated,service_role;
grant execute on function public.ap_claim_unpaid_source_cleanup(integer),public.ap_authorize_unpaid_source_delete(uuid,uuid),public.ap_finish_unpaid_source_delete(uuid,uuid,boolean) to service_role;
commit;

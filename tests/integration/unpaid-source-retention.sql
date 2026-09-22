begin;
insert into public.ap_anonymous_drafts(id,capability_secret_hash,created_at,expires_at)
values('b5100000-0000-4000-8000-000000000001',repeat('a',64),now()-interval '100 days',now()-interval '99 days'),
 ('b5100000-0000-4000-8000-000000000002',repeat('b',64),now()-interval '1 day',now()+interval '1 day');
insert into public.ap_document_versions(id,draft_id,kind,version,safe_display_name,storage_bucket,storage_path,size_bytes,claimed_mime_type,verified_mime_type,sha256,created_at)
select id::uuid,draft::uuid,'RESUME',1,'Synthetic retention fixture.pdf','customer-source-documents',path,100,'application/pdf','application/pdf',repeat('c',64),now()-interval '90 days'
from (values
 ('b5110000-0000-4000-8000-000000000001','b5100000-0000-4000-8000-000000000001','anonymous/b5100000-0000-4000-8000-000000000001/resume/fixture.pdf'),
 ('b5110000-0000-4000-8000-000000000002','b5100000-0000-4000-8000-000000000002','anonymous/b5100000-0000-4000-8000-000000000002/resume/fixture.pdf')) t(id,draft,path);
update public.ap_retention_configuration set approved=false where singleton;
do $$ begin
 if exists(select 1 from public.ap_claim_unpaid_source_cleanup(10)) then raise exception 'unapproved cleanup claimed'; end if;
end $$;
update public.ap_retention_configuration set unpaid_draft_seconds=3600,unpaid_file_seconds=3600,
 privacy_policy_approval_reference='SYNTHETIC ROLLBACK-ONLY RETENTION TEST',approved=true where singleton;
create temp table retention_claim as select * from public.ap_claim_unpaid_source_cleanup(10);
do $$ begin
 if (select count(*) from retention_claim)<>1 then raise exception 'nonexpired or missing eligible claim'; end if;
 if exists(select 1 from public.ap_unpaid_source_cleanup where document_id='b5110000-0000-4000-8000-000000000002') then raise exception 'nonexpired draft queued'; end if;
end $$;
-- Hold placed after claim must veto authorization (stale worker cannot delete).
update public.ap_anonymous_drafts set retention_state='LEGAL_HOLD' where id='b5100000-0000-4000-8000-000000000001';
do $$ declare claim record; begin
 select * into claim from retention_claim;
 if public.ap_authorize_unpaid_source_delete(claim.document_id,claim.lease_token) is not null then raise exception 'stale claim bypassed hold'; end if;
end $$;
update public.ap_anonymous_drafts set retention_state='ACTIVE' where id='b5100000-0000-4000-8000-000000000001';
do $$ declare claim record; target jsonb; begin
 select * into claim from retention_claim;
 target:=public.ap_authorize_unpaid_source_delete(claim.document_id,claim.lease_token);
 if target->>'bucket' is distinct from 'customer-source-documents' then raise exception 'valid deletion intent missing'; end if;
 begin
   update public.ap_anonymous_drafts set retention_state='LEGAL_HOLD' where id='b5100000-0000-4000-8000-000000000001';
   raise exception 'late hold falsely accepted';
 exception when raise_exception then if sqlerrm<>'retention_delete_already_authorized' then raise; end if; end;
 if not public.ap_finish_unpaid_source_delete(claim.document_id,claim.lease_token,false) then raise exception 'retry not durable'; end if;
 if (select retention_state from public.ap_document_versions where id=claim.document_id)<>'DELETE_PENDING' then raise exception 'failure claimed deletion'; end if;
end $$;
update public.ap_unpaid_source_cleanup set lease_expires_at=now()-interval '1 second';
create temp table retention_retry as select * from public.ap_claim_unpaid_source_cleanup(10);
do $$ declare retry record; old_claim record; begin
 select * into retry from retention_retry; select * into old_claim from retention_claim;
 if retry.lease_token is null or retry.lease_token=old_claim.lease_token then raise exception 'lease not rotated'; end if;
 if public.ap_authorize_unpaid_source_delete(old_claim.document_id,old_claim.lease_token) is not null then raise exception 'stale lease authorized'; end if;
 if public.ap_authorize_unpaid_source_delete(retry.document_id,retry.lease_token) is null then raise exception 'retry authorization missing'; end if;
 if not public.ap_finish_unpaid_source_delete(retry.document_id,retry.lease_token,true) then raise exception 'finalization failed'; end if;
 if not public.ap_finish_unpaid_source_delete(retry.document_id,retry.lease_token,true) then raise exception 'idempotent finalization failed'; end if;
 if (select retention_state from public.ap_document_versions where id=retry.document_id)<>'DELETED' then raise exception 'tombstone missing'; end if;
 if not exists(select 1 from public.ap_anonymous_drafts where id='b5100000-0000-4000-8000-000000000001' and state='EXPIRED') then raise exception 'draft history missing'; end if;
 if exists(select 1 from public.ap_claim_unpaid_source_cleanup(10)) then raise exception 'completed job reclaimed'; end if;
end $$;
rollback;

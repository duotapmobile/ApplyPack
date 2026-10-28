-- Resume an existing unpaid review without replaying or rewriting its original
-- immutable answer. Full review and confirmation remain separate operations.
begin;
-- Verified account ownership is separate from immutable intake content and
-- from paid conversion. A minimized claim remains a non-authorizing ownership
-- tombstone: payment reconciliation must never fall back to an email lookup.
create table public.ap_intake_account_claims(
 root_draft_id uuid primary key references public.ap_anonymous_drafts(id),
 customer_id uuid not null references public.profiles(id),
 access_email_normalized text not null check(access_email_normalized=lower(btrim(access_email_normalized)) and length(access_email_normalized) between 3 and 320),
 creation_request_id uuid,
 email_verified_at timestamptz not null,
 claimed_at timestamptz not null default clock_timestamp(),
 unique(customer_id,creation_request_id));
create table public.ap_intake_clarification_notices(
 message_id uuid primary key references public.ap_outbox_messages(id),
 question_id uuid not null references public.ap_candidate_questions(id),
 root_draft_id uuid not null references public.ap_intake_account_claims(root_draft_id),
 customer_id uuid not null references public.profiles(id),
 recipient_email text not null check(recipient_email=lower(btrim(recipient_email)) and length(recipient_email) between 3 and 320),
 template_version text not null default 'intake-clarification-notice-v1' check(template_version='intake-clarification-notice-v1'),
 delivery_envelope_sha256 text check(delivery_envelope_sha256~'^[a-f0-9]{64}$'),
 created_at timestamptz not null default clock_timestamp(),unique(question_id,root_draft_id));

create function public.ap_intake_root_draft(p_draft_id uuid) returns uuid
language plpgsql stable security definer set search_path='' as $$
declare current_id uuid:=p_draft_id; parent_id uuid; seen uuid[]:='{}';
begin
 if not exists(select 1 from public.ap_anonymous_drafts where id=current_id) then return null; end if;
 loop
  if current_id=any(seen) or cardinality(seen)>=64 then raise exception 'intake_lineage_invalid'; end if;
  seen:=array_append(seen,current_id);
  select source_draft_id into parent_id from public.ap_intake_clarifications where draft_id=current_id;
  if parent_id is null then return current_id; end if;
  if not exists(select 1 from public.ap_anonymous_drafts where id=parent_id) then raise exception 'intake_lineage_invalid'; end if;
  current_id:=parent_id;
 end loop;
end $$;
create function public.ap_intake_draft_chain(p_root_id uuid) returns uuid[]
language plpgsql stable security definer set search_path='' as $$
declare current_id uuid:=p_root_id; child_id uuid; ids uuid[]:='{}'; child_count integer;
begin
 if public.ap_intake_root_draft(p_root_id) is distinct from p_root_id then raise exception 'intake_lineage_invalid'; end if;
 loop
  if current_id=any(ids) or cardinality(ids)>=64 then raise exception 'intake_lineage_invalid'; end if;
  ids:=array_append(ids,current_id);
  select count(*),min(c.draft_id::text)::uuid into child_count,child_id from public.ap_intake_clarifications c
   join public.ap_anonymous_drafts d on d.id=c.source_draft_id and d.finalized_snapshot_id=c.source_snapshot_id
   where c.source_draft_id=current_id and c.draft_id is not null;
  if child_count>1 then raise exception 'intake_lineage_invalid'; end if;
  if child_id is null then return ids; end if;
  current_id:=child_id;
 end loop;
end $$;
create function public.ap_intake_claim_customer(p_draft_id uuid) returns uuid
language sql stable security definer set search_path='' as $$
 select customer_id from public.ap_intake_account_claims where root_draft_id=public.ap_intake_root_draft(p_draft_id);
$$;
create function public.ap_verified_intake_email(p_customer_id uuid,p_expected_email text default null) returns text
language plpgsql stable security definer set search_path='' as $$
declare current_email text;
begin
 select lower(btrim(u.email)) into current_email from auth.users u join public.profiles p on p.id=u.id
  where u.id=p_customer_id and u.email_confirmed_at is not null and not u.is_anonymous;
 if current_email is null or length(current_email) not between 3 and 320
  or (p_expected_email is not null and lower(btrim(p_expected_email)) is distinct from current_email)
  then raise exception 'verified_intake_identity_required'; end if;
 return current_email;
end $$;

alter function public.ap_retention_snapshot_customers(uuid) rename to ap_retention_snapshot_customers_before_103;
create function public.ap_retention_snapshot_customers(p_snapshot uuid) returns uuid[]
language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(distinct owner order by owner) filter(where owner is not null),'{}'::uuid[]) from (
  select unnest(public.ap_retention_snapshot_customers_before_103(p_snapshot)) owner
  union select public.ap_intake_claim_customer(draft_id) from public.ap_intake_snapshots where id=p_snapshot
 ) owners;
$$;
alter function public.ap_retention_row_customers(text,jsonb) rename to ap_retention_row_customers_before_103;
create function public.ap_retention_row_customers(p_table text,p_row jsonb) returns uuid[]
language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(distinct owner order by owner) filter(where owner is not null),'{}'::uuid[]) from (
  select unnest(public.ap_retention_row_customers_before_103(p_table,p_row)) owner
  union select public.ap_intake_claim_customer(case when p_table='ap_anonymous_drafts' then (p_row->>'id')::uuid
   else coalesce((p_row->>'draft_id')::uuid,(p_row->>'root_draft_id')::uuid) end)
 ) owners;
$$;

-- Existing snapshot/clarification fences precede owner locks; owner locks
-- precede draft rows. Every check is repeated after waiting for these locks.
create function public.ap_lock_owned_intake(p_draft_id uuid,p_proposed_customer_id uuid default null,p_allow_checkout boolean default false) returns uuid[]
language plpgsql security definer set search_path='' as $$
declare root_id uuid; ids uuid[]; owners uuid[]; fresh_owners uuid[]; value_id uuid; snapshot_id uuid;
begin
 perform 1 from public.ap_retention_restore_lock where singleton for share;
 if exists(select 1 from public.ap_retention_restore_lock where singleton and locked) then raise exception 'retention_restore_locked'; end if;
 perform pg_advisory_xact_lock_shared(6384910250098);
 if public.ap_archive_fence_active() then raise exception using errcode='40001',message='archive_maintenance_retry_required'; end if;
 root_id:=public.ap_intake_root_draft(p_draft_id);
 if root_id is null then raise exception 'owned_intake_unavailable'; end if;
 ids:=public.ap_intake_draft_chain(root_id);
 foreach value_id in array ids loop
  select finalized_snapshot_id into snapshot_id from public.ap_anonymous_drafts where id=value_id;
  if snapshot_id is not null then
   perform pg_advisory_xact_lock(hashtextextended(snapshot_id::text,45));
   perform pg_advisory_xact_lock(hashtextextended('intake-clarification:'||snapshot_id::text,0));
  end if;
 end loop;
 select coalesce(array_agg(distinct x order by x) filter(where x is not null),'{}'::uuid[]) into owners from (
  select unnest(public.ap_retention_row_customers('ap_anonymous_drafts',to_jsonb(d))) x from public.ap_anonymous_drafts d where id=any(ids)
  union select p_proposed_customer_id) all_owners;
 foreach value_id in array owners loop
  perform pg_advisory_xact_lock(hashtextextended('service-retention:'||value_id::text,0));
  if exists(select 1 from public.ap_service_retention_claims where customer_id=value_id and state='PENDING') then raise exception 'service_retention_purge_committed'; end if;
 end loop;
 foreach value_id in array ids loop perform 1 from public.ap_anonymous_drafts where id=value_id for update; end loop;
 if public.ap_intake_root_draft(p_draft_id) is distinct from root_id or public.ap_intake_draft_chain(root_id) is distinct from ids
  then raise exception using errcode='40001',message='owned_intake_changed'; end if;
 select coalesce(array_agg(distinct x order by x) filter(where x is not null),'{}'::uuid[]) into fresh_owners from (
  select unnest(public.ap_retention_row_customers('ap_anonymous_drafts',to_jsonb(d))) x from public.ap_anonymous_drafts d where id=any(ids)
  union select p_proposed_customer_id) all_owners;
 if fresh_owners is distinct from owners then raise exception using errcode='40001',message='owned_intake_changed'; end if;
 if exists(select 1 from public.ap_anonymous_drafts where id=any(ids) and (expires_at<=clock_timestamp() or retention_state<>'ACTIVE'
  or (state not in('IN_PROGRESS','COMPLETE') and not(p_allow_checkout and state='LOCKED_TO_CHECKOUT')) or converted_customer_id is not null or converted_intake_id is not null))
  or exists(select 1 from public.ap_retention_row_receipts where (table_name='ap_anonymous_drafts' and row_id=any(ids::text[]))
   or (table_name='ap_intake_account_claims' and row_id=root_id::text)) then raise exception 'owned_intake_unavailable'; end if;
 if (not p_allow_checkout and exists(select 1 from public.ap_checkout_attempts where draft_id=any(ids) and state not in('EXPIRED','CANCELED','FAILED')))
  or exists(select 1 from public.ap_intake_snapshots s join public.ap_search_services service on service.original_snapshot_id=s.id or service.active_snapshot_id=s.id where s.draft_id=any(ids))
  then raise exception 'owned_intake_paid_or_checkout'; end if;
 if exists(select 1 from public.ap_unpaid_source_cleanup c join public.ap_document_versions d on d.id=c.document_id
  where d.draft_id=any(ids) and c.deletion_authorized_at is not null) then raise exception 'owned_intake_unavailable'; end if;
 return ids;
end $$;

create function public.ap_owned_intake_metadata(p_customer_id uuid,p_draft_id uuid,p_replayed boolean default false,p_allow_checkout boolean default false,p_allow_source boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare claim public.ap_intake_account_claims; d public.ap_anonymous_drafts; ids uuid[]; verified_email text;
begin
 verified_email:=public.ap_verified_intake_email(p_customer_id);
 select * into claim from public.ap_intake_account_claims where root_draft_id=public.ap_intake_root_draft(p_draft_id) and customer_id=p_customer_id;
 if claim.root_draft_id is null then raise exception 'owned_intake_unavailable'; end if;
 ids:=public.ap_intake_draft_chain(claim.root_draft_id);
 select * into d from public.ap_anonymous_drafts where id=case when p_allow_source and p_draft_id=any(ids) then p_draft_id else ids[cardinality(ids)] end;
 if d.id is distinct from p_draft_id or exists(select 1 from public.ap_anonymous_drafts where id=any(ids)
  and (expires_at<=clock_timestamp() or retention_state<>'ACTIVE' or (state not in('IN_PROGRESS','COMPLETE') and not(p_allow_checkout and state='LOCKED_TO_CHECKOUT')) or converted_customer_id is not null))
  or exists(select 1 from public.ap_retention_row_receipts where (table_name='ap_intake_account_claims' and row_id=claim.root_draft_id::text)
   or (table_name='ap_anonymous_drafts' and row_id=any(ids::text[])))
  or exists(select 1 from public.ap_service_retention_claims where customer_id=p_customer_id and state='PENDING')
  or (not p_allow_checkout and exists(select 1 from public.ap_checkout_attempts where draft_id=any(ids) and state not in('EXPIRED','CANCELED','FAILED')))
  or exists(select 1 from public.ap_intake_snapshots s join public.ap_search_services service on service.original_snapshot_id=s.id or service.active_snapshot_id=s.id where s.draft_id=any(ids))
  then raise exception 'owned_intake_unavailable'; end if;
 return jsonb_build_object('rootDraftId',claim.root_draft_id,'draftId',d.id,'state',d.state,'version',d.version,'capabilityVersion',d.capability_version,
  'expiresAt',d.expires_at,'accessEmail',claim.access_email_normalized,'verifiedEmail',verified_email,'createdAt',d.created_at,'updatedAt',d.updated_at,
  'questionPending',exists(select 1 from public.ap_candidate_questions q join public.ap_intake_clarifications c on c.source_snapshot_id=q.snapshot_id
   where c.source_draft_id=any(ids) and c.confirmed_snapshot_id is null and not exists(select 1 from public.ap_intake_clarification_answers a where a.question_id=q.id)),
  'reviewRequired',exists(select 1 from public.ap_intake_clarifications c where (c.draft_id=d.id or c.source_draft_id=d.id and c.draft_id is not null) and c.confirmed_snapshot_id is null),
  'claimed',true,'replayed',p_replayed);
end $$;
create function public.ap_owned_intake_draft_context(p_customer_id uuid,p_draft_id uuid,p_secret_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform public.ap_verified_intake_email(p_customer_id);
 if public.ap_intake_claim_customer(p_draft_id) is distinct from p_customer_id then raise exception 'owned_intake_unavailable'; end if;
 perform public.ap_lock_owned_intake(p_draft_id,null,true);
 if not exists(select 1 from public.ap_anonymous_drafts where id=p_draft_id and capability_secret_hash=p_secret_hash)
  then raise exception 'owned_intake_unavailable'; end if;
 return public.ap_owned_intake_metadata(p_customer_id,p_draft_id,false,true,true);
end $$;
create function public.ap_owned_intake_drafts(p_customer_id uuid,p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path='' as $$
declare claim record; ids uuid[]; metadata jsonb; result jsonb:='[]';
begin
 perform public.ap_verified_intake_email(p_customer_id);
 if p_limit is null or p_limit not between 1 and 20 then raise exception 'owned_intake_limit_invalid'; end if;
 perform 1 from public.ap_retention_restore_lock where singleton for share;
 if exists(select 1 from public.ap_retention_restore_lock where singleton and locked) then raise exception 'retention_restore_locked'; end if;
 for claim in select root_draft_id from public.ap_intake_account_claims where customer_id=p_customer_id order by claimed_at desc,root_draft_id limit 100 loop
  begin
   ids:=public.ap_intake_draft_chain(claim.root_draft_id);
   metadata:=public.ap_owned_intake_metadata(p_customer_id,ids[cardinality(ids)]);
   result:=result||jsonb_build_array(metadata-'replayed');
  exception when others then if sqlerrm<>'owned_intake_unavailable' then raise; end if; end;
  exit when jsonb_array_length(result)>=p_limit;
 end loop;
 return result;
end $$;

create function public.ap_create_owned_intake_draft(p_customer_id uuid,p_verified_email text,p_request_id uuid,
 p_draft_id uuid,p_secret_hash text,p_expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' as $$
declare email_value text; existing public.ap_intake_account_claims; ids uuid[];
begin
 email_value:=public.ap_verified_intake_email(p_customer_id,p_verified_email);
 if p_request_id is null or p_draft_id is null or p_secret_hash is null or p_secret_hash!~'^[a-f0-9]{64}$'
  or p_expires_at is null or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '7 days 5 seconds'
  then raise exception 'owned_intake_create_invalid'; end if;
 perform 1 from public.ap_retention_restore_lock where singleton for share;
 if exists(select 1 from public.ap_retention_restore_lock where singleton and locked) then raise exception 'retention_restore_locked'; end if;
 perform pg_advisory_xact_lock_shared(6384910250098);
 if public.ap_archive_fence_active() then raise exception using errcode='40001',message='archive_maintenance_retry_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('intake-create:'||p_customer_id::text||':'||p_request_id::text,0));
 select * into existing from public.ap_intake_account_claims where customer_id=p_customer_id and creation_request_id=p_request_id;
 if existing.root_draft_id is not null then
  ids:=public.ap_lock_owned_intake(existing.root_draft_id);
  return public.ap_owned_intake_metadata(p_customer_id,ids[cardinality(ids)],true);
 end if;
 perform pg_advisory_xact_lock(hashtextextended('service-retention:'||p_customer_id::text,0));
 if exists(select 1 from public.ap_service_retention_claims where customer_id=p_customer_id and state='PENDING') then raise exception 'service_retention_purge_committed'; end if;
 email_value:=public.ap_verified_intake_email(p_customer_id,p_verified_email);
 perform public.ap_create_anonymous_draft(p_draft_id,p_secret_hash,p_expires_at);
 insert into public.ap_intake_account_claims(root_draft_id,customer_id,access_email_normalized,creation_request_id,email_verified_at)
  select p_draft_id,p_customer_id,email_value,p_request_id,email_confirmed_at from auth.users where id=p_customer_id;
 update public.ap_anonymous_drafts set answers=answers||jsonb_build_object('email',email_value),access_email_normalized=email_value where id=p_draft_id;
 return public.ap_owned_intake_metadata(p_customer_id,p_draft_id);
end $$;

create function public.ap_claim_intake_draft(p_customer_id uuid,p_verified_email text,p_draft_id uuid,p_secret_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare email_value text; root_id uuid; ids uuid[]; existing public.ap_intake_account_claims;
 d public.ap_anonymous_drafts; access_email text; existing_owner uuid;
begin
 email_value:=public.ap_verified_intake_email(p_customer_id,p_verified_email);
 select * into d from public.ap_anonymous_drafts where id=p_draft_id and capability_secret_hash=p_secret_hash;
 if d.id is null then raise exception 'owned_intake_unavailable'; end if;
 root_id:=public.ap_intake_root_draft(p_draft_id);
 select * into existing from public.ap_intake_account_claims where root_draft_id=root_id;
 if existing.root_draft_id is not null and existing.customer_id<>p_customer_id then raise exception 'owned_intake_unavailable'; end if;
 ids:=public.ap_lock_owned_intake(p_draft_id,p_customer_id);
 email_value:=public.ap_verified_intake_email(p_customer_id,p_verified_email);
 select * into d from public.ap_anonymous_drafts where id=p_draft_id and capability_secret_hash=p_secret_hash;
 if d.id is null or not(p_draft_id=any(ids)) then raise exception 'owned_intake_unavailable'; end if;
 select * into existing from public.ap_intake_account_claims where root_draft_id=root_id;
 if existing.root_draft_id is not null then
  if existing.customer_id<>p_customer_id then raise exception 'owned_intake_unavailable'; end if;
  return public.ap_owned_intake_metadata(p_customer_id,ids[cardinality(ids)],true);
 end if;
 -- A claim never overwrites an existing explicit owner or paid relationship.
 for existing_owner in select distinct unnest(public.ap_retention_row_customers('ap_anonymous_drafts',to_jsonb(family)))
  from public.ap_anonymous_drafts family where id=any(ids) loop
  if existing_owner<>p_customer_id then raise exception 'owned_intake_unavailable'; end if;
 end loop;
 select coalesce(s.access_email_normalized,nullif(lower(btrim(root.access_email_normalized)),''),nullif(lower(btrim(root.answers->>'email')),''))
  into access_email from public.ap_anonymous_drafts root left join public.ap_intake_snapshots s on s.id=root.finalized_snapshot_id where root.id=root_id;
 if access_email is null then
  if exists(select 1 from public.ap_anonymous_drafts where id=any(ids) and (answers-ARRAY['flowVersion']::text[]<>'{}' or finalized_snapshot_id is not null))
   or exists(select 1 from public.ap_document_versions where draft_id=any(ids))
   or exists(select 1 from public.ap_candidate_facts where draft_id=any(ids))
   or exists(select 1 from public.ap_sensitive_payloads where draft_id=any(ids))
   then raise exception 'owned_intake_access_identity_required'; end if;
  access_email:=email_value;
 end if;
 if access_email<>email_value then raise exception 'owned_intake_access_identity_mismatch'; end if;
 insert into public.ap_intake_account_claims(root_draft_id,customer_id,access_email_normalized,email_verified_at)
  select root_id,p_customer_id,access_email,email_confirmed_at from auth.users where id=p_customer_id;
 -- Existing content stays byte-exact. An actually empty draft may establish
 -- its first access identity after verified sign-in.
 update public.ap_anonymous_drafts set answers=answers||jsonb_build_object('email',access_email),access_email_normalized=access_email
  where id=root_id and answers-ARRAY['flowVersion']::text[]='{}' and finalized_snapshot_id is null;
 perform public.ap_enqueue_intake_clarification_notices(root_id);
 return public.ap_owned_intake_metadata(p_customer_id,ids[cardinality(ids)]);
end $$;
create function public.ap_resume_owned_intake_draft(p_customer_id uuid,p_root_draft_id uuid,p_expected_draft_id uuid,
 p_expected_capability_version integer,p_secret_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ids uuid[]; d public.ap_anonymous_drafts;
begin
 perform public.ap_verified_intake_email(p_customer_id);
 if p_secret_hash is null or p_secret_hash!~'^[a-f0-9]{64}$' or p_expected_capability_version is null or p_expected_capability_version<1
  or not exists(select 1 from public.ap_intake_account_claims where root_draft_id=p_root_draft_id and customer_id=p_customer_id)
  then raise exception 'owned_intake_unavailable'; end if;
 ids:=public.ap_lock_owned_intake(p_root_draft_id);
 if ids[cardinality(ids)] is distinct from p_expected_draft_id then raise exception using errcode='40001',message='owned_intake_changed'; end if;
 select * into strict d from public.ap_anonymous_drafts where id=p_expected_draft_id;
 if d.capability_secret_hash=p_secret_hash and d.capability_version in(p_expected_capability_version,p_expected_capability_version+1)
  then return public.ap_owned_intake_metadata(p_customer_id,d.id,true); end if;
 if d.capability_version<>p_expected_capability_version then raise exception using errcode='40001',message='owned_intake_changed'; end if;
 update public.ap_anonymous_drafts set capability_secret_hash=p_secret_hash,capability_version=capability_version+1,
  capability_rotated_at=clock_timestamp() where id=d.id;
 return public.ap_owned_intake_metadata(p_customer_id,d.id);
end $$;

alter function public.ap_customer_owns_snapshot(uuid,uuid) rename to ap_customer_owns_snapshot_before_103;
create function public.ap_customer_owns_snapshot(p_customer_id uuid,p_snapshot_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from public.ap_intake_snapshots s join public.ap_intake_account_claims c
  on c.root_draft_id=public.ap_intake_root_draft(s.draft_id) where s.id=p_snapshot_id) then exists(
   select 1 from public.ap_intake_snapshots s join public.ap_intake_account_claims c on c.root_draft_id=public.ap_intake_root_draft(s.draft_id)
   join public.ap_anonymous_drafts d on d.id=s.draft_id where s.id=p_snapshot_id and c.customer_id=p_customer_id
    and s.finalized_at is not null and (s.customer_id is null or s.customer_id=p_customer_id)
    and d.retention_state='ACTIVE' and public.ap_retention_snapshot_private_access_allowed(s.id)
    and not exists(select 1 from public.ap_retention_row_receipts r where r.table_name='ap_intake_account_claims' and r.row_id=c.root_draft_id::text)
    and not exists(select 1 from public.ap_retention_row_receipts r where (r.table_name='ap_anonymous_drafts' and r.row_id=d.id::text)
     or (r.table_name='ap_intake_snapshots' and r.row_id=s.id::text))
    and (exists(select 1 from public.ap_search_services service where service.customer_id=p_customer_id and (service.original_snapshot_id=s.id or service.active_snapshot_id=s.id))
     or not exists(select 1 from public.ap_anonymous_drafts ancestor where ancestor.id=any(public.ap_intake_draft_chain(c.root_draft_id))
      and (ancestor.expires_at<=clock_timestamp() or ancestor.retention_state<>'ACTIVE')))
  ) else public.ap_customer_owns_snapshot_before_103(p_customer_id,p_snapshot_id) end;
$$;
create function public.ap_intake_payment_identity(p_draft_id uuid,p_snapshot_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare claim public.ap_intake_account_claims;
begin
 if not exists(select 1 from public.ap_intake_snapshots where id=p_snapshot_id and draft_id=p_draft_id and finalized_at is not null)
  then raise exception 'checkout_binding_incomplete'; end if;
 select * into claim from public.ap_intake_account_claims where root_draft_id=public.ap_intake_root_draft(p_draft_id);
 if claim.root_draft_id is null then return jsonb_build_object('claimed',false,'customerId',null,'rootDraftId',null); end if;
 if not exists(select 1 from public.profiles where id=claim.customer_id) then raise exception 'access_identity_mismatch'; end if;
 return jsonb_build_object('claimed',true,'customerId',claim.customer_id,'rootDraftId',claim.root_draft_id);
end $$;

create function public.ap_enqueue_intake_clarification_notices(p_root_draft_id uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare claim public.ap_intake_account_claims; ids uuid[]; q record; message_id uuid; message_key text; recipient text; queued integer:=0;
begin
 select * into claim from public.ap_intake_account_claims where root_draft_id=p_root_draft_id;
 if claim.root_draft_id is null then return 0; end if;
 ids:=public.ap_lock_owned_intake(p_root_draft_id);
 recipient:=public.ap_verified_intake_email(claim.customer_id);
 for q in select question.id from public.ap_candidate_questions question join public.ap_intake_clarifications c on c.source_snapshot_id=question.snapshot_id
  where c.source_draft_id=any(ids) and c.confirmed_snapshot_id is null order by question.created_at,question.id limit 20 loop
  if exists(select 1 from public.ap_intake_clarification_notices where question_id=q.id and root_draft_id=p_root_draft_id) then continue; end if;
  message_id:=gen_random_uuid();
  message_key:='intake-clarification:'||p_root_draft_id::text||':'||q.id::text||':v1';
  insert into public.ap_outbox_messages(id,customer_id,message_kind,recipient_ref,deduplication_key,provider_idempotency_key,state,next_attempt_at)
   values(message_id,claim.customer_id,'INTAKE_CLARIFICATION_REQUIRED',q.id::text,message_key,message_key,'QUEUED',clock_timestamp());
  insert into public.ap_intake_clarification_notices(message_id,question_id,root_draft_id,customer_id,recipient_email)
   values(message_id,q.id,p_root_draft_id,claim.customer_id,recipient);
  insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
   values('OUTBOX_SEND',message_id,'outbox-send:'||message_id::text,clock_timestamp()) on conflict(idempotency_key) do nothing;
  queued:=queued+1;
 end loop;
 return queued;
end $$;
create function public.ap_prepare_intake_clarification_notification(p_message_id uuid,p_lease_owner text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare notice public.ap_intake_clarification_notices; message public.ap_outbox_messages; current_email text; ids uuid[];
begin
 select * into notice from public.ap_intake_clarification_notices where message_id=p_message_id;
 if notice.message_id is null then raise exception 'intake_notice_unavailable'; end if;
 perform 1 from public.ap_retention_restore_lock where singleton for share;
 if exists(select 1 from public.ap_retention_restore_lock where singleton and locked) then raise exception 'retention_restore_locked'; end if;
 perform pg_advisory_xact_lock_shared(6384910250098);
 if public.ap_archive_fence_active() then raise exception using errcode='40001',message='archive_maintenance_retry_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('service-retention:'||notice.customer_id::text,0));
 select * into message from public.ap_outbox_messages where id=p_message_id for update;
 if message.id is null or message.state<>'SENDING' or message.lease_owner is distinct from p_lease_owner
  or message.lease_expires_at<=clock_timestamp() or message.first_submitted_at is null
  or message.first_submitted_at>clock_timestamp() or message.first_submitted_at+interval '24 hours'<=clock_timestamp()
  or message.message_kind<>'INTAKE_CLARIFICATION_REQUIRED' or message.customer_id is distinct from notice.customer_id
  or message.recipient_ref<>notice.question_id::text or message.order_id is not null or message.payload_ref is not null
  or message.deduplication_key<>'intake-clarification:'||notice.root_draft_id::text||':'||notice.question_id::text||':v1'
  or message.provider_idempotency_key<>message.deduplication_key then raise exception 'intake_notice_lease_invalid'; end if;
 current_email:=public.ap_verified_intake_email(notice.customer_id);
 ids:=public.ap_intake_draft_chain(notice.root_draft_id);
 if current_email<>notice.recipient_email or not exists(select 1 from public.ap_intake_account_claims
  where root_draft_id=notice.root_draft_id and customer_id=notice.customer_id)
  or not exists(select 1 from public.ap_candidate_questions q join public.ap_intake_snapshots s on s.id=q.snapshot_id
   where q.id=notice.question_id and s.draft_id=any(ids))
  or exists(select 1 from public.ap_anonymous_drafts where id=any(ids) and (expires_at<=clock_timestamp() or retention_state<>'ACTIVE'))
  or exists(select 1 from public.ap_service_retention_claims where customer_id=notice.customer_id and state='PENDING')
  or exists(select 1 from public.ap_retention_row_receipts where (table_name='ap_intake_account_claims' and row_id=notice.root_draft_id::text)
   or (table_name='ap_intake_clarification_notices' and row_id=notice.message_id::text))
  then raise exception 'intake_notice_unavailable'; end if;
 return jsonb_build_object('messageId',message.id,'customerId',notice.customer_id,'questionId',notice.question_id,
  'rootDraftId',notice.root_draft_id,'recipientEmail',notice.recipient_email,'providerIdempotencyKey',message.provider_idempotency_key,
  'templateVersion',notice.template_version);
end $$;
create function public.ap_pin_intake_clarification_delivery(p_message_id uuid,p_lease_owner text,p_payload_sha256 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare notice public.ap_intake_clarification_notices;
begin
 if p_payload_sha256 is null or p_payload_sha256!~'^[a-f0-9]{64}$' then raise exception 'intake_notice_envelope_invalid'; end if;
 perform public.ap_prepare_intake_clarification_notification(p_message_id,p_lease_owner);
 select * into notice from public.ap_intake_clarification_notices where message_id=p_message_id for update;
 if notice.delivery_envelope_sha256 is null then
  update public.ap_intake_clarification_notices set delivery_envelope_sha256=p_payload_sha256 where message_id=p_message_id;
 elsif notice.delivery_envelope_sha256<>p_payload_sha256 then raise exception 'intake_notice_envelope_changed'; end if;
 return jsonb_build_object('messageId',p_message_id,'payloadSha256',p_payload_sha256);
end $$;
alter function public.ap_issue_candidate_question(uuid,uuid,uuid,uuid,text) rename to ap_issue_candidate_question_before_103;
create function public.ap_issue_candidate_question(p_snapshot_id uuid,p_job_snapshot_id uuid,p_node_id uuid,p_actor_id uuid,p_prompt text) returns uuid
language plpgsql security definer set search_path='' as $$
declare question_id uuid; root_id uuid;
begin
 select public.ap_intake_root_draft(draft_id) into root_id from public.ap_intake_snapshots where id=p_snapshot_id;
 if exists(select 1 from public.ap_intake_account_claims where root_draft_id=root_id) then perform public.ap_lock_owned_intake(root_id); end if;
 question_id:=public.ap_issue_candidate_question_before_103(p_snapshot_id,p_job_snapshot_id,p_node_id,p_actor_id,p_prompt);
 if root_id is not null then perform public.ap_enqueue_intake_clarification_notices(root_id); end if;
 return question_id;
end $$;

create function public.ap_guard_intake_claim_identity() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and public.ap_retention_redaction_permitted(tg_relid,to_jsonb(old),to_jsonb(new)) then return new; end if;
 if tg_table_name='ap_intake_clarification_notices' and tg_op='UPDATE'
  and to_jsonb(old)->'delivery_envelope_sha256'='null'::jsonb and to_jsonb(new)->>'delivery_envelope_sha256'~'^[a-f0-9]{64}$'
  and to_jsonb(old)-'delivery_envelope_sha256'=to_jsonb(new)-'delivery_envelope_sha256' then return new; end if;
 raise exception 'intake_ownership_identity_immutable';
end $$;
create function public.ap_guard_owned_intake_access_identity() returns trigger
language plpgsql security definer set search_path='' as $$
declare claim public.ap_intake_account_claims;
begin
 if tg_op='UPDATE' and public.ap_retention_redaction_permitted(tg_relid,to_jsonb(old),to_jsonb(new)) then return new; end if;
 select * into claim from public.ap_intake_account_claims where root_draft_id=public.ap_intake_root_draft(
  case when tg_table_name='ap_anonymous_drafts' then new.id else (to_jsonb(new)->>'draft_id')::uuid end);
 if claim.root_draft_id is null then return new; end if;
 if tg_table_name='ap_anonymous_drafts' then
  if nullif(lower(btrim(new.answers->>'email')),'') is distinct from claim.access_email_normalized then raise exception 'owned_intake_access_identity_mismatch'; end if;
 else
  if new.access_email_normalized is distinct from claim.access_email_normalized or (new.customer_id is not null and new.customer_id<>claim.customer_id)
   then raise exception 'owned_intake_access_identity_mismatch'; end if;
 end if;
 return new;
end $$;
create trigger ap_owned_intake_email before update of answers on public.ap_anonymous_drafts for each row execute function public.ap_guard_owned_intake_access_identity();
create trigger ap_owned_intake_snapshot_email before insert on public.ap_intake_snapshots for each row execute function public.ap_guard_owned_intake_access_identity();

create function public.ap_prelock_claimed_intake(p_draft_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if public.ap_intake_claim_customer(p_draft_id) is not null then perform public.ap_lock_owned_intake(p_draft_id); end if;
end $$;
-- Cleanup must also acquire the newly discoverable owner before draft rows.
-- Unlike interactive resume this accepts expired drafts; contention skips a
-- candidate for a later maintenance cycle instead of reversing the lock order.
create function public.ap_try_lock_intake_retention_owners(p_draft_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare owner_id uuid; d public.ap_anonymous_drafts;
begin
 select * into d from public.ap_anonymous_drafts where id=p_draft_id;
 if d.id is null then return false; end if;
 for owner_id in select unnest(public.ap_retention_row_customers('ap_anonymous_drafts',to_jsonb(d))) order by 1 loop
  if not pg_try_advisory_xact_lock(hashtextextended('service-retention:'||owner_id::text,0)) then return false; end if;
  if exists(select 1 from public.ap_service_retention_claims where customer_id=owner_id and state='PENDING') then return false; end if;
 end loop;
 return true;
end $$;
do $$ declare definition text; anchor text; begin
 definition:=pg_get_functiondef('public.ap_claim_unpaid_source_cleanup(integer)'::regprocedure);
 anchor:='where config.singleton and d.state in';
 if position(anchor in definition)=0 then raise exception 'owned_cleanup_empty_draft_lock_anchor_missing'; end if;
 definition:=replace(definition,anchor,'where config.singleton and public.ap_try_lock_intake_retention_owners(d.id) and d.state in');
 anchor:='perform 1 from public.ap_anonymous_drafts draft where draft.id=draft_id for update;';
 if position(anchor in definition)=0 then raise exception 'owned_cleanup_claim_lock_anchor_missing'; end if;
 definition:=replace(definition,anchor,'if not public.ap_try_lock_intake_retention_owners(draft_id) then continue; end if;'||chr(10)||'   '||anchor);
 execute definition;
 definition:=pg_get_functiondef('public.ap_authorize_unpaid_source_delete(uuid,uuid)'::regprocedure);
 anchor:='perform 1 from public.ap_anonymous_drafts where id=doc.draft_id for update;';
 if position(anchor in definition)=0 then raise exception 'owned_cleanup_authorize_lock_anchor_missing'; end if;
 definition:=replace(definition,anchor,'if not public.ap_try_lock_intake_retention_owners(doc.draft_id) then return null; end if;'||chr(10)||' '||anchor);
 execute definition;
 definition:=pg_get_functiondef('public.ap_finish_unpaid_source_delete(uuid,uuid,boolean)'::regprocedure);
 anchor:='if not p_succeeded then';
 if position(anchor in definition)=0 then raise exception 'owned_cleanup_finish_lock_anchor_missing'; end if;
 definition:=replace(definition,anchor,'if not public.ap_try_lock_intake_retention_owners((select draft_id from public.ap_document_versions where id=p_document_id)) then return false; end if;'||chr(10)||' '||anchor);
 execute definition;
end $$;
do $$ declare name text; definition text; rewritten text; begin
 foreach name in array array['ap_save_four_step_draft','ap_register_anonymous_document','ap_remove_anonymous_document',
  'ap_retry_anonymous_document','ap_record_fact_presentation','ap_record_isolated_document_review','ap_finalize_four_step_intake',
  'ap_prepare_intake_confirmation','ap_annotate_document_facts','ap_retry_document_processing'] loop
  select pg_get_functiondef(p.oid) into strict definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=name;
  rewritten:=regexp_replace(definition,E'\\mbegin\\M','begin'||chr(10)||' perform public.ap_prelock_claimed_intake(p_draft_id);','i');
  if definition=rewritten then raise exception 'owned_intake_writer_lock_anchor_missing:%',name; end if; execute rewritten;
 end loop;
end $$;

-- Provider request recipients are immutable once prepared. Historical rows
-- receive NULL only; a claim never backfills an old address into a new pin.
alter table public.ap_checkout_attempts add column claimed_customer_email text
 check(claimed_customer_email=lower(btrim(claimed_customer_email)) and length(claimed_customer_email) between 3 and 320);
alter table public.ap_outbox_messages
 add column claimed_root_draft_id uuid references public.ap_intake_account_claims(root_draft_id),
 add column claimed_recipient_email text check(claimed_recipient_email=lower(btrim(claimed_recipient_email)) and length(claimed_recipient_email) between 3 and 320),
 add column claimed_delivery_envelope_sha256 text check(claimed_delivery_envelope_sha256~'^[a-f0-9]{64}$');

create function public.ap_claimed_checkout_email(p_checkout_id uuid,p_historical_email text) returns text
language plpgsql stable security definer set search_path='' as $$
declare checkout public.ap_checkout_attempts; owner_id uuid;
begin
 select * into strict checkout from public.ap_checkout_attempts where id=p_checkout_id;
 owner_id:=public.ap_intake_claim_customer(checkout.draft_id);
 if owner_id is null then return p_historical_email; end if;
 if checkout.customer_id is distinct from owner_id or checkout.claimed_customer_email is null
  or checkout.claimed_customer_email is distinct from public.ap_verified_intake_email(owner_id)
  or exists(select 1 from public.ap_retention_row_receipts where table_name='ap_checkout_attempts' and row_id=checkout.id::text)
  then raise exception 'claimed_checkout_recipient_changed_reconcile'; end if;
 return checkout.claimed_customer_email;
end $$;

-- Resolve the actual message's financial graph, never an email match. A valid
-- unclaimed historical graph is distinct from missing or inconsistent data.
create function public.ap_claimed_payment_message_identity(p_message_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare message public.ap_outbox_messages; snapshot_id uuid; draft_id uuid; owner_id uuid; root_id uuid; due_at timestamptz;
begin
 select * into message from public.ap_outbox_messages where id=p_message_id;
 if message.id is null or message.message_kind='INTAKE_CLARIFICATION_REQUIRED' then raise exception 'claimed_payment_context_missing'; end if;
 if message.order_id is not null then
  select s.original_snapshot_id,s.delivery_due_at into snapshot_id,due_at from public.ap_search_services s
   join public.orders o on o.id=s.legacy_order_id and o.customer_id=s.customer_id where s.legacy_order_id=message.order_id;
 elsif message.message_kind in('CAPACITY_EXCEPTION_REFUND','DUPLICATE_PAYMENT_REFUND','STALE_PAYMENT_REFUND') then
  select id into snapshot_id from public.ap_intake_snapshots where id::text=message.recipient_ref;
 elsif message.message_kind='REFUND_INITIATED' then
  select q.snapshot_id into snapshot_id from public.ap_payment_attempts p join public.ap_checkout_attempts c on c.id=p.checkout_attempt_id
   join public.ap_quotes q on q.id=c.quote_id where p.id::text=message.recipient_ref;
 elsif message.message_kind in('REFUND_COMPLETED','REFUND_PROCESSING','REFUND_PROBLEM') then
  select q.snapshot_id into snapshot_id from public.ap_refund_operations r join public.ap_payment_attempts p on p.id=r.payment_attempt_id
   join public.ap_checkout_attempts c on c.id=p.checkout_attempt_id join public.ap_quotes q on q.id=c.quote_id where r.id::text=message.recipient_ref;
 else raise exception 'claimed_payment_context_missing'; end if;
 select s.draft_id into draft_id from public.ap_intake_snapshots s where s.id=snapshot_id;
 if not found then raise exception 'claimed_payment_context_missing'; end if;
 -- Older direct customer/intake snapshots legitimately predate anonymous
 -- drafts. Their existing financial graph remains an unclaimed history path.
 if draft_id is not null then
  root_id:=public.ap_intake_root_draft(draft_id);
  if root_id is null then raise exception 'claimed_payment_context_missing'; end if;
 end if;
 select customer_id into owner_id from public.ap_intake_account_claims where root_draft_id=root_id;
 if owner_id is null then
  if message.claimed_root_draft_id is not null or message.claimed_recipient_email is not null or message.claimed_delivery_envelope_sha256 is not null
   then raise exception 'claimed_payment_context_missing'; end if;
  return jsonb_build_object('claimed',false);
 end if;
 if message.customer_id is distinct from owner_id
  or not exists(select 1 from public.profiles where id=owner_id)
  or (message.order_id is not null and not exists(select 1 from public.orders where id=message.order_id and customer_id=owner_id))
  then raise exception 'claimed_payment_owner_mismatch'; end if;
 return jsonb_build_object('claimed',true,'customerId',owner_id,'rootDraftId',root_id,'deliveryDueAt',due_at);
end $$;

create function public.ap_prepare_claimed_payment_notification(p_message_id uuid,p_lease_owner text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare identity_value jsonb; fresh_identity jsonb; message public.ap_outbox_messages; recipient text; root_id uuid; owner_id uuid;
begin
 perform 1 from public.ap_retention_restore_lock where singleton for share;
 if exists(select 1 from public.ap_retention_restore_lock where singleton and locked) then raise exception 'retention_restore_locked'; end if;
 perform pg_advisory_xact_lock_shared(6384910250098);
 if public.ap_archive_fence_active() then raise exception using errcode='40001',message='archive_maintenance_retry_required'; end if;
 identity_value:=public.ap_claimed_payment_message_identity(p_message_id);
 owner_id:=(identity_value->>'customerId')::uuid;
 if owner_id is not null then perform pg_advisory_xact_lock(hashtextextended('service-retention:'||owner_id::text,0)); end if;
 select * into message from public.ap_outbox_messages where id=p_message_id for update;
 if message.id is null or message.state<>'SENDING' or message.lease_owner is distinct from p_lease_owner
  or message.lease_expires_at<=clock_timestamp() or message.first_submitted_at is null
  or message.first_submitted_at>clock_timestamp() or message.first_submitted_at+interval '24 hours'<=clock_timestamp()
  then raise exception 'claimed_payment_lease_invalid'; end if;
 fresh_identity:=public.ap_claimed_payment_message_identity(p_message_id);
 if fresh_identity is distinct from identity_value then raise exception using errcode='40001',message='claimed_payment_context_changed'; end if;
 if not (identity_value->>'claimed')::boolean then return identity_value; end if;
 root_id:=(identity_value->>'rootDraftId')::uuid;
 if exists(select 1 from public.ap_service_retention_claims where customer_id=owner_id and state='PENDING')
  or exists(select 1 from public.ap_retention_row_receipts where (table_name='ap_intake_account_claims' and row_id=root_id::text)
   or (table_name='ap_outbox_messages' and row_id=message.id::text)) then raise exception 'claimed_payment_content_removed'; end if;
 recipient:=public.ap_verified_intake_email(owner_id);
 if message.claimed_root_draft_id is null and message.claimed_recipient_email is null and message.claimed_delivery_envelope_sha256 is null then
  update public.ap_outbox_messages set claimed_root_draft_id=root_id,claimed_recipient_email=recipient where id=message.id;
 elsif message.claimed_root_draft_id is distinct from root_id or message.claimed_recipient_email is distinct from recipient
  then raise exception 'claimed_payment_recipient_changed'; end if;
 return jsonb_build_object('claimed',true,'messageId',message.id,'customerId',owner_id,'orderId',message.order_id,
  'rootDraftId',root_id,'deliveryDueAt',identity_value->'deliveryDueAt','recipientEmail',recipient,
  'providerIdempotencyKey',message.provider_idempotency_key,'templateVersion','claimed-payment-notice-v1');
end $$;
create function public.ap_pin_claimed_payment_delivery(p_message_id uuid,p_lease_owner text,p_payload_sha256 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context_value jsonb; pinned text;
begin
 if p_payload_sha256 is null or p_payload_sha256!~'^[a-f0-9]{64}$' then raise exception 'claimed_payment_envelope_invalid'; end if;
 context_value:=public.ap_prepare_claimed_payment_notification(p_message_id,p_lease_owner);
 if not (context_value->>'claimed')::boolean then raise exception 'claimed_payment_context_missing'; end if;
 select claimed_delivery_envelope_sha256 into pinned from public.ap_outbox_messages where id=p_message_id for update;
 if pinned is null then update public.ap_outbox_messages set claimed_delivery_envelope_sha256=p_payload_sha256 where id=p_message_id;
 elsif pinned<>p_payload_sha256 then raise exception 'claimed_payment_envelope_changed'; end if;
 return jsonb_build_object('messageId',p_message_id,'payloadSha256',p_payload_sha256);
end $$;

-- Pin writes use nonblocking owner locks because old financial state writers
-- already hold their row. They may safely retry, but cannot form a lock cycle.
-- Receipt-covered nonprivate settlement/lease fields remain reconcilable.
create function public.ap_guard_claimed_delivery_pins() returns trigger
language plpgsql security definer set search_path='' as $$
declare owner_id uuid; identity_value jsonb; before_value jsonb:=case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end; after_value jsonb:=to_jsonb(new);
begin
 if tg_op='UPDATE' and public.ap_retention_redaction_permitted(tg_relid,before_value,after_value) then return new; end if;
 if tg_table_name='ap_checkout_attempts' then
  if tg_op='UPDATE' and old.claimed_customer_email is distinct from new.claimed_customer_email then raise exception 'claimed_delivery_pin_immutable'; end if;
  if tg_op='UPDATE' or new.claimed_customer_email is null then return new; end if;
  owner_id:=public.ap_intake_claim_customer(new.draft_id);
  if new.customer_id is distinct from owner_id or new.claimed_customer_email is distinct from public.ap_verified_intake_email(owner_id)
   then raise exception 'claimed_delivery_pin_invalid'; end if;
 else
  if tg_op='INSERT' then
   if new.claimed_root_draft_id is not null or new.claimed_recipient_email is not null or new.claimed_delivery_envelope_sha256 is not null
    then raise exception 'claimed_delivery_pin_invalid'; end if;
   return new;
  end if;
  if row(old.id,old.customer_id,old.order_id,old.message_kind,old.recipient_ref,old.payload_ref,old.deduplication_key,old.provider_idempotency_key)
    is distinct from row(new.id,new.customer_id,new.order_id,new.message_kind,new.recipient_ref,new.payload_ref,new.deduplication_key,new.provider_idempotency_key)
    and (old.claimed_root_draft_id is not null or new.claimed_root_draft_id is not null)
   then raise exception 'claimed_delivery_pin_immutable'; end if;
  if old.claimed_root_draft_id is not null and (old.claimed_root_draft_id is distinct from new.claimed_root_draft_id
    or old.claimed_recipient_email is distinct from new.claimed_recipient_email
    or (before_value-ARRAY['state','attempts','next_attempt_at','provider_message_id','reconciliation_state','last_error_code','updated_at','lease_owner','lease_expires_at','first_submitted_at','dead_lettered_at','provider_idempotency_expires_at','claimed_delivery_envelope_sha256'])
       is distinct from (after_value-ARRAY['state','attempts','next_attempt_at','provider_message_id','reconciliation_state','last_error_code','updated_at','lease_owner','lease_expires_at','first_submitted_at','dead_lettered_at','provider_idempotency_expires_at','claimed_delivery_envelope_sha256']))
   then raise exception 'claimed_delivery_pin_immutable'; end if;
  if old.claimed_delivery_envelope_sha256 is not null and old.claimed_delivery_envelope_sha256 is distinct from new.claimed_delivery_envelope_sha256
   then raise exception 'claimed_delivery_pin_immutable'; end if;
  if row(old.claimed_root_draft_id,old.claimed_recipient_email,old.claimed_delivery_envelope_sha256)
    is not distinct from row(new.claimed_root_draft_id,new.claimed_recipient_email,new.claimed_delivery_envelope_sha256) then return new; end if;
  identity_value:=public.ap_claimed_payment_message_identity(new.id);
  owner_id:=(identity_value->>'customerId')::uuid;
  if not (identity_value->>'claimed')::boolean or new.claimed_root_draft_id is distinct from (identity_value->>'rootDraftId')::uuid
   or new.claimed_recipient_email is distinct from public.ap_verified_intake_email(owner_id) then raise exception 'claimed_delivery_pin_invalid'; end if;
 end if;
 if not pg_try_advisory_xact_lock(hashtextextended('service-retention:'||owner_id::text,0))
  then raise exception using errcode='40001',message='claimed_delivery_owner_busy'; end if;
 if exists(select 1 from public.ap_service_retention_claims where customer_id=owner_id and state='PENDING')
  or exists(select 1 from public.ap_retention_row_receipts where table_name=tg_table_name and row_id=new.id::text)
  then raise exception 'claimed_payment_content_removed'; end if;
 return new;
end $$;

-- Claimed payment identity is durable even after expiry/minimization. Preserve
-- the exact historical email check only when no claim ever existed.
do $$ declare definition text; anchor text; rewritten text; begin
 select pg_get_functiondef(p.oid) into strict definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='ap_begin_search_checkout';
 if position('allocation_id_local:=public.ap_reserve_capacity(null,' in definition)=0
  or position('insert into public.ap_quotes(id,draft_id,snapshot_id,' in definition)=0
  or position('values(p_quote_id,p_draft_id,p_snapshot_id,' in definition)=0 then raise exception 'claimed_checkout_financial_owner_anchor_missing'; end if;
 definition:=replace(definition,'allocation_id_local:=public.ap_reserve_capacity(null,',
  'allocation_id_local:=public.ap_reserve_capacity(public.ap_intake_claim_customer(p_draft_id),');
 definition:=replace(definition,'insert into public.ap_quotes(id,draft_id,snapshot_id,','insert into public.ap_quotes(id,customer_id,draft_id,snapshot_id,');
 definition:=replace(definition,'values(p_quote_id,p_draft_id,p_snapshot_id,','values(p_quote_id,public.ap_intake_claim_customer(p_draft_id),p_draft_id,p_snapshot_id,');
 execute definition;
 select pg_get_functiondef(p.oid) into strict definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='ap_begin_authorized_search_checkout';
 rewritten:=regexp_replace(definition,E'\\mbegin\\M','begin'||chr(10)||$a$
  if public.ap_intake_claim_customer(p_draft_id) is not null then
   perform public.ap_lock_owned_intake(p_draft_id,null,true);
   if public.ap_intake_claim_customer(p_draft_id) is distinct from p_customer_id then raise exception 'access_identity_mismatch'; end if;
  end if;$a$,'i');
 if definition=rewritten then raise exception 'owned_checkout_authority_anchor_missing'; end if;
 if position('snapshot.access_email_normalized,existing.provider_session_deadline' in rewritten)=0 then raise exception 'owned_checkout_recipient_anchor_missing'; end if;
 rewritten:=replace(rewritten,'snapshot.access_email_normalized,existing.provider_session_deadline',
  'public.ap_claimed_checkout_email(checkout.id,snapshot.access_email_normalized),existing.provider_session_deadline');
 execute rewritten;
 select pg_get_functiondef(p.oid) into strict definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='ap_apply_verified_search_payment';
 anchor:='if not exists(select 1 from public.profiles where id=p_customer_id and lower(email)=snapshot_row.access_email_normalized)';
 if position(anchor in definition)=0 then raise exception 'owned_intake_payment_identity_anchor_missing'; end if;
 definition:=replace(definition,anchor,$a$if (public.ap_intake_payment_identity(checkout_row.draft_id,snapshot_row.id)->>'claimed')::boolean
  and ((public.ap_intake_payment_identity(checkout_row.draft_id,snapshot_row.id)->>'customerId')::uuid is distinct from p_customer_id
   or (checkout_row.customer_id is not null and checkout_row.customer_id<>p_customer_id))
  or not (public.ap_intake_payment_identity(checkout_row.draft_id,snapshot_row.id)->>'claimed')::boolean
   and not exists(select 1 from public.profiles where id=p_customer_id and lower(email)=snapshot_row.access_email_normalized)$a$);
 anchor:=$a$checkout_row.browser_capability_secret_hash,'ISSUED',now_at,now_at,now_at+interval '15 minutes'),
    (p_email_access_capability_id,checkout_row.id,p_order_id,p_customer_id,'EMAIL_ACCESS',
    checkout_row.email_capability_secret_hash,'ISSUED',now_at,now_at,now_at+interval '15 minutes');$a$;
 if position(anchor in definition)=0 then raise exception 'claimed_payment_email_capability_anchor_missing'; end if;
 definition:=replace(definition,anchor,$a$checkout_row.browser_capability_secret_hash,'ISSUED',now_at,now_at,now_at+interval '15 minutes');
  if public.ap_intake_claim_customer(checkout_row.draft_id) is null then
   insert into public.ap_order_access_capabilities(id,checkout_attempt_id,order_id,customer_id,kind,secret_hash,state,created_at,issued_at,expires_at)
   values(p_email_access_capability_id,checkout_row.id,p_order_id,p_customer_id,'EMAIL_ACCESS',
    checkout_row.email_capability_secret_hash,'ISSUED',now_at,now_at,now_at+interval '15 minutes');
  end if;$a$);
 execute definition;
end $$;

-- Claimed accounts use ordinary verified sign-in. The historical email-only
-- lookup and bearer-link functions remain available solely to unclaimed orders.
do $$ declare definition text; anchor text; begin
 definition:=pg_get_functiondef('public.ap_find_latest_access_order(text)'::regprocedure);
 anchor:='where snapshot.access_email_normalized=lower(btrim(p_email))';
 if position(anchor in definition)=0 then raise exception 'claimed_access_lookup_anchor_missing'; end if;
 execute replace(definition,anchor,anchor||' and public.ap_intake_claim_customer(snapshot.draft_id) is null');
 definition:=pg_get_functiondef('public.ap_consume_order_access(uuid,text)'::regprocedure);
 anchor:='if snapshot_email is null then';
 if position(anchor in definition)=0 then raise exception 'claimed_access_consume_anchor_missing'; end if;
 execute replace(definition,anchor,$a$if exists(select 1 from public.ap_search_services s join public.ap_intake_snapshots i on i.id=s.original_snapshot_id
   where s.legacy_order_id=capability.order_id and public.ap_intake_claim_customer(i.draft_id) is not null)
   then raise exception 'claimed_order_requires_sign_in'; end if;
  if snapshot_email is null then$a$);
 select pg_get_functiondef(p.oid) into strict definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='ap_issue_order_access_capability';
 anchor:='if checkout_row.id is null or not exists(';
 if position(anchor in definition)=0 then raise exception 'claimed_access_issue_anchor_missing'; end if;
 execute replace(definition,anchor,$a$if public.ap_intake_claim_customer(checkout_row.draft_id) is not null then raise exception 'claimed_order_requires_sign_in'; end if;
  if checkout_row.id is null or not exists($a$);
 select pg_get_functiondef(p.oid) into strict definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='ap_authorize_staging_rehearsal_checkout';
 anchor:='and lower(btrim(snapshot.access_email_normalized))=lower(btrim(customer.email))';
 if position(anchor in definition)=0 then raise exception 'claimed_rehearsal_owner_anchor_missing'; end if;
 execute replace(definition,anchor,$a$and (public.ap_intake_claim_customer(draft.id)=p_customer_id
   or public.ap_intake_claim_customer(draft.id) is null and lower(btrim(snapshot.access_email_normalized))=lower(btrim(customer.email)))$a$);
end $$;
create function public.ap_guard_claimed_checkout_owner() returns trigger
language plpgsql security definer set search_path='' as $$
declare owner_id uuid;
begin
 if tg_op='UPDATE' and public.ap_retention_redaction_permitted(tg_relid,to_jsonb(old),to_jsonb(new)) then return new; end if;
 owner_id:=public.ap_intake_claim_customer(new.draft_id);
 if owner_id is not null then
  if new.customer_id is not null and new.customer_id<>owner_id then raise exception 'access_identity_mismatch'; end if;
  new.customer_id:=owner_id;
  if tg_op='INSERT' then new.claimed_customer_email:=public.ap_verified_intake_email(owner_id); end if;
 end if;
 return new;
end $$;
create trigger ap_claimed_checkout_owner before insert or update on public.ap_checkout_attempts for each row execute function public.ap_guard_claimed_checkout_owner();
create trigger ap_service_retention_write before insert or update on public.ap_checkout_attempts for each row execute function public.ap_guard_claimed_delivery_pins();
create trigger ap_service_retention_write before insert or update on public.ap_outbox_messages for each row execute function public.ap_guard_claimed_delivery_pins();
insert into public.ap_retention_private_tables(table_name,primary_key,redaction_patch) values
 ('ap_checkout_attempts','id','{"claimed_customer_email":null}'::jsonb),
 ('ap_outbox_messages','id','{"claimed_recipient_email":null}'::jsonb)
 on conflict(table_name) do update set redaction_patch=public.ap_retention_private_tables.redaction_patch||excluded.redaction_patch;

do $$ declare item record; f record; begin
 for item in select * from (values('ap_intake_account_claims','root_draft_id','{"access_email_normalized":"removed@retention.invalid"}'::jsonb),
  ('ap_intake_clarification_notices','message_id','{"recipient_email":"removed@retention.invalid"}'::jsonb)) tables(name,key,patch) loop
  execute format('alter table public.%I enable row level security',item.name);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',item.name);
  execute format('grant select on public.%I to service_role',item.name);
  insert into public.ap_retention_private_tables values(item.name,item.key,item.patch);
  execute format('create trigger ap_service_retention_write before insert or update or delete on public.%I for each row execute function public.ap_guard_service_retention_write()',item.name);
  execute format('create trigger ap_intake_identity_immutable before update or delete on public.%I for each row execute function public.ap_guard_intake_claim_identity()',item.name);
  insert into public.ap_archive_fence_relations values('public',item.name);
  execute format('create trigger ap_archive_source_mutation before insert or update or delete or truncate on public.%I for each statement execute function public.ap_guard_archive_source_mutation()',item.name);
 end loop;
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and p.proname in('ap_intake_root_draft','ap_intake_draft_chain','ap_intake_claim_customer','ap_verified_intake_email','ap_lock_owned_intake',
   'ap_owned_intake_metadata','ap_owned_intake_draft_context','ap_owned_intake_drafts','ap_create_owned_intake_draft','ap_claim_intake_draft','ap_resume_owned_intake_draft',
   'ap_customer_owns_snapshot','ap_customer_owns_snapshot_before_103','ap_retention_snapshot_customers','ap_retention_snapshot_customers_before_103',
   'ap_retention_row_customers','ap_retention_row_customers_before_103','ap_intake_payment_identity','ap_enqueue_intake_clarification_notices',
   'ap_prepare_intake_clarification_notification','ap_pin_intake_clarification_delivery','ap_issue_candidate_question','ap_issue_candidate_question_before_103','ap_guard_intake_claim_identity',
   'ap_guard_owned_intake_access_identity','ap_prelock_claimed_intake','ap_try_lock_intake_retention_owners','ap_guard_claimed_checkout_owner',
   'ap_claimed_checkout_email','ap_claimed_payment_message_identity','ap_prepare_claimed_payment_notification','ap_pin_claimed_payment_delivery','ap_guard_claimed_delivery_pins') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in('ap_owned_intake_draft_context','ap_owned_intake_drafts','ap_create_owned_intake_draft','ap_claim_intake_draft','ap_resume_owned_intake_draft',
   'ap_intake_payment_identity','ap_prepare_intake_clarification_notification','ap_pin_intake_clarification_delivery','ap_issue_candidate_question','ap_customer_owns_snapshot',
   'ap_prepare_claimed_payment_notification','ap_pin_claimed_payment_delivery') then
   execute format('grant execute on function %s to service_role',f.signature);
   execute format('alter function %s set lock_timeout=''5s''',f.signature);
  end if;
 end loop;
end $$;
update public.ap_archive_fence_function_contracts set definition_sha256=encode(extensions.digest(pg_get_functiondef(signature::regprocedure),'sha256'),'hex')
 where signature in('public.ap_retention_snapshot_customers(uuid)','public.ap_retention_row_customers(text,jsonb)');
insert into public.ap_archive_fence_function_contracts
 select signature,encode(extensions.digest(pg_get_functiondef(signature::regprocedure),'sha256'),'hex') from unnest(array[
  'public.ap_retention_snapshot_customers_before_103(uuid)','public.ap_retention_row_customers_before_103(text,jsonb)',
  'public.ap_intake_root_draft(uuid)','public.ap_intake_claim_customer(uuid)',
  'public.ap_claimed_checkout_email(uuid,text)','public.ap_claimed_payment_message_identity(uuid)',
  'public.ap_prepare_claimed_payment_notification(uuid,text)','public.ap_pin_claimed_payment_delivery(uuid,text,text)',
  'public.ap_guard_claimed_delivery_pins()','public.ap_guard_claimed_checkout_owner()']) signature;
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.ap_archive_fence_coverage_current()'::regprocedure);
 if position('count(*)=18' in definition)=0 then raise exception 'owned_intake_archive_roster_anchor_missing'; end if;
 definition:=replace(definition,'count(*)=18','count(*)=28');
 definition:=replace(definition,'''public.ap_retention_snapshot_customers(uuid)''',
  '''public.ap_retention_snapshot_customers(uuid)'',''public.ap_retention_snapshot_customers_before_103(uuid)'',''public.ap_retention_row_customers_before_103(text,jsonb)'',''public.ap_intake_root_draft(uuid)'',''public.ap_intake_claim_customer(uuid)'',''public.ap_claimed_checkout_email(uuid,text)'',''public.ap_claimed_payment_message_identity(uuid)'',''public.ap_prepare_claimed_payment_notification(uuid,text)'',''public.ap_pin_claimed_payment_delivery(uuid,text,text)'',''public.ap_guard_claimed_delivery_pins()'',''public.ap_guard_claimed_checkout_owner()''');
 execute definition;
end $$;

create function public.ap_resume_material_clarification(p_question_id uuid,p_draft_id uuid,p_secret_hash text,p_customer_id uuid,
 p_successor_draft_id uuid,p_successor_secret_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q public.ap_candidate_questions; s public.ap_intake_snapshots; c public.ap_intake_clarifications;
 d public.ap_anonymous_drafts; prior public.ap_intake_clarification_answers; context jsonb;
begin
 if p_question_id is null or p_successor_draft_id is null or p_successor_secret_hash is null
  or p_successor_secret_hash!~'^[a-f0-9]{64}$' then raise exception 'question_owner_or_version_invalid'; end if;
 -- Reject foreign callers before taking the original-source lock. This same
 -- ownership proof is repeated after the source and successor rows are locked.
 context:=public.ap_material_clarification_answer_context(p_question_id,p_draft_id,p_secret_hash,p_customer_id);
 if context->>'mode' is distinct from 'CONFIRMED_INTAKE'
  or context->>'successorDraftId' is distinct from p_successor_draft_id::text
  then raise exception 'clarification_not_open'; end if;
 select * into q from public.ap_candidate_questions where id=p_question_id;
 s:=public.ap_lock_material_clarification(q.snapshot_id);
 select * into c from public.ap_intake_clarifications where source_snapshot_id=s.id for update;
 if c.id is null or c.source_draft_id is distinct from s.draft_id or c.draft_id is distinct from p_successor_draft_id
  or c.confirmed_snapshot_id is not null then raise exception 'clarification_not_open'; end if;
 select * into d from public.ap_anonymous_drafts where id=c.draft_id for update;
 context:=public.ap_material_clarification_answer_context(p_question_id,p_draft_id,p_secret_hash,p_customer_id);
 if context->>'mode' is distinct from 'CONFIRMED_INTAKE' or context->>'sourceDraftId' is distinct from s.draft_id::text
  or context->>'successorDraftId' is distinct from d.id::text
  or (p_customer_id is not null and c.customer_id is not null and c.customer_id<>p_customer_id)
  then raise exception 'question_owner_or_version_invalid'; end if;
 if d.id is null or d.state<>'IN_PROGRESS' or d.expires_at<=clock_timestamp() or d.retention_state<>'ACTIVE'
  or d.finalized_snapshot_id is not null then raise exception 'clarification_not_open'; end if;
 if d.converted_customer_id is not null or exists(select 1 from public.ap_checkout_attempts
  where draft_id=d.id and state not in('EXPIRED','CANCELED','FAILED'))
  then raise exception 'clarification_paid_or_checkout_owner_exception'; end if;
 select * into prior from public.ap_intake_clarification_answers where question_id=q.id;
 if prior.question_id is null or prior.draft_id is distinct from d.id or prior.source_snapshot_id is distinct from s.id
  then raise exception 'clarification_not_open'; end if;
 -- Anonymous recovery must prove the already-issued successor capability.
 -- A freshly authenticated owner may rotate only that unpaid draft capability.
 if p_customer_id is null and d.capability_secret_hash<>p_successor_secret_hash
  then raise exception 'clarification_capability_conflict'; end if;
 if p_customer_id is not null and d.capability_secret_hash<>p_successor_secret_hash then
  update public.ap_anonymous_drafts set capability_secret_hash=p_successor_secret_hash,capability_version=capability_version+1,
   capability_rotated_at=clock_timestamp() where id=d.id;
 end if;
 return jsonb_build_object('state','FULL_REVIEW_REQUIRED','draftId',d.id,'version',d.version,'expiresAt',d.expires_at,'replayed',true);
end $$;
revoke all on function public.ap_resume_material_clarification(uuid,uuid,text,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.ap_resume_material_clarification(uuid,uuid,text,uuid,uuid,text) to service_role;
alter function public.ap_resume_material_clarification(uuid,uuid,text,uuid,uuid,text) set lock_timeout='5s';

create or replace function public.ap_archive_snapshot_schema_supported(p_schema text) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(p_schema=any(array[
  '202610250090','202610250091','202610250092','202610250093','202610250094','202610250095',
  '202610250096','202610250097','202610250098','202610250099','202610250100','202610250101','202610260102','202610260103'
 ]) and exists(select 1 from supabase_migrations.schema_migrations where version=p_schema),false);
$$;
revoke all on function public.ap_archive_snapshot_schema_supported(text) from public,anon,authenticated,service_role;
create function public.ap_verified_intake_ownership_schema_installed() returns boolean
language sql stable security definer set search_path='' as $$
 select to_regclass('public.ap_intake_account_claims') is not null and to_regclass('public.ap_intake_clarification_notices') is not null
  and public.ap_archive_fence_coverage_current()
  and (select count(*)=4 from public.ap_retention_private_tables where table_name in('ap_intake_account_claims','ap_intake_clarification_notices','ap_checkout_attempts','ap_outbox_messages'))
  and not exists(select 1 from unnest(array['public.ap_create_owned_intake_draft(uuid,text,uuid,uuid,text,timestamptz)',
   'public.ap_claim_intake_draft(uuid,text,uuid,text)','public.ap_owned_intake_drafts(uuid,integer)',
   'public.ap_owned_intake_draft_context(uuid,uuid,text)','public.ap_resume_owned_intake_draft(uuid,uuid,uuid,integer,text)',
   'public.ap_intake_payment_identity(uuid,uuid)','public.ap_prepare_intake_clarification_notification(uuid,text)',
   'public.ap_pin_intake_clarification_delivery(uuid,text,text)','public.ap_prepare_claimed_payment_notification(uuid,text)',
   'public.ap_pin_claimed_payment_delivery(uuid,text,text)']) signature
   where to_regprocedure(signature) is null or not has_function_privilege('service_role',signature,'EXECUTE')
    or has_function_privilege('authenticated',signature,'EXECUTE') or has_function_privilege('anon',signature,'EXECUTE'))
  and exists(select 1 from pg_trigger where tgrelid='public.ap_checkout_attempts'::regclass and tgname='ap_claimed_checkout_owner' and tgenabled='O');
$$;
revoke all on function public.ap_verified_intake_ownership_schema_installed() from public,anon,authenticated;
grant execute on function public.ap_verified_intake_ownership_schema_installed() to service_role;
insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
 values('202610260103','MATERIAL_CLARIFICATION_RESUME',0,clock_timestamp());
create function public.ap_material_clarification_resume_schema_installed() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ap_migration_checkpoints where migration_id='202610260103' and checkpoint='MATERIAL_CLARIFICATION_RESUME')
 and public.ap_service_repair_case_state_schema_installed()
 and public.ap_verified_intake_ownership_schema_installed()
 and has_function_privilege('service_role','public.ap_resume_material_clarification(uuid,uuid,text,uuid,uuid,text)','EXECUTE')
 and not has_function_privilege('authenticated','public.ap_resume_material_clarification(uuid,uuid,text,uuid,uuid,text)','EXECUTE')
 and not has_function_privilege('anon','public.ap_resume_material_clarification(uuid,uuid,text,uuid,uuid,text)','EXECUTE')
 and position('ap_lock_material_clarification' in pg_get_functiondef('public.ap_resume_material_clarification(uuid,uuid,text,uuid,uuid,text)'::regprocedure))>0
 and position('ap_material_clarification_answer_context' in pg_get_functiondef('public.ap_resume_material_clarification(uuid,uuid,text,uuid,uuid,text)'::regprocedure))>0
 and position('ap_intake_clarification_answers' in pg_get_functiondef('public.ap_resume_material_clarification(uuid,uuid,text,uuid,uuid,text)'::regprocedure))>0;
$$;
revoke all on function public.ap_material_clarification_resume_schema_installed() from public,anon,authenticated;
grant execute on function public.ap_material_clarification_resume_schema_installed() to service_role;
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.ap_manual_launch_schema_readiness()'::regprocedure);
 if position('select count(*)=26 as installed' in definition)=0 or position('''requiredSchemaVersion'', ''202610260102''' in definition)=0
  or position('(''202610260102'',''SERVICE_REPAIR_CASE_STATE_CAS'')' in definition)=0
  or position('''202610250101'',''202610260102''' in definition)=0
  or position('public.ap_service_repair_case_state_schema_installed()' in definition)=0 then raise exception 'clarification_resume_readiness_anchor_missing'; end if;
 definition:=replace(definition,'select count(*)=26 as installed','select count(*)=27 as installed');
 definition:=replace(definition,'(''202610260102'',''SERVICE_REPAIR_CASE_STATE_CAS'')','(''202610260102'',''SERVICE_REPAIR_CASE_STATE_CAS''),(''202610260103'',''MATERIAL_CLARIFICATION_RESUME'')');
 definition:=replace(definition,'''requiredSchemaVersion'', ''202610260102''','''requiredSchemaVersion'', ''202610260103''');
 definition:=replace(definition,'''202610250101'',''202610260102''','''202610250101'',''202610260102'',''202610260103''');
 definition:=replace(definition,'public.ap_service_repair_case_state_schema_installed()','public.ap_service_repair_case_state_schema_installed() and public.ap_material_clarification_resume_schema_installed()');
 execute definition;
end $$;
commit;

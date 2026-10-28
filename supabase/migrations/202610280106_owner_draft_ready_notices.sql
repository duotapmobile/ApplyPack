-- Durable owner handoffs. No provider call, runtime enablement, approval or Send.
-- SUPPRESSED is used only by later RPC calls, after this transaction commits.
begin;
-- Composite argument types must be qualified identically when definitions are
-- hashed here and verified by the archive fence's empty search path.
set local search_path='';
alter type public.ap_outbox_state add value 'SUPPRESSED';

create table public.ap_material_draft_owner_notices (
 message_id uuid primary key references public.ap_outbox_messages(id) deferrable initially deferred,
 job_id uuid not null references public.ap_material_draft_jobs(id),
 draft_version_id uuid not null references public.ap_material_draft_versions(id),
 customer_id uuid not null references public.profiles(id),
 material_line_id uuid not null references public.ap_material_lines(id),
 phase text not null check(phase in('SOURCE_READY','REVIEW_READY')),
 packet_sha256 text not null check(packet_sha256~'^[a-f0-9]{64}$'),
 source_sha256 text not null check(source_sha256~'^[a-f0-9]{64}$'),
 member_set_sha256 text check(member_set_sha256~'^[a-f0-9]{64}$'),
 ready_at timestamptz not null default clock_timestamp(),
 template_version text not null default 'owner-draft-notice-v1' check(template_version='owner-draft-notice-v1'),
 recipient_email text check(recipient_email is null or (recipient_email=lower(btrim(recipient_email)) and length(recipient_email) between 3 and 254
  and recipient_email~'^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$')),
 delivery_envelope_sha256 text check(delivery_envelope_sha256~'^[a-f0-9]{64}$'),
 suppression_reason text check(suppression_reason in('VERSION_SUPERSEDED','PHASE_COMPLETED','OBLIGATION_INACTIVE','NO_LONGER_READY')),
 suppressed_at timestamptz,
 unique(job_id,draft_version_id,phase),
 check((phase='REVIEW_READY')=(member_set_sha256 is not null)),
 check((suppression_reason is null)=(suppressed_at is null)),
 check(suppressed_at is null or delivery_envelope_sha256 is null)
);
alter table public.ap_material_draft_owner_notices enable row level security;
revoke all on public.ap_material_draft_owner_notices from public,anon,authenticated,service_role;
grant select on public.ap_material_draft_owner_notices to service_role;

-- Read-only eligibility: no customer/financial locks are acquired while a
-- readiness writer already owns its job row. Owner-created versions have no
-- validated model attempt and deliberately do not create SOURCE_READY events.
create function public.ap_owner_draft_ready_phase(p_job_id uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare j public.ap_material_draft_jobs; v public.ap_material_draft_versions; l public.ap_material_lines;
 r public.ap_material_line_revisions; p public.ap_payment_attempts; expected_types text[];
begin
 select * into j from public.ap_material_draft_jobs where id=p_job_id;
 if j.id is null or j.state not in('SOURCE_READY','REVIEW_READY') then return null; end if;
 select * into v from public.ap_material_draft_versions where id=j.active_version_id;
 select * into l from public.ap_material_lines where id=j.material_line_id;
 select * into r from public.ap_material_line_revisions where id=j.line_revision_id;
 select * into p from public.ap_payment_attempts where id=l.payment_attempt_id;
 if v.id is null or v.job_id is distinct from j.id or v.customer_id is distinct from j.customer_id or v.material_line_id is distinct from l.id
  or v.invalidated_at is not null or v.release_id is not null or v.source_sha256 is null
  or r.id is null or r.line_id is distinct from l.id or r.version is distinct from l.active_revision or r.superseded_at is not null
  or r.source_snapshot_id is distinct from j.source_snapshot_id or r.due_at is null or r.due_at<=clock_timestamp()
  or l.materials_due_at is distinct from r.due_at or l.fulfillment not in('PAID','GENERATING','HUMAN_REVIEW','READY_TO_RELEASE')
  or p.customer_id is distinct from j.customer_id or p.settlement is distinct from 'PAID' or p.dispute in('OPEN','LOST')
  or p.funds_reversed_at is not null or p.immediate_charge_verified is distinct from true or p.payment_verified_at is null
  or not exists(select 1 from public.ap_material_purchases where id=l.purchase_id and customer_id=j.customer_id and payment_attempt_id=p.id
    and amount_cents=p.amount_cents and currency=p.currency)
  or exists(select 1 from public.ap_refund_operations where material_line_id=l.id and superseded_at is null)
  or exists(select 1 from public.ap_releases where material_line_id=l.id)
  or not public.ap_customer_owns_snapshot(j.customer_id,j.source_snapshot_id)
  or exists(select 1 from public.ap_service_retention_claims where customer_id=j.customer_id and state='PENDING')
  or not exists(select 1 from public.ap_sensitive_payloads where id=v.packet_encrypted_payload_id and customer_id=j.customer_id and content_sha256=v.packet_sha256 and retention_state='ACTIVE')
  or not exists(select 1 from public.ap_sensitive_payloads where id=v.encrypted_payload_id and customer_id=j.customer_id and content_sha256=v.source_sha256 and retention_state='ACTIVE')
  then return null; end if;
 if j.state='SOURCE_READY' then
  if v.claim_review_sha256 is not null or not exists(select 1 from public.ap_material_draft_attempts a
   join public.ap_material_draft_observations o on o.request_id=a.id and o.outcome='PROPOSAL_VALIDATED'
   where a.job_id=j.id and a.draft_version_id=v.id and a.customer_id=j.customer_id and a.material_line_id=l.id
    and a.state='RESULT_RECORDED' and a.completed_at is not null and o.provider_response_id is not null)
   then return null; end if;
 else
  expected_types:=case when l.selected_reference_sheet then array['COVER_LETTER','REFERENCE_SHEET','RESUME'] else array['COVER_LETTER','RESUME'] end;
  if v.claim_review_sha256 is null or v.claims_reviewed_at is null or v.claims_reviewed_by is null or v.member_set_sha256 is null
   or not exists(select 1 from public.ap_sensitive_payloads where id=v.claim_review_encrypted_payload_id and customer_id=j.customer_id and content_sha256=v.claim_review_sha256 and retention_state='ACTIVE')
   or (select array_agg(artifact_type::text order by artifact_type::text) from public.ap_material_draft_members where draft_version_id=v.id) is distinct from expected_types
   or exists(select 1 from public.ap_material_draft_members where draft_version_id=v.id and
     (customer_id<>j.customer_id or material_line_id<>l.id or source_sha256<>v.source_sha256))
   or v.member_set_sha256 is distinct from encode(extensions.digest(public.ap_material_draft_member_identity(v.id)::text,'sha256'),'hex')
   then return null; end if;
 end if;
 return j.state;
end $$;

-- All external notice mutations use the existing financial lock order, without
-- requiring an active obligation. Historical pinned notices remain reconcilable.
create function public.ap_lock_owner_draft_notice_graph(p_job_id uuid) returns public.ap_material_draft_jobs
language plpgsql security definer set search_path='' as $$
declare j public.ap_material_draft_jobs; observed public.ap_material_draft_jobs;
begin
 select * into observed from public.ap_material_draft_jobs where id=p_job_id;
 if observed.id is null then raise exception 'owner_notice_unavailable'; end if;
 perform 1 from public.ap_retention_restore_lock where singleton for share;
 if exists(select 1 from public.ap_retention_restore_lock where singleton and locked) then raise exception 'retention_restore_locked'; end if;
 perform pg_advisory_xact_lock_shared(6384910250098);
 if public.ap_archive_fence_active() then raise exception using errcode='40001',message='archive_maintenance_retry_required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('service-retention:'||observed.customer_id::text,0));
 perform 1 from public.ap_payment_attempts p join public.ap_material_lines l on l.payment_attempt_id=p.id where l.id=observed.material_line_id for update of p;
 perform 1 from public.ap_material_lines where id=observed.material_line_id for update;
 perform 1 from public.ap_material_line_revisions where id=observed.line_revision_id for update;
 select * into j from public.ap_material_draft_jobs where id=p_job_id for update;
 if row(j.customer_id,j.material_line_id,j.line_revision_id,j.source_snapshot_id)
  is distinct from row(observed.customer_id,observed.material_line_id,observed.line_revision_id,observed.source_snapshot_id)
  then raise exception using errcode='40001',message='owner_notice_graph_changed'; end if;
 return j;
end $$;

create function public.ap_owner_draft_notice_obsolete(p_notice public.ap_material_draft_owner_notices) returns text
language plpgsql stable security definer set search_path='' as $$
declare j public.ap_material_draft_jobs; v public.ap_material_draft_versions; l public.ap_material_lines; r public.ap_material_line_revisions; p public.ap_payment_attempts;
begin
 select * into j from public.ap_material_draft_jobs where id=p_notice.job_id;
 select * into v from public.ap_material_draft_versions where id=p_notice.draft_version_id;
 select * into l from public.ap_material_lines where id=p_notice.material_line_id;
 select * into r from public.ap_material_line_revisions where id=j.line_revision_id;
 select * into p from public.ap_payment_attempts where id=l.payment_attempt_id;
 if j.id is null or v.id is null or l.id is null or r.id is null or p.id is null then raise exception 'owner_notice_identity_invalid'; end if;
 if j.active_version_id is distinct from v.id or v.invalidated_at is not null then return 'VERSION_SUPERSEDED'; end if;
 if j.state in('APPROVED','RELEASED') or (p_notice.phase='SOURCE_READY' and
  (v.claim_review_sha256 is not null or j.state in('RENDERING','REVIEW_READY'))) then return 'PHASE_COMPLETED'; end if;
 if p.settlement<>'PAID' or p.dispute in('OPEN','LOST') or p.funds_reversed_at is not null
  or l.fulfillment not in('PAID','GENERATING','HUMAN_REVIEW','READY_TO_RELEASE') or l.active_revision<>r.version
  or r.superseded_at is not null or r.due_at<=clock_timestamp()
  or exists(select 1 from public.ap_refund_operations where material_line_id=l.id and superseded_at is null)
  or exists(select 1 from public.ap_releases where material_line_id=l.id) then return 'OBLIGATION_INACTIVE'; end if;
 if j.state<>p_notice.phase then return 'NO_LONGER_READY'; end if;
 return null;
end $$;

create function public.ap_owner_draft_notice_context(p_message_id uuid,p_lease_owner text) returns public.ap_material_draft_owner_notices
language plpgsql security definer set search_path='' as $$
declare observed public.ap_material_draft_owner_notices; n public.ap_material_draft_owner_notices;
 j public.ap_material_draft_jobs; v public.ap_material_draft_versions; m public.ap_outbox_messages; expected_key text;
begin
 select * into observed from public.ap_material_draft_owner_notices where message_id=p_message_id;
 if observed.message_id is null then raise exception 'owner_notice_unavailable'; end if;
 j:=public.ap_lock_owner_draft_notice_graph(observed.job_id);
 select * into v from public.ap_material_draft_versions where id=observed.draft_version_id for update;
 select * into m from public.ap_outbox_messages where id=p_message_id for update;
 select * into n from public.ap_material_draft_owner_notices where message_id=p_message_id for update;
 expected_key:='owner-draft-ready:'||n.job_id::text||':'||n.draft_version_id::text||':'||n.phase||':v1';
 if n.message_id is null or row(n.job_id,n.draft_version_id,n.customer_id,n.material_line_id) is distinct from row(observed.job_id,observed.draft_version_id,observed.customer_id,observed.material_line_id)
  or row(j.customer_id,j.material_line_id) is distinct from row(n.customer_id,n.material_line_id)
  or row(v.job_id,v.customer_id,v.material_line_id,v.packet_sha256,v.source_sha256) is distinct from row(n.job_id,n.customer_id,n.material_line_id,n.packet_sha256,n.source_sha256)
  or (n.phase='REVIEW_READY' and v.member_set_sha256 is distinct from n.member_set_sha256)
  or m.message_kind is distinct from 'OWNER_DRAFT_REVIEW_REQUIRED' or m.customer_id is distinct from n.customer_id
  or m.recipient_ref is distinct from n.draft_version_id::text or m.order_id is not null or m.payload_ref is not null
  or m.deduplication_key is distinct from expected_key or m.provider_idempotency_key is distinct from expected_key
  or m.claimed_root_draft_id is not null or m.claimed_recipient_email is not null or m.claimed_delivery_envelope_sha256 is not null
  then raise exception 'owner_notice_identity_invalid'; end if;
 if p_lease_owner is null or length(btrim(p_lease_owner))<3 or m.state<>'SENDING' or m.lease_owner is distinct from p_lease_owner
  or m.lease_expires_at is null or m.lease_expires_at<=clock_timestamp() or m.first_submitted_at is null or m.first_submitted_at>clock_timestamp()
  or m.provider_idempotency_expires_at is null or m.provider_idempotency_expires_at<=clock_timestamp()
  or m.first_submitted_at+interval '24 hours'<=clock_timestamp() or m.provider_message_id is not null or n.suppressed_at is not null
  then raise exception 'owner_notice_lease_invalid'; end if;
 if exists(select 1 from public.ap_service_retention_claims where customer_id=n.customer_id and state='PENDING')
  or exists(select 1 from public.ap_retention_row_receipts where
   (table_name in('ap_material_draft_owner_notices','ap_outbox_messages') and row_id=n.message_id::text)
   or (table_name='ap_material_draft_jobs' and row_id=j.id::text)
   or (table_name='ap_material_draft_versions' and row_id=v.id::text)
   or (table_name='ap_intake_snapshots' and row_id=j.source_snapshot_id::text))
  or not exists(select 1 from public.ap_sensitive_payloads where id=v.packet_encrypted_payload_id and customer_id=n.customer_id and content_sha256=n.packet_sha256 and retention_state='ACTIVE')
  or not exists(select 1 from public.ap_sensitive_payloads where id=v.encrypted_payload_id and customer_id=n.customer_id and content_sha256=n.source_sha256 and retention_state='ACTIVE')
  or not public.ap_customer_owns_snapshot(n.customer_id,j.source_snapshot_id)
  then raise exception 'owner_notice_content_unavailable'; end if;
 return n;
end $$;

create function public.ap_enqueue_owner_draft_notice(p_job_id uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare j public.ap_material_draft_jobs; v public.ap_material_draft_versions; n public.ap_material_draft_owner_notices; m public.ap_outbox_messages;
 phase_value text; message_id_value uuid; key_value text;
begin
 select * into j from public.ap_material_draft_jobs where id=p_job_id;
 phase_value:=public.ap_owner_draft_ready_phase(p_job_id);
 if phase_value is null then return 0; end if;
 -- A readiness writer already owns its graph. Never block on a new reverse
 -- owner/archive lock from its AFTER trigger; contention retries the transaction.
 if not pg_try_advisory_xact_lock_shared(6384910250098) or not pg_try_advisory_xact_lock(hashtextextended('service-retention:'||j.customer_id::text,0))
  then raise exception using errcode='40001',message='owner_notice_enqueue_busy'; end if;
 if public.ap_archive_fence_active() then raise exception using errcode='40001',message='archive_maintenance_retry_required'; end if;
 if exists(select 1 from public.ap_retention_restore_lock where singleton and locked) then raise exception 'retention_restore_locked'; end if;
 select * into v from public.ap_material_draft_versions where id=j.active_version_id;
 key_value:='owner-draft-ready:'||j.id::text||':'||v.id::text||':'||phase_value||':v1';
 select * into n from public.ap_material_draft_owner_notices where job_id=j.id and draft_version_id=v.id and phase=phase_value;
 if n.message_id is not null then
  select * into m from public.ap_outbox_messages where id=n.message_id;
  if row(n.customer_id,n.material_line_id,n.packet_sha256,n.source_sha256,n.member_set_sha256)
   is distinct from row(j.customer_id,j.material_line_id,v.packet_sha256,v.source_sha256,case when phase_value='REVIEW_READY' then v.member_set_sha256 else null end)
   or m.customer_id is distinct from j.customer_id or m.message_kind is distinct from 'OWNER_DRAFT_REVIEW_REQUIRED'
   or m.recipient_ref is distinct from v.id::text or m.deduplication_key is distinct from key_value or m.provider_idempotency_key is distinct from key_value
   or m.order_id is not null or m.payload_ref is not null then raise exception 'owner_notice_identity_invalid'; end if;
  return 0;
 end if;
 message_id_value:=gen_random_uuid();
 insert into public.ap_material_draft_owner_notices(message_id,job_id,draft_version_id,customer_id,material_line_id,phase,packet_sha256,source_sha256,member_set_sha256)
 values(message_id_value,j.id,v.id,j.customer_id,j.material_line_id,phase_value,v.packet_sha256,v.source_sha256,case when phase_value='REVIEW_READY' then v.member_set_sha256 else null end);
 insert into public.ap_outbox_messages(id,customer_id,message_kind,recipient_ref,deduplication_key,provider_idempotency_key,state,next_attempt_at)
 values(message_id_value,j.customer_id,'OWNER_DRAFT_REVIEW_REQUIRED',v.id::text,key_value,key_value,'QUEUED',clock_timestamp());
 insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
 values('OUTBOX_SEND',message_id_value,'outbox-send:'||message_id_value::text,clock_timestamp());
 return 1;
end $$;
create function public.ap_trigger_owner_draft_notice() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.state in('SOURCE_READY','REVIEW_READY') and (tg_op='INSERT' or row(old.state,old.active_version_id) is distinct from row(new.state,new.active_version_id))
  then perform public.ap_enqueue_owner_draft_notice(new.id); end if;
 return new;
end $$;
create trigger ap_owner_draft_ready_notice after insert or update of state,active_version_id on public.ap_material_draft_jobs
 for each row execute function public.ap_trigger_owner_draft_notice();

create function public.ap_prepare_owner_draft_notification(p_message_id uuid,p_lease_owner text,p_recipient_email text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n public.ap_material_draft_owner_notices; reason_value text; m public.ap_outbox_messages;
begin
 if p_recipient_email is null or p_recipient_email<>lower(btrim(p_recipient_email)) or length(p_recipient_email) not between 3 and 254
  or p_recipient_email!~'^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
  then raise exception 'owner_notice_recipient_invalid'; end if;
 n:=public.ap_owner_draft_notice_context(p_message_id,p_lease_owner);
 reason_value:=public.ap_owner_draft_notice_obsolete(n);
 if n.delivery_envelope_sha256 is null and reason_value is not null then
  return jsonb_build_object('disposition','OBSOLETE','messageId',n.message_id,'reason',reason_value);
 end if;
 if n.recipient_email is not null and n.recipient_email<>p_recipient_email then raise exception 'owner_notice_recipient_changed'; end if;
 if not coalesce((select provider_idempotent_email_approved and provider_email_approval_reference is not null from public.ap_commerce_configuration where singleton),false)
  then raise exception 'email_provider_guarantee_unapproved'; end if;
 if n.recipient_email is null then update public.ap_material_draft_owner_notices set recipient_email=p_recipient_email where message_id=n.message_id; end if;
 select * into m from public.ap_outbox_messages where id=n.message_id;
 return jsonb_build_object('disposition','SEND','messageId',n.message_id,'customerId',n.customer_id,'jobId',n.job_id,'draftVersionId',n.draft_version_id,
  'phase',n.phase,'recipientEmail',p_recipient_email,'providerIdempotencyKey',m.provider_idempotency_key,'templateVersion',n.template_version);
end $$;
create function public.ap_pin_owner_draft_delivery(p_message_id uuid,p_lease_owner text,p_recipient_email text,p_payload_sha256 text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context_value jsonb; pinned text;
begin
 if p_payload_sha256 is null or p_payload_sha256!~'^[a-f0-9]{64}$' then raise exception 'owner_notice_envelope_invalid'; end if;
 context_value:=public.ap_prepare_owner_draft_notification(p_message_id,p_lease_owner,p_recipient_email);
 if context_value->>'disposition'<>'SEND' then raise exception 'owner_notice_obsolete'; end if;
 select delivery_envelope_sha256 into pinned from public.ap_material_draft_owner_notices where message_id=p_message_id;
 if pinned is null then update public.ap_material_draft_owner_notices set delivery_envelope_sha256=p_payload_sha256 where message_id=p_message_id;
 elsif pinned<>p_payload_sha256 then raise exception 'owner_notice_envelope_changed'; end if;
 return jsonb_build_object('messageId',p_message_id,'payloadSha256',p_payload_sha256);
end $$;
create function public.ap_suppress_owner_draft_notification(p_message_id uuid,p_lease_owner text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n public.ap_material_draft_owner_notices; reason_value text;
begin
 n:=public.ap_owner_draft_notice_context(p_message_id,p_lease_owner);
 if n.delivery_envelope_sha256 is not null then raise exception 'owner_notice_outcome_unconfirmed'; end if;
 reason_value:=public.ap_owner_draft_notice_obsolete(n);
 if reason_value is null then raise exception 'owner_notice_still_actionable'; end if;
 update public.ap_material_draft_owner_notices set suppression_reason=reason_value,suppressed_at=clock_timestamp() where message_id=p_message_id;
 -- Parsed/executed only after ALTER TYPE has committed. No migration-time use.
 update public.ap_outbox_messages set state='SUPPRESSED',lease_owner=null,lease_expires_at=null,next_attempt_at=null,last_error_code=null,
  reconciliation_state='NOT_REQUIRED',updated_at=clock_timestamp() where id=p_message_id;
 insert into public.ap_audit_events(customer_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
 values(n.customer_id,'OUTBOX_SUPPRESSED','OUTBOX_MESSAGE',n.message_id,jsonb_build_object('phase',n.phase,'reason',reason_value),'owner-draft-notice-v1');
 return jsonb_build_object('disposition','SUPPRESSED','messageId',n.message_id,'reason',reason_value);
end $$;

create function public.ap_guard_owner_draft_notice() returns trigger
language plpgsql security definer set search_path='' as $$
declare m public.ap_outbox_messages; j public.ap_material_draft_jobs; v public.ap_material_draft_versions;
begin
 if tg_op='UPDATE' and public.ap_retention_redaction_permitted(tg_relid,to_jsonb(old),to_jsonb(new)) then return new; end if;
 if tg_op='DELETE' then raise exception 'owner_notice_identity_immutable'; end if;
 if tg_op='INSERT' then
  select * into j from public.ap_material_draft_jobs where id=new.job_id;
  select * into v from public.ap_material_draft_versions where id=new.draft_version_id;
  if row(j.customer_id,j.material_line_id,j.active_version_id) is distinct from row(new.customer_id,new.material_line_id,new.draft_version_id)
   or row(v.job_id,v.customer_id,v.material_line_id,v.packet_sha256,v.source_sha256)
    is distinct from row(new.job_id,new.customer_id,new.material_line_id,new.packet_sha256,new.source_sha256)
   or new.phase is distinct from public.ap_owner_draft_ready_phase(j.id)
   or new.member_set_sha256 is distinct from (case when new.phase='REVIEW_READY' then v.member_set_sha256 else null end)
   or new.ready_at>clock_timestamp() or new.recipient_email is not null or new.delivery_envelope_sha256 is not null or new.suppressed_at is not null
   then raise exception 'owner_notice_identity_invalid'; end if;
  return new;
 end if;
 if (to_jsonb(old)-array['recipient_email','delivery_envelope_sha256','suppression_reason','suppressed_at'])
  is distinct from (to_jsonb(new)-array['recipient_email','delivery_envelope_sha256','suppression_reason','suppressed_at'])
  or (old.recipient_email is not null and old.recipient_email is distinct from new.recipient_email)
  or (old.delivery_envelope_sha256 is not null and old.delivery_envelope_sha256 is distinct from new.delivery_envelope_sha256)
  or (old.suppressed_at is not null and row(old.suppression_reason,old.suppressed_at) is distinct from row(new.suppression_reason,new.suppressed_at))
  then raise exception 'owner_notice_identity_immutable'; end if;
 if to_jsonb(old)=to_jsonb(new) then return new; end if;
 select * into m from public.ap_outbox_messages where id=new.message_id;
 if m.state<>'SENDING' or m.lease_owner is null or m.lease_expires_at is null or m.lease_expires_at<=clock_timestamp() or m.provider_message_id is not null
  or m.first_submitted_at is null or m.first_submitted_at+interval '24 hours'<=clock_timestamp()
  or m.provider_idempotency_expires_at is null or m.provider_idempotency_expires_at<=clock_timestamp()
  or old.suppressed_at is not null then raise exception 'owner_notice_lease_invalid'; end if;
 if new.delivery_envelope_sha256 is not null and new.recipient_email is null then raise exception 'owner_notice_recipient_invalid'; end if;
 if new.suppressed_at is not null and (new.delivery_envelope_sha256 is not null or new.suppressed_at>clock_timestamp()
  or new.suppression_reason is distinct from public.ap_owner_draft_notice_obsolete(new)) then raise exception 'owner_notice_suppression_invalid'; end if;
 return new;
end $$;

-- Generic outbox claiming/completion holds only its own row. This trigger must
-- never acquire a job, customer or financial lock in the opposite order.
create function public.ap_guard_owner_draft_outbox() returns trigger
language plpgsql security definer set search_path='' as $$
declare n public.ap_material_draft_owner_notices; expected_key text;
begin
 if tg_op='DELETE' then
  if old.message_kind='OWNER_DRAFT_REVIEW_REQUIRED' then raise exception 'owner_notice_identity_immutable'; end if;
  return old;
 end if;
 if new.message_kind<>'OWNER_DRAFT_REVIEW_REQUIRED' and (tg_op='INSERT' or old.message_kind<>'OWNER_DRAFT_REVIEW_REQUIRED') then return new; end if;
 if tg_op='UPDATE' and public.ap_retention_redaction_permitted(tg_relid,to_jsonb(old),to_jsonb(new)) then return new; end if;
 select * into n from public.ap_material_draft_owner_notices where message_id=new.id;
 expected_key:='owner-draft-ready:'||n.job_id::text||':'||n.draft_version_id::text||':'||n.phase||':v1';
 if n.message_id is null or new.customer_id is distinct from n.customer_id or new.recipient_ref is distinct from n.draft_version_id::text
  or new.message_kind<>'OWNER_DRAFT_REVIEW_REQUIRED' or new.deduplication_key is distinct from expected_key or new.provider_idempotency_key is distinct from expected_key
  or new.order_id is not null or new.payload_ref is not null or new.claimed_root_draft_id is not null
  or new.claimed_recipient_email is not null or new.claimed_delivery_envelope_sha256 is not null
  then raise exception 'owner_notice_identity_invalid'; end if;
 if tg_op='INSERT' then
  if new.state<>'QUEUED' or new.provider_message_id is not null or new.first_submitted_at is not null or new.provider_idempotency_expires_at is not null
   or new.lease_owner is not null or new.lease_expires_at is not null or new.attempts<>0 then raise exception 'owner_notice_initial_state_invalid'; end if;
  return new;
 end if;
 if row(old.id,old.customer_id,old.order_id,old.message_kind,old.recipient_ref,old.payload_ref,old.deduplication_key,old.provider_idempotency_key,old.created_at)
  is distinct from row(new.id,new.customer_id,new.order_id,new.message_kind,new.recipient_ref,new.payload_ref,new.deduplication_key,new.provider_idempotency_key,new.created_at)
  or (old.first_submitted_at is not null and old.first_submitted_at is distinct from new.first_submitted_at)
  or (old.provider_idempotency_expires_at is not null and old.provider_idempotency_expires_at is distinct from new.provider_idempotency_expires_at)
  or (old.provider_message_id is not null and old.provider_message_id is distinct from new.provider_message_id)
  or (old.state::text in('SENT','SUPPRESSED') and old.state is distinct from new.state)
  then raise exception 'owner_notice_identity_immutable'; end if;
 if new.state='SENT' and old.state<>'SENT' and (old.state<>'SENDING' or old.lease_expires_at is null or old.lease_expires_at<=clock_timestamp()
  or n.delivery_envelope_sha256 is null or n.recipient_email is null or n.suppressed_at is not null
  or new.provider_message_id is null or length(btrim(new.provider_message_id)) not between 1 and 255 or new.reconciliation_state<>'RECONCILED')
  then raise exception 'owner_notice_provider_acceptance_required'; end if;
 -- Compare text here so creating QUEUED catch-up rows does not resolve the new
 -- enum value before commit. Actual suppression still assigns the enum normally.
 if new.state::text='SUPPRESSED' and (old.state<>'SENDING' or old.lease_expires_at is null or old.lease_expires_at<=clock_timestamp()
  or n.suppressed_at is null or n.delivery_envelope_sha256 is not null or new.provider_message_id is not null
  or new.lease_owner is not null or new.lease_expires_at is not null or new.next_attempt_at is not null or new.reconciliation_state<>'NOT_REQUIRED')
  then raise exception 'owner_notice_suppression_invalid'; end if;
 return new;
end $$;

-- A deferred identity check makes partial notice/outbox inserts or suppression
-- metadata without its terminal state impossible to commit.
create function public.ap_owner_draft_notice_consistency() returns trigger
language plpgsql security definer set search_path='' as $$
declare n public.ap_material_draft_owner_notices; m public.ap_outbox_messages; id_value uuid; changed jsonb:=to_jsonb(new);
begin
 id_value:=(case when tg_table_name='ap_outbox_messages' then changed->>'id' else changed->>'message_id' end)::uuid;
 if tg_table_name='ap_outbox_messages' and changed->>'message_kind'<>'OWNER_DRAFT_REVIEW_REQUIRED' then return null; end if;
 select * into n from public.ap_material_draft_owner_notices where message_id=id_value;
 select * into m from public.ap_outbox_messages where id=id_value;
 if n.message_id is null or m.id is null or m.message_kind<>'OWNER_DRAFT_REVIEW_REQUIRED'
  or m.customer_id is distinct from n.customer_id or m.recipient_ref is distinct from n.draft_version_id::text
  or m.deduplication_key is distinct from 'owner-draft-ready:'||n.job_id::text||':'||n.draft_version_id::text||':'||n.phase||':v1'
  or m.provider_idempotency_key is distinct from m.deduplication_key or m.order_id is not null or m.payload_ref is not null
  or (m.state::text='SUPPRESSED') is distinct from (n.suppressed_at is not null)
  or (n.suppressed_at is not null and (n.delivery_envelope_sha256 is not null or m.provider_message_id is not null))
  then raise exception 'owner_notice_identity_invalid'; end if;
 return null;
end $$;
create trigger ap_owner_notice_immutable before insert or update or delete on public.ap_material_draft_owner_notices
 for each row execute function public.ap_guard_owner_draft_notice();
create trigger ap_owner_notice_outbox_immutable before insert or update or delete on public.ap_outbox_messages
 for each row execute function public.ap_guard_owner_draft_outbox();
create constraint trigger ap_owner_notice_consistency after insert or update on public.ap_material_draft_owner_notices
 deferrable initially deferred for each row execute function public.ap_owner_draft_notice_consistency();
create constraint trigger ap_owner_notice_outbox_consistency after insert or update on public.ap_outbox_messages
 deferrable initially deferred for each row execute function public.ap_owner_draft_notice_consistency();

insert into public.ap_retention_private_tables(table_name,primary_key,redaction_patch)
 values('ap_material_draft_owner_notices','message_id','{"recipient_email":null}'::jsonb);
create trigger ap_service_retention_write before insert or update on public.ap_material_draft_owner_notices
 for each row execute function public.ap_guard_service_retention_write();
insert into public.ap_archive_fence_relations(schema_name,table_name) values('public','ap_material_draft_owner_notices');
create trigger ap_archive_source_mutation before insert or update or delete or truncate on public.ap_material_draft_owner_notices
 for each statement execute function public.ap_guard_archive_source_mutation();

-- A truthful terminal suppression has no external work left to reconcile. Keep
-- every historical outbox kind/state protected; never treat an arbitrary new
-- enum value as completed. Text comparison is safe before the enum commits.
do $$ declare definition text; anchor text:='exists(select 1 from public.ap_outbox_messages where customer_id=p_customer and state not in(''SENT''))'; begin
 definition:=pg_get_functiondef('public.ap_retention_cleanup_blocked(uuid)'::regprocedure);
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'owner_notice_retention_anchor_missing'; end if;
 definition:=replace(definition,anchor,$replacement$exists(select 1 from public.ap_outbox_messages m where m.customer_id=p_customer and m.state<>'SENT' and not (
  m.state::text='SUPPRESSED' and m.message_kind='OWNER_DRAFT_REVIEW_REQUIRED' and m.provider_message_id is null
  and m.reconciliation_state='NOT_REQUIRED' and m.lease_owner is null and m.lease_expires_at is null and m.next_attempt_at is null
  and exists(select 1 from public.ap_material_draft_owner_notices n where n.message_id=m.id and n.customer_id=m.customer_id
   and n.suppressed_at is not null and n.suppression_reason is not null and n.delivery_envelope_sha256 is null
   and m.recipient_ref=n.draft_version_id::text and m.order_id is null and m.payload_ref is null
   and m.deduplication_key='owner-draft-ready:'||n.job_id::text||':'||n.draft_version_id::text||':'||n.phase||':v1'
   and m.provider_idempotency_key=m.deduplication_key)))$replacement$);
 execute definition;
 update public.ap_archive_fence_function_contracts set definition_sha256=encode(extensions.digest(pg_get_functiondef('public.ap_retention_cleanup_blocked(uuid)'::regprocedure),'sha256'),'hex')
  where signature='public.ap_retention_cleanup_blocked(uuid)';
 if not found then raise exception 'owner_notice_retention_archive_contract_missing'; end if;
end $$;

create function public.ap_catch_up_owner_draft_notices() returns jsonb
language plpgsql security definer set search_path='' as $$
declare item record; queued integer:=0; skipped integer:=0; added integer;
begin
 for item in select id from public.ap_material_draft_jobs where state in('SOURCE_READY','REVIEW_READY') order by customer_id,id loop
  perform public.ap_lock_owner_draft_notice_graph(item.id);
  added:=public.ap_enqueue_owner_draft_notice(item.id);
  queued:=queued+added; skipped:=skipped+case when added=0 then 1 else 0 end;
 end loop;
 return jsonb_build_object('queued',queued,'skipped',skipped);
end $$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in('ap_owner_draft_ready_phase','ap_lock_owner_draft_notice_graph','ap_owner_draft_notice_obsolete',
   'ap_owner_draft_notice_context','ap_enqueue_owner_draft_notice','ap_trigger_owner_draft_notice','ap_prepare_owner_draft_notification',
   'ap_pin_owner_draft_delivery','ap_suppress_owner_draft_notification','ap_guard_owner_draft_notice','ap_guard_owner_draft_outbox',
   'ap_owner_draft_notice_consistency','ap_catch_up_owner_draft_notices') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  if f.proname in('ap_prepare_owner_draft_notification','ap_pin_owner_draft_delivery','ap_suppress_owner_draft_notification') then
   execute format('grant execute on function %s to service_role',f.signature);
   execute format('alter function %s set lock_timeout=''5s''',f.signature);
  end if;
 end loop;
end $$;

insert into public.ap_archive_fence_function_contracts(signature,definition_sha256)
 select signature,encode(extensions.digest(pg_get_functiondef(signature::regprocedure),'sha256'),'hex') from unnest(array[
  'public.ap_owner_draft_ready_phase(uuid)','public.ap_lock_owner_draft_notice_graph(uuid)',
  'public.ap_owner_draft_notice_obsolete(public.ap_material_draft_owner_notices)','public.ap_owner_draft_notice_context(uuid,text)',
  'public.ap_enqueue_owner_draft_notice(uuid)','public.ap_trigger_owner_draft_notice()',
  'public.ap_prepare_owner_draft_notification(uuid,text,text)','public.ap_pin_owner_draft_delivery(uuid,text,text,text)',
  'public.ap_suppress_owner_draft_notification(uuid,text)','public.ap_guard_owner_draft_notice()',
  'public.ap_guard_owner_draft_outbox()','public.ap_owner_draft_notice_consistency()','public.ap_catch_up_owner_draft_notices()']) signature;
do $$ declare definition text; signatures text; anchor text:='''public.ap_retention_snapshot_customers(uuid)'''; begin
 definition:=pg_get_functiondef('public.ap_archive_fence_coverage_current()'::regprocedure);
 if (length(definition)-length(replace(definition,'count(*)=46','')))/length('count(*)=46')<>1
  or (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'owner_notice_archive_roster_anchor_missing'; end if;
 select string_agg(quote_literal(signature),',' order by signature) into signatures from public.ap_archive_fence_function_contracts
  where signature like 'public.ap_%owner_draft_%';
 if (select count(*) from public.ap_archive_fence_function_contracts where signature like 'public.ap_%owner_draft_%')<>13 then raise exception 'owner_notice_archive_roster_invalid'; end if;
 definition:=replace(definition,'count(*)=46','count(*)=59');
 definition:=replace(definition,anchor,anchor||','||signatures);
 definition:=replace(definition,'''ap_unpaid_source_cleanup''','''ap_unpaid_source_cleanup'',''ap_material_draft_owner_notices''');
 execute definition;
end $$;

do $$ declare result jsonb; begin
 result:=public.ap_catch_up_owner_draft_notices();
 insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
 values('202610280106','OWNER_DRAFT_READY_NOTICES',(result->>'queued')::integer,clock_timestamp());
 raise notice 'OWNER_DRAFT_READY_NOTICES_CATCHUP %',result;
end $$;

create function public.ap_owner_draft_notices_schema_installed() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ap_migration_checkpoints where migration_id='202610280106' and checkpoint='OWNER_DRAFT_READY_NOTICES')
 and exists(select 1 from pg_enum where enumtypid='public.ap_outbox_state'::regtype and enumlabel='SUPPRESSED')
 and exists(select 1 from pg_class where oid=to_regclass('public.ap_material_draft_owner_notices') and relrowsecurity)
 and exists(select 1 from public.ap_retention_private_tables where table_name='ap_material_draft_owner_notices' and primary_key='message_id' and redaction_patch='{"recipient_email":null}'::jsonb)
 and exists(select 1 from pg_trigger where tgrelid='public.ap_material_draft_jobs'::regclass and tgname='ap_owner_draft_ready_notice' and tgenabled='O' and tgfoid='public.ap_trigger_owner_draft_notice()'::regprocedure)
 and exists(select 1 from pg_trigger where tgrelid='public.ap_material_draft_owner_notices'::regclass and tgname='ap_owner_notice_immutable' and tgenabled='O')
 and exists(select 1 from pg_trigger where tgrelid='public.ap_outbox_messages'::regclass and tgname='ap_owner_notice_outbox_immutable' and tgenabled='O')
 and public.ap_archive_fence_coverage_current()
 and not has_table_privilege('authenticated','public.ap_material_draft_owner_notices','SELECT')
 and not has_table_privilege('anon','public.ap_material_draft_owner_notices','SELECT')
 and not has_table_privilege('service_role','public.ap_material_draft_owner_notices','UPDATE')
 and not exists(select 1 from unnest(array['public.ap_prepare_owner_draft_notification(uuid,text,text)',
  'public.ap_pin_owner_draft_delivery(uuid,text,text,text)','public.ap_suppress_owner_draft_notification(uuid,text)']) signature
  where not has_function_privilege('service_role',signature,'EXECUTE') or has_function_privilege('anon',signature,'EXECUTE') or has_function_privilege('authenticated',signature,'EXECUTE'));
$$;
revoke all on function public.ap_owner_draft_notices_schema_installed() from public,anon,authenticated;
grant execute on function public.ap_owner_draft_notices_schema_installed() to service_role;

do $$ declare definition text; anchor text; begin
 definition:=pg_get_functiondef('public.ap_archive_snapshot_schema_supported(text)'::regprocedure);
 anchor:='''202610270104'',''202610270105''';
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'owner_notice_archive_schema_anchor_missing'; end if;
 execute replace(definition,anchor,anchor||',''202610280106''');
 definition:=pg_get_functiondef('public.ap_manual_launch_schema_readiness()'::regprocedure);
 foreach anchor in array array['select count(*)=29 as installed','(''202610270105'',''VERIFIED_SOURCE_RUN_BINDING'')',
  '''requiredSchemaVersion'', ''202610270105''','''202610270104'',''202610270105''','public.ap_verified_source_run_schema_installed()'] loop
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'owner_notice_readiness_anchor_missing'; end if;
 end loop;
 definition:=replace(definition,'select count(*)=29 as installed','select count(*)=30 as installed');
 definition:=replace(definition,'(''202610270105'',''VERIFIED_SOURCE_RUN_BINDING'')','(''202610270105'',''VERIFIED_SOURCE_RUN_BINDING''),(''202610280106'',''OWNER_DRAFT_READY_NOTICES'')');
 definition:=replace(definition,'''requiredSchemaVersion'', ''202610270105''','''requiredSchemaVersion'', ''202610280106''');
 definition:=replace(definition,'''202610270104'',''202610270105''','''202610270104'',''202610270105'',''202610280106''');
 definition:=replace(definition,'public.ap_verified_source_run_schema_installed()','public.ap_verified_source_run_schema_installed() and public.ap_owner_draft_notices_schema_installed()');
 execute definition;
end $$;
commit;

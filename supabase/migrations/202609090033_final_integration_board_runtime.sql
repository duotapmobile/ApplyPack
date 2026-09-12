-- Final integration: securely claim a finalized four-step profile and durably
-- recompute the unranked subscription board after profile, job, or source changes.

alter table public.ap_board_admissions
  add column if not exists input_sha256 text,
  add column if not exists superseded_at timestamptz;

alter table public.ap_board_admissions
  drop constraint if exists ap_board_admissions_input_sha256_check;
alter table public.ap_board_admissions
  add constraint ap_board_admissions_input_sha256_check
  check (input_sha256 is null or input_sha256 ~ '^[0-9a-f]{64}$');

create index if not exists ap_board_admissions_current_browse_idx
  on public.ap_board_admissions(customer_id,profile_snapshot_id,decision,evaluated_at desc)
  where superseded_at is null;

alter table public.ap_board_subscriptions
  add column if not exists refund_state text not null default 'NONE',
  add column if not exists provider_refund_id text,
  add column if not exists provider_dispute_id text;
alter table public.ap_board_subscriptions
  drop constraint if exists ap_board_subscriptions_refund_state_check;
alter table public.ap_board_subscriptions
  add constraint ap_board_subscriptions_refund_state_check
  check (refund_state in ('NONE','PARTIAL','FULL','FAILED'));

create table public.ap_board_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider_event_id text not null unique,
  provider_subscription_id text not null,
  event_type text not null,
  provider_created bigint not null,
  provider_refund_id text,
  provider_dispute_id text,
  amount_cents integer,
  full_amount_cents integer,
  resulting_state text not null,
  created_at timestamptz not null default now()
);
alter table public.ap_board_provider_events enable row level security;
revoke all on public.ap_board_provider_events from public,anon,authenticated;
grant all on public.ap_board_provider_events to service_role;

-- Finalized intake snapshots and extracted evidence are immutable. This
-- ownership ledger links an authenticated customer to that preserved evidence
-- without rewriting provenance-bearing rows.
create table public.ap_board_profile_claims (
  profile_snapshot_id uuid primary key references public.ap_intake_snapshots(id),
  draft_id uuid not null references public.ap_anonymous_drafts(id),
  customer_id uuid not null references public.profiles(id),
  profile_version integer not null check (profile_version > 0),
  access_email_normalized text not null check (access_email_normalized=lower(btrim(access_email_normalized))),
  claimed_at timestamptz not null default now(),
  unique(draft_id,profile_version)
);
create index ap_board_profile_claims_customer_idx
  on public.ap_board_profile_claims(customer_id,profile_version desc,claimed_at desc);
alter table public.ap_board_profile_claims enable row level security;
revoke all on public.ap_board_profile_claims from public,anon,authenticated;
grant all on public.ap_board_profile_claims to service_role;

alter table public.job_matches alter column position drop not null;
alter table public.job_matches add column if not exists match_kind text not null default 'TOP_TEN';
alter table public.job_matches drop constraint if exists job_matches_match_kind_check;
alter table public.job_matches add constraint job_matches_match_kind_check check (
  (match_kind='TOP_TEN' and position between 1 and 10)
  or (match_kind='BOARD_MATERIAL_SOURCE' and position is null and ranking_score is null)
);

alter table public.ap_material_checkout_intents alter column delivered_release_id drop not null;
alter table public.ap_material_checkout_intents
  add column if not exists source_kind text not null default 'TOP_TEN',
  add column if not exists board_admission_id uuid references public.ap_board_admissions(id);
alter table public.ap_material_checkout_intents drop constraint if exists ap_material_checkout_source_check;
alter table public.ap_material_checkout_intents add constraint ap_material_checkout_source_check check (
  (source_kind='TOP_TEN' and delivered_release_id is not null and board_admission_id is null)
  or (source_kind='BOARD' and delivered_release_id is null and board_admission_id is not null and line_count=1)
);

create unique index ap_one_board_material_checkout_per_admission
  on public.ap_material_checkout_intents(customer_id,board_admission_id)
  where source_kind='BOARD' and state not in ('EXPIRED','FAILED');

create or replace function public.ap_sync_board_material_order()
returns trigger language plpgsql security definer set search_path='' as $$
declare order_status_value public.order_status;
begin
  if not exists(select 1 from public.job_matches match where match.id=new.delivered_match_id and match.match_kind='BOARD_MATERIAL_SOURCE')
    then return new; end if;
  order_status_value:=case new.fulfillment
    when 'NOT_PURCHASED' then 'pending_payment'::public.order_status
    when 'PAID' then 'paid'::public.order_status
    when 'DELIVERED' then 'delivered'::public.order_status
    when 'CANCELED' then 'cancelled'::public.order_status
    else 'in_fulfillment'::public.order_status end;
  update public.orders set status=order_status_value,
    paid_at=case when new.materials_payment_verified_at is not null then coalesce(paid_at,new.materials_payment_verified_at) else paid_at end,
    delivery_deadline=coalesce(new.materials_due_at,delivery_deadline),
    delivered_at=case when new.fulfillment='DELIVERED' then coalesce(delivered_at,now()) else delivered_at end,
    updated_at=now() where id=new.delivered_order_id;
  return new;
end;
$$;
drop trigger if exists ap_sync_board_material_order_trigger on public.ap_material_lines;
create trigger ap_sync_board_material_order_trigger after insert or update of fulfillment,materials_payment_verified_at,materials_due_at
on public.ap_material_lines for each row execute function public.ap_sync_board_material_order();

create or replace function public.ap_begin_board_material_checkout(
  p_customer_id uuid,p_board_admission_id uuid,p_source_snapshot_id uuid,p_contact_payload_id uuid,
  p_request_key text,p_selection_sha256 text,p_submission_rule_id uuid,p_emphasis_note text,
  p_do_not_mention_note text,p_career_break_choice text,p_career_break_custom_label text,
  p_cover_letter_break_consent boolean,p_document_contact_confirmed boolean,p_document_facts_confirmed boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare config public.ap_commerce_configuration; admission public.ap_board_admissions;
  snapshot_row public.ap_intake_snapshots; job_row public.ap_job_snapshots;
  rule_row public.ap_employer_submission_rules; existing public.ap_material_checkout_intents;
  now_at timestamptz:=clock_timestamp(); expires_at timestamptz:=clock_timestamp()+interval '30 minutes';
  order_id uuid:=gen_random_uuid(); match_id uuid:=gen_random_uuid(); intent_id uuid:=gen_random_uuid();
  purchase_id uuid:=gen_random_uuid(); payment_id uuid:=gen_random_uuid(); command_id uuid:=gen_random_uuid();
  line_id uuid:=gen_random_uuid(); revision_id uuid:=gen_random_uuid(); entitlement_id uuid:=gen_random_uuid();
  item_id uuid:=gen_random_uuid(); allocation_id uuid; input_hash text; members jsonb;
begin
  select * into config from public.ap_commerce_configuration where singleton for update;
  if not found or not config.checkout_enabled or not config.tax_configuration_approved
    or config.tax_approval_reference is null or config.tax_treatment<>'TAX_INCLUSIVE_NO_ADDED_AMOUNT'
    or config.material_line_price_cents<>800 or not config.tax_inclusive or config.currency<>'USD'
    or config.pricing_version is null or config.tax_version is null or config.payment_provider<>'stripe'
    or config.payment_api_version is null or config.immediate_payment_methods<>array['card']::text[]
    or config.materials_rule_ttl_seconds is distinct from 3600 or not config.materials_generation_approved
    or nullif(btrim(config.materials_generation_approval_reference),'') is null
    or cardinality(config.material_output_formats)=0 or nullif(btrim(config.document_renderer_identity),'') is null
    or config.arial_font_sha256 is null or nullif(btrim(config.malware_scanner_identity),'') is null
    then raise exception 'materials_checkout_disabled_unset_blocking'; end if;
  if not public.ap_board_has_access(p_customer_id,now_at) then raise exception 'active_board_subscription_required'; end if;
  if p_selection_sha256!~'^[0-9a-f]{64}$' or nullif(btrim(p_request_key),'') is null
    or not p_document_contact_confirmed or not p_document_facts_confirmed
    or p_career_break_choice not in ('KEEP_EXISTING_TIMELINE','CAREER_BREAK','FAMILY_CAREGIVING','CUSTOM_WORDING','OMIT_ENTRY')
    or (p_career_break_choice='CUSTOM_WORDING') is distinct from (nullif(btrim(p_career_break_custom_label),'') is not null)
    then raise exception 'invalid_board_material_checkout_request'; end if;
  select * into existing from public.ap_material_checkout_intents where request_key=p_request_key for update;
  if found then
    if existing.customer_id<>p_customer_id or existing.selection_sha256<>p_selection_sha256
      or existing.source_kind<>'BOARD' or existing.board_admission_id<>p_board_admission_id
      then raise exception 'material_checkout_idempotency_conflict'; end if;
    return jsonb_build_object('checkoutIntentId',existing.id,'purchaseId',existing.purchase_id,
      'paymentAttemptId',existing.payment_attempt_id,'commandId',existing.command_id,
      'capacityAllocationId',existing.capacity_allocation_id,'amountCents',800,'lineCount',1,
      'expiresAt',existing.expires_at,'replayed',true);
  end if;
  select * into admission from public.ap_board_admissions where id=p_board_admission_id
    and customer_id=p_customer_id and profile_snapshot_id=p_source_snapshot_id and decision='ADMITTED'
    and admission_version='board-admission-v2' and superseded_at is null for update;
  if not found then raise exception 'current_board_admission_required'; end if;
  select * into snapshot_row from public.ap_intake_snapshots where id=p_source_snapshot_id
    and finalized_at is not null and (customer_id=p_customer_id or exists(
      select 1 from public.ap_board_profile_claims claim
      where claim.profile_snapshot_id=p_source_snapshot_id and claim.customer_id=p_customer_id));
  if not found or snapshot_row.document_contact_email is null then raise exception 'document_contact_snapshot_required'; end if;
  if not exists(select 1 from public.ap_sensitive_payloads where id=p_contact_payload_id and customer_id=p_customer_id)
    then raise exception 'protected_document_contact_required'; end if;
  select * into job_row from public.ap_job_snapshots where legacy_job_id=admission.job_id
    and listing_activity_result='PASS' and application_path_result='PASS' and legitimacy_result='PASS'
    and live_verified_at>=now_at-make_interval(secs=>config.materials_rule_ttl_seconds)
    and not exists(select 1 from public.ap_job_snapshots successor where successor.supersedes_job_snapshot_id=ap_job_snapshots.id)
    order by retrieved_at desc,id desc limit 1;
  if not found then raise exception 'board_job_snapshot_not_material_ready'; end if;
  select * into rule_row from public.ap_employer_submission_rules where id=p_submission_rule_id
    and job_snapshot_id=job_row.id and is_current for update;
  if not found or rule_row.checked_at<now_at-make_interval(secs=>config.materials_rule_ttl_seconds)
    or rule_row.injection_scan_state<>'CLEAR' or rule_row.hard_block_reason is not null
    or rule_row.resume_requirement='PROHIBITED' or rule_row.cover_letter_requirement='PROHIBITED'
    or rule_row.submission_channel='UNSUPPORTED' or not (rule_row.allowed_formats && config.material_output_formats)
    then raise exception 'employer_instructions_block_materials'; end if;

  input_hash:=encode(extensions.digest(convert_to(p_request_key||':'||p_selection_sha256,'UTF8'),'sha256'),'hex');
  insert into public.orders(id,customer_id,product_kind,amount_cents,status)
    values(order_id,p_customer_id,'apply_pack',800,'pending_payment');
  insert into public.job_matches(id,search_order_id,job_id,position,match_kind,fit_summary,
    matching_experience,core_responsibilities,requirements,concerns,criteria_checks,ranking_score,ranking_reason_codes,
    release_explanation,allowed_unknown_warnings,source_provenance,last_checked_at)
  select match_id,order_id,admission.job_id,null,'BOARD_MATERIAL_SOURCE',
    'This job passed the current profile filters; it was not comparatively ranked.',
    '[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,'{}'::jsonb,null,'[]'::jsonb,
    jsonb_build_object('admissionVersion',admission.admission_version,'nonRanking',true),
    admission.warning_codes,jsonb_build_object('boardAdmissionId',admission.id),now_at;
  insert into public.ap_external_commands(id,customer_id,command_kind,provider,immutable_input_sha256,
    provider_idempotency_key,state,lease_expires_at,reconciliation_state)
  values(command_id,p_customer_id,'CREATE_MATERIALS_CHECKOUT','stripe',input_hash,
    'materials-checkout/'||command_id::text,'CREATING',now_at+interval '5 minutes','REQUIRED');
  insert into public.ap_payment_attempts(id,customer_id,provider,amount_cents,currency,settlement,dispute)
    values(payment_id,p_customer_id,'stripe',800,'USD','UNPAID','NONE');
  insert into public.ap_material_purchases(id,customer_id,payment_attempt_id,amount_cents,currency,checkout_intent_id)
    values(purchase_id,p_customer_id,payment_id,800,'USD',null);
  insert into public.ap_material_checkout_intents(
    id,customer_id,delivered_order_id,delivered_release_id,source_snapshot_id,contact_payload_id,purchase_id,
    payment_attempt_id,command_id,request_key,selection_sha256,line_count,amount_cents,currency,tax_inclusive,
    pricing_version,tax_version,career_break_choice,career_break_custom_label,cover_letter_break_consent,
    document_contact_confirmed,document_facts_confirmed,state,expires_at,source_kind,board_admission_id
  ) values(intent_id,p_customer_id,order_id,null,p_source_snapshot_id,p_contact_payload_id,purchase_id,
    payment_id,command_id,p_request_key,p_selection_sha256,1,800,'USD',true,config.pricing_version,config.tax_version,
    p_career_break_choice,nullif(btrim(p_career_break_custom_label),''),p_cover_letter_break_consent,true,true,
    'READY',expires_at,'BOARD',admission.id);
  update public.ap_material_purchases set checkout_intent_id=intent_id where id=purchase_id;
  insert into public.ap_material_lines(id,purchase_id,delivered_order_id,delivered_match_id,payment_attempt_id,
    payment_allocation_key,allocated_amount_cents,readiness,fulfillment,substitution,selected_reference_sheet,
    active_revision,selection_confirmed_at)
  values(line_id,purchase_id,order_id,match_id,payment_id,'material-payment/'||payment_id::text||'/'||match_id::text,
    800,'CHECKOUT_ELIGIBLE','NOT_PURCHASED','NONE',false,1,now_at);
  insert into public.ap_material_line_revisions(id,line_id,version,revision_kind,job_snapshot_id,source_snapshot_id,
    employer_rule_snapshot_id,binding_sha256,accepted_at)
  values(revision_id,line_id,1,'ORIGINAL',job_row.id,p_source_snapshot_id,rule_row.id,
    encode(extensions.digest(convert_to(p_selection_sha256||':'||job_row.content_sha256||':'||rule_row.content_sha256,'UTF8'),'sha256'),'hex'),now_at);
  insert into public.ap_material_entitlement_history(id,line_id,delivered_order_id,delivered_match_id,revision_id,state)
    values(entitlement_id,line_id,order_id,match_id,revision_id,'OPEN');
  perform public.ap_claim_material_entitlement(entitlement_id);
  insert into public.ap_material_checkout_items(id,checkout_intent_id,material_line_id,delivered_match_id,
    job_snapshot_id,submission_rule_id,selected_reference_sheet,originally_selected_reference_sheet,
    emphasis_note,do_not_mention_note,readiness)
  values(item_id,intent_id,line_id,match_id,job_row.id,rule_row.id,false,false,left(coalesce(p_emphasis_note,''),500),
    left(coalesce(p_do_not_mention_note,''),500),'CHECKOUT_ELIGIBLE');
  insert into public.ap_material_listing_checks(material_line_id,line_revision_id,phase,job_snapshot_id,
    submission_rule_id,result,checked_by,checked_at,evidence_sha256)
  values(line_id,revision_id,'BEFORE_CHECKOUT',job_row.id,rule_row.id,'ACTIVE',rule_row.human_confirmed_by,
    rule_row.checked_at,rule_row.content_sha256);
  members:=jsonb_build_array(jsonb_build_object('materialLineId',line_id,'revisionId',revision_id,'units',1));
  allocation_id:=public.ap_reserve_capacity(p_customer_id,'MATERIALS',1,
    'materials-checkout:'||p_request_key,expires_at,members,null);
  update public.ap_material_checkout_intents set capacity_allocation_id=allocation_id where id=intent_id;
  update public.ap_material_line_revisions set capacity_allocation_id=allocation_id where id=revision_id;
  insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at)
    values('MATERIAL_CHECKOUT_EXPIRY',intent_id,'material-checkout-expiry:'||intent_id::text,expires_at)
    on conflict(idempotency_key) do nothing;
  insert into public.ap_audit_events(customer_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(p_customer_id,'BOARD_MATERIAL_CHECKOUT_READY','MATERIAL_CHECKOUT',intent_id,
    jsonb_build_object('boardAdmissionId',admission.id,'amountCents',800,'nonRanking',true),'board-material-v1');
  return jsonb_build_object('checkoutIntentId',intent_id,'purchaseId',purchase_id,'paymentAttemptId',payment_id,
    'commandId',command_id,'capacityAllocationId',allocation_id,'amountCents',800,'lineCount',1,
    'expiresAt',expires_at,'providerIdempotencyKey','materials-checkout/'||command_id::text,'replayed',false);
end;
$$;

create table public.ap_board_recompute_jobs (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('PROFILE','JOB','POLICY')),
  customer_id uuid references public.profiles(id),
  profile_snapshot_id uuid references public.ap_intake_snapshots(id),
  job_id uuid references public.jobs(id),
  reason_code text not null,
  idempotency_key text not null unique,
  state text not null default 'PENDING' check (state in ('PENDING','PROCESSING','COMPLETED','RETRY','DEAD_LETTER')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((scope='PROFILE')=(customer_id is not null and profile_snapshot_id is not null)),
  check ((scope='JOB')=(job_id is not null)),
  check ((state='COMPLETED')=(completed_at is not null))
);
create index ap_board_recompute_jobs_ready_idx
  on public.ap_board_recompute_jobs(state,available_at,created_at);

alter table public.ap_board_recompute_jobs enable row level security;
revoke all on public.ap_board_recompute_jobs from public,anon,authenticated;
grant all on public.ap_board_recompute_jobs to service_role;

create or replace function public.ap_enqueue_board_profile_recompute(
  p_customer_id uuid,p_profile_snapshot_id uuid,p_reason_code text
) returns uuid language plpgsql security definer set search_path='' as $$
declare queued_id uuid;
begin
  if not exists(select 1 from public.ap_intake_snapshots s where s.id=p_profile_snapshot_id and s.finalized_at is not null
      and (s.customer_id=p_customer_id or exists(select 1 from public.ap_board_profile_claims claim
        where claim.profile_snapshot_id=s.id and claim.customer_id=p_customer_id)))
    then raise exception 'board_profile_snapshot_invalid'; end if;
  insert into public.ap_board_recompute_jobs(scope,customer_id,profile_snapshot_id,reason_code,idempotency_key)
  values('PROFILE',p_customer_id,p_profile_snapshot_id,left(p_reason_code,100),
    'board-profile:'||p_profile_snapshot_id::text||':board-admission-v2')
  on conflict(idempotency_key) do update set
    state=case when ap_board_recompute_jobs.state='PROCESSING' then ap_board_recompute_jobs.state else 'PENDING' end,
    available_at=case when ap_board_recompute_jobs.state='PROCESSING' then ap_board_recompute_jobs.available_at else now() end,
    completed_at=null,last_error_code=null
  returning id into queued_id;
  return queued_id;
end;
$$;

create or replace function public.ap_enqueue_board_job_recompute(
  p_job_id uuid,p_reason_code text,p_change_key text
) returns uuid language plpgsql security definer set search_path='' as $$
declare queued_id uuid;
begin
  if not exists(select 1 from public.jobs where id=p_job_id) then raise exception 'board_job_invalid'; end if;
  insert into public.ap_board_recompute_jobs(scope,job_id,reason_code,idempotency_key)
  values('JOB',p_job_id,left(p_reason_code,100),'board-job:'||p_job_id::text||':'||left(p_change_key,80))
  on conflict(idempotency_key) do update set
    state=case when ap_board_recompute_jobs.state='PROCESSING' then ap_board_recompute_jobs.state else 'PENDING' end,
    available_at=case when ap_board_recompute_jobs.state='PROCESSING' then ap_board_recompute_jobs.available_at else now() end,
    completed_at=null,last_error_code=null
  returning id into queued_id;
  return queued_id;
end;
$$;

create or replace function public.ap_claim_board_profile(
  p_draft_id uuid,p_secret_hash text,p_customer_id uuid,p_verified_email text
) returns uuid language plpgsql security definer set search_path='' as $$
declare draft_row public.ap_anonymous_drafts; snapshot_row public.ap_intake_snapshots;
  snapshot_id uuid; normalized_email text;
begin
  normalized_email:=lower(btrim(p_verified_email));
  if normalized_email='' or not exists(select 1 from public.profiles where id=p_customer_id)
    then raise exception 'board_profile_customer_invalid'; end if;
  select * into draft_row from public.ap_anonymous_drafts
    where id=p_draft_id and capability_secret_hash=p_secret_hash and state='COMPLETE'
      and finalized_snapshot_id is not null and expires_at>now() for update;
  if not found then raise exception 'board_profile_capability_invalid'; end if;
  snapshot_id:=draft_row.finalized_snapshot_id;
  select * into snapshot_row from public.ap_intake_snapshots s where s.id=snapshot_id
    and s.draft_id=p_draft_id and s.finalized_at is not null
    and s.access_email_normalized=normalized_email;
  if not found or (snapshot_row.customer_id is not null and snapshot_row.customer_id<>p_customer_id)
    then raise exception 'board_profile_email_or_owner_mismatch'; end if;
  if exists(select 1 from public.ap_board_profile_claims claim
      where claim.draft_id=p_draft_id and claim.customer_id<>p_customer_id)
    then raise exception 'board_profile_already_claimed'; end if;
  insert into public.ap_board_profile_claims(profile_snapshot_id,draft_id,customer_id,profile_version,access_email_normalized)
  values(snapshot_id,p_draft_id,p_customer_id,snapshot_row.version,normalized_email)
  on conflict(profile_snapshot_id) do update set claimed_at=now()
    where ap_board_profile_claims.customer_id=excluded.customer_id;
  if not found then raise exception 'board_profile_already_claimed'; end if;
  perform public.ap_enqueue_board_profile_recompute(p_customer_id,snapshot_id,'PROFILE_CLAIMED');
  insert into public.ap_audit_events(customer_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(p_customer_id,'BOARD_PROFILE_CLAIMED','INTAKE_SNAPSHOT',snapshot_id,
    jsonb_build_object('draftId',p_draft_id),'board-admission-v2');
  return snapshot_id;
end;
$$;

create or replace function public.ap_claim_board_recompute_jobs(p_owner text,p_limit integer default 10)
returns setof public.ap_board_recompute_jobs language plpgsql security definer set search_path='' as $$
begin
  if nullif(btrim(p_owner),'') is null then raise exception 'board_worker_owner_required'; end if;
  return query
  with candidates as (
    select id from public.ap_board_recompute_jobs
    where state in ('PENDING','RETRY') and available_at<=now()
      and (lease_expires_at is null or lease_expires_at<now())
    order by available_at,created_at,id for update skip locked limit greatest(1,least(50,p_limit))
  ), claimed as (
    update public.ap_board_recompute_jobs job set state='PROCESSING',attempts=job.attempts+1,
      lease_owner=p_owner,lease_expires_at=now()+interval '5 minutes'
    from candidates where job.id=candidates.id returning job.*
  ) select * from claimed;
end;
$$;

create or replace function public.ap_finish_board_recompute_job(
  p_job_id uuid,p_owner text,p_success boolean,p_error_code text default null
) returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.ap_board_recompute_jobs set
    state=case when p_success then 'COMPLETED' when attempts>=12 then 'DEAD_LETTER' else 'RETRY' end,
    completed_at=case when p_success then now() else null end,
    available_at=case when p_success then available_at else now()+make_interval(secs=>least(21600,60*power(2,greatest(0,attempts-1))::integer)) end,
    last_error_code=case when p_success then null else left(coalesce(p_error_code,'BOARD_RECOMPUTE_FAILED'),100) end,
    lease_owner=null,lease_expires_at=null
  where id=p_job_id and state='PROCESSING' and lease_owner=p_owner;
  return found;
end;
$$;

create or replace function public.ap_queue_board_snapshot_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.customer_id is not null and new.finalized_at is not null then
    perform public.ap_enqueue_board_profile_recompute(new.customer_id,new.id,
      case when tg_op='INSERT' then 'PROFILE_CREATED' else 'PROFILE_CHANGED' end);
  end if;
  return new;
end;
$$;
drop trigger if exists ap_queue_board_snapshot_change_trigger on public.ap_intake_snapshots;
create trigger ap_queue_board_snapshot_change_trigger
after insert or update of customer_id,content_sha256 on public.ap_intake_snapshots
for each row execute function public.ap_queue_board_snapshot_change();

create or replace function public.ap_queue_board_job_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform public.ap_enqueue_board_job_recompute(new.id,
    case when tg_op='INSERT' then 'JOB_CREATED' else 'JOB_CHANGED' end,
    coalesce(new.content_hash,'no-content-hash')||':'||coalesce(new.last_verified_at::text,new.checked_at::text));
  return new;
end;
$$;
drop trigger if exists ap_queue_board_job_change_trigger on public.jobs;
create trigger ap_queue_board_job_change_trigger
after insert or update of content_hash,is_active,listing_status,last_verified_at,source_freshness_status,
  employment_type,work_mode,eligible_states,salary_min,salary_max,sales_flag,commission_flag,
  phone_intensity,high_volume_contact_center_flag,benefits_status,rejection_reason on public.jobs
for each row execute function public.ap_queue_board_job_change();

insert into public.ap_board_recompute_jobs(scope,customer_id,profile_snapshot_id,reason_code,idempotency_key)
select 'PROFILE',snapshot.customer_id,snapshot.id,'MIGRATION_BACKFILL',
  'board-profile:'||snapshot.id::text||':board-admission-v2'
from public.ap_intake_snapshots snapshot
where snapshot.customer_id is not null and snapshot.finalized_at is not null
  and not exists(select 1 from public.ap_intake_snapshots newer
    where newer.customer_id=snapshot.customer_id and newer.version>snapshot.version)
on conflict(idempotency_key) do nothing;

insert into public.ap_board_recompute_jobs(scope,customer_id,profile_snapshot_id,reason_code,idempotency_key)
select 'PROFILE',claim.customer_id,claim.profile_snapshot_id,'MIGRATION_CLAIM_BACKFILL',
  'board-profile:'||claim.profile_snapshot_id::text||':board-admission-v2'
from public.ap_board_profile_claims claim
where not exists(select 1 from public.ap_board_profile_claims newer
  where newer.customer_id=claim.customer_id and newer.profile_version>claim.profile_version)
on conflict(idempotency_key) do nothing;

revoke all on function public.ap_enqueue_board_profile_recompute(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.ap_enqueue_board_job_recompute(uuid,text,text) from public,anon,authenticated;
revoke all on function public.ap_claim_board_profile(uuid,text,uuid,text) from public,anon,authenticated;
revoke all on function public.ap_claim_board_recompute_jobs(text,integer) from public,anon,authenticated;
revoke all on function public.ap_finish_board_recompute_job(uuid,text,boolean,text) from public,anon,authenticated;
revoke all on function public.ap_begin_board_material_checkout(uuid,uuid,uuid,uuid,text,text,uuid,text,text,text,text,boolean,boolean,boolean) from public,anon,authenticated;
grant execute on function public.ap_enqueue_board_profile_recompute(uuid,uuid,text) to service_role;
grant execute on function public.ap_enqueue_board_job_recompute(uuid,text,text) to service_role;
grant execute on function public.ap_claim_board_profile(uuid,text,uuid,text) to service_role;
grant execute on function public.ap_claim_board_recompute_jobs(text,integer) to service_role;
grant execute on function public.ap_finish_board_recompute_job(uuid,text,boolean,text) to service_role;
grant execute on function public.ap_begin_board_material_checkout(uuid,uuid,uuid,uuid,text,text,uuid,text,text,text,text,boolean,boolean,boolean) to service_role;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202609090033','FINAL_BOARD_RUNTIME_EXPAND',0,now())
on conflict(migration_id,checkpoint) do nothing;

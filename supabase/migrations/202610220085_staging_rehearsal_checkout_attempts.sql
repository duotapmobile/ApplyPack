-- Forward-only, service-only rehearsal authority and durable provider attempts.
-- Authorization expiry ends initiation; it never erases a payment obligation.
begin;

-- AWS worker objects use a separate durable queue. Older maintenance instances
-- must never mistake these S3 keys for Supabase Storage objects and acknowledge
-- them without deleting the actual sensitive object. Completed rows retain the
-- original operation lease so a retry cannot manufacture a new upload window.
create table public.ap_aws_temporary_cleanup (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null check (operation_id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  deployment_environment text not null check (deployment_environment in ('staging','production')),
  bucket text not null,
  storage_path text not null,
  created_at timestamptz not null default now(),
  not_before timestamptz not null default (now()+interval '10 minutes'),
  attempts integer not null default 0 check (attempts>=0),
  last_error text,
  last_attempt_at timestamptz,
  completed_at timestamptz,
  constraint ap_aws_temporary_cleanup_bucket_check check (
    bucket=case deployment_environment
      when 'staging' then 'applypack-838445019912-staging-document-worker-temp'
      when 'production' then 'applypack-838445019912-production-document-worker-temp' end),
  constraint ap_aws_temporary_cleanup_path_check check (storage_path in (
    'ephemeral/'||operation_id::text,
    'ephemeral/'||operation_id::text||'.render.pdf',
    'ephemeral/'||operation_id::text||'.page-1.png',
    'ephemeral/'||operation_id::text||'.page-2.png')),
  constraint ap_aws_temporary_cleanup_lease_check check (not_before=created_at+interval '10 minutes'),
  constraint ap_aws_temporary_cleanup_completion_check check (completed_at is null or completed_at>=created_at),
  unique(bucket,storage_path),
  unique(operation_id,storage_path)
);
create index ap_aws_temporary_cleanup_pending_idx
  on public.ap_aws_temporary_cleanup(not_before,attempts,created_at) where completed_at is null;
alter table public.ap_aws_temporary_cleanup enable row level security;
revoke all on public.ap_aws_temporary_cleanup from public,anon,authenticated,service_role;
grant select on public.ap_aws_temporary_cleanup to service_role;
grant update(attempts,last_error,last_attempt_at,completed_at) on public.ap_aws_temporary_cleanup to service_role;

create function public.ap_guard_aws_temporary_cleanup()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' or (to_jsonb(new)-array['attempts','last_error','last_attempt_at','completed_at'])
    is distinct from (to_jsonb(old)-array['attempts','last_error','last_attempt_at','completed_at'])
    then raise exception 'aws_temporary_cleanup_identity_immutable'; end if;
  if new.attempts<old.attempts
    or (old.completed_at is not null and new.completed_at is distinct from old.completed_at)
    or (old.last_attempt_at is not null and (new.last_attempt_at is null or new.last_attempt_at<old.last_attempt_at))
    then raise exception 'aws_temporary_cleanup_progress_regression'; end if;
  return new;
end $$;
revoke all on function public.ap_guard_aws_temporary_cleanup() from public,anon,authenticated,service_role;
create trigger ap_aws_temporary_cleanup_immutable before update or delete on public.ap_aws_temporary_cleanup
  for each row execute function public.ap_guard_aws_temporary_cleanup();

create function public.ap_begin_aws_temporary_cleanup(p_operation_id uuid,p_deployment_environment text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_bucket text; object_keys text[]; created_at_value timestamptz; not_before_value timestamptz;
  existing_count integer; completed boolean;
begin
  if p_operation_id is null or p_operation_id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_deployment_environment is null or p_deployment_environment not in ('staging','production')
    then raise exception 'aws_temporary_cleanup_scope_invalid'; end if;
  perform 1 from public.ap_commerce_configuration where singleton
    and canonical_site_url=case p_deployment_environment
      when 'staging' then 'https://applypack-staging-staging.up.railway.app'
      when 'production' then 'https://applypack.work' end for share;
  if not found then raise exception 'aws_temporary_cleanup_environment_mismatch'; end if;
  target_bucket:='applypack-838445019912-'||p_deployment_environment||'-document-worker-temp';
  object_keys:=array['ephemeral/'||p_operation_id::text,'ephemeral/'||p_operation_id::text||'.render.pdf',
    'ephemeral/'||p_operation_id::text||'.page-1.png','ephemeral/'||p_operation_id::text||'.page-2.png'];
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('aws-temporary-cleanup:'||p_operation_id::text,0));
  perform 1 from public.ap_aws_temporary_cleanup where operation_id=p_operation_id for update;
  select count(*),min(created_at),min(not_before),coalesce(bool_or(completed_at is not null),false)
    into existing_count,created_at_value,not_before_value,completed
    from public.ap_aws_temporary_cleanup where operation_id=p_operation_id;
  if existing_count=0 then
    created_at_value:=clock_timestamp();
    not_before_value:=created_at_value+interval '10 minutes';
    insert into public.ap_aws_temporary_cleanup(operation_id,deployment_environment,bucket,storage_path,created_at,not_before)
      select p_operation_id,p_deployment_environment,target_bucket,object_key,created_at_value,not_before_value
      from unnest(object_keys) object_key;
  elsif existing_count<>4 or exists(select 1 from public.ap_aws_temporary_cleanup where operation_id=p_operation_id
    and (deployment_environment<>p_deployment_environment or bucket<>target_bucket
      or not(storage_path=any(object_keys)) or created_at<>created_at_value or not_before<>not_before_value))
    then raise exception 'aws_temporary_cleanup_operation_conflict'; end if;
  return jsonb_build_object('operationId',p_operation_id,'createdAt',created_at_value,'notBefore',not_before_value,
    'submissionDeadline',created_at_value+interval '60 seconds','bucket',target_bucket,'keys',to_jsonb(object_keys),
    'completed',completed);
end $$;
revoke all on function public.ap_begin_aws_temporary_cleanup(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.ap_begin_aws_temporary_cleanup(uuid,text) to service_role;

-- 052 added the current/historical price constraint under its intended name,
-- while PostgreSQL's original unnamed 800-only constraint remained alongside it.
-- Remove only that verified obsolete duplicate; preserve historical 800 rows.
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.ap_material_checkout_intents'::regclass
    and conname='ap_material_checkout_intents_check'
    and pg_get_constraintdef(oid)='CHECK ((amount_cents = (line_count * 800)))')
    or not exists(select 1 from pg_constraint where conrelid='public.ap_material_checkout_intents'::regclass
      and conname='ap_material_checkout_intents_amount_cents_check'
      and pg_get_constraintdef(oid)='CHECK (((amount_cents = (line_count * 799)) OR (amount_cents = (line_count * 800))))')
    then raise exception 'material_current_price_constraint_anchor_missing'; end if;
  alter table public.ap_material_checkout_intents drop constraint ap_material_checkout_intents_check;
end $$;

create table public.ap_checkout_mode_configuration (
  singleton boolean primary key default true check (singleton),
  mode text not null default 'LOCKED' check (mode in ('LOCKED','PUBLIC','CANARY','REHEARSAL')),
  release_sha text check (release_sha ~ '^[0-9a-f]{40}$'),
  generation bigint not null default 0,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references public.profiles(id),
  check (mode='LOCKED' or release_sha is not null)
);
insert into public.ap_checkout_mode_configuration(singleton) values(true);
alter table public.ap_checkout_mode_configuration enable row level security;
revoke all on public.ap_checkout_mode_configuration from public,anon,authenticated,service_role;
grant select on public.ap_checkout_mode_configuration to service_role;

-- Revision content is immutable. Existing checkout/payment transactions need
-- two narrowly validated initializations after their referenced rows exist:
-- bind the reservation once, then bind the verified paid clock once.
create function public.ap_guard_material_revision_initialization()
returns trigger language plpgsql security definer set search_path='' as $$
declare line public.ap_material_lines; payment public.ap_payment_attempts; allocation public.ap_capacity_allocations;
  expected_start timestamptz;
begin
  if tg_op='DELETE' or old.superseded_at is not null then raise exception 'immutable_record'; end if;
  if (to_jsonb(new)-'superseded_at')=(to_jsonb(old)-'superseded_at') and new.superseded_at is not null
    then return new; end if;
  if new.superseded_at is not null
    or (to_jsonb(new)-array['capacity_allocation_id','started_at','due_at'])
      is distinct from (to_jsonb(old)-array['capacity_allocation_id','started_at','due_at'])
    or (old.capacity_allocation_id is not null and new.capacity_allocation_id is distinct from old.capacity_allocation_id)
    or old.started_at is not null or old.due_at is not null or new.capacity_allocation_id is null
    then raise exception 'immutable_record'; end if;
  select * into line from public.ap_material_lines where id=new.line_id;
  select * into payment from public.ap_payment_attempts where id=line.payment_attempt_id;
  select * into allocation from public.ap_capacity_allocations where id=new.capacity_allocation_id;
  if allocation.id is null or allocation.customer_id is distinct from payment.customer_id
    or not exists(select 1 from public.ap_capacity_allocation_members member
      where member.allocation_id=allocation.id and member.material_line_id=new.line_id and member.revision_id=new.id)
    then raise exception 'material_revision_capacity_binding_invalid'; end if;
  if new.started_at is null then
    if new.due_at is not null or old.capacity_allocation_id is not null
      or allocation.lifecycle<>'RESERVED' or allocation.debit_disposition<>'HELD'
      then raise exception 'material_revision_initial_reservation_invalid'; end if;
  else
    expected_start:=case when new.revision_kind='ORIGINAL'
      then greatest(line.selection_confirmed_at,payment.payment_verified_at)
      else greatest(new.accepted_at,payment.payment_verified_at,allocation.consumed_at) end;
    if payment.settlement<>'PAID' or payment.payment_verified_at is null or new.accepted_at is null
      or allocation.lifecycle<>'CONSUMED' or allocation.debit_disposition<>'SPENT'
      or new.started_at is distinct from expected_start or new.due_at is distinct from expected_start+interval '24 hours'
      or (new.revision_kind='ORIGINAL' and (line.materials_started_at is distinct from expected_start
        or line.materials_due_at is distinct from new.due_at))
      then raise exception 'material_revision_verified_clock_invalid'; end if;
  end if;
  return new;
end $$;
revoke all on function public.ap_guard_material_revision_initialization() from public,anon,authenticated,service_role;
drop trigger ap_material_line_revisions_immutable on public.ap_material_line_revisions;
create trigger ap_material_line_revisions_immutable before update or delete on public.ap_material_line_revisions
  for each row execute function public.ap_guard_material_revision_initialization();

-- The member identity remains immutable, while its existing material lifecycle
-- follows paid consumption, immutable delivery, or one-way supersession.
create function public.ap_guard_capacity_member_lifecycle()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' or (to_jsonb(new)-array['member_lifecycle','member_debit_disposition','superseded_at','completed_at'])
    is distinct from (to_jsonb(old)-array['member_lifecycle','member_debit_disposition','superseded_at','completed_at'])
    then raise exception 'immutable_capacity_member_identity'; end if;
  if new is not distinct from old then return new; end if;
  if old.member_lifecycle='RESERVED' and old.member_debit_disposition='HELD'
    and new.member_lifecycle='CONSUMED' and new.member_debit_disposition='SPENT'
    and new.superseded_at is null and new.completed_at is null
    and exists(select 1 from public.ap_capacity_allocations allocation
      join public.ap_material_lines line on line.id=new.material_line_id
      join public.ap_payment_attempts payment on payment.id=line.payment_attempt_id
      where allocation.id=new.allocation_id and allocation.lifecycle='CONSUMED' and allocation.debit_disposition='SPENT'
        and payment.customer_id=allocation.customer_id and payment.settlement='PAID' and payment.payment_verified_at is not null)
    then return new; end if;
  if old.member_lifecycle='CONSUMED' and old.member_debit_disposition='SPENT'
    and new.member_lifecycle='COMPLETED' and new.member_debit_disposition='SPENT'
    and new.superseded_at is null and new.completed_at is not null and old.completed_at is null
    and exists(select 1 from public.ap_releases where material_line_id=new.material_line_id
      and release_kind in ('MATERIAL_PAIR','MATERIAL_TRIPLE')) then return new; end if;
  if old.member_lifecycle in ('RESERVED','CONSUMED') and old.member_debit_disposition in ('HELD','SPENT')
    and new.member_lifecycle='SUPERSEDED' and new.superseded_at is not null and old.superseded_at is null
    and new.completed_at is null
    and new.member_debit_disposition=(case when old.member_debit_disposition='SPENT'
      then 'SPENT'::public.ap_capacity_debit else 'RETURNED'::public.ap_capacity_debit end)
    then return new; end if;
  raise exception 'invalid_capacity_member_transition';
end $$;
revoke all on function public.ap_guard_capacity_member_lifecycle() from public,anon,authenticated,service_role;
drop trigger ap_capacity_allocation_members_immutable on public.ap_capacity_allocation_members;
create trigger ap_capacity_allocation_members_immutable before update or delete on public.ap_capacity_allocation_members
  for each row execute function public.ap_guard_capacity_member_lifecycle();

create table public.ap_manual_launch_canary_resource_bindings (
  authorization_id uuid primary key references public.ap_manual_launch_canary_authorizations(id),
  resource_id uuid not null,
  resource_sha256 text check (resource_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp()
);
alter table public.ap_manual_launch_canary_resource_bindings enable row level security;
revoke all on public.ap_manual_launch_canary_resource_bindings from public,anon,authenticated,service_role;
grant select on public.ap_manual_launch_canary_resource_bindings to service_role;
create trigger ap_manual_launch_canary_resource_binding_immutable
  before update or delete on public.ap_manual_launch_canary_resource_bindings
  for each row execute function public.ap_prevent_immutable_mutation();

create function public.ap_authorize_scoped_manual_launch_canary_checkout(
  p_release_sha text,p_product_kind text,p_expected_customer_id uuid,p_search_draft_id uuid,
  p_actor_id uuid,p_evidence_reference text,p_expires_at timestamptz,
  p_resource_id uuid,p_resource_sha256 text
) returns uuid language plpgsql security definer set search_path='' as $$
declare resolved_authorization_id uuid; existing public.ap_manual_launch_canary_resource_bindings;
begin
  if p_resource_id is null
    or (p_product_kind='SEARCH' and (p_resource_id is distinct from p_search_draft_id or p_resource_sha256 is not null))
    or (p_product_kind='MATERIALS' and (coalesce(p_resource_sha256,'') !~ '^[0-9a-f]{64}$'
      or not exists(select 1 from public.ap_releases where id=p_resource_id
        and customer_id=p_expected_customer_id and release_kind='SEARCH_EXACT_TEN')))
    then raise exception 'canary_resource_binding_invalid'; end if;
  resolved_authorization_id:=public.ap_authorize_manual_launch_canary_checkout(p_release_sha,p_product_kind,
    p_expected_customer_id,p_search_draft_id,p_actor_id,p_evidence_reference,p_expires_at);
  select * into existing from public.ap_manual_launch_canary_resource_bindings binding
    where binding.authorization_id=resolved_authorization_id;
  if found then
    if existing.resource_id<>p_resource_id or existing.resource_sha256 is distinct from p_resource_sha256
      then raise exception 'canary_resource_binding_conflict'; end if;
  else
    -- A consumed historical authorization cannot acquire a new purchase scope.
    if exists(select 1 from public.ap_manual_launch_canary_designations designation
      where designation.authorization_id=resolved_authorization_id)
      then raise exception 'canary_consumed_authorization_cannot_be_scoped'; end if;
    insert into public.ap_manual_launch_canary_resource_bindings(authorization_id,resource_id,resource_sha256)
    values(resolved_authorization_id,p_resource_id,p_resource_sha256);
  end if;
  return resolved_authorization_id;
end $$;

create table public.ap_staging_rehearsal_authorizations (
  id uuid primary key default gen_random_uuid(),
  release_sha text not null check (release_sha ~ '^[0-9a-f]{40}$'),
  product_kind text not null check (product_kind in ('SEARCH','MATERIALS')),
  customer_id uuid not null references public.profiles(id),
  resource_id uuid not null,
  resource_sha256 text,
  authorized_by uuid not null references public.profiles(id),
  evidence_reference text not null check (length(btrim(evidence_reference)) between 12 and 500),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id),
  revocation_reference text,
  check (expires_at>created_at and expires_at<=created_at+interval '30 minutes'),
  check ((product_kind='SEARCH' and resource_sha256 is null)
    or (product_kind='MATERIALS' and resource_sha256 ~ '^[0-9a-f]{64}$')),
  check ((revoked_at is null and revoked_by is null and revocation_reference is null)
    or (revoked_at is not null and revoked_by is not null
      and length(btrim(revocation_reference)) between 12 and 500))
);

create table public.ap_checkout_initiations (
  id uuid primary key,
  mode text not null check (mode in ('PUBLIC','CANARY','REHEARSAL')),
  customer_id uuid references public.profiles(id),
  product_kind text not null check (product_kind in ('SEARCH','MATERIALS')),
  resource_id uuid not null,
  resource_sha256 text,
  release_sha text not null check (release_sha ~ '^[0-9a-f]{40}$'),
  authorization_id uuid,
  request_key text not null unique,
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  payment_attempt_id uuid not null unique references public.ap_payment_attempts(id),
  command_id uuid not null unique references public.ap_external_commands(id),
  capacity_allocation_id uuid not null unique references public.ap_capacity_allocations(id),
  provider_idempotency_key text not null unique,
  provider_session_deadline timestamptz not null,
  provider_session_id text unique,
  provider_session_expires_at timestamptz,
  state text not null default 'INITIATED'
    check (state in ('INITIATED','OPEN','EXPIRATION_REQUIRED','EXPIRED','PAID')),
  initiated_at timestamptz not null default clock_timestamp(),
  reconciled_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  check ((mode='PUBLIC' and authorization_id is null)
    or (mode in ('CANARY','REHEARSAL') and authorization_id is not null and customer_id is not null)),
  check ((product_kind='SEARCH' and resource_sha256 is null)
    or (product_kind='MATERIALS' and resource_sha256 ~ '^[0-9a-f]{64}$' and customer_id is not null)),
  check ((provider_session_id is null)=(provider_session_expires_at is null)),
  check (provider_session_deadline>initiated_at
    and provider_session_deadline<=initiated_at+interval '36 minutes')
);
create unique index ap_checkout_initiations_one_authorization
  on public.ap_checkout_initiations(authorization_id) where authorization_id is not null;
create index ap_checkout_initiations_reconciliation
  on public.ap_checkout_initiations(state,provider_session_deadline)
  where state in ('INITIATED','OPEN','EXPIRATION_REQUIRED');

alter table public.ap_staging_rehearsal_authorizations enable row level security;
alter table public.ap_checkout_initiations enable row level security;
revoke all on public.ap_staging_rehearsal_authorizations,public.ap_checkout_initiations
  from public,anon,authenticated,service_role;
grant select on public.ap_staging_rehearsal_authorizations,public.ap_checkout_initiations to service_role;

create function public.ap_guard_checkout_initiation_history()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'checkout_initiation_history_immutable'; end if;
  if (to_jsonb(new)-array['provider_session_id','provider_session_expires_at','state','reconciled_at','updated_at'])
    is distinct from
    (to_jsonb(old)-array['provider_session_id','provider_session_expires_at','state','reconciled_at','updated_at'])
    or (old.provider_session_id is not null and
      (new.provider_session_id is distinct from old.provider_session_id
        or new.provider_session_expires_at is distinct from old.provider_session_expires_at))
    or (old.state='PAID' and new.state<>'PAID') then
    raise exception 'checkout_initiation_binding_immutable';
  end if;
  return new;
end $$;
create trigger ap_checkout_initiations_history before update or delete on public.ap_checkout_initiations
  for each row execute function public.ap_guard_checkout_initiation_history();

create function public.ap_guard_staging_rehearsal_history()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'staging_rehearsal_history_immutable'; end if;
  if (to_jsonb(new)-array['revoked_at','revoked_by','revocation_reference'])
    is distinct from (to_jsonb(old)-array['revoked_at','revoked_by','revocation_reference'])
    or old.revoked_at is not null then raise exception 'staging_rehearsal_history_immutable'; end if;
  return new;
end $$;
create trigger ap_staging_rehearsal_history before update or delete on public.ap_staging_rehearsal_authorizations
  for each row execute function public.ap_guard_staging_rehearsal_history();

create function public.ap_set_checkout_mode(
  p_mode text,p_release_sha text,p_actor_id uuid,p_evidence_reference text
) returns bigint language plpgsql security definer set search_path='' as $$
declare current_mode public.ap_checkout_mode_configuration; next_generation bigint;
begin
  if p_mode is null or p_mode not in ('LOCKED','PUBLIC','CANARY','REHEARSAL')
    or (p_mode<>'LOCKED' and coalesce(p_release_sha,'') !~ '^[0-9a-f]{40}$')
    or length(btrim(coalesce(p_evidence_reference,''))) not between 12 and 500
    or not exists(select 1 from public.profiles where id=p_actor_id and role='admin')
    then raise exception 'checkout_mode_change_invalid'; end if;
  select * into current_mode from public.ap_checkout_mode_configuration where singleton for update;
  if p_mode<>'LOCKED' and current_mode.mode<>'LOCKED'
    then raise exception 'checkout_mode_transition_requires_locked'; end if;
  if p_mode<>'LOCKED' and exists(select 1 from public.ap_checkout_initiations attempt
    join public.ap_payment_attempts payment on payment.id=attempt.payment_attempt_id
    where attempt.state in ('INITIATED','OPEN','EXPIRATION_REQUIRED')
      or (attempt.state='PAID' and (payment.payment_verified_at is null or payment.settlement<>'PAID')))
    then raise exception 'checkout_mode_transition_requires_reconciliation'; end if;
  if p_mode='REHEARSAL' and not exists(select 1 from public.ap_commerce_configuration where singleton
    and canonical_site_url='https://applypack-staging-staging.up.railway.app' and not checkout_enabled)
    then raise exception 'checkout_mode_rehearsal_staging_required'; end if;
  if p_mode in ('PUBLIC','CANARY') and not exists(select 1 from public.ap_commerce_configuration config
    join public.ap_manual_launch_activations activation on activation.id=config.launch_activation_id
    where config.singleton and config.checkout_enabled and config.launch_release_sha=p_release_sha
      and activation.release_sha=p_release_sha and activation.activation_phase=p_mode)
    then raise exception 'checkout_mode_activation_required'; end if;
  update public.ap_checkout_mode_configuration set mode=p_mode,release_sha=p_release_sha,
    generation=generation+1,updated_at=clock_timestamp(),updated_by=p_actor_id where singleton
    returning generation into next_generation;
  if p_mode='LOCKED' then
    update public.ap_manual_launch_canary_authorizations authz
      set revoked_at=clock_timestamp(),revoked_by=p_actor_id,revocation_evidence_reference=btrim(p_evidence_reference)
      where revoked_at is null and not exists(select 1 from public.ap_manual_launch_canary_designations designation
        where designation.authorization_id=authz.id);
    update public.ap_staging_rehearsal_authorizations set revoked_at=clock_timestamp(),revoked_by=p_actor_id,
      revocation_reference=btrim(p_evidence_reference) where revoked_at is null;
    update public.ap_checkout_initiations set state='EXPIRATION_REQUIRED',updated_at=clock_timestamp()
      where state in ('INITIATED','OPEN');
  end if;
  insert into public.ap_audit_events(actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(p_actor_id,'CHECKOUT_MODE_CHANGED','CHECKOUT_MODE',gen_random_uuid(),
    jsonb_build_object('mode',p_mode,'releaseSha',p_release_sha,'generation',next_generation,
      'evidenceReference',btrim(p_evidence_reference)),'checkout-initiation-v1');
  return next_generation;
end $$;

-- New paid work keeps the contractual provider/input clocks. Processing delay
-- never grants another 24 hours; historical rows and approved adjustment clocks
-- are not rewritten. Capacity is still consumed atomically in the webhook.
do $$ declare definition text; begin
  definition:=pg_get_functiondef('public.ap_apply_verified_search_payment(text,text,text,timestamptz,timestamptz,text,text,text,text,integer,text,text,uuid,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,uuid)'::regprocedure);
  if position('started_at:=greatest(snapshot_row.finalized_at,p_payment_succeeded_at,now_at);' in definition)=0
    then raise exception 'search_payment_clock_anchor_missing'; end if;
  definition:=replace(definition,'started_at:=greatest(snapshot_row.finalized_at,p_payment_succeeded_at,now_at);',
    'started_at:=p_payment_succeeded_at;');
  definition:=replace(definition,
    '-- The customer promise starts only after all three independently recorded',
    '-- Payment time is immutable; the following legacy comment describes historical gates only.');
  execute definition;
  definition:=pg_get_functiondef('public.ap_apply_verified_material_payment(text,text,text,timestamptz,uuid,text,text,text,text,integer,text,text,timestamptz,uuid)'::regprocedure);
  if position('started_value:=greatest(line_row.selection_confirmed_at,p_payment_succeeded_at,now_at);' in definition)=0
    then raise exception 'material_payment_clock_anchor_missing'; end if;
  definition:=replace(definition,'started_value:=greatest(line_row.selection_confirmed_at,p_payment_succeeded_at,now_at);',
    'started_value:=greatest(line_row.selection_confirmed_at,p_payment_succeeded_at);');
  execute definition;
end $$;

-- Correct the old NONE expiration transition without releasing anything until
-- its caller has established the provider outcome.
do $$ declare definition text; old_transition text; new_transition text; begin
  definition:=replace(pg_get_functiondef('public.ap_expire_search_checkout(uuid,text)'::regprocedure),chr(13),'');
  old_transition:=$old$    update public.ap_external_commands set state='COMPENSATED',compensated_at=coalesce(compensated_at,now_at),
      reconciliation_state='RECONCILED',failure_code=p_reason,updated_at=now_at
      where id=command_row.id and state='CREATING';$old$;
  new_transition:=$new$    update public.ap_external_commands set state='COMPENSATING',failure_code=p_reason,updated_at=now_at
      where id=command_row.id and state='CREATING';
    update public.ap_external_commands set state='COMPENSATED',compensated_at=coalesce(compensated_at,now_at),
      reconciliation_state='RECONCILED',failure_code=p_reason,updated_at=now_at
      where id=command_row.id and state='COMPENSATING';$new$;
  if position(old_transition in definition)=0 then raise exception 'search_expiry_transition_anchor_missing'; end if;
  execute replace(definition,old_transition,new_transition);
end $$;

do $$ declare definition text; old_transition text; new_transition text; begin
  definition:=replace(pg_get_functiondef('public.ap_expire_material_checkout(uuid,text)'::regprocedure),chr(13),'');
  old_transition:=$old$  update public.ap_external_commands set state='COMPENSATED',compensated_at=now_at,failure_code=left(p_reason,100),
    reconciliation_state='RECONCILED',updated_at=now_at where id=intent.command_id and state<>'APPLIED';$old$;
  new_transition:=$new$  update public.ap_external_commands set state='COMPENSATING',failure_code=left(p_reason,100),updated_at=now_at
    where id=intent.command_id and state in ('CREATING','CREATED','APPLYING');
  update public.ap_external_commands set state='COMPENSATED',compensated_at=now_at,failure_code=left(p_reason,100),
    reconciliation_state='RECONCILED',updated_at=now_at where id=intent.command_id and state='COMPENSATING';$new$;
  if position(old_transition in definition)=0 then raise exception 'material_expiry_transition_anchor_missing'; end if;
  execute replace(definition,old_transition,new_transition);
end $$;

do $$ declare definition text; transition_anchor text; begin
  definition:=replace(pg_get_functiondef('public.ap_apply_verified_material_payment(text,text,text,timestamptz,uuid,text,text,text,text,integer,text,text,timestamptz,uuid)'::regprocedure),chr(13),'');
  transition_anchor:=$old$    update public.ap_external_commands set state='APPLIED',applied_at=now_at,reconciliation_state='RECONCILED',$old$;
  if position(transition_anchor in definition)=0 then raise exception 'material_payment_transition_anchor_missing'; end if;
  execute replace(definition,transition_anchor,
    $new$    update public.ap_external_commands set state='APPLYING',updated_at=now_at
      where id=intent.command_id and state='CREATED';
    update public.ap_external_commands set state='APPLIED',applied_at=now_at,reconciliation_state='RECONCILED',$new$);
end $$;

create function public.ap_authorize_staging_rehearsal_checkout(
  p_release_sha text,p_product_kind text,p_customer_id uuid,p_resource_id uuid,p_resource_sha256 text,
  p_actor_id uuid,p_evidence_reference text,p_expires_at timestamptz
) returns uuid language plpgsql security definer set search_path='' as $$
declare result_id uuid; now_at timestamptz:=clock_timestamp();
begin
  if p_release_sha is null or p_release_sha !~ '^[0-9a-f]{40}$'
    or p_product_kind is null or p_product_kind not in ('SEARCH','MATERIALS')
    or p_resource_id is null or p_expires_at is null or p_expires_at<=now_at
    or p_expires_at>now_at+interval '30 minutes'
    or length(btrim(coalesce(p_evidence_reference,''))) not between 12 and 500
    or (p_product_kind='SEARCH' and p_resource_sha256 is not null)
    or (p_product_kind='MATERIALS' and coalesce(p_resource_sha256,'') !~ '^[0-9a-f]{64}$')
    then raise exception 'staging_rehearsal_authorization_invalid'; end if;
  if not exists(select 1 from public.profiles where id=p_actor_id and role='admin')
    then raise exception 'staging_rehearsal_admin_required'; end if;
  if not exists(select 1 from public.profiles where id=p_customer_id and role='customer')
    then raise exception 'staging_rehearsal_customer_required'; end if;
  if not exists(select 1 from public.ap_commerce_configuration where singleton
    and canonical_site_url='https://applypack-staging-staging.up.railway.app'
    and launch_product_scope='MANUAL_ONLY' and not checkout_enabled)
    then raise exception 'staging_rehearsal_locked_staging_required'; end if;
  if p_product_kind='SEARCH' and not exists(
    select 1 from public.ap_anonymous_drafts draft
      join public.ap_intake_snapshots snapshot on snapshot.id=draft.finalized_snapshot_id
      join public.profiles customer on customer.id=p_customer_id
    where draft.id=p_resource_id and draft.state='COMPLETE' and draft.expires_at>now_at
      and lower(btrim(snapshot.access_email_normalized))=lower(btrim(customer.email)))
    then raise exception 'staging_rehearsal_search_customer_mismatch'; end if;
  if p_product_kind='MATERIALS' and not exists(select 1 from public.ap_releases
    where id=p_resource_id and customer_id=p_customer_id and release_kind='SEARCH_EXACT_TEN')
    then raise exception 'staging_rehearsal_material_resource_mismatch'; end if;
  insert into public.ap_staging_rehearsal_authorizations(
    release_sha,product_kind,customer_id,resource_id,resource_sha256,authorized_by,
    evidence_reference,created_at,expires_at
  ) values(p_release_sha,p_product_kind,p_customer_id,p_resource_id,p_resource_sha256,p_actor_id,
    btrim(p_evidence_reference),now_at,p_expires_at) returning id into result_id;
  insert into public.ap_audit_events(customer_id,actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(p_customer_id,p_actor_id,'STAGING_REHEARSAL_AUTHORIZED','STAGING_REHEARSAL_AUTHORIZATION',result_id,
    jsonb_build_object('releaseSha',p_release_sha,'productKind',p_product_kind,'resourceId',p_resource_id,
      'resourceSha256',p_resource_sha256,'expiresAt',p_expires_at),'checkout-initiation-v1');
  return result_id;
end $$;

create function public.ap_revoke_staging_rehearsal_checkout(
  p_authorization_id uuid,p_actor_id uuid,p_evidence_reference text
) returns boolean language plpgsql security definer set search_path='' as $$
declare authz public.ap_staging_rehearsal_authorizations;
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and role='admin')
    or length(btrim(coalesce(p_evidence_reference,''))) not between 12 and 500
    then raise exception 'staging_rehearsal_revocation_invalid'; end if;
  select * into authz from public.ap_staging_rehearsal_authorizations where id=p_authorization_id for update;
  if not found then raise exception 'staging_rehearsal_authorization_missing'; end if;
  if authz.revoked_at is not null then return true; end if;
  update public.ap_staging_rehearsal_authorizations set revoked_at=clock_timestamp(),revoked_by=p_actor_id,
    revocation_reference=btrim(p_evidence_reference) where id=authz.id;
  update public.ap_checkout_initiations set state='EXPIRATION_REQUIRED',updated_at=clock_timestamp()
    where authorization_id=authz.id and state in ('INITIATED','OPEN');
  insert into public.ap_audit_events(customer_id,actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(authz.customer_id,p_actor_id,'STAGING_REHEARSAL_REVOKED','STAGING_REHEARSAL_AUTHORIZATION',authz.id,
    jsonb_build_object('evidenceReference',btrim(p_evidence_reference)),'checkout-initiation-v1');
  return true;
end $$;

-- This private helper can be used only inside an authorized wrapper transaction.
-- No activation row or sales-approval field is written for rehearsal.
create function public.ap_checkout_context_allows_rehearsal()
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.ap_staging_rehearsal_authorizations authz
    join public.ap_commerce_configuration config on config.singleton
    where authz.id::text=current_setting('applypack.rehearsal_authorization_id',true)
      and authz.release_sha=current_setting('applypack.checkout_release_sha',true)
      and authz.revoked_at is null and authz.expires_at>clock_timestamp()
      and config.canonical_site_url='https://applypack-staging-staging.up.railway.app'
      and config.launch_product_scope='MANUAL_ONLY' and not config.checkout_enabled
      and config.currency='USD' and config.search_price_cents=1899 and config.material_line_price_cents=799
      and config.tax_inclusive and config.tax_treatment='TAX_INCLUSIVE_NO_ADDED_AMOUNT'
      and config.document_worker_network_attestation_sha256 ~ '^[0-9a-f]{64}$');
$$;

create function public.ap_assert_checkout_initiation_authorized(
  p_mode text,p_customer_id uuid,p_release_sha text,p_authorization_id uuid,
  p_product_kind text,p_resource_id uuid,p_resource_sha256 text
) returns uuid language plpgsql security definer set search_path='' as $$
declare authz public.ap_staging_rehearsal_authorizations; canary public.ap_manual_launch_canary_authorizations;
  resolved_id uuid:=p_authorization_id;
begin
  if p_mode is null or p_mode not in ('PUBLIC','CANARY','REHEARSAL')
    or p_release_sha is null or p_release_sha !~ '^[0-9a-f]{40}$'
    then raise exception 'checkout_initiation_mode_invalid'; end if;
  -- A row lock serializes initiation against a deployment transition. Revoking
  -- old entry-point grants also stops pre-085 instances from creating Sessions.
  perform 1 from public.ap_checkout_mode_configuration where singleton
    and mode=p_mode and release_sha=p_release_sha for share;
  if not found then raise exception 'checkout_database_mode_denied'; end if;
  if p_mode='REHEARSAL' then
    select * into authz from public.ap_staging_rehearsal_authorizations where id=p_authorization_id for update;
    if not found or authz.customer_id is distinct from p_customer_id or authz.product_kind<>p_product_kind
      or authz.resource_id<>p_resource_id or authz.resource_sha256 is distinct from p_resource_sha256
      or authz.release_sha<>p_release_sha or authz.revoked_at is not null or authz.expires_at<=clock_timestamp()
      or exists(select 1 from public.ap_checkout_initiations where authorization_id=authz.id)
      then raise exception 'staging_rehearsal_authorization_denied'; end if;
    perform set_config('applypack.rehearsal_authorization_id',authz.id::text,true);
    perform set_config('applypack.checkout_release_sha',p_release_sha,true);
    if not public.ap_checkout_context_allows_rehearsal()
      then raise exception 'staging_rehearsal_configuration_denied'; end if;
  elsif p_mode='CANARY' then
    select * into canary from public.ap_manual_launch_canary_authorizations
      where release_sha=p_release_sha and product_kind=p_product_kind
        and expected_customer_id=p_customer_id
        and (p_product_kind='MATERIALS' or search_draft_id=p_resource_id)
        and (p_authorization_id is null or id=p_authorization_id)
        and revoked_at is null and expires_at>clock_timestamp()
      order by created_at desc limit 1 for update;
    if not found or not public.ap_manual_launch_canary_checkout_authorized(p_release_sha,p_product_kind,
      p_customer_id,case when p_product_kind='SEARCH' then p_resource_id else null end)
      or not exists(select 1 from public.ap_manual_launch_canary_resource_bindings
        where authorization_id=canary.id and resource_id=p_resource_id
          and resource_sha256 is not distinct from p_resource_sha256)
      or exists(select 1 from public.ap_checkout_initiations where authorization_id=canary.id)
      then raise exception 'checkout_canary_authorization_denied'; end if;
    resolved_id:=canary.id;
  else
    if p_authorization_id is not null or not exists(
      select 1 from public.ap_commerce_configuration config
        join public.ap_manual_launch_activations activation on activation.id=config.launch_activation_id
      where config.singleton and config.checkout_enabled and config.launch_release_sha=p_release_sha
        and activation.release_sha=p_release_sha and activation.activation_phase='PUBLIC'
        and activation.canary_reconciled_amount_cents=2698)
      then raise exception 'checkout_public_activation_denied'; end if;
  end if;
  return resolved_id;
end $$;

-- Keep all historical RPCs and all non-activation predicates. A wrapper stores
-- the immutable Session deadline before the reservation and quote are inserted.
do $$ declare definition text; begin
  definition:=replace(pg_get_functiondef('public.ap_begin_search_checkout(uuid,text,uuid,uuid,text,uuid,text,uuid,text,uuid,uuid,text,text,uuid)'::regprocedure),chr(13),'');
  if position('not configuration.checkout_enabled' in definition)=0
    or position('date_trunc(''second'',clock_timestamp())+interval ''30 minutes 5 seconds''' in definition)=0
    then raise exception 'rehearsal_search_anchor_missing'; end if;
  definition:=replace(definition,'not configuration.checkout_enabled',
    '(not configuration.checkout_enabled and not public.ap_checkout_context_allows_rehearsal())');
  definition:=replace(definition,'date_trunc(''second'',clock_timestamp())+interval ''30 minutes 5 seconds''',
    'coalesce(nullif(current_setting(''applypack.checkout_session_deadline'',true),'''')::timestamptz,date_trunc(''second'',clock_timestamp())+interval ''30 minutes 5 seconds'')');
  execute definition;
  definition:=replace(pg_get_functiondef('public.ap_begin_material_checkout(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,text,text,boolean,boolean,boolean)'::regprocedure),chr(13),'');
  if position('not config.checkout_enabled' in definition)=0
    or position('expires_at timestamptz:=clock_timestamp()+interval ''30 minutes''' in definition)=0
    then raise exception 'rehearsal_material_anchor_missing'; end if;
  definition:=replace(definition,'not config.checkout_enabled',
    '(not config.checkout_enabled and not public.ap_checkout_context_allows_rehearsal())');
  definition:=replace(definition,'expires_at timestamptz:=clock_timestamp()+interval ''30 minutes''',
    'expires_at timestamptz:=coalesce(nullif(current_setting(''applypack.checkout_session_deadline'',true),'''')::timestamptz,clock_timestamp()+interval ''30 minutes'')');
  execute definition;
  definition:=pg_get_functiondef('public.ap_promote_search_checkout(uuid,text,timestamptz)'::regprocedure);
  if position('now_at+interval ''30 minutes 5 seconds''' in definition)=0
    then raise exception 'checkout_promotion_deadline_anchor_missing'; end if;
  definition:=replace(definition,'p_provider_session_expires_at>now_at+interval ''30 minutes 5 seconds''',
    '(p_provider_session_expires_at>now_at+interval ''30 minutes 5 seconds'' and not exists(select 1 from public.ap_checkout_initiations initiation where initiation.id=p_checkout_attempt_id and initiation.provider_session_deadline=p_provider_session_expires_at))');
  execute definition;
  definition:=pg_get_functiondef('public.ap_guard_checkout_configuration()'::regprocedure);
  if position('if not coalesce((select checkout_enabled from public.ap_commerce_configuration where singleton), false) then' in definition)=0
    then raise exception 'rehearsal_checkout_promotion_guard_anchor_missing'; end if;
  definition:=replace(definition,
    'if not coalesce((select checkout_enabled from public.ap_commerce_configuration where singleton), false) then',
    'if not coalesce((select checkout_enabled from public.ap_commerce_configuration where singleton), false) and not exists(select 1 from public.ap_checkout_initiations initiation where initiation.id=new.id and initiation.mode=''REHEARSAL'' and initiation.product_kind=''SEARCH'' and initiation.provider_session_deadline=new.expires_at) then');
  execute definition;
end $$;

create function public.ap_begin_authorized_search_checkout(
  p_invitation_id uuid,p_invitation_secret_hash text,p_draft_id uuid,p_secret_hash text,
  p_snapshot_id uuid,p_assessment_id uuid,p_request_key text,p_quote_id uuid,p_quote_sha256 text,
  p_command_id uuid,p_provider_idempotency_key text,p_checkout_attempt_id uuid,p_payment_attempt_id uuid,
  p_browser_secret_hash text,p_email_secret_hash text,p_mode text,p_customer_id uuid,p_release_sha text,
  p_authorization_id uuid default null,p_access_payload_id uuid default null
) returns table(quote_id uuid,command_id uuid,checkout_attempt_id uuid,payment_attempt_id uuid,
  allocation_id uuid,provider_idempotency_key text,lease_expires_at timestamptz,
  reservation_expires_at timestamptz,access_email text,provider_session_deadline timestamptz,
  initiation_state text,provider_session_id text)
language plpgsql security definer set search_path='' as $$
declare existing public.ap_checkout_initiations; provisioned record; authz_id uuid;
  deadline timestamptz:=date_trunc('second',clock_timestamp())+interval '35 minutes';
begin
  perform pg_advisory_xact_lock(hashtextextended('checkout-initiation:'||p_request_key,0));
  select * into existing from public.ap_checkout_initiations where request_key=p_request_key for update;
  if found then
    if existing.mode<>p_mode or existing.customer_id is distinct from p_customer_id
      or existing.resource_id<>p_draft_id or existing.product_kind<>'SEARCH'
      or existing.release_sha<>p_release_sha or existing.request_sha256<>p_quote_sha256
      or (p_authorization_id is not null and existing.authorization_id is distinct from p_authorization_id)
      or not exists(select 1 from public.ap_anonymous_drafts where id=p_draft_id and capability_secret_hash=p_secret_hash)
      or not exists(select 1 from public.ap_search_checkout_invitations where id=p_invitation_id
        and draft_id=p_draft_id and secret_hash=p_invitation_secret_hash)
      then raise exception 'checkout_initiation_replay_conflict'; end if;
  else
    authz_id:=public.ap_assert_checkout_initiation_authorized(p_mode,p_customer_id,p_release_sha,p_authorization_id,'SEARCH',p_draft_id,null);
    perform set_config('applypack.checkout_session_deadline',deadline::text,true);
    select * into provisioned from public.ap_begin_invited_search_checkout(
      p_invitation_id,p_invitation_secret_hash,p_draft_id,p_secret_hash,p_snapshot_id,p_assessment_id,
      p_request_key,p_quote_id,p_quote_sha256,p_command_id,p_provider_idempotency_key,p_checkout_attempt_id,
      p_payment_attempt_id,p_browser_secret_hash,p_email_secret_hash,p_access_payload_id);
    if provisioned.checkout_attempt_id<>p_checkout_attempt_id
      then raise exception 'legacy_checkout_requires_reconciliation'; end if;
    update public.ap_capacity_allocations set expires_at=deadline where id=provisioned.allocation_id;
    update public.ap_external_commands set lease_expires_at=deadline where id=provisioned.command_id;
    update public.ap_checkout_attempts set expires_at=deadline where id=provisioned.checkout_attempt_id;
    insert into public.ap_checkout_initiations(id,mode,customer_id,product_kind,resource_id,release_sha,
      authorization_id,request_key,request_sha256,payment_attempt_id,command_id,capacity_allocation_id,
      provider_idempotency_key,provider_session_deadline)
    values(provisioned.checkout_attempt_id,p_mode,p_customer_id,'SEARCH',p_draft_id,p_release_sha,authz_id,
      p_request_key,p_quote_sha256,provisioned.payment_attempt_id,provisioned.command_id,provisioned.allocation_id,
      provisioned.provider_idempotency_key,deadline) returning * into existing;
    if p_mode='CANARY' then perform public.ap_bind_manual_launch_canary_payment(existing.payment_attempt_id,p_release_sha); end if;
  end if;
  return query select checkout.quote_id,existing.command_id,existing.id,existing.payment_attempt_id,
    existing.capacity_allocation_id,existing.provider_idempotency_key,command.lease_expires_at,
    existing.provider_session_deadline,snapshot.access_email_normalized,existing.provider_session_deadline,
    existing.state,existing.provider_session_id
    from public.ap_checkout_attempts checkout join public.ap_quotes quote on quote.id=checkout.quote_id
      join public.ap_intake_snapshots snapshot on snapshot.id=quote.snapshot_id
      join public.ap_external_commands command on command.id=existing.command_id where checkout.id=existing.id;
end $$;

create function public.ap_begin_authorized_material_checkout(
  p_customer_id uuid,p_delivered_order_id uuid,p_delivered_release_id uuid,p_source_snapshot_id uuid,
  p_contact_payload_id uuid,p_request_key text,p_selection_sha256 text,p_selections jsonb,
  p_career_break_choice text,p_career_break_custom_label text,p_cover_letter_break_consent boolean,
  p_document_contact_confirmed boolean,p_document_facts_confirmed boolean,
  p_mode text,p_release_sha text,p_authorization_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.ap_checkout_initiations; provisioned jsonb; authz_id uuid; resource_hash text;
  deadline timestamptz:=date_trunc('second',clock_timestamp())+interval '35 minutes';
begin
  if jsonb_typeof(p_selections) is distinct from 'array' then raise exception 'material_selection_invalid'; end if;
  select encode(extensions.digest(convert_to(string_agg(lower((value->>'matchId')::uuid::text),','
    order by lower((value->>'matchId')::uuid::text)),'UTF8'),'sha256'),'hex')
    into resource_hash from jsonb_array_elements(p_selections);
  perform pg_advisory_xact_lock(hashtextextended('checkout-initiation:'||p_request_key,0));
  select * into existing from public.ap_checkout_initiations where request_key=p_request_key for update;
  if found then
    if existing.mode<>p_mode or existing.customer_id is distinct from p_customer_id
      or existing.resource_id<>p_delivered_release_id or existing.resource_sha256 is distinct from resource_hash
      or existing.product_kind<>'MATERIALS' or existing.release_sha<>p_release_sha
      or existing.request_sha256<>p_selection_sha256
      or (p_authorization_id is not null and existing.authorization_id is distinct from p_authorization_id)
      then raise exception 'checkout_initiation_replay_conflict'; end if;
    select jsonb_build_object('checkoutIntentId',intent.id,'purchaseId',intent.purchase_id,
      'paymentAttemptId',intent.payment_attempt_id,'commandId',intent.command_id,
      'capacityAllocationId',intent.capacity_allocation_id,'amountCents',intent.amount_cents,
      'lineCount',intent.line_count,'expiresAt',intent.expires_at,'replayed',true)
      into provisioned from public.ap_material_checkout_intents intent where intent.id=existing.id;
  else
    authz_id:=public.ap_assert_checkout_initiation_authorized(p_mode,p_customer_id,p_release_sha,
      p_authorization_id,'MATERIALS',p_delivered_release_id,resource_hash);
    perform set_config('applypack.checkout_session_deadline',deadline::text,true);
    provisioned:=public.ap_begin_material_checkout(p_customer_id,p_delivered_order_id,p_delivered_release_id,
      p_source_snapshot_id,p_contact_payload_id,p_request_key,p_selection_sha256,p_selections,
      p_career_break_choice,p_career_break_custom_label,p_cover_letter_break_consent,
      p_document_contact_confirmed,p_document_facts_confirmed);
    if coalesce((provisioned->>'replayed')::boolean,false)
      then raise exception 'legacy_checkout_requires_reconciliation'; end if;
    insert into public.ap_checkout_initiations(id,mode,customer_id,product_kind,resource_id,resource_sha256,
      release_sha,authorization_id,request_key,request_sha256,payment_attempt_id,command_id,capacity_allocation_id,
      provider_idempotency_key,provider_session_deadline)
    select (provisioned->>'checkoutIntentId')::uuid,p_mode,p_customer_id,'MATERIALS',p_delivered_release_id,
      resource_hash,p_release_sha,authz_id,p_request_key,p_selection_sha256,(provisioned->>'paymentAttemptId')::uuid,
      command.id,(provisioned->>'capacityAllocationId')::uuid,command.provider_idempotency_key,deadline
      from public.ap_external_commands command where command.id=(provisioned->>'commandId')::uuid
      returning * into existing;
    if p_mode='CANARY' then perform public.ap_bind_manual_launch_canary_payment(existing.payment_attempt_id,p_release_sha); end if;
  end if;
  return provisioned||jsonb_build_object('providerSessionDeadline',existing.provider_session_deadline,
    'providerIdempotencyKey',existing.provider_idempotency_key,'initiationState',existing.state,
    'providerSessionId',existing.provider_session_id);
end $$;

-- Anonymous intake remains immutable after payment. Resolve its owner through
-- the exact customer-owned delivered service and order, never by null ownership
-- alone. Browser roles cannot insert or update ap_search_services.
do $$ declare definition text; old_lookup text; owned_lookup text; begin
  definition:=replace(pg_get_functiondef('public.ap_begin_material_checkout(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,text,text,boolean,boolean,boolean)'::regprocedure),chr(13),'');
  old_lookup:=$old$  select * into snapshot_row from public.ap_intake_snapshots where id=p_source_snapshot_id
    and customer_id=p_customer_id and finalized_at is not null;$old$;
  owned_lookup:=$new$  select snapshot.* into snapshot_row
  from public.ap_intake_snapshots snapshot
    join public.ap_search_services owner_service on owner_service.original_snapshot_id=snapshot.id
      and owner_service.customer_id=p_customer_id and owner_service.legacy_order_id=p_delivered_order_id
      and owner_service.fulfillment='DELIVERED'
    join public.orders owner_order on owner_order.id=owner_service.legacy_order_id
      and owner_order.customer_id=p_customer_id and owner_order.status='delivered'
  where snapshot.id=p_source_snapshot_id and snapshot.finalized_at is not null
    and (snapshot.customer_id=p_customer_id or (snapshot.customer_id is null and snapshot.draft_id is not null));$new$;
  if position(old_lookup in definition)=0
    then raise exception 'material_original_snapshot_ownership_anchor_missing'; end if;
  execute replace(definition,old_lookup,owned_lookup);
end $$;

-- 081 changed the allowed configured font but left these current creation and
-- release predicates on Arial. Repair those two gates only; historical artifact
-- and download validation retains its version-specific font contracts.
do $$ declare fn record; definition text; begin
  for fn in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('ap_begin_material_checkout','ap_commit_material_release_v2') loop
    definition:=pg_get_functiondef(fn.oid);
    if position('config.document_font_family=''Arial''' in definition)=0
      then raise exception 'material_current_font_gate_anchor_missing'; end if;
    execute replace(definition,'config.document_font_family=''Arial''',
      'config.document_font_family=''Liberation Sans''');
  end loop;
end $$;

-- Repeat reconciliation may encounter a quote already invalidated by absence
-- cleanup. Skip that write instead of relaxing immutable quote history.
do $$ declare signature text; definition text; anchor text:=
  'update public.ap_quotes set invalidated_at=coalesce(invalidated_at,now_at) where id=checkout_row.quote_id;';
begin
  foreach signature in array array['public.ap_expire_search_checkout(uuid,text)',
    'public.ap_compensate_search_checkout(uuid,text,text)'] loop
    definition:=replace(pg_get_functiondef(signature::regprocedure),chr(13),'');
    if position(anchor in definition)=0 then raise exception 'checkout_quote_invalidation_anchor_missing'; end if;
    execute replace(definition,anchor,
      'update public.ap_quotes set invalidated_at=now_at where id=checkout_row.quote_id and invalidated_at is null;');
  end loop;
end $$;

create function public.ap_bind_checkout_initiation(
  p_attempt_id uuid,p_provider_session_id text,p_provider_session_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare attempt public.ap_checkout_initiations; must_expire boolean;
begin
  select * into attempt from public.ap_checkout_initiations where id=p_attempt_id for update;
  if not found or nullif(btrim(p_provider_session_id),'') is null
    or p_provider_session_expires_at is distinct from attempt.provider_session_deadline
    or (attempt.provider_session_id is not null and attempt.provider_session_id<>p_provider_session_id)
    then raise exception 'checkout_initiation_provider_binding_invalid'; end if;
  must_expire:=attempt.state in ('EXPIRATION_REQUIRED','EXPIRED') or (
    attempt.mode='REHEARSAL' and exists(select 1 from public.ap_staging_rehearsal_authorizations
      where id=attempt.authorization_id and (revoked_at is not null or expires_at<=clock_timestamp()))) or (
    attempt.mode='CANARY' and exists(select 1 from public.ap_manual_launch_canary_authorizations
      where id=attempt.authorization_id and (revoked_at is not null or expires_at<=clock_timestamp())));
  -- Session identity is recorded even after a revoke/expiry race. No new attempt
  -- is made, and maintenance can expire it or account for an intervening payment.
  if attempt.provider_session_id is null then
    if attempt.provider_session_deadline>clock_timestamp() and exists(
      select 1 from public.ap_capacity_allocations where id=attempt.capacity_allocation_id
        and lifecycle='RESERVED' and debit_disposition='HELD' and expires_at>clock_timestamp()) then
      if attempt.product_kind='SEARCH' then
        perform public.ap_promote_search_checkout(attempt.id,p_provider_session_id,p_provider_session_expires_at);
      else
        perform public.ap_promote_material_checkout(attempt.id,p_provider_session_id,p_provider_session_expires_at);
      end if;
    else
      -- A delayed first observation may arrive after local reservation expiry.
      -- Bind the identity for the verified webhook's existing stale-payment
      -- refund path; never manufacture capacity or discard the paid event.
      must_expire:=true;
      if attempt.product_kind='SEARCH' then
        if exists(select 1 from public.ap_checkout_attempts where id=attempt.id and state='NONE') then
          perform public.ap_compensate_search_checkout(attempt.id,'LATE_PROVIDER_BINDING',p_provider_session_id);
        else
          perform public.ap_expire_search_checkout(attempt.id,'LATE_PROVIDER_BINDING');
        end if;
        update public.ap_checkout_attempts set provider_checkout_session_id=p_provider_session_id,
          updated_at=clock_timestamp() where id=attempt.id;
      else
        perform public.ap_expire_material_checkout(attempt.id,'LATE_PROVIDER_BINDING');
        update public.ap_material_checkout_intents set provider_checkout_session_id=p_provider_session_id,
          updated_at=clock_timestamp() where id=attempt.id;
      end if;
      update public.ap_payment_attempts set provider_checkout_session_id=p_provider_session_id,
        updated_at=clock_timestamp() where id=attempt.payment_attempt_id;
    end if;
  end if;
  update public.ap_checkout_initiations set provider_session_id=p_provider_session_id,
    provider_session_expires_at=p_provider_session_expires_at,
    state=case when state='PAID' then state when must_expire then 'EXPIRATION_REQUIRED' else 'OPEN' end,
    updated_at=clock_timestamp() where id=attempt.id;
  return jsonb_build_object('attemptId',attempt.id,'expirationRequired',must_expire,'providerSessionId',p_provider_session_id);
end $$;

create function public.ap_reconcile_checkout_initiation(
  p_attempt_id uuid,p_provider_session_id text,p_provider_status text,p_payment_status text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare attempt public.ap_checkout_initiations;
begin
  select * into attempt from public.ap_checkout_initiations where id=p_attempt_id for update;
  if not found or attempt.provider_session_id is distinct from p_provider_session_id
    or p_provider_status is null or p_provider_status not in ('open','complete','expired')
    or p_payment_status is null or p_payment_status not in ('paid','unpaid','no_payment_required')
    then raise exception 'checkout_reconciliation_binding_invalid'; end if;
  if p_payment_status='paid' then
    update public.ap_checkout_initiations set state='PAID',reconciled_at=clock_timestamp(),updated_at=clock_timestamp()
      where id=attempt.id;
  elsif p_provider_status='expired' and attempt.state<>'PAID' then
    if exists(select 1 from public.ap_payment_attempts where id=attempt.payment_attempt_id and settlement='PAID') then
      update public.ap_checkout_initiations set state='PAID',reconciled_at=clock_timestamp(),updated_at=clock_timestamp() where id=attempt.id;
    else
      if attempt.product_kind='SEARCH' then perform public.ap_expire_search_checkout(attempt.id,'PROVIDER_RECONCILED_EXPIRED');
      else perform public.ap_expire_material_checkout(attempt.id,'PROVIDER_RECONCILED_EXPIRED'); end if;
      update public.ap_checkout_initiations set state='EXPIRED',reconciled_at=clock_timestamp(),updated_at=clock_timestamp() where id=attempt.id;
    end if;
  end if;
  return jsonb_build_object('attemptId',attempt.id,'state',(select state from public.ap_checkout_initiations where id=attempt.id));
end $$;

create function public.ap_mark_checkout_initiations_for_expiration()
returns integer language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
  update public.ap_checkout_initiations attempt set state='EXPIRATION_REQUIRED',updated_at=clock_timestamp()
  where state in ('INITIATED','OPEN') and (
    attempt.provider_session_deadline<=clock_timestamp()
    or (attempt.mode='REHEARSAL' and exists(select 1 from public.ap_staging_rehearsal_authorizations authz
      where authz.id=attempt.authorization_id and (authz.revoked_at is not null or authz.expires_at<=clock_timestamp())))
    or (attempt.mode='CANARY' and exists(select 1 from public.ap_manual_launch_canary_authorizations authz
      where authz.id=attempt.authorization_id and (authz.revoked_at is not null or authz.expires_at<=clock_timestamp()))));
  get diagnostics affected=row_count;
  return affected;
end $$;

create function public.ap_reconcile_checkout_initiation_absence(
  p_attempt_id uuid,p_observed_at timestamptz,p_evidence_sha256 text
) returns boolean language plpgsql security definer set search_path='' as $$
declare attempt public.ap_checkout_initiations;
begin
  select * into attempt from public.ap_checkout_initiations where id=p_attempt_id for update;
  if not found or attempt.provider_session_id is not null or attempt.state<>'EXPIRATION_REQUIRED'
    or p_observed_at is null or p_observed_at<attempt.provider_session_deadline+interval '5 minutes'
    or p_observed_at>clock_timestamp()+interval '5 seconds'
    or clock_timestamp()<attempt.provider_session_deadline+interval '5 minutes'
    or coalesce(p_evidence_sha256,'') !~ '^[0-9a-f]{64}$'
    or not exists(select 1 from public.ap_payment_attempts where id=attempt.payment_attempt_id
      and settlement='UNPAID' and provider_payment_id is null and payment_verified_at is null)
    or not exists(select 1 from public.audit_logs evidence
      where evidence.action='checkout_provider_absence_observed'
        and evidence.entity_type='checkout_initiation' and evidence.entity_id=attempt.id::text
        and evidence.details->>'evidenceSha256'=p_evidence_sha256
        and evidence.details->>'attemptId'=attempt.id::text
        and (evidence.details->>'observedAt')::timestamptz=p_observed_at
        and (evidence.details->'created'->>'gte')::bigint=floor(extract(epoch from attempt.initiated_at))::bigint-5
        and (evidence.details->'created'->>'lte')::bigint=floor(extract(epoch from attempt.provider_session_deadline))::bigint
        and jsonb_typeof(evidence.details->'requests')='array'
        and jsonb_array_length(evidence.details->'requests') between 1 and 3
        and evidence.details->'requests'->-1->>'hasMore'='false'
        and not exists(select 1 from jsonb_array_elements(evidence.details->'requests') request
          where coalesce(request->>'requestId','')='' or jsonb_typeof(request->'hasMore')<>'boolean'))
    then raise exception 'checkout_provider_absence_reconciliation_denied'; end if;
  -- Service caller must have exhausted a provider Session listing covering the
  -- whole creation window. Partial/error/capped listings are never evidence.
  if attempt.product_kind='SEARCH' then
    perform public.ap_expire_search_checkout(attempt.id,'VERIFIED_PROVIDER_SESSION_ABSENT');
  else
    perform public.ap_expire_material_checkout(attempt.id,'VERIFIED_PROVIDER_SESSION_ABSENT');
  end if;
  update public.ap_checkout_initiations set state='EXPIRED',reconciled_at=p_observed_at,
    updated_at=clock_timestamp() where id=attempt.id;
  insert into public.ap_audit_events(customer_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(attempt.customer_id,'CHECKOUT_PROVIDER_ABSENCE_RECONCILED','CHECKOUT_INITIATION',attempt.id,
    jsonb_build_object('source','verified_provider_session_listing','observedAt',p_observed_at,
      'evidenceSha256',p_evidence_sha256,'createdFrom',attempt.initiated_at,'createdThrough',attempt.provider_session_deadline),
    'checkout-initiation-v1');
  return true;
end $$;

-- Grant only public service entry points; helpers cannot create a general bypass.
create function public.ap_checkout_initiations_requiring_reconciliation(
  p_limit integer default 100,p_authorization_id uuid default null
) returns setof public.ap_checkout_initiations
language sql stable security definer set search_path='' as $$
  select attempt.* from public.ap_checkout_initiations attempt
    join public.ap_payment_attempts payment on payment.id=attempt.payment_attempt_id
  where (p_authorization_id is null or attempt.authorization_id=p_authorization_id)
    and (attempt.state in ('INITIATED','OPEN','EXPIRATION_REQUIRED')
      or (attempt.state='PAID' and (payment.payment_verified_at is null or payment.settlement<>'PAID')))
  order by attempt.provider_session_deadline,attempt.id
  limit greatest(1,least(coalesce(p_limit,100),100));
$$;

do $$ declare fn regprocedure; begin
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'ap_guard_checkout_initiation_history','ap_guard_staging_rehearsal_history',
      'ap_set_checkout_mode',
      'ap_authorize_scoped_manual_launch_canary_checkout',
      'ap_reconcile_checkout_initiation_absence',
      'ap_checkout_initiations_requiring_reconciliation',
      'ap_checkout_context_allows_rehearsal','ap_assert_checkout_initiation_authorized',
      'ap_authorize_staging_rehearsal_checkout','ap_revoke_staging_rehearsal_checkout',
      'ap_begin_authorized_search_checkout','ap_begin_authorized_material_checkout',
      'ap_bind_checkout_initiation','ap_reconcile_checkout_initiation','ap_mark_checkout_initiations_for_expiration')
  loop execute format('revoke all on function %s from public,anon,authenticated,service_role',fn); end loop;
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'ap_set_checkout_mode',
      'ap_authorize_scoped_manual_launch_canary_checkout',
      'ap_reconcile_checkout_initiation_absence',
      'ap_checkout_initiations_requiring_reconciliation',
      'ap_authorize_staging_rehearsal_checkout','ap_revoke_staging_rehearsal_checkout',
      'ap_begin_authorized_search_checkout','ap_begin_authorized_material_checkout',
      'ap_bind_checkout_initiation','ap_reconcile_checkout_initiation','ap_mark_checkout_initiations_for_expiration')
  loop execute format('grant execute on function %s to service_role',fn); end loop;
end $$;

-- Old deployed code must not retain a route around the database mode lock.
-- Definer wrappers still call these functions as the owner; reconciliation and
-- fulfillment functions retain their existing service grants.
revoke execute on function public.ap_begin_invited_search_checkout(uuid,text,uuid,text,uuid,uuid,text,uuid,text,uuid,text,uuid,uuid,text,text,uuid)
  from service_role;
revoke execute on function public.ap_begin_material_checkout(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,text,text,boolean,boolean,boolean)
  from service_role;
revoke execute on function public.ap_authorize_manual_launch_canary_checkout(text,text,uuid,uuid,uuid,text,timestamptz)
  from service_role;
revoke execute on function public.ap_reopen_provisional_search_checkout(uuid) from service_role;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202610220085','STAGING_REHEARSAL_CHECKOUT_ATTEMPTS',0,clock_timestamp());
do $$
declare
  definition text;
  prior_required_migrations text := '''202610040077'',''202610040078'',''202610040079'',''202610040080'',''202610190081'',''202610190082'',''202610190083'',''202610190084''';
begin
  definition:=pg_get_functiondef('public.ap_manual_launch_schema_readiness()'::regprocedure);
  if position('select count(*)=8 as installed' in definition)=0
    or position('''requiredSchemaVersion'', ''202610190084''' in definition)=0
    or position(prior_required_migrations in definition)=0
    then raise exception 'rehearsal_schema_readiness_anchor_missing'; end if;
  definition:=replace(definition,'select count(*)=8 as installed','select count(*)=9 as installed');
  definition:=replace(definition,'(''202610190084'',''LEGACY_BOARD_TERMINAL_EVENT_ORDERING'')',
    '(''202610190084'',''LEGACY_BOARD_TERMINAL_EVENT_ORDERING''),(''202610220085'',''STAGING_REHEARSAL_CHECKOUT_ATTEMPTS'')');
  definition:=replace(definition,'''requiredSchemaVersion'', ''202610190084''','''requiredSchemaVersion'', ''202610220085''');
  definition:=replace(definition,prior_required_migrations,prior_required_migrations||',''202610220085''');
  execute definition;
  if public.ap_manual_launch_schema_readiness()->'requiredMigrations' is distinct from jsonb_build_array(
    '202610040077','202610040078','202610040079','202610040080','202610190081',
    '202610190082','202610190083','202610190084','202610220085')
    then raise exception 'rehearsal_schema_required_migrations_invalid'; end if;
end $$;
commit;

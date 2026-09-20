-- Employer-first job aggregation foundation.
--
-- This migration does not activate a source. Collection schedules are disabled
-- by default and can run only while pinned to the latest employer-specific,
-- immutable AUTHORIZED_AUTOMATED source authorization.

alter table public.job_sources drop constraint if exists job_sources_adapter_kind_check;
alter table public.job_sources add constraint job_sources_adapter_kind_check
  check (adapter_kind in ('lever','greenhouse','ashby','recruitee','teamtailor','official_link_only','existing_import'));

alter table public.job_sources drop constraint if exists job_sources_ats_platform_check;
alter table public.job_sources add constraint job_sources_ats_platform_check
  check (ats_platform is null or ats_platform in ('lever','greenhouse','ashby','recruitee','teamtailor','workday','custom','unknown','none'));

alter table public.jobs
  add column last_observed_at timestamptz,
  add column last_successfully_verified_at timestamptz,
  add column lifecycle_state text not null default 'unknown'
    check (lifecycle_state in ('unknown','observed_open','verified_open','closed')),
  add column content_revision bigint not null default 0 check (content_revision >= 0),
  add column application_path_status text not null default 'unknown'
    check (application_path_status in ('unknown','unverified','verified_actionable','unavailable')),
  add column recoverable_merge_evidence jsonb not null default '[]'::jsonb
    check (jsonb_typeof(recoverable_merge_evidence)='array');

create or replace function public.ap_track_job_content_revision()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    new.content_revision:=case when new.content_hash is null then 0 else 1 end;
  elsif new.content_hash is distinct from old.content_hash then
    new.content_revision:=old.content_revision+1;
  end if;
  return new;
end;
$$;
create trigger ap_job_content_revision
before insert or update of content_hash on public.jobs
for each row execute function public.ap_track_job_content_revision();

create table public.ap_source_authorization_heads (
  source_id text primary key,
  current_authorization_id uuid not null unique references public.ap_source_authorizations(id),
  revision bigint not null default 1 check (revision > 0),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);
insert into public.ap_source_authorization_heads(source_id,current_authorization_id)
select distinct on (source_authority.source_id) source_authority.source_id,source_authority.id
from public.ap_source_authorizations source_authority
order by source_authority.source_id,source_authority.created_at desc,source_authority.id desc;

create table public.job_source_schedules (
  id uuid primary key default gen_random_uuid(),
  source_id text not null unique references public.job_sources(id),
  source_authorization_id uuid not null references public.ap_source_authorizations(id),
  authorization_head_revision bigint not null check (authorization_head_revision > 0),
  scope_sha256 text not null check (scope_sha256 ~ '^[0-9a-f]{64}$'),
  schedule_tier text not null check (schedule_tier in ('A','B','C','DISCOVERY')),
  cadence_seconds integer not null check (cadence_seconds between 900 and 1209600),
  jitter_seconds integer not null default 0 check (jitter_seconds between 0 and 21600 and jitter_seconds < cadence_seconds),
  result_bound integer not null check (result_bound between 1 and 500),
  page_bound integer not null default 5 check (page_bound between 1 and 20),
  request_bound integer not null default 5 check (request_bound between 1 and 20),
  response_byte_bound integer not null default 5242880 check (response_byte_bound between 1024 and 10485760),
  duration_ms_bound integer not null default 30000 check (duration_ms_bound between 1000 and 120000),
  host_concurrency_bound integer not null default 1 check (host_concurrency_bound = 1),
  quota_unit_bound integer not null default 0 check (quota_unit_bound = 0),
  minimum_complete_misses integer not null default 2 check (minimum_complete_misses between 2 and 10),
  visibility_window_seconds integer not null default 86400 check (visibility_window_seconds between 3600 and 1209600),
  enabled boolean not null default false,
  next_run_at timestamptz not null,
  last_enqueued_at timestamptz,
  last_started_at timestamptz,
  last_completed_at timestamptz,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  schedule_generation bigint not null default 0 check (schedule_generation >= 0),
  last_reconciled_generation bigint not null default 0 check (last_reconciled_generation >= 0 and last_reconciled_generation <= schedule_generation),
  paused_reason text,
  state_revision bigint not null default 1 check (state_revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not enabled or paused_reason is null),
  foreign key(source_id) references public.ap_source_authorization_heads(source_id)
);
create index job_source_schedules_due_idx
  on public.job_source_schedules(next_run_at,id) where enabled;

create or replace function public.ap_set_source_authorization_head(
  p_source_id text,p_authorization_id uuid,p_expected_revision bigint,p_actor_id uuid
) returns bigint language plpgsql security definer set search_path='' as $$
declare source_authority public.ap_source_authorizations; head public.ap_source_authorization_heads; next_revision bigint;
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and role in ('operator','admin'))
    then raise exception 'source_authorization_reviewer_required'; end if;
  select * into source_authority from public.ap_source_authorizations
    where id=p_authorization_id and source_id=p_source_id;
  if not found then raise exception 'source_authorization_scope_mismatch'; end if;
  select * into head from public.ap_source_authorization_heads where source_id=p_source_id for update;
  if found then
    if head.revision<>p_expected_revision then raise exception 'source_authorization_head_conflict'; end if;
    next_revision:=head.revision+1;
    update public.ap_source_authorization_heads set current_authorization_id=source_authority.id,
      revision=next_revision,updated_by=p_actor_id,updated_at=clock_timestamp() where source_id=p_source_id;
    update public.job_source_schedules set enabled=false,paused_reason='AUTHORIZATION_HEAD_CHANGED',
      state_revision=state_revision+1,updated_at=clock_timestamp() where source_id=p_source_id;
  else
    if p_expected_revision<>0 then raise exception 'source_authorization_head_conflict'; end if;
    next_revision:=1;
    insert into public.ap_source_authorization_heads(source_id,current_authorization_id,revision,updated_by)
      values(p_source_id,source_authority.id,next_revision,p_actor_id);
  end if;
  insert into public.ap_audit_events(actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(p_actor_id,'SOURCE_AUTHORIZATION_HEAD_CHANGED','SOURCE_AUTHORIZATION',source_authority.id,
    jsonb_build_object('sourceId',p_source_id,'headRevision',next_revision,'state',source_authority.state),
    'job-source-aggregation-v1');
  return next_revision;
end;
$$;

alter table public.ap_scheduled_jobs
  add column if not exists worker_pool text not null default 'COMMERCE'
    check (worker_pool in ('COMMERCE','JOB_SOURCE')),
  add column if not exists lease_epoch bigint not null default 0 check (lease_epoch >= 0),
  add column if not exists source_generation bigint check (source_generation is null or source_generation > 0);
create unique index ap_one_live_job_source_sync_per_schedule
  on public.ap_scheduled_jobs(reference_id)
  where job_kind='JOB_SOURCE_SYNC' and state in ('QUEUED','RETRY','LEASED');

create or replace function public.ap_claim_scheduled_jobs(p_owner text,p_limit integer default 10)
returns setof public.ap_scheduled_jobs language plpgsql security definer set search_path='' as $$
begin
  if length(btrim(p_owner))<3 or p_limit not between 1 and 50 then raise exception 'invalid_job_claim'; end if;
  return query with candidates as (
    select id from public.ap_scheduled_jobs
    where worker_pool='COMMERCE' and run_at<=clock_timestamp()
      and (state in ('QUEUED','RETRY') or (state='LEASED' and lease_expires_at<=clock_timestamp()))
    order by run_at,id for update skip locked limit p_limit
  ) update public.ap_scheduled_jobs job set state='LEASED',lease_owner=p_owner,
    lease_expires_at=clock_timestamp()+interval '5 minutes',attempts=attempts+1,
    lease_epoch=lease_epoch+1,updated_at=clock_timestamp()
    from candidates where job.id=candidates.id returning job.*;
end;
$$;

alter table public.job_source_runs
  add column schedule_id uuid references public.job_source_schedules(id),
  add column scheduled_job_id uuid references public.ap_scheduled_jobs(id),
  add column source_authorization_id uuid references public.ap_source_authorizations(id),
  add column authorization_head_revision bigint check (authorization_head_revision is null or authorization_head_revision > 0),
  add column schedule_generation bigint check (schedule_generation is null or schedule_generation > 0),
  add column scope_sha256 text check (scope_sha256 is null or scope_sha256 ~ '^[0-9a-f]{64}$'),
  add column attempt_number integer check (attempt_number is null or attempt_number > 0),
  add column trigger_kind text not null default 'legacy' check (trigger_kind in ('legacy','scheduled','admin','canary')),
  add column adapter_version text,
  add column enumeration_status text check (enumeration_status is null or enumeration_status in ('complete','partial','failed')),
  add column response_classification text,
  add column checkpoint_start jsonb,
  add column checkpoint_end jsonb,
  add column pages_requested integer not null default 0 check (pages_requested >= 0),
  add column pages_completed integer not null default 0 check (pages_completed >= 0),
  add column parsed_count integer not null default 0 check (parsed_count >= 0),
  add column persisted_count integer not null default 0 check (persisted_count >= 0),
  add column verified_count integer not null default 0 check (verified_count >= 0),
  add column quota_units integer not null default 0 check (quota_units >= 0),
  add column retry_after_seconds integer check (retry_after_seconds is null or retry_after_seconds >= 0),
  add column projection_status text not null default 'legacy'
    check (projection_status in ('legacy','observation_only','complete','failed')),
  add column closure_minimum_complete_misses integer check (closure_minimum_complete_misses is null or closure_minimum_complete_misses between 2 and 10),
  add column closure_visibility_window_seconds integer check (closure_visibility_window_seconds is null or closure_visibility_window_seconds between 3600 and 1209600),
  add column closure_reconciled_at timestamptz,
  add column error_metadata jsonb not null default '[]'::jsonb check (jsonb_typeof(error_metadata)='array');

alter table public.job_source_runs drop constraint if exists job_source_runs_status_check;
alter table public.job_source_runs add constraint job_source_runs_status_check
  check (status in ('started','succeeded','partial','failed','rate_limited','link_only'));
alter table public.job_source_runs add constraint job_source_runs_completion_check check (
  trigger_kind='legacy'
  or (completed_at is null and status='started')
  or (completed_at is not null and status<>'started')
);
alter table public.job_source_runs add constraint job_source_runs_enumeration_check check (
  trigger_kind='legacy'
  or (enumeration_status is null and status in ('started','link_only'))
  or (enumeration_status='complete' and status='succeeded')
  or (enumeration_status='partial' and status='partial')
  or (enumeration_status='failed' and status in ('failed','rate_limited'))
);
alter table public.job_source_runs add constraint job_source_runs_scope_check check (
  trigger_kind='legacy'
  or (schedule_id is not null and scheduled_job_id is not null and source_authorization_id is not null
    and authorization_head_revision is not null and schedule_generation is not null
    and scope_sha256 is not null and attempt_number is not null
    and projection_status<>'legacy'
    and closure_minimum_complete_misses is not null and closure_visibility_window_seconds is not null)
);
create index job_source_runs_operational_idx on public.job_source_runs(source_id,started_at desc);
create unique index job_source_runs_scheduled_attempt_idx on public.job_source_runs(scheduled_job_id,attempt_number)
  where scheduled_job_id is not null;

alter table public.ap_job_snapshots
  add column if not exists source_run_id uuid references public.job_source_runs(id),
  add column if not exists job_source_reference_id uuid references public.job_source_references(id),
  add column if not exists projection_input_sha256 text;
alter table public.ap_job_snapshots add constraint ap_job_snapshots_projection_input_sha256_check
  check (projection_input_sha256 is null or projection_input_sha256 ~ '^[0-9a-f]{64}$');

create table public.job_source_run_listings (
  run_id uuid not null references public.job_source_runs(id),
  listing_key text not null,
  job_id uuid references public.jobs(id),
  source_reference_id uuid references public.job_source_references(id),
  job_snapshot_id uuid references public.ap_job_snapshots(id),
  captured_listing jsonb not null check (jsonb_typeof(captured_listing)='object'),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  observed_at timestamptz not null,
  primary key(run_id,listing_key)
);
create index job_source_run_listings_reference_idx
  on public.job_source_run_listings(source_reference_id) where source_reference_id is not null;

create table public.job_source_discovery_snapshots (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  dataset_name text not null,
  dataset_version text not null,
  source_authorization_id uuid not null references public.ap_source_authorizations(id),
  authorization_head_revision bigint not null check (authorization_head_revision > 0),
  source_url text not null check (source_url ~ '^https://'),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  license_identifier text not null,
  license_evidence_sha256 text not null check (license_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  attribution_text text not null,
  importer_version text not null,
  row_count integer not null check (row_count >= 0),
  imported_count integer not null default 0 check (imported_count >= 0),
  quarantined_count integer not null default 0 check (quarantined_count >= 0),
  imported_at timestamptz not null default now(),
  imported_by uuid references public.profiles(id),
  notes text,
  unique(provider,dataset_name,dataset_version,content_sha256)
);

create table public.job_source_candidates (
  id uuid primary key default gen_random_uuid(),
  discovery_snapshot_id uuid not null references public.job_source_discovery_snapshots(id),
  external_candidate_id text,
  employer_name text,
  career_url text not null check (career_url ~ '^https://'),
  normalized_host text not null,
  ats_platform text,
  ats_tenant_identifier text,
  candidate_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(candidate_payload)='object'),
  status text not null default 'CANDIDATE' check (status in ('CANDIDATE','QUARANTINED','VERIFIED','REJECTED')),
  quarantine_reason text,
  verified_by uuid references public.profiles(id),
  verified_at timestamptz,
  admitted_source_id text references public.job_sources(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(discovery_snapshot_id,career_url),
  check ((status='QUARANTINED')=(quarantine_reason is not null)),
  check ((status='VERIFIED')=(verified_by is not null and verified_at is not null)),
  check (admitted_source_id is null or status='VERIFIED')
);
create index job_source_candidates_review_idx on public.job_source_candidates(status,created_at);

alter table public.job_source_references
  add column consecutive_complete_misses integer not null default 0 check (consecutive_complete_misses >= 0),
  add column last_complete_miss_at timestamptz,
  add column closed_at timestamptz,
  add column closed_by_run_id uuid references public.job_source_runs(id),
  add column closure_reason text;
alter table public.job_source_references add constraint job_source_reference_closure_check check (
  (is_active and closed_at is null and closed_by_run_id is null and closure_reason is null)
  or (not is_active and closed_at is not null and closed_by_run_id is not null and closure_reason is not null)
  or (not is_active and closed_at is null and closed_by_run_id is null and closure_reason is null)
);

create or replace function public.ap_enqueue_due_job_source_syncs(p_limit integer default 20)
returns integer language plpgsql security definer set search_path='' as $$
declare schedule_row public.job_source_schedules; queued integer:=0; next_generation bigint;
begin
  if p_limit < 1 or p_limit > 50 then raise exception 'job_source_schedule_limit_invalid'; end if;
  for schedule_row in
    select schedule.* from public.job_source_schedules schedule
    join public.job_sources source on source.id=schedule.source_id and source.is_active
    where schedule.enabled and schedule.paused_reason is null and schedule.next_run_at<=clock_timestamp()
      and not exists(select 1 from public.ap_scheduled_jobs live
        where live.job_kind='JOB_SOURCE_SYNC' and live.reference_id=schedule.id
          and live.state in ('QUEUED','RETRY','LEASED'))
      and exists(
        select 1 from public.ap_source_authorizations source_authority
        join public.ap_source_authorization_heads head
          on head.source_id=source_authority.source_id and head.current_authorization_id=source_authority.id
        where source_authority.id=schedule.source_authorization_id
          and source_authority.source_id=schedule.source_id
          and head.revision=schedule.authorization_head_revision
          and source_authority.state='AUTHORIZED_AUTOMATED'
          and source_authority.access_method='AUTOMATED'
          and 'ENUMERATE_JOBS'=any(source_authority.allowed_actions)
          and cardinality(source_authority.allowed_hosts)>0
          and coalesce(source_authority.rate_and_result_bounds->>'resultBound','') ~ '^[0-9]+$'
          and (source_authority.rate_and_result_bounds->>'resultBound')::integer>=schedule.result_bound
          and coalesce(source_authority.rate_and_result_bounds->>'pageBound','') ~ '^[0-9]+$'
          and (source_authority.rate_and_result_bounds->>'pageBound')::integer>=schedule.page_bound
          and coalesce(source_authority.rate_and_result_bounds->>'requestBound','') ~ '^[0-9]+$'
          and (source_authority.rate_and_result_bounds->>'requestBound')::integer>=schedule.request_bound
          and coalesce(source_authority.rate_and_result_bounds->>'responseByteBound','') ~ '^[0-9]+$'
          and (source_authority.rate_and_result_bounds->>'responseByteBound')::integer>=schedule.response_byte_bound
          and coalesce(source_authority.rate_and_result_bounds->>'durationMsBound','') ~ '^[0-9]+$'
          and (source_authority.rate_and_result_bounds->>'durationMsBound')::integer>=schedule.duration_ms_bound
          and coalesce(source_authority.rate_and_result_bounds->>'hostConcurrencyBound','') ~ '^[0-9]+$'
          and (source_authority.rate_and_result_bounds->>'hostConcurrencyBound')::integer>=schedule.host_concurrency_bound
          and coalesce(source_authority.rate_and_result_bounds->>'quotaUnitBound','') ~ '^[0-9]+$'
          and (source_authority.rate_and_result_bounds->>'quotaUnitBound')::integer>=schedule.quota_unit_bound
      )
    order by schedule.next_run_at,schedule.id
    for update of schedule skip locked limit p_limit
  loop
    next_generation:=schedule_row.schedule_generation+1;
    insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at,worker_pool,source_generation)
    values('JOB_SOURCE_SYNC',schedule_row.id,
      'job-source-sync:'||schedule_row.id::text||':'||next_generation::text,clock_timestamp(),'JOB_SOURCE',next_generation)
    on conflict(idempotency_key) do nothing;
    update public.job_source_schedules set
      schedule_generation=next_generation,
      last_enqueued_at=clock_timestamp(),
      next_run_at=clock_timestamp()+make_interval(secs=>schedule_row.cadence_seconds)
        +make_interval(secs=>floor(random()*(schedule_row.jitter_seconds+1))::integer),
      updated_at=clock_timestamp()
    where id=schedule_row.id;
    queued:=queued+1;
  end loop;
  return queued;
end;
$$;

create or replace function public.ap_set_job_source_schedule_state(
  p_schedule_id uuid,p_enabled boolean,p_expected_state_revision bigint,p_reason_code text,p_actor_id uuid
) returns bigint language plpgsql security definer set search_path='' as $$
declare schedule_row public.job_source_schedules; next_revision bigint; now_at timestamptz:=clock_timestamp();
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and role in ('operator','admin'))
    then raise exception 'job_source_schedule_operator_required'; end if;
  if (p_enabled and p_reason_code<>'RESUME_AFTER_REVIEW') or
    (not p_enabled and p_reason_code not in ('MANUAL_PAUSE','INCIDENT','RATE_LIMIT','SCHEMA_DRIFT','AUTHORIZATION_REVIEW'))
    then raise exception 'job_source_schedule_reason_invalid'; end if;
  select * into schedule_row from public.job_source_schedules where id=p_schedule_id for update;
  if not found then raise exception 'job_source_schedule_missing'; end if;
  if schedule_row.state_revision<>p_expected_state_revision
    then raise exception 'job_source_schedule_state_conflict'; end if;
  if p_enabled and not exists(
    select 1 from public.ap_source_authorizations source_authority
    join public.ap_source_authorization_heads head
      on head.source_id=source_authority.source_id and head.current_authorization_id=source_authority.id
    where source_authority.id=schedule_row.source_authorization_id
      and source_authority.source_id=schedule_row.source_id
      and head.revision=schedule_row.authorization_head_revision
      and source_authority.state='AUTHORIZED_AUTOMATED'
      and source_authority.access_method='AUTOMATED'
      and 'ENUMERATE_JOBS'=any(source_authority.allowed_actions)
      and cardinality(source_authority.allowed_hosts)>0
      and coalesce(source_authority.rate_and_result_bounds->>'resultBound','') ~ '^[0-9]+$'
      and (source_authority.rate_and_result_bounds->>'resultBound')::integer>=schedule_row.result_bound
      and coalesce(source_authority.rate_and_result_bounds->>'pageBound','') ~ '^[0-9]+$'
      and (source_authority.rate_and_result_bounds->>'pageBound')::integer>=schedule_row.page_bound
      and coalesce(source_authority.rate_and_result_bounds->>'requestBound','') ~ '^[0-9]+$'
      and (source_authority.rate_and_result_bounds->>'requestBound')::integer>=schedule_row.request_bound
      and coalesce(source_authority.rate_and_result_bounds->>'responseByteBound','') ~ '^[0-9]+$'
      and (source_authority.rate_and_result_bounds->>'responseByteBound')::integer>=schedule_row.response_byte_bound
      and coalesce(source_authority.rate_and_result_bounds->>'durationMsBound','') ~ '^[0-9]+$'
      and (source_authority.rate_and_result_bounds->>'durationMsBound')::integer>=schedule_row.duration_ms_bound
      and coalesce(source_authority.rate_and_result_bounds->>'hostConcurrencyBound','') ~ '^[0-9]+$'
      and (source_authority.rate_and_result_bounds->>'hostConcurrencyBound')::integer>=schedule_row.host_concurrency_bound
      and coalesce(source_authority.rate_and_result_bounds->>'quotaUnitBound','') ~ '^[0-9]+$'
      and (source_authority.rate_and_result_bounds->>'quotaUnitBound')::integer>=schedule_row.quota_unit_bound
  ) then raise exception 'current_employer_source_authorization_required'; end if;
  next_revision:=schedule_row.state_revision+1;
  update public.job_source_schedules set enabled=p_enabled,
    paused_reason=case when p_enabled then null else p_reason_code end,
    state_revision=next_revision,updated_at=now_at where id=schedule_row.id;
  insert into public.ap_audit_events(actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(p_actor_id,case when p_enabled then 'JOB_SOURCE_SCHEDULE_RESUMED' else 'JOB_SOURCE_SCHEDULE_PAUSED' end,
    'JOB_SOURCE_SCHEDULE',schedule_row.id,
    jsonb_build_object('sourceId',schedule_row.source_id,'reasonCode',p_reason_code,'stateRevision',next_revision),
    'job-source-aggregation-v1');
  return next_revision;
end;
$$;

create or replace function public.ap_enqueue_job_source_sync(p_schedule_id uuid,p_request_key text)
returns uuid language plpgsql security definer set search_path='' as $$
declare schedule_row public.job_source_schedules; queued_id uuid; next_generation bigint;
begin
  if nullif(btrim(p_request_key),'') is null or length(p_request_key)>100
    then raise exception 'job_source_request_key_invalid'; end if;
  select * into schedule_row from public.job_source_schedules where id=p_schedule_id for update;
  if not found or not schedule_row.enabled or schedule_row.paused_reason is not null
    then raise exception 'job_source_schedule_disabled'; end if;
  select id into queued_id from public.ap_scheduled_jobs
    where idempotency_key='job-source-sync-admin:'||p_schedule_id::text||':'||btrim(p_request_key);
  if found then return queued_id; end if;
  select id into queued_id from public.ap_scheduled_jobs
    where job_kind='JOB_SOURCE_SYNC' and reference_id=p_schedule_id and state in ('QUEUED','RETRY','LEASED')
    order by created_at limit 1;
  if found then return queued_id; end if;
  if not exists(
    select 1 from public.ap_source_authorizations source_authority
    join public.ap_source_authorization_heads head
      on head.source_id=source_authority.source_id and head.current_authorization_id=source_authority.id
    where source_authority.id=schedule_row.source_authorization_id
      and source_authority.source_id=schedule_row.source_id
      and head.revision=schedule_row.authorization_head_revision
      and source_authority.state='AUTHORIZED_AUTOMATED'
      and source_authority.access_method='AUTOMATED'
      and 'ENUMERATE_JOBS'=any(source_authority.allowed_actions)
      and cardinality(source_authority.allowed_hosts)>0
      and coalesce(source_authority.rate_and_result_bounds->>'resultBound','') ~ '^[0-9]+$'
      and (source_authority.rate_and_result_bounds->>'resultBound')::integer>=schedule_row.result_bound
      and coalesce(source_authority.rate_and_result_bounds->>'pageBound','') ~ '^[0-9]+$'
      and (source_authority.rate_and_result_bounds->>'pageBound')::integer>=schedule_row.page_bound
      and coalesce(source_authority.rate_and_result_bounds->>'requestBound','') ~ '^[0-9]+$'
      and (source_authority.rate_and_result_bounds->>'requestBound')::integer>=schedule_row.request_bound
      and coalesce(source_authority.rate_and_result_bounds->>'responseByteBound','') ~ '^[0-9]+$'
      and (source_authority.rate_and_result_bounds->>'responseByteBound')::integer>=schedule_row.response_byte_bound
      and coalesce(source_authority.rate_and_result_bounds->>'durationMsBound','') ~ '^[0-9]+$'
      and (source_authority.rate_and_result_bounds->>'durationMsBound')::integer>=schedule_row.duration_ms_bound
      and coalesce(source_authority.rate_and_result_bounds->>'hostConcurrencyBound','') ~ '^[0-9]+$'
      and (source_authority.rate_and_result_bounds->>'hostConcurrencyBound')::integer>=schedule_row.host_concurrency_bound
      and coalesce(source_authority.rate_and_result_bounds->>'quotaUnitBound','') ~ '^[0-9]+$'
      and (source_authority.rate_and_result_bounds->>'quotaUnitBound')::integer>=schedule_row.quota_unit_bound
  ) then raise exception 'current_employer_source_authorization_required'; end if;
  next_generation:=schedule_row.schedule_generation+1;
  insert into public.ap_scheduled_jobs(job_kind,reference_id,idempotency_key,run_at,worker_pool,source_generation)
  values('JOB_SOURCE_SYNC',schedule_row.id,
    'job-source-sync-admin:'||schedule_row.id::text||':'||btrim(p_request_key),clock_timestamp(),'JOB_SOURCE',next_generation)
  returning id into queued_id;
  update public.job_source_schedules set schedule_generation=next_generation,
    last_enqueued_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=schedule_row.id;
  return queued_id;
end;
$$;

create or replace function public.ap_claim_job_source_syncs(p_owner text,p_limit integer default 1)
returns setof public.ap_scheduled_jobs language plpgsql security definer set search_path='' as $$
begin
  if length(btrim(p_owner))<3 or p_limit<>1 then raise exception 'invalid_job_source_claim'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('applypack-job-source-global-claim',0));
  if exists(select 1 from public.ap_scheduled_jobs where worker_pool='JOB_SOURCE'
    and job_kind='JOB_SOURCE_SYNC' and state='LEASED' and lease_expires_at>clock_timestamp()) then return; end if;
  return query with candidates as (
    select scheduled.id from public.ap_scheduled_jobs scheduled
    join public.job_source_schedules schedule on schedule.id=scheduled.reference_id
    join public.ap_source_authorization_heads head on head.source_id=schedule.source_id
      and head.current_authorization_id=schedule.source_authorization_id
      and head.revision=schedule.authorization_head_revision
    join public.ap_source_authorizations source_authority on source_authority.id=head.current_authorization_id
      and source_authority.source_id=schedule.source_id
    where scheduled.worker_pool='JOB_SOURCE' and scheduled.job_kind='JOB_SOURCE_SYNC'
      and scheduled.run_at<=clock_timestamp() and schedule.enabled and schedule.paused_reason is null
      and source_authority.state='AUTHORIZED_AUTOMATED' and source_authority.access_method='AUTOMATED'
      and 'ENUMERATE_JOBS'=any(source_authority.allowed_actions)
      and cardinality(source_authority.allowed_hosts)>0
      and coalesce(source_authority.rate_and_result_bounds->>'resultBound','') ~ '^[0-9]+$'
      and (source_authority.rate_and_result_bounds->>'resultBound')::integer>=schedule.result_bound
      and coalesce(source_authority.rate_and_result_bounds->>'pageBound','') ~ '^[0-9]+$'
      and (source_authority.rate_and_result_bounds->>'pageBound')::integer>=schedule.page_bound
      and coalesce(source_authority.rate_and_result_bounds->>'requestBound','') ~ '^[0-9]+$'
      and (source_authority.rate_and_result_bounds->>'requestBound')::integer>=schedule.request_bound
      and coalesce(source_authority.rate_and_result_bounds->>'responseByteBound','') ~ '^[0-9]+$'
      and (source_authority.rate_and_result_bounds->>'responseByteBound')::integer>=schedule.response_byte_bound
      and coalesce(source_authority.rate_and_result_bounds->>'durationMsBound','') ~ '^[0-9]+$'
      and (source_authority.rate_and_result_bounds->>'durationMsBound')::integer>=schedule.duration_ms_bound
      and coalesce(source_authority.rate_and_result_bounds->>'hostConcurrencyBound','') ~ '^[0-9]+$'
      and (source_authority.rate_and_result_bounds->>'hostConcurrencyBound')::integer>=schedule.host_concurrency_bound
      and coalesce(source_authority.rate_and_result_bounds->>'quotaUnitBound','') ~ '^[0-9]+$'
      and (source_authority.rate_and_result_bounds->>'quotaUnitBound')::integer>=schedule.quota_unit_bound
      and (scheduled.state in ('QUEUED','RETRY')
        or (scheduled.state='LEASED' and scheduled.lease_expires_at<=clock_timestamp()))
    order by scheduled.run_at,scheduled.id for update of scheduled skip locked limit 1
  ), leased as (
    update public.ap_scheduled_jobs scheduled set state='LEASED',lease_owner=p_owner,
      lease_expires_at=clock_timestamp()+interval '5 minutes',attempts=attempts+1,
      lease_epoch=lease_epoch+1,updated_at=clock_timestamp()
      from candidates where scheduled.id=candidates.id returning scheduled.*
  ), started as (
    update public.job_source_schedules schedule set last_started_at=clock_timestamp(),updated_at=clock_timestamp()
    where schedule.id in (select leased.reference_id from leased) returning schedule.id
  ) select leased.* from leased join started on started.id=leased.reference_id;
end;
$$;

create or replace function public.ap_renew_job_source_sync_lease(p_job_id uuid,p_owner text,p_lease_epoch bigint)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare renewed_until timestamptz:=clock_timestamp()+interval '5 minutes';
begin
  update public.ap_scheduled_jobs set lease_expires_at=renewed_until,updated_at=clock_timestamp()
  where id=p_job_id and worker_pool='JOB_SOURCE' and job_kind='JOB_SOURCE_SYNC'
    and state='LEASED' and lease_owner=p_owner and lease_epoch=p_lease_epoch
    and lease_expires_at>clock_timestamp();
  if not found then raise exception 'job_source_lease_mismatch'; end if;
  return renewed_until;
end;
$$;

create or replace function public.ap_retry_job_source_sync(
  p_job_id uuid,p_owner text,p_lease_epoch bigint,p_error_code text,p_retry_at timestamptz,p_dead_letter boolean
) returns boolean language plpgsql security definer set search_path='' as $$
declare scheduled public.ap_scheduled_jobs; now_at timestamptz:=clock_timestamp();
  affected_source_id text; next_state_revision bigint;
begin
  select * into scheduled from public.ap_scheduled_jobs
  where id=p_job_id and worker_pool='JOB_SOURCE' and job_kind='JOB_SOURCE_SYNC'
    and state='LEASED' and lease_owner=p_owner and lease_epoch=p_lease_epoch
    and lease_expires_at>now_at for update;
  if not found then raise exception 'job_source_lease_mismatch'; end if;
  update public.ap_scheduled_jobs set
    state=case when p_dead_letter then 'DEAD_LETTER'::public.ap_scheduled_job_state else 'RETRY'::public.ap_scheduled_job_state end,
    run_at=case when p_dead_letter then run_at else p_retry_at end,lease_owner=null,lease_expires_at=null,
    last_error_code=left(p_error_code,100),updated_at=now_at where id=scheduled.id;
  update public.job_source_schedules set consecutive_failures=consecutive_failures+1,
    paused_reason=case when p_dead_letter then 'WORKER_DEAD_LETTER' else paused_reason end,
    enabled=case when p_dead_letter then false else enabled end,
    state_revision=state_revision+case when p_dead_letter then 1 else 0 end,updated_at=now_at
    where id=scheduled.reference_id returning source_id,state_revision into affected_source_id,next_state_revision;
  if p_dead_letter then
    insert into public.ap_audit_events(action,entity_type,entity_id,non_sensitive_details,audit_version)
    values('JOB_SOURCE_SCHEDULE_AUTO_PAUSED','JOB_SOURCE_SCHEDULE',scheduled.reference_id,
      jsonb_build_object('sourceId',affected_source_id,'reasonCode','WORKER_DEAD_LETTER',
        'errorCode',left(p_error_code,100),'stateRevision',next_state_revision),
      'job-source-aggregation-v1');
  end if;
  return true;
end;
$$;

create or replace function public.ap_complete_job_source_sync(p_job_id uuid,p_owner text,p_lease_epoch bigint)
returns boolean language plpgsql security definer set search_path='' as $$
declare scheduled public.ap_scheduled_jobs; now_at timestamptz:=clock_timestamp();
begin
  select * into scheduled from public.ap_scheduled_jobs
  where id=p_job_id and worker_pool='JOB_SOURCE' and job_kind='JOB_SOURCE_SYNC'
    and state='LEASED' and lease_owner=p_owner and lease_epoch=p_lease_epoch
    and lease_expires_at>now_at for update;
  if not found then raise exception 'job_source_lease_mismatch'; end if;
  if not exists(select 1 from public.job_source_runs run
    where run.scheduled_job_id=scheduled.id and run.status='succeeded'
      and run.enumeration_status='complete' and run.closure_reconciled_at is not null)
    then raise exception 'job_source_run_not_finalized'; end if;
  update public.ap_scheduled_jobs set state='COMPLETED',lease_owner=null,lease_expires_at=null,
    last_error_code=null,updated_at=now_at where id=scheduled.id;
  update public.job_source_schedules set consecutive_failures=0,last_completed_at=now_at,updated_at=now_at
    where id=scheduled.reference_id;
  return true;
end;
$$;

create or replace function public.ap_finalize_job_source_run(p_run_id uuid,p_owner text,p_lease_epoch bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare run_row public.job_source_runs; schedule_row public.job_source_schedules;
  updated_missing_references integer:=0; closed_jobs integer:=0; now_at timestamptz:=clock_timestamp();
begin
  select * into run_row from public.job_source_runs where id=p_run_id for update;
  if not found or run_row.status<>'succeeded' or run_row.enumeration_status<>'complete' or run_row.completed_at is null
    then raise exception 'complete_successful_enumeration_required'; end if;
  if run_row.closure_reconciled_at is not null then raise exception 'job_source_run_already_reconciled'; end if;
  select * into schedule_row from public.job_source_schedules where id=run_row.schedule_id for update;
  if not found then raise exception 'job_source_schedule_required_for_closure'; end if;
  if schedule_row.source_id<>run_row.source_id
    or schedule_row.source_authorization_id is distinct from run_row.source_authorization_id
    or schedule_row.authorization_head_revision is distinct from run_row.authorization_head_revision
    or schedule_row.scope_sha256 is distinct from run_row.scope_sha256
    or run_row.schedule_generation<=schedule_row.last_reconciled_generation
    or run_row.closure_minimum_complete_misses is null
    or run_row.closure_visibility_window_seconds is null
    or not exists(select 1 from public.ap_scheduled_jobs scheduled
      where scheduled.id=run_row.scheduled_job_id and scheduled.job_kind='JOB_SOURCE_SYNC'
        and scheduled.worker_pool='JOB_SOURCE' and scheduled.reference_id=schedule_row.id
        and scheduled.source_generation=run_row.schedule_generation
        and scheduled.state='LEASED' and scheduled.lease_owner=p_owner
        and scheduled.lease_epoch=p_lease_epoch and scheduled.lease_expires_at>clock_timestamp())
    then raise exception 'job_source_run_scope_mismatch'; end if;
  if not exists(
    select 1 from public.ap_source_authorizations source_authority
    join public.ap_source_authorization_heads head
      on head.source_id=source_authority.source_id and head.current_authorization_id=source_authority.id
    where source_authority.id=run_row.source_authorization_id
      and source_authority.source_id=run_row.source_id
      and head.revision=run_row.authorization_head_revision
      and source_authority.state='AUTHORIZED_AUTOMATED'
      and source_authority.access_method='AUTOMATED'
      and 'ENUMERATE_JOBS'=any(source_authority.allowed_actions)
      and cardinality(source_authority.allowed_hosts)>0
      and coalesce(source_authority.rate_and_result_bounds->>'resultBound','') ~ '^[0-9]+$'
      and (source_authority.rate_and_result_bounds->>'resultBound')::integer>=schedule_row.result_bound
      and coalesce(source_authority.rate_and_result_bounds->>'pageBound','') ~ '^[0-9]+$'
      and (source_authority.rate_and_result_bounds->>'pageBound')::integer>=schedule_row.page_bound
      and coalesce(source_authority.rate_and_result_bounds->>'requestBound','') ~ '^[0-9]+$'
      and (source_authority.rate_and_result_bounds->>'requestBound')::integer>=schedule_row.request_bound
      and coalesce(source_authority.rate_and_result_bounds->>'responseByteBound','') ~ '^[0-9]+$'
      and (source_authority.rate_and_result_bounds->>'responseByteBound')::integer>=schedule_row.response_byte_bound
      and coalesce(source_authority.rate_and_result_bounds->>'durationMsBound','') ~ '^[0-9]+$'
      and (source_authority.rate_and_result_bounds->>'durationMsBound')::integer>=schedule_row.duration_ms_bound
      and coalesce(source_authority.rate_and_result_bounds->>'hostConcurrencyBound','') ~ '^[0-9]+$'
      and (source_authority.rate_and_result_bounds->>'hostConcurrencyBound')::integer>=schedule_row.host_concurrency_bound
      and coalesce(source_authority.rate_and_result_bounds->>'quotaUnitBound','') ~ '^[0-9]+$'
      and (source_authority.rate_and_result_bounds->>'quotaUnitBound')::integer>=schedule_row.quota_unit_bound
  ) then raise exception 'current_employer_source_authorization_required'; end if;
  if (select count(*) from public.job_source_run_listings listing where listing.run_id=run_row.id)<>run_row.fetched_count
    then raise exception 'complete_run_listing_ledger_mismatch'; end if;
  if run_row.projection_status<>'complete' then
    update public.job_source_runs set closure_reconciled_at=now_at where id=run_row.id;
    update public.job_source_schedules set last_reconciled_generation=run_row.schedule_generation,updated_at=now_at
      where id=schedule_row.id;
    return jsonb_build_object('sourceId',run_row.source_id,'closureEligible',false,
      'reason','OBSERVATION_ONLY_NOT_PROJECTED','updatedMissingReferences',0,'closedJobs',0);
  end if;
  if run_row.persisted_count<>run_row.fetched_count or run_row.verified_count<>run_row.fetched_count
    or exists(select 1 from public.job_source_run_listings listing where listing.run_id=run_row.id
      and (listing.job_id is null or listing.source_reference_id is null or listing.job_snapshot_id is null))
    then raise exception 'complete_verified_projection_required_for_closure'; end if;

  update public.job_source_references reference set
    consecutive_complete_misses=0,last_complete_miss_at=null,
    is_active=case when reference.is_active or reference.closure_reason='REPEATED_COMPLETE_ENUMERATION_ABSENCE' then true else false end,
    closed_at=case when reference.closure_reason='REPEATED_COMPLETE_ENUMERATION_ABSENCE' then null else reference.closed_at end,
    closed_by_run_id=case when reference.closure_reason='REPEATED_COMPLETE_ENUMERATION_ABSENCE' then null else reference.closed_by_run_id end,
    closure_reason=case when reference.closure_reason='REPEATED_COMPLETE_ENUMERATION_ABSENCE' then null else reference.closure_reason end
  where reference.source_id=run_row.source_id and (
    (reference.external_job_id is not null and 'id:'||reference.external_job_id in
      (select listing.listing_key from public.job_source_run_listings listing where listing.run_id=run_row.id))
    or (reference.external_job_id is null and reference.normalized_source_url is not null
      and 'url:'||reference.normalized_source_url in
        (select listing.listing_key from public.job_source_run_listings listing where listing.run_id=run_row.id))
  );

  update public.job_source_references reference set
    consecutive_complete_misses=reference.consecutive_complete_misses+1,
    last_complete_miss_at=now_at,
    is_active=case when reference.consecutive_complete_misses+1>=run_row.closure_minimum_complete_misses
      and reference.last_verified_at<now_at-make_interval(secs=>run_row.closure_visibility_window_seconds) then false else reference.is_active end,
    closed_at=case when reference.consecutive_complete_misses+1>=run_row.closure_minimum_complete_misses
      and reference.last_verified_at<now_at-make_interval(secs=>run_row.closure_visibility_window_seconds) then now_at else reference.closed_at end,
    closed_by_run_id=case when reference.consecutive_complete_misses+1>=run_row.closure_minimum_complete_misses
      and reference.last_verified_at<now_at-make_interval(secs=>run_row.closure_visibility_window_seconds) then run_row.id else reference.closed_by_run_id end,
    closure_reason=case when reference.consecutive_complete_misses+1>=run_row.closure_minimum_complete_misses
      and reference.last_verified_at<now_at-make_interval(secs=>run_row.closure_visibility_window_seconds) then 'REPEATED_COMPLETE_ENUMERATION_ABSENCE' else reference.closure_reason end
  where reference.source_id=run_row.source_id and reference.is_active
    and (reference.external_job_id is not null or reference.normalized_source_url is not null)
    and (reference.last_complete_miss_at is null
      or reference.last_complete_miss_at<=now_at-make_interval(secs=>schedule_row.cadence_seconds))
    and not ((case when reference.external_job_id is not null then 'id:'||reference.external_job_id
      when reference.normalized_source_url is not null then 'url:'||reference.normalized_source_url
      else null end) in
        (select listing.listing_key from public.job_source_run_listings listing where listing.run_id=run_row.id));
  get diagnostics updated_missing_references=row_count;

  with closed as (
    update public.jobs job set is_active=false,listing_status='inactive',updated_at=now_at
    where job.is_active and exists(select 1 from public.job_source_references reference
      where reference.job_id=job.id and reference.closed_by_run_id=run_row.id)
      and not exists(select 1 from public.job_source_references active_reference
        where active_reference.job_id=job.id and active_reference.is_active)
    returning job.id
  ) select count(*) into closed_jobs from closed;
  update public.job_source_runs set closure_reconciled_at=now_at where id=run_row.id;
  update public.job_source_schedules set last_reconciled_generation=run_row.schedule_generation,updated_at=now_at
    where id=schedule_row.id;
  return jsonb_build_object('sourceId',run_row.source_id,'updatedMissingReferences',updated_missing_references,'closedJobs',closed_jobs);
end;
$$;

create or replace function public.ap_guard_job_source_run_evidence()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' and old.trigger_kind<>'legacy' then raise exception 'job_source_run_evidence_immutable'; end if;
  if tg_op='UPDATE' and old.trigger_kind<>'legacy' and old.status<>'started'
    and (to_jsonb(new)-'closure_reconciled_at')<>(to_jsonb(old)-'closure_reconciled_at')
    then raise exception 'job_source_run_evidence_immutable'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
create trigger job_source_run_evidence_guard
before update or delete on public.job_source_runs
for each row execute function public.ap_guard_job_source_run_evidence();

create or replace function public.ap_guard_job_source_run_listing()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op<>'INSERT' then raise exception 'job_source_run_listing_immutable'; end if;
  if not exists(select 1 from public.job_source_runs run
    where run.id=new.run_id and run.trigger_kind<>'legacy' and run.status='started')
    then raise exception 'open_job_source_run_required'; end if;
  return new;
end;
$$;
create trigger job_source_run_listing_guard
before insert or update or delete on public.job_source_run_listings
for each row execute function public.ap_guard_job_source_run_listing();

alter table public.ap_source_authorization_heads enable row level security;
alter table public.job_source_schedules enable row level security;
alter table public.job_source_run_listings enable row level security;
alter table public.job_source_discovery_snapshots enable row level security;
alter table public.job_source_candidates enable row level security;

revoke all on public.ap_source_authorization_heads,public.job_source_schedules,public.job_source_run_listings,
  public.job_source_discovery_snapshots,public.job_source_candidates from public,anon,authenticated;
grant select on public.ap_source_authorization_heads,public.job_source_schedules,
  public.job_source_discovery_snapshots,public.job_source_candidates to service_role;
grant select,insert on public.job_source_run_listings to service_role;

revoke all on function public.ap_set_source_authorization_head(text,uuid,bigint,uuid),
  public.ap_set_job_source_schedule_state(uuid,boolean,bigint,text,uuid),
  public.ap_enqueue_due_job_source_syncs(integer),
  public.ap_enqueue_job_source_sync(uuid,text),
  public.ap_claim_job_source_syncs(text,integer),
  public.ap_renew_job_source_sync_lease(uuid,text,bigint),
  public.ap_retry_job_source_sync(uuid,text,bigint,text,timestamptz,boolean),
  public.ap_complete_job_source_sync(uuid,text,bigint),
  public.ap_finalize_job_source_run(uuid,text,bigint)
  from public,anon,authenticated;
grant execute on function public.ap_set_source_authorization_head(text,uuid,bigint,uuid),
  public.ap_set_job_source_schedule_state(uuid,boolean,bigint,text,uuid),
  public.ap_enqueue_due_job_source_syncs(integer),
  public.ap_enqueue_job_source_sync(uuid,text),
  public.ap_claim_job_source_syncs(text,integer),
  public.ap_renew_job_source_sync_lease(uuid,text,bigint),
  public.ap_retry_job_source_sync(uuid,text,bigint,text,timestamptz,boolean),
  public.ap_complete_job_source_sync(uuid,text,bigint),
  public.ap_finalize_job_source_run(uuid,text,bigint)
  to service_role;

comment on table public.job_source_schedules is
  'Mutable operational scheduling only. Authorization remains immutable in ap_source_authorizations.';
comment on table public.job_source_candidates is
  'Discovery-only candidates. A row cannot feed inventory until separately verified, registered, and authorized.';
comment on column public.jobs.last_observed_at is
  'Latest source observation. This is not a successful human or canonical verification timestamp.';
comment on column public.jobs.last_successfully_verified_at is
  'Latest completed canonical verification; observation alone must not update this field.';
comment on function public.ap_finalize_job_source_run(uuid,text,bigint) is
  'Closes listings only after repeated authoritative complete enumerations and a visibility window. Partial or failed runs are rejected.';

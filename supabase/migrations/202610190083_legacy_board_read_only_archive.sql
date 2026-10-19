-- Preserve already-paid legacy board access without reviving the retired product.
-- The archive is a one-time snapshot. No admission, recompute, apply-link, or
-- board-origin commerce path remains writable after this migration.

begin;

drop trigger if exists ap_retire_board_subscription_state on public.ap_board_subscriptions;

create or replace function public.ap_legacy_board_has_access(
  p_customer_id uuid,
  p_now timestamptz default now()
) returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1
    from public.ap_board_subscriptions subscription
    where subscription.customer_id=p_customer_id
      and subscription.state in ('ACTIVE','CANCEL_AT_PERIOD_END')
      and subscription.access_ends_at>p_now
      and nullif(btrim(subscription.provider_customer_id),'') is not null
      and nullif(btrim(subscription.provider_subscription_id),'') is not null
      and nullif(btrim(subscription.last_provider_event_id),'') is not null
      and subscription.last_provider_event_created>0
      and subscription.refund_state in ('NONE','FAILED')
      and subscription.provider_dispute_id is null
  );
$$;
revoke all on function public.ap_legacy_board_has_access(uuid,timestamptz) from public,anon;
grant execute on function public.ap_legacy_board_has_access(uuid,timestamptz) to authenticated,service_role;

create or replace function public.ap_board_has_access(p_customer_id uuid,p_now timestamptz default now())
returns boolean language sql stable security definer set search_path='' as $$
  select public.ap_legacy_board_has_access(p_customer_id,p_now);
$$;
revoke all on function public.ap_board_has_access(uuid,timestamptz) from public,anon;
grant execute on function public.ap_board_has_access(uuid,timestamptz) to authenticated,service_role;

create table public.ap_legacy_board_archive_entries (
  id uuid primary key default gen_random_uuid(),
  admission_id uuid not null unique references public.ap_board_admissions(id),
  customer_id uuid not null references public.profiles(id),
  original_job_id uuid not null references public.jobs(id),
  company text not null,
  title text not null,
  description text,
  location_text text,
  salary_text text,
  posted_at timestamptz,
  last_verified_at timestamptz,
  source_name text,
  warning_codes jsonb not null default '[]'::jsonb check (jsonb_typeof(warning_codes)='array'),
  capability_connection_codes jsonb not null default '[]'::jsonb check (jsonb_typeof(capability_connection_codes)='array'),
  evaluated_at timestamptz not null,
  archived_at timestamptz not null default clock_timestamp()
);
create index ap_legacy_board_archive_customer_idx
  on public.ap_legacy_board_archive_entries(customer_id,archived_at desc,id);

insert into public.ap_legacy_board_archive_entries(
  admission_id,customer_id,original_job_id,company,title,description,location_text,salary_text,
  posted_at,last_verified_at,source_name,warning_codes,capability_connection_codes,evaluated_at
)
select admission.id,admission.customer_id,job.id,job.company,job.title,job.description,job.location_text,job.salary_text,
  job.posted_at,job.last_verified_at,job.source_name,admission.warning_codes,
  admission.capability_connection_codes,admission.evaluated_at
from public.ap_board_admissions admission
join public.jobs job on job.id=admission.job_id
where admission.decision='ADMITTED' and admission.superseded_at is null;

alter table public.ap_legacy_board_archive_entries enable row level security;
revoke all on public.ap_legacy_board_archive_entries from public,anon,authenticated,service_role;
grant select on public.ap_legacy_board_archive_entries to authenticated;
grant select on public.ap_legacy_board_archive_entries to service_role;
create policy ap_legacy_board_archive_owner_select on public.ap_legacy_board_archive_entries
  for select to authenticated using (
    customer_id=auth.uid() and public.ap_legacy_board_has_access(auth.uid())
  );

create or replace function public.ap_legacy_board_archive_is_immutable()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'legacy_board_archive_is_immutable';
end;
$$;
create trigger ap_legacy_board_archive_immutable
before insert or update or delete on public.ap_legacy_board_archive_entries
for each row execute function public.ap_legacy_board_archive_is_immutable();

create or replace function public.ap_legacy_board_runtime_is_frozen()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'legacy_board_runtime_is_frozen';
end;
$$;
create trigger ap_legacy_board_admissions_frozen
before insert or update or delete on public.ap_board_admissions
for each row execute function public.ap_legacy_board_runtime_is_frozen();
create trigger ap_legacy_board_profile_claims_frozen
before insert or update or delete on public.ap_board_profile_claims
for each row execute function public.ap_legacy_board_runtime_is_frozen();

update public.ap_board_recompute_jobs
set state='COMPLETED',completed_at=coalesce(completed_at,clock_timestamp()),lease_owner=null,
  lease_expires_at=null,last_error_code='LEGACY_BOARD_RECOMPUTE_RETIRED'
where state<>'COMPLETED';
create trigger ap_legacy_board_recompute_jobs_frozen
before insert or update or delete on public.ap_board_recompute_jobs
for each row execute function public.ap_legacy_board_runtime_is_frozen();

drop trigger if exists ap_queue_board_snapshot_change_trigger on public.ap_intake_snapshots;
drop trigger if exists ap_queue_board_job_change_trigger on public.jobs;
drop trigger if exists ap_queue_board_source_policy_change_trigger on public.job_sources;

create or replace function public.ap_enqueue_board_profile_recompute(
  p_customer_id uuid,p_profile_snapshot_id uuid,p_reason_code text
)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  raise exception 'legacy_board_recompute_retired';
end;
$$;
create or replace function public.ap_enqueue_board_job_recompute(
  p_job_id uuid,p_reason_code text,p_change_key text
)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  raise exception 'legacy_board_recompute_retired';
end;
$$;
create or replace function public.ap_claim_board_profile(
  p_draft_id uuid,p_secret_hash text,p_customer_id uuid,p_verified_email text
)
returns uuid language plpgsql security definer set search_path='' as $$
begin
  raise exception 'legacy_board_profile_claim_retired';
end;
$$;
create or replace function public.ap_claim_board_recompute_jobs(p_owner text,p_limit integer default 10)
returns setof public.ap_board_recompute_jobs language plpgsql security definer set search_path='' as $$
begin
  return;
end;
$$;
create or replace function public.ap_finish_board_recompute_job(
  p_job_id uuid,p_owner text,p_success boolean,p_error_code text default null
)
returns boolean language sql security definer set search_path='' as $$
  select false;
$$;

create or replace function public.ap_begin_board_material_checkout(
  p_customer_id uuid,p_board_admission_id uuid,p_source_snapshot_id uuid,p_contact_payload_id uuid,
  p_request_key text,p_selection_sha256 text,p_submission_rule_id uuid,p_emphasis_note text,
  p_do_not_mention_note text,p_career_break_choice text,p_career_break_custom_label text,
  p_cover_letter_break_consent boolean,p_document_contact_confirmed boolean,p_document_facts_confirmed boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  raise exception 'board_origin_commerce_retired';
end;
$$;

create or replace function public.ap_legacy_board_subscription_binding_is_immutable()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then raise exception 'new_board_subscriptions_are_retired'; end if;
  if new.customer_id is distinct from old.customer_id
    or new.plan_id is distinct from old.plan_id
    or new.provider_customer_id is distinct from old.provider_customer_id
    or new.provider_subscription_id is distinct from old.provider_subscription_id
    or new.provider_checkout_session_id is distinct from old.provider_checkout_session_id
    or new.created_at is distinct from old.created_at
  then raise exception 'legacy_board_subscription_binding_is_immutable'; end if;
  return new;
end;
$$;
create trigger ap_legacy_board_subscription_binding_immutable
before insert or update on public.ap_board_subscriptions
for each row execute function public.ap_legacy_board_subscription_binding_is_immutable();

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202610190083','LEGACY_BOARD_READ_ONLY_ARCHIVE',0,clock_timestamp())
on conflict(migration_id,checkpoint) do nothing;

do $$
declare definition text;
begin
  definition:=pg_catalog.pg_get_functiondef('public.ap_manual_launch_schema_readiness()'::regprocedure);
  definition:=replace(definition,'select count(*)=6 as installed','select count(*)=7 as installed');
  definition:=replace(definition,
    '(''202610190082'',''TAX_ACTIVATION_DECISION'')',
    '(''202610190082'',''TAX_ACTIVATION_DECISION''),'||E'\n      '||
      '(''202610190083'',''LEGACY_BOARD_READ_ONLY_ARCHIVE'')');
  definition:=replace(definition,'''requiredSchemaVersion'', ''202610190082''',
    '''requiredSchemaVersion'', ''202610190083''');
  definition:=replace(definition,
    '''202610040077'',''202610040078'',''202610040079'',''202610040080'',''202610190081'',''202610190082''',
    '''202610040077'',''202610040078'',''202610040079'',''202610040080'',''202610190081'',''202610190082'',''202610190083''');
  if position('202610190083' in definition)=0 or position('count(*)=7' in definition)=0 then
    raise exception 'launch_schema_legacy_board_archive_anchor_missing';
  end if;
  execute definition;
end $$;

commit;

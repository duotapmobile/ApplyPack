-- Final launch hardening: public ATS reachability is not paid-display authorization.
-- No existing source is promoted. A documentary authorization must be recorded
-- explicitly before its real inventory can satisfy board or readiness gates.

alter table public.job_sources drop constraint if exists job_sources_paid_display_permission_check;
alter table public.job_sources add constraint job_sources_paid_display_permission_check
  check (paid_display_permission_status in (
    'approved_public_endpoint',
    'documented_paid_display_authorized',
    'manual_research_only',
    'direct_link_only',
    'unverified',
    'requires_license_or_written_permission'
  ));

-- The old label describes endpoint reachability, not permission to display a
-- listing in a paid product. Demote it fail closed if any environment used it.
update public.job_sources
set paid_display_permission_status='requires_license_or_written_permission',
    schedule_enabled=false,
    updated_at=now()
where paid_display_permission_status='approved_public_endpoint';

create or replace function public.ap_queue_board_source_policy_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare affected public.jobs;
begin
  for affected in select * from public.jobs where source_id=new.id loop
    perform public.ap_enqueue_board_job_recompute(
      affected.id,
      'SOURCE_POLICY_CHANGED',
      new.id||':'||coalesce(new.updated_at::text,now()::text)
    );
  end loop;
  return new;
end;
$$;

drop trigger if exists ap_queue_board_source_policy_change_trigger on public.job_sources;
create trigger ap_queue_board_source_policy_change_trigger
after update of paid_display_permission_status,permission_evidence_url,is_active,
  health_status,last_successful_sync_at on public.job_sources
for each row execute function public.ap_queue_board_source_policy_change();

revoke all on function public.ap_queue_board_source_policy_change() from public,anon,authenticated;
grant execute on function public.ap_queue_board_source_policy_change() to service_role;

comment on column public.job_sources.paid_display_permission_status is
  'Paid-board display authority. Public endpoint reachability is insufficient; only documented_paid_display_authorized may satisfy paid display.';
-- The new board-or-Top-10 materials path receives the same one-round,
-- three-calendar-day factual correction contract as legacy material items.
alter table public.ap_material_support_cases
  drop constraint if exists ap_material_support_cases_case_kind_check;
alter table public.ap_material_support_cases
  add constraint ap_material_support_cases_case_kind_check
  check (case_kind in ('POSTDELIVERY_MATERIAL_FALSE_CLAIM','INCLUDED_FACTUAL_CORRECTION'));
create unique index if not exists ap_one_included_material_correction_per_line
  on public.ap_material_support_cases(material_line_id)
  where case_kind='INCLUDED_FACTUAL_CORRECTION';

create or replace function public.ap_open_postdelivery_false_claim_case(
  p_customer_id uuid,p_material_line_id uuid,p_artifact_id uuid,p_sensitive_payload_id uuid,
  p_non_sensitive_report jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare line_row public.ap_material_lines; purchase public.ap_material_purchases;
  case_id uuid:=gen_random_uuid(); now_at timestamptz:=clock_timestamp(); release_at timestamptz;
begin
  select * into line_row from public.ap_material_lines where id=p_material_line_id for update;
  select * into purchase from public.ap_material_purchases where id=line_row.purchase_id;
  select max(release.released_at) into release_at
  from public.ap_generated_artifacts artifact
  join public.ap_release_members member on member.member_id=artifact.id and member.member_type='GENERATED_ARTIFACT'
  join public.ap_releases release on release.id=member.release_id and release.material_line_id=line_row.id
  where artifact.id=p_artifact_id and artifact.material_line_id=line_row.id
    and artifact.customer_id=p_customer_id;
  if purchase.customer_id<>p_customer_id or line_row.fulfillment<>'DELIVERED'
    or jsonb_typeof(p_non_sensitive_report)<>'object' or p_non_sensitive_report='{}'::jsonb
    or not exists(select 1 from public.ap_sensitive_payloads
      where id=p_sensitive_payload_id and customer_id=p_customer_id)
    or release_at is null
    then raise exception 'included_correction_case_invalid'; end if;
  if release_at < now_at-interval '3 days' then
    raise exception 'included_correction_window_closed';
  end if;
  if exists(select 1 from public.ap_material_support_cases
      where material_line_id=line_row.id and case_kind='INCLUDED_FACTUAL_CORRECTION') then
    raise exception 'included_correction_round_already_used';
  end if;
  update public.ap_generated_file_versions file set downloads_revoked_at=coalesce(file.downloads_revoked_at,now_at)
    where file.artifact_id=p_artifact_id;
  update public.ap_artifact_quality_reviews quality set invalidated_at=coalesce(invalidated_at,now_at)
    from public.ap_generated_file_versions file where quality.file_version_id=file.id
      and file.artifact_id=p_artifact_id;
  insert into public.ap_material_support_cases(
    id,customer_id,material_line_id,artifact_id,sensitive_payload_id,case_kind,state,non_sensitive_fact_diff,opened_at
  ) values(case_id,p_customer_id,line_row.id,p_artifact_id,p_sensitive_payload_id,
    'INCLUDED_FACTUAL_CORRECTION','OPEN',p_non_sensitive_report,now_at);
  insert into public.ap_audit_events(customer_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(p_customer_id,'INCLUDED_MATERIAL_CORRECTION_OPENED','MATERIAL_SUPPORT_CASE',case_id,
    jsonb_build_object('materialLineId',line_row.id,'artifactId',p_artifact_id,
      'includedRound',1,'requestWithinDays',3,'downloadsRevoked',true),'final-integration-v1');
  return case_id;
end;
$$;
-- Neutral freshness sorting uses the employer-posted time when known and the
-- first-seen time otherwise. This is factual ordering, never personalization.
alter table public.jobs
  add column if not exists first_seen_at timestamptz;
update public.jobs
  set first_seen_at=coalesce(first_seen_at,created_at,checked_at,now())
  where first_seen_at is null;
alter table public.jobs
  alter column first_seen_at set default now(),
  alter column first_seen_at set not null;
alter table public.jobs
  add column if not exists freshness_sort_at timestamptz
  generated always as (coalesce(posted_at, first_seen_at, created_at)) stored;
create index if not exists jobs_factual_freshness_idx
  on public.jobs(freshness_sort_at desc,id);
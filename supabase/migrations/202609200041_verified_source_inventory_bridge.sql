begin;

-- Human direct verification is a separate, attributable act. A successful ATS
-- enumeration or hidden projection never creates this record automatically.
create table public.ap_source_inventory_verifications (
  id uuid primary key default gen_random_uuid(),
  projection_id uuid not null references public.job_source_listing_projections(id),
  criteria_snapshot_id uuid not null references public.ap_intake_snapshots(id),
  inventory_version_id uuid not null references public.ap_inventory_versions(id),
  inventory_member_id uuid not null references public.ap_inventory_members(id),
  job_snapshot_id uuid not null references public.ap_job_snapshots(id),
  source_reference_id uuid not null references public.job_source_references(id),
  reviewer_id uuid not null references public.profiles(id),
  source_authorization_id uuid not null references public.ap_source_authorizations(id),
  authorization_head_revision bigint not null,
  observed_content_sha256 text not null,
  direct_capture_sha256 text not null,
  verification_evidence jsonb not null,
  verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(projection_id,inventory_version_id)
);
alter table public.ap_source_inventory_verifications enable row level security;
revoke all on public.ap_source_inventory_verifications from public,anon,authenticated,service_role;
grant select on public.ap_source_inventory_verifications to service_role;
create trigger ap_source_inventory_verifications_immutable before update or delete
on public.ap_source_inventory_verifications for each row execute function public.ap_prevent_immutable_mutation();

create function public.ap_promote_verified_source_inventory(
  p_projection_id uuid,p_actor_id uuid,p_criteria_snapshot_id uuid,p_inventory_version_id uuid,
  p_review jsonb,p_stable_job_id text,p_job_snapshot jsonb,p_requirement_nodes jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare projection public.job_source_listing_projections; observation public.job_source_run_listings;
  run_row public.job_source_runs; head public.ap_source_authorization_heads; authority public.ap_source_authorizations;
  source_row public.job_sources; job public.jobs; prior public.ap_source_inventory_verifications;
  verified_time timestamptz; member_id uuid; reference_id uuid; checked_snapshot jsonb; capture_hash text;
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and role in ('admin','operator'))
    then raise exception 'source_promotion_operator_required'; end if;
  select * into projection from public.job_source_listing_projections where id=p_projection_id for update;
  select * into observation from public.job_source_run_listings where run_id=projection.run_id and listing_key=projection.listing_key;
  select * into run_row from public.job_source_runs where id=projection.run_id;
  select * into head from public.ap_source_authorization_heads where source_id=run_row.source_id for share;
  select * into authority from public.ap_source_authorizations where id=head.current_authorization_id;
  select * into source_row from public.job_sources where id=run_row.source_id for share;
  select * into job from public.jobs where id=projection.job_id for update;
  if projection.id is null or run_row.status is distinct from 'succeeded' or run_row.enumeration_status is distinct from 'complete'
    or head.current_authorization_id is distinct from projection.source_authorization_id
    or head.revision is distinct from projection.authorization_head_revision
    or authority.state is distinct from 'AUTHORIZED_AUTOMATED'
    or not coalesce(source_row.is_active,false)
    or job.rejection_reason is not null or job.lifecycle_state='closed'
    or exists(select 1 from public.job_source_references r where r.job_id=job.id and r.source_id=run_row.source_id and not r.is_active)
    or job.content_hash is distinct from observation.content_sha256
    or job.source_id is distinct from run_row.source_id
    or job.canonical_employer_id is distinct from source_row.canonical_employer_id
    or (job.closing_at is not null and job.closing_at<=clock_timestamp())
    or exists(select 1 from public.job_source_run_listings newer
      join public.job_source_runs newer_run on newer_run.id=newer.run_id
      where newer_run.source_id=run_row.source_id and newer.listing_key=observation.listing_key
        and newer.observed_at>observation.observed_at and newer.content_sha256<>observation.content_sha256)
    then raise exception 'source_promotion_authority_or_content_changed'; end if;
  if not exists(select 1 from public.ap_feasibility_coverage_plans where snapshot_id=p_criteria_snapshot_id and inventory_version_id=p_inventory_version_id)
    or not exists(select 1 from public.ap_intake_snapshots where id=p_criteria_snapshot_id and finalized_at is not null)
    or exists(select 1 from public.ap_intake_snapshots target join public.ap_intake_snapshots newer
      on (newer.draft_id=target.draft_id or newer.intake_id=target.intake_id)
      and newer.version>target.version and newer.finalized_at is not null
      where target.id=p_criteria_snapshot_id)
    then raise exception 'source_promotion_coverage_snapshot_mismatch'; end if;
  verified_time:=(p_review->>'checkedAt')::timestamptz;
  if verified_time is null or verified_time>clock_timestamp() or verified_time<clock_timestamp()-interval '15 minutes'
    or verified_time<observation.observed_at
    or p_review->>'method' is distinct from 'HUMAN_DIRECT_OFFICIAL_REVIEW'
    or p_review->>'employerIdentityConfirmed' is distinct from 'true'
    or p_review->>'applicationPathConfirmed' is distinct from 'true'
    or p_review->>'listingActiveConfirmed' is distinct from 'true'
    or p_review->>'legitimacyConfirmed' is distinct from 'true'
    or length(btrim(coalesce(p_review->>'evidenceNotes','')))<20
    or public.ap_source_projection_url(p_review->>'officialListingUrl') is distinct from job.normalized_source_url
    or public.ap_source_projection_url(p_review->>'officialApplicationUrl') is distinct from public.ap_source_projection_url(job.official_application_url)
    or job.official_application_url is null
    or regexp_replace(btrim(coalesce(p_review->>'capturedText','')),'\s+',' ','g') is distinct from regexp_replace(btrim(coalesce(job.description,'')),'\s+',' ','g')
    or length(btrim(coalesce(p_review->>'capturedText','')))=0
    then raise exception 'source_promotion_direct_evidence_required'; end if;
  capture_hash:=encode(extensions.digest(convert_to(p_review->>'capturedText','UTF8'),'sha256'),'hex');
  if p_review->>'captureSha256' is distinct from capture_hash
    or p_job_snapshot->>'legacy_job_id' is distinct from job.id::text
    or p_job_snapshot->>'company' is distinct from job.company
    or p_job_snapshot->>'exact_title' is distinct from job.raw_title
    or p_job_snapshot->>'source_url' is distinct from job.source_job_url
    or p_job_snapshot->>'canonical_application_url' is distinct from job.official_application_url
    or p_job_snapshot#>>'{captured_listing,text}' is distinct from p_review->>'capturedText'
    or jsonb_typeof(p_requirement_nodes) is distinct from 'array'
    or jsonb_array_length(p_requirement_nodes)=0
    then raise exception 'source_promotion_snapshot_binding_invalid'; end if;
  select * into prior from public.ap_source_inventory_verifications
    where projection_id=p_projection_id and inventory_version_id=p_inventory_version_id;
  if found then
    if prior.direct_capture_sha256<>capture_hash or prior.criteria_snapshot_id<>p_criteria_snapshot_id then
      raise exception 'source_promotion_replay_conflict'; end if;
    return prior.inventory_member_id;
  end if;
  checked_snapshot:=p_job_snapshot||jsonb_build_object(
    'source_authorization_id',authority.id,'discovery_source',run_row.source_id,
    'live_verified_at',verified_time,'retrieved_at',observation.observed_at,'first_seen_at',job.created_at,
    'employer_identity_result','PASS','application_path_result','PASS','listing_activity_result','PASS','legitimacy_result','PASS');
  member_id:=public.ap_persist_parsed_inventory_job(p_criteria_snapshot_id,p_inventory_version_id,p_stable_job_id,checked_snapshot,p_requirement_nodes);
  insert into public.job_source_references(job_id,source_id,source_name,source_job_url,normalized_source_url,
    official_application_url,external_job_id,is_official,is_direct_employer,last_verified_at,is_active)
  values(job.id,run_row.source_id,job.source_name,job.source_job_url,job.normalized_source_url,
    job.official_application_url,job.external_job_id,job.is_official_source,job.is_direct_employer_source,verified_time,true)
  on conflict(job_id,source_id,external_job_id) do update set last_verified_at=excluded.last_verified_at
  where job_source_references.is_active
  returning id into reference_id;
  if reference_id is null then raise exception 'source_promotion_inactive_reference_requires_review'; end if;
  insert into public.ap_source_inventory_verifications(projection_id,criteria_snapshot_id,inventory_version_id,
    inventory_member_id,job_snapshot_id,source_reference_id,reviewer_id,source_authorization_id,authorization_head_revision,
    observed_content_sha256,direct_capture_sha256,verification_evidence,verified_at)
  values(p_projection_id,p_criteria_snapshot_id,p_inventory_version_id,member_id,(checked_snapshot->>'id')::uuid,
    reference_id,p_actor_id,authority.id,head.revision,observation.content_sha256,capture_hash,p_review,verified_time);
  -- Source display permission and per-customer board rules remain independent.
  -- Do not enable a source, a schedule, or checkout here.
  update public.jobs set is_active=true,listing_status='open',lifecycle_state='verified_open',
    application_path_status='verified_actionable',last_verified_at=verified_time,last_successfully_verified_at=verified_time,
    source_freshness_status='fresh',checked_at=verified_time
  where id=job.id;
  return member_id;
end;
$$;
revoke all on function public.ap_promote_verified_source_inventory(uuid,uuid,uuid,uuid,jsonb,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.ap_promote_verified_source_inventory(uuid,uuid,uuid,uuid,jsonb,text,jsonb,jsonb) to service_role;
commit;

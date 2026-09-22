begin;
-- Source verification is independent of customer criteria and inventory admission.
create table public.ap_source_verifications (
 id uuid primary key default gen_random_uuid(),
 projection_id uuid not null unique references public.job_source_listing_projections(id),
 job_snapshot_id uuid not null unique references public.ap_job_snapshots(id),
 source_reference_id uuid not null references public.job_source_references(id),
 reviewer_id uuid not null references public.profiles(id),
 source_authorization_id uuid not null references public.ap_source_authorizations(id),
 authorization_head_revision bigint not null,
 observed_content_sha256 text not null,
 direct_capture_sha256 text not null,
 verification_evidence jsonb not null,
 verified_at timestamptz not null,
 stable_normalized_job_id text not null check(length(stable_normalized_job_id)>0),
 created_at timestamptz not null default now()
);
alter table public.ap_source_verifications enable row level security;
revoke all on public.ap_source_verifications from public,anon,authenticated,service_role;
grant select on public.ap_source_verifications to service_role;
create trigger ap_source_verifications_immutable before update or delete on public.ap_source_verifications
 for each row execute function public.ap_prevent_immutable_mutation();
create table public.ap_source_lifecycle_reviews (
 id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs(id),
 projection_id uuid not null references public.job_source_listing_projections(id),
 reviewer_id uuid not null references public.profiles(id), action text not null check(action in ('CHANGED','REOPENED')),
 reason text not null check(length(btrim(reason))>=20), previous_content_sha256 text not null,
 observed_content_sha256 text not null, created_at timestamptz not null default now()
);
alter table public.ap_source_lifecycle_reviews enable row level security;
revoke all on public.ap_source_lifecycle_reviews from public,anon,authenticated,service_role;
grant select on public.ap_source_lifecycle_reviews to service_role;
create trigger ap_source_lifecycle_reviews_immutable before update or delete on public.ap_source_lifecycle_reviews
 for each row execute function public.ap_prevent_immutable_mutation();
-- A source transition has its own immutable review; it has no customer criteria.
alter table public.ap_job_snapshots add column source_lifecycle_review_id uuid
 references public.ap_source_lifecycle_reviews(id);
alter table public.ap_job_snapshots drop constraint ap_job_snapshots_correction_lineage_check;
alter table public.ap_job_snapshots add constraint ap_job_snapshots_correction_lineage_check check (
 (supersedes_job_snapshot_id is null and correction_review_id is null and source_lifecycle_review_id is null)
 or (supersedes_job_snapshot_id is not null and num_nonnulls(correction_review_id,source_lifecycle_review_id)=1)
);
create unique index ap_job_snapshots_source_lifecycle_review_unique on public.ap_job_snapshots(source_lifecycle_review_id)
 where source_lifecycle_review_id is not null;

-- Preserve historical snapshots while recording that their canonical input changed.
create table public.ap_job_snapshot_invalidations (
 job_snapshot_id uuid primary key references public.ap_job_snapshots(id),
 legacy_job_id uuid not null references public.jobs(id),
 previous_content_sha256 text, replacement_content_sha256 text,
 reason text not null check(reason='CANONICAL_SOURCE_CONTENT_CHANGED'),
 invalidated_at timestamptz not null default clock_timestamp()
);
alter table public.ap_job_snapshot_invalidations enable row level security;
revoke all on public.ap_job_snapshot_invalidations from public,anon,authenticated,service_role;
grant select on public.ap_job_snapshot_invalidations to service_role;
create trigger ap_job_snapshot_invalidations_immutable before update or delete on public.ap_job_snapshot_invalidations
 for each row execute function public.ap_prevent_immutable_mutation();

-- Lock canonical state before checking invalidation, including brand-new generation.
create function public.ap_guard_generated_artifact_source_snapshot()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.jobs job join public.ap_job_snapshots snapshot on snapshot.legacy_job_id=job.id
 where snapshot.id=new.job_snapshot_id for share of job;
 if exists(select 1 from public.ap_job_snapshot_invalidations where job_snapshot_id=new.job_snapshot_id) then
   raise exception 'material_generation_stale_job_snapshot'; end if;
 return new;
end;
$$;
create trigger ap_generated_artifact_source_snapshot_current before insert on public.ap_generated_artifacts
 for each row execute function public.ap_guard_generated_artifact_source_snapshot();
revoke all on function public.ap_guard_generated_artifact_source_snapshot() from public,anon,authenticated;

-- All download, approval and release RPCs already call this current-facts guard.
-- Check after its canonical row lock, so content changes cannot race the decision.
do $migration$
declare definition text; anchor text;
begin
 definition:=pg_get_functiondef('public.ap_assert_current_artifact_facts(uuid)'::regprocedure);
 anchor:='  if artifact.artifact_type in (''RESUME'',''COVER_LETTER'') and';
 if position(anchor in definition)=0 then raise exception 'artifact_source_invalidation_anchor_missing'; end if;
 definition:=replace(definition,anchor,
   '  if exists(select 1 from public.ap_job_snapshot_invalidations where job_snapshot_id=artifact.job_snapshot_id) then'
   ||chr(10)||'    raise exception ''material_download_unavailable''; end if;'||chr(10)||anchor);
 execute definition;
end;
$migration$;

-- A canonical content change invalidates every historical sibling for this exact job.
-- Timestamp-only refreshes and unrelated jobs at the same employer remain valid.
create function public.ap_invalidate_materials_for_job_content_change()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.content_hash is not distinct from old.content_hash then return new; end if;
 insert into public.ap_job_snapshot_invalidations(job_snapshot_id,legacy_job_id,previous_content_sha256,replacement_content_sha256,reason)
 select snapshot.id,new.id,old.content_hash,new.content_hash,'CANONICAL_SOURCE_CONTENT_CHANGED'
 from public.ap_job_snapshots snapshot where snapshot.legacy_job_id=new.id
 on conflict(job_snapshot_id) do nothing;
 update public.ap_generated_file_versions file
 set downloads_revoked_at=coalesce(file.downloads_revoked_at,clock_timestamp())
 from public.ap_generated_artifacts artifact,public.ap_job_snapshots snapshot
 where artifact.id=file.artifact_id and snapshot.id=artifact.job_snapshot_id and snapshot.legacy_job_id=new.id;
 update public.ap_artifact_quality_reviews review
 set invalidated_at=coalesce(review.invalidated_at,clock_timestamp())
 from public.ap_generated_file_versions file,public.ap_generated_artifacts artifact,public.ap_job_snapshots snapshot
 where review.file_version_id=file.id and file.artifact_id=artifact.id
 and snapshot.id=artifact.job_snapshot_id and snapshot.legacy_job_id=new.id;
 return new;
end;
$$;
create trigger ap_material_job_content_changed after update of content_hash on public.jobs
for each row execute function public.ap_invalidate_materials_for_job_content_change();
revoke all on function public.ap_invalidate_materials_for_job_content_change() from public,anon,authenticated;

create function public.ap_verify_source_observation(
  p_projection_id uuid,p_actor_id uuid,
  p_review jsonb,p_stable_job_id text,p_job_snapshot jsonb,p_requirement_nodes jsonb,p_normalized jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare projection public.job_source_listing_projections; observation public.job_source_run_listings;
  run_row public.job_source_runs; head public.ap_source_authorization_heads; authority public.ap_source_authorizations;
  source_row public.job_sources; job public.jobs; prior public.ap_source_verifications;
  normalized public.jobs; previous_snapshot_id uuid; lifecycle_review_id uuid; transition_kind text; verified_time timestamptz; member_id uuid; reference_id uuid; checked_snapshot jsonb; capture_hash text;
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
  perform 1 from public.job_source_references where job_id=job.id and source_id=run_row.source_id for update;
  if projection.id is null or run_row.status is distinct from 'succeeded' or run_row.enumeration_status is distinct from 'complete'
    or head.current_authorization_id is distinct from projection.source_authorization_id
    or head.revision is distinct from projection.authorization_head_revision
    or authority.state is distinct from 'AUTHORIZED_AUTOMATED'
    or not coalesce(source_row.is_active,false)
    or job.rejection_reason is not null
    or job.source_id is distinct from run_row.source_id
    or job.canonical_employer_id is distinct from source_row.canonical_employer_id
    or (nullif(p_normalized->>'closing_at','')::timestamptz<=clock_timestamp())
    or exists(select 1 from public.job_source_run_listings newer
      join public.job_source_runs newer_run on newer_run.id=newer.run_id
      where newer_run.source_id=run_row.source_id and newer.listing_key=observation.listing_key
        and newer.observed_at>observation.observed_at and newer.content_sha256<>observation.content_sha256)
    then raise exception 'source_promotion_authority_or_content_changed'; end if;
  select * into prior from public.ap_source_verifications where projection_id=p_projection_id;
  if found then
    if prior.direct_capture_sha256 is distinct from encode(extensions.digest(convert_to(p_review->>'capturedText','UTF8'),'sha256'),'hex')
      or job.content_hash is distinct from observation.content_sha256 or not job.is_active
      or exists(select 1 from public.job_source_references where id=prior.source_reference_id and not is_active)
      then raise exception 'source_promotion_replay_conflict'; end if;
    return prior.job_snapshot_id;
  end if;
  normalized:=jsonb_populate_record(null::public.jobs,p_normalized);
  transition_kind:=coalesce(p_review->>'lifecycleAction','UNCHANGED');
  if normalized.content_hash is distinct from observation.content_sha256
    or normalized.canonical_employer_id is distinct from job.canonical_employer_id
    or normalized.source_id is distinct from job.source_id
    or normalized.external_job_id is distinct from job.external_job_id
    or normalized.normalized_source_url is distinct from job.normalized_source_url
    or normalized.rejection_reason is not null then raise exception 'source_transition_identity_changed'; end if;
  if job.lifecycle_state='closed' or exists(select 1 from public.job_source_references r
    where r.job_id=job.id and r.source_id=run_row.source_id and not r.is_active) then
    if transition_kind<>'REOPENED' or exists(select 1 from public.job_source_references r
       where r.job_id=job.id and r.source_id=run_row.source_id and not r.is_active
         and (r.closed_at is null or observation.observed_at<=r.closed_at)) then
      raise exception 'source_reopen_requires_new_direct_review'; end if;
  elsif job.content_hash<>observation.content_sha256 and transition_kind<>'CHANGED' then
    raise exception 'source_changed_content_requires_review';
  end if;
  if transition_kind not in ('UNCHANGED','CHANGED','REOPENED') or
    (transition_kind<>'UNCHANGED' and length(btrim(coalesce(p_review->>'transitionReason','')))<20) then
    raise exception 'source_transition_reason_required'; end if;
  -- Update only the observed canonical fields, inside this same direct-review transaction.
  -- Any later evidence failure rolls the update back.
  if transition_kind<>'UNCHANGED' then
    insert into public.ap_source_lifecycle_reviews(job_id,projection_id,reviewer_id,action,reason,previous_content_sha256,observed_content_sha256)
    values(job.id,p_projection_id,p_actor_id,transition_kind,p_review->>'transitionReason',job.content_hash,observation.content_sha256)
    returning id into lifecycle_review_id;
    select snapshot.id into previous_snapshot_id from public.ap_job_snapshots snapshot
    where snapshot.legacy_job_id=job.id and not exists(select 1 from public.ap_job_snapshots successor
      where successor.supersedes_job_snapshot_id=snapshot.id)
    order by snapshot.live_verified_at desc,snapshot.retrieved_at desc,snapshot.id desc limit 1 for update;
    update public.jobs set company=normalized.company,employer_display_name=normalized.employer_display_name,employer_aliases=normalized.employer_aliases,
      title=normalized.title,raw_title=normalized.raw_title,normalized_title=normalized.normalized_title,
      description=normalized.description,department=normalized.department,source_name=normalized.source_name,
      source_category=normalized.source_category,is_official_source=normalized.is_official_source,is_direct_employer_source=normalized.is_direct_employer_source,
      source_url=normalized.source_url,source_job_url=normalized.source_job_url,official_application_url=normalized.official_application_url,
      content_hash=normalized.content_hash,deduplication_key=normalized.deduplication_key,location_text=normalized.location_text,
      employment_type=normalized.employment_type,w2_or_contractor=normalized.w2_or_contractor,work_mode=normalized.work_mode,
      remote_scope=normalized.remote_scope,eligible_states=normalized.eligible_states,eligible_countries=normalized.eligible_countries,
      timezone_requirement=normalized.timezone_requirement,schedule_type=normalized.schedule_type,salary_min=normalized.salary_min,
      salary_max=normalized.salary_max,salary_currency=normalized.salary_currency,pay_period=normalized.pay_period,
      salary_text=normalized.salary_text,pay_model=normalized.pay_model,phone_intensity=normalized.phone_intensity,
      sales_flag=normalized.sales_flag,commission_flag=normalized.commission_flag,marketing_flag=normalized.marketing_flag,
      high_volume_contact_center_flag=normalized.high_volume_contact_center_flag,degree_required=normalized.degree_required,experience_level=normalized.experience_level,
      equipment_requirement=normalized.equipment_requirement,equipment_cost_responsibility=normalized.equipment_cost_responsibility,applicant_cost=normalized.applicant_cost,
      benefits_status=normalized.benefits_status,language_requirements=normalized.language_requirements,posted_at=normalized.posted_at,
      closing_at=normalized.closing_at,last_observed_at=observation.observed_at
    where id=job.id returning * into job;
  end if;
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
  select * into prior from public.ap_source_verifications
    where projection_id=p_projection_id;
  if found then
    if prior.direct_capture_sha256<>capture_hash then
      raise exception 'source_promotion_replay_conflict'; end if;
    return prior.job_snapshot_id;
  end if;
  checked_snapshot:=p_job_snapshot||jsonb_build_object(
    'source_authorization_id',authority.id,'discovery_source',run_row.source_id,
    'live_verified_at',verified_time,'retrieved_at',observation.observed_at,'first_seen_at',job.created_at,
    'employer_identity_result','PASS','application_path_result','PASS','listing_activity_result','PASS','legitimacy_result','PASS');
  insert into public.ap_job_snapshots(
    id,legacy_job_id,origin,discovery_source,external_job_id,canonical_application_url,application_host_type,
    canonical_employer_listing_url,source_url,company,exact_title,normalized_fingerprint,captured_listing,retrieved_at,
    posted_on,posted_date_unknown,live_verified_at,compensation_text,compensation_source,location_and_work_mode,
    parser_version,content_sha256,source_authorization_id,first_seen_at,canonical_employer_domain,employer_identity_result,
    application_path_result,listing_activity_result,legitimacy_result,requirement_completeness,compensation_completeness,
    canonicalization_version,legacy_compatibility,material_source_qualities,
    supersedes_job_snapshot_id,source_lifecycle_review_id
  )
  values(
    (checked_snapshot->>'id')::uuid,(checked_snapshot->>'legacy_job_id')::uuid,(checked_snapshot->>'origin')::public.ap_job_origin,checked_snapshot->>'discovery_source',
    nullif(checked_snapshot->>'external_job_id',''),checked_snapshot->>'canonical_application_url',checked_snapshot->>'application_host_type',
    nullif(checked_snapshot->>'canonical_employer_listing_url',''),checked_snapshot->>'source_url',checked_snapshot->>'company',
    checked_snapshot->>'exact_title',checked_snapshot->>'normalized_fingerprint',checked_snapshot->'captured_listing',
    (checked_snapshot->>'retrieved_at')::timestamptz,nullif(checked_snapshot->>'posted_on','')::date,(checked_snapshot->>'posted_date_unknown')::boolean,
    (checked_snapshot->>'live_verified_at')::timestamptz,nullif(checked_snapshot->>'compensation_text',''),nullif(checked_snapshot->>'compensation_source',''),
    checked_snapshot->'location_and_work_mode',checked_snapshot->>'parser_version',checked_snapshot->>'content_sha256',
    (checked_snapshot->>'source_authorization_id')::uuid,(checked_snapshot->>'first_seen_at')::timestamptz,checked_snapshot->>'canonical_employer_domain',
    checked_snapshot->>'employer_identity_result',checked_snapshot->>'application_path_result',checked_snapshot->>'listing_activity_result',
    checked_snapshot->>'legitimacy_result',(checked_snapshot->>'requirement_completeness')::integer,(checked_snapshot->>'compensation_completeness')::integer,
    checked_snapshot->>'canonicalization_version',false,
    case
      when jsonb_typeof(checked_snapshot->'material_source_qualities')='array'
        and jsonb_array_length(checked_snapshot->'material_source_qualities')>0
      then array(select (quality)::numeric from jsonb_array_elements_text(checked_snapshot->'material_source_qualities') quality)
      else array[0.8]::numeric[]
    end,previous_snapshot_id,case when previous_snapshot_id is not null then lifecycle_review_id end
  );
  insert into public.ap_requirement_nodes(id,job_snapshot_id,parent_id,position,node_kind,criterion_type,stable_criterion_id,semantic_key,requirement_strength,source_locator,parser_certainty,criterion_version,typed_value,source_excerpt,classification_method,importance,human_correction_history)
  select node.id,(checked_snapshot->>'id')::uuid,node.parent_id,node.position,node.node_kind,node.criterion_type,node.stable_criterion_id,node.semantic_key,node.requirement_strength,node.source_locator,node.parser_certainty,node.criterion_version,node.typed_value,node.source_excerpt,node.classification_method,node.importance,coalesce(node.human_correction_history,'[]'::jsonb)
  from jsonb_to_recordset(p_requirement_nodes) as node(id uuid,parent_id uuid,position integer,node_kind public.ap_requirement_node_kind,criterion_type public.ap_criterion_type,stable_criterion_id uuid,semantic_key text,requirement_strength text,source_locator text,parser_certainty numeric,criterion_version text,typed_value jsonb,source_excerpt text,classification_method text,importance smallint,human_correction_history jsonb);

  if transition_kind='REOPENED' then
    update public.job_source_references set is_active=true,closed_at=null,closed_by_run_id=null,closure_reason=null,
      consecutive_complete_misses=0,last_complete_miss_at=null
    where job_id=job.id and source_id=run_row.source_id and not is_active;
  end if;
  insert into public.job_source_references(job_id,source_id,source_name,source_job_url,normalized_source_url,
    official_application_url,external_job_id,is_official,is_direct_employer,last_verified_at,is_active)
  values(job.id,run_row.source_id,job.source_name,job.source_job_url,job.normalized_source_url,
    job.official_application_url,job.external_job_id,job.is_official_source,job.is_direct_employer_source,verified_time,true)
  on conflict(job_id,source_id,external_job_id) do update set last_verified_at=excluded.last_verified_at,
    official_application_url=excluded.official_application_url,source_job_url=excluded.source_job_url,
    normalized_source_url=excluded.normalized_source_url
  where job_source_references.is_active
  returning id into reference_id;
  if reference_id is null then raise exception 'source_promotion_inactive_reference_requires_review'; end if;
  insert into public.ap_source_verifications(projection_id,job_snapshot_id,source_reference_id,reviewer_id,
    source_authorization_id,authorization_head_revision,observed_content_sha256,direct_capture_sha256,
    verification_evidence,verified_at,stable_normalized_job_id)
  values(p_projection_id,(checked_snapshot->>'id')::uuid,reference_id,p_actor_id,authority.id,head.revision,
    observation.content_sha256,capture_hash,p_review,verified_time,p_stable_job_id);
  -- Source display permission and per-customer board rules remain independent.
  -- Do not enable a source, a schedule, or checkout here.
  update public.jobs set is_active=true,listing_status='open',lifecycle_state='verified_open',
    application_path_status='verified_actionable',last_verified_at=verified_time,last_successfully_verified_at=verified_time,
    source_freshness_status='fresh',checked_at=verified_time
  where id=job.id;
  return (checked_snapshot->>'id')::uuid;
end;
$$;
revoke all on function public.ap_verify_source_observation(uuid,uuid,jsonb,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.ap_verify_source_observation(uuid,uuid,jsonb,text,jsonb,jsonb,jsonb) to service_role;

create table public.ap_source_closure_reconciliations (
 run_id uuid primary key references public.job_source_runs(id),
 source_id text not null references public.job_sources(id),
 generation bigint not null,
 reviewer_id uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),
 unique(source_id,generation)
);
alter table public.ap_source_closure_reconciliations enable row level security;
revoke all on public.ap_source_closure_reconciliations from public,anon,authenticated,service_role;
grant select on public.ap_source_closure_reconciliations to service_role;
create trigger ap_source_closure_reconciliations_immutable before update or delete on public.ap_source_closure_reconciliations
 for each row execute function public.ap_prevent_immutable_mutation();
create function public.ap_reconcile_verified_source_run(p_run_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare run_row public.job_source_runs; schedule_row public.job_source_schedules;
 updated_missing_references integer:=0; closed_jobs integer:=0; now_at timestamptz:=clock_timestamp();
begin
 if not exists(select 1 from public.profiles where id=p_actor_id and role in ('admin','operator')) then
  raise exception 'source_reconciliation_operator_required'; end if;
 select * into run_row from public.job_source_runs where id=p_run_id for update;
 select * into schedule_row from public.job_source_schedules where id=run_row.schedule_id for update;
 if exists(select 1 from public.ap_source_closure_reconciliations where run_id=p_run_id) then
  return jsonb_build_object('replayed',true); end if;
 if run_row.id is null or schedule_row.id is null or run_row.status<>'succeeded' or run_row.enumeration_status<>'complete'
   or run_row.trigger_kind<>'scheduled'
   or run_row.checkpoint_start is not null or run_row.completed_at<now_at-interval '24 hours'
   or exists(select 1 from public.job_source_runs newer where newer.source_id=run_row.source_id
      and newer.id<>run_row.id and (newer.started_at>run_row.started_at or newer.completed_at>run_row.completed_at))
   or run_row.scope_sha256<>schedule_row.scope_sha256 or not schedule_row.enabled or schedule_row.paused_reason is not null
   or run_row.fetched_count<>(select count(*) from public.job_source_run_listings where run_id=p_run_id)
   or not exists(select 1 from public.ap_source_authorization_heads h
      join public.ap_source_authorizations a on a.id=h.current_authorization_id
      join public.job_sources source on source.id=h.source_id
      where h.source_id=run_row.source_id and h.revision=run_row.authorization_head_revision
      and h.current_authorization_id=run_row.source_authorization_id and a.state='AUTHORIZED_AUTOMATED'
      and a.access_method='AUTOMATED' and 'ENUMERATE_JOBS'=any(a.allowed_actions) and source.is_active)
   or exists(select 1 from public.ap_source_closure_reconciliations where source_id=run_row.source_id and generation>=run_row.schedule_generation)
   or exists(select 1 from public.job_source_run_listings listing where listing.run_id=p_run_id and not exists(
      select 1 from public.job_source_listing_projections projection
      join public.ap_source_verifications verification on verification.projection_id=projection.id
      join public.job_source_references reference on reference.id=verification.source_reference_id
      where projection.run_id=p_run_id and projection.listing_key=listing.listing_key
      and verification.observed_content_sha256=listing.content_sha256
      and verification.source_authorization_id=run_row.source_authorization_id
      and verification.authorization_head_revision=run_row.authorization_head_revision
      and verification.verified_at>=now_at-interval '24 hours' and reference.is_active))
 then raise exception 'complete_current_directly_verified_snapshot_required'; end if;
  update public.job_source_references reference set consecutive_complete_misses=0,last_complete_miss_at=null
  where reference.source_id=run_row.source_id and reference.is_active and
    (case when reference.external_job_id is not null then 'id:'||reference.external_job_id else 'url:'||reference.normalized_source_url end)
      in (select listing_key from public.job_source_run_listings where run_id=p_run_id);
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
    update public.jobs job set is_active=false,listing_status='inactive',lifecycle_state='closed',checked_at=now_at
    where job.is_active and exists(select 1 from public.job_source_references reference
      where reference.job_id=job.id and reference.closed_by_run_id=run_row.id)
      and not exists(select 1 from public.job_source_references active_reference
        where active_reference.job_id=job.id and active_reference.is_active)
    returning job.id
  ) select count(*) into closed_jobs from closed;

 insert into public.ap_source_closure_reconciliations(run_id,source_id,generation,reviewer_id)
 values(p_run_id,run_row.source_id,run_row.schedule_generation,p_actor_id);
 return jsonb_build_object('closureEligible',true,'updatedMissingReferences',updated_missing_references,'closedJobs',closed_jobs);
end; $$;
revoke all on function public.ap_reconcile_verified_source_run(uuid,uuid) from public,anon,authenticated;
grant execute on function public.ap_reconcile_verified_source_run(uuid,uuid) to service_role;
create table public.ap_source_attempt_payloads (
 run_id uuid primary key references public.job_source_runs(id), adapter_version text not null,
 postings jsonb not null check(jsonb_typeof(postings)='array' and jsonb_array_length(postings)<=500),
 content_sha256 text not null, created_at timestamptz not null default now()
);
alter table public.ap_source_attempt_payloads enable row level security;
revoke all on public.ap_source_attempt_payloads from public,anon,authenticated,service_role;
grant select on public.ap_source_attempt_payloads to service_role;
create trigger ap_source_attempt_payloads_immutable before update or delete on public.ap_source_attempt_payloads
 for each row execute function public.ap_prevent_immutable_mutation();
create function public.ap_archive_source_attempt(p_run_id uuid,p_adapter_version text,p_postings jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.job_source_runs where id=p_run_id and status='started' and trigger_kind='scheduled')
   or length(btrim(coalesce(p_adapter_version,'')))=0 or jsonb_typeof(p_postings) is distinct from 'array'
   or jsonb_array_length(p_postings)>500 then raise exception 'source_attempt_archive_invalid'; end if;
 insert into public.ap_source_attempt_payloads(run_id,adapter_version,postings,content_sha256)
 values(p_run_id,p_adapter_version,p_postings,encode(extensions.digest(convert_to(p_postings::text,'UTF8'),'sha256'),'hex'));
end; $$;
revoke all on function public.ap_archive_source_attempt(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.ap_archive_source_attempt(uuid,text,jsonb) to service_role;
commit;

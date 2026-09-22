-- Current immutable verification is required; mutable job flags are insufficient.
begin;
create function public.ap_current_source_verifications(p_snapshot_id uuid)
returns setof public.ap_source_verifications language sql stable security definer set search_path='' as $shared$
select verification.*
    from public.ap_source_verifications verification
    join public.ap_job_snapshots snapshot on snapshot.id=verification.job_snapshot_id
    join public.job_source_references reference on reference.id=verification.source_reference_id and reference.is_active
    join public.jobs job on job.id=reference.job_id and job.id=snapshot.legacy_job_id
    join public.job_sources source on source.id=reference.source_id and source.id=job.source_id
    join public.ap_source_authorization_heads head on head.source_id=source.id
      and head.current_authorization_id=verification.source_authorization_id and head.revision=verification.authorization_head_revision
    join public.ap_source_authorizations authority on authority.id=head.current_authorization_id and authority.source_id=source.id
    where (p_snapshot_id is null or verification.job_snapshot_id=p_snapshot_id) and source.is_active and source.id<>'synthetic-staging'
      and source.paid_display_permission_status='documented_paid_display_authorized'
      and job.is_active and job.listing_status='open' and job.rejection_reason is null
      and job.content_hash=verification.observed_content_sha256
      and job.application_path_status='verified_actionable'
      and (job.closing_at is null or job.closing_at>clock_timestamp())
      and verification.verified_at between clock_timestamp()-interval '24 hours' and clock_timestamp()
      and snapshot.live_verified_at=verification.verified_at and snapshot.source_authorization_id=authority.id
      and snapshot.requirement_completeness=100 and not snapshot.legacy_compatibility
      and snapshot.employer_identity_result='PASS' and snapshot.application_path_result='PASS'
      and snapshot.listing_activity_result='PASS' and snapshot.legitimacy_result='PASS'
      and public.ap_source_projection_url(reference.official_application_url)=public.ap_source_projection_url(job.official_application_url)
      and not exists(select 1 from public.ap_job_snapshot_invalidations invalid where invalid.job_snapshot_id=snapshot.id)
      and not exists(select 1 from public.ap_job_snapshots successor where successor.supersedes_job_snapshot_id=snapshot.id)
      -- New captured content cannot become ready merely because old mutable flags remain verified.
      and not exists(select 1 from public.job_source_run_listings listing join public.job_source_runs run on run.id=listing.run_id
        where run.source_id=source.id and run.source_authorization_id=authority.id and run.authorization_head_revision=head.revision
          and listing.observed_at>verification.verified_at and listing.content_sha256<>job.content_hash
          and ((job.external_job_id is not null and listing.captured_listing->>'externalJobId'=job.external_job_id)
            or public.ap_source_projection_url(listing.captured_listing->>'sourceJobUrl')=job.normalized_source_url))
      and ((authority.state='AUTHORIZED_MANUAL_ONLY' and 'MANUAL_REVIEW'=any(authority.allowed_actions)
        and exists(select 1 from public.ap_manual_source_observations receipt where receipt.id=verification.manual_observation_id
          and receipt.source_id=source.id and receipt.source_authorization_id=authority.id
          and receipt.authorization_head_revision=head.revision and receipt.content_sha256=verification.observed_content_sha256))
        or (authority.state='AUTHORIZED_AUTOMATED' and 'ENUMERATE_JOBS'=any(authority.allowed_actions)
        and exists(select 1 from public.job_source_listing_projections projection
          join public.job_source_run_listings observation on observation.run_id=projection.run_id and observation.listing_key=projection.listing_key
          join public.job_source_runs run on run.id=projection.run_id
          where projection.id=verification.projection_id and projection.job_id=job.id
            and run.source_id=source.id and run.source_authorization_id=authority.id and run.authorization_head_revision=head.revision
            and projection.source_authorization_id=authority.id and projection.authorization_head_revision=head.revision
            and projection.observation_content_sha256=verification.observed_content_sha256
            and observation.content_sha256=verification.observed_content_sha256)));
$shared$;
revoke all on function public.ap_current_source_verifications(uuid) from public,anon,authenticated;
grant execute on function public.ap_current_source_verifications(uuid) to service_role;

create or replace function public.ap_current_source_readiness() returns jsonb
language sql stable security invoker set search_path='' as $function$
  with eligible as (
    select schedule.source_id, schedule.id schedule_id, authority.id authorization_id,
      head.revision, schedule.scope_sha256
    from public.job_source_schedules schedule
    join public.job_sources source on source.id=schedule.source_id
    join public.ap_source_authorization_heads head on head.source_id=source.id
    join public.ap_source_authorizations authority on authority.id=head.current_authorization_id
    where schedule.enabled and schedule.paused_reason is null and source.is_active
      and source.id<>'synthetic-staging'
      and source.paid_display_permission_status='documented_paid_display_authorized'
      and authority.id=schedule.source_authorization_id and authority.source_id=source.id
      and head.revision=schedule.authorization_head_revision
      and authority.state='AUTHORIZED_AUTOMATED' and authority.access_method='AUTOMATED'
      and 'ENUMERATE_JOBS'=any(authority.allowed_actions) and cardinality(authority.allowed_hosts)>0
      and not exists (
        select 1 from (values
          ('resultBound',schedule.result_bound),('pageBound',schedule.page_bound),
          ('requestBound',schedule.request_bound),('responseByteBound',schedule.response_byte_bound),
          ('durationMsBound',schedule.duration_ms_bound),('hostConcurrencyBound',schedule.host_concurrency_bound),
          ('quotaUnitBound',schedule.quota_unit_bound)
        ) bounds(key,required)
        where not case when coalesce(authority.rate_and_result_bounds->>bounds.key,'') ~ '^[0-9]+$'
          then (authority.rate_and_result_bounds->>bounds.key)::numeric>=bounds.required else false end
      )
  ), complete_runs as (
    select run.id, run.source_id from public.job_source_runs run
    join eligible on eligible.source_id=run.source_id and eligible.schedule_id=run.schedule_id
      and eligible.authorization_id=run.source_authorization_id and eligible.revision=run.authorization_head_revision
      and eligible.scope_sha256=run.scope_sha256
    where run.status='succeeded' and run.enumeration_status='complete' and run.error_code is null
      and run.fetched_count>0 and run.parsed_count=run.fetched_count and run.rejected_count=0
      and run.completed_at between statement_timestamp()-interval '72 hours' and statement_timestamp()
      and (select count(*) from public.job_source_run_listings listing where listing.run_id=run.id)=run.fetched_count
  
  ), verified as (
    select job.id job_id,source.id source_id,authority.state,authority.allowed_actions,
      verification.projection_id,verification.manual_observation_id,verification.observed_content_sha256,
      verification.verified_at,verification.source_authorization_id,verification.authorization_head_revision
    from public.ap_current_source_verifications(null) verification
    join public.ap_job_snapshots snapshot on snapshot.id=verification.job_snapshot_id
    join public.job_source_references reference on reference.id=verification.source_reference_id and reference.is_active
    join public.jobs job on job.id=reference.job_id and job.id=snapshot.legacy_job_id
    join public.job_sources source on source.id=reference.source_id and source.id=job.source_id
    join public.ap_source_authorization_heads head on head.source_id=source.id
      and head.current_authorization_id=verification.source_authorization_id and head.revision=verification.authorization_head_revision
    join public.ap_source_authorizations authority on authority.id=head.current_authorization_id and authority.source_id=source.id
    where source.is_active and source.id<>'synthetic-staging'
      and source.paid_display_permission_status='documented_paid_display_authorized'
      and job.is_active and job.listing_status='open' and job.rejection_reason is null
      and job.content_hash=verification.observed_content_sha256
      and job.application_path_status='verified_actionable'
      and (job.closing_at is null or job.closing_at>clock_timestamp())
      and verification.verified_at between clock_timestamp()-interval '24 hours' and clock_timestamp()
      and snapshot.live_verified_at=verification.verified_at and snapshot.source_authorization_id=authority.id
      and snapshot.requirement_completeness=100 and not snapshot.legacy_compatibility
      and snapshot.employer_identity_result='PASS' and snapshot.application_path_result='PASS'
      and snapshot.listing_activity_result='PASS' and snapshot.legitimacy_result='PASS'
      and public.ap_source_projection_url(reference.official_application_url)=public.ap_source_projection_url(job.official_application_url)
      and not exists(select 1 from public.ap_job_snapshot_invalidations invalid where invalid.job_snapshot_id=snapshot.id)
      and not exists(select 1 from public.ap_job_snapshots successor where successor.supersedes_job_snapshot_id=snapshot.id)
      -- New captured content cannot become ready merely because old mutable flags remain verified.
      and not exists(select 1 from public.job_source_run_listings listing join public.job_source_runs run on run.id=listing.run_id
        where run.source_id=source.id and run.source_authorization_id=authority.id and run.authorization_head_revision=head.revision
          and listing.observed_at>verification.verified_at and listing.content_sha256<>job.content_hash
          and ((job.external_job_id is not null and listing.captured_listing->>'externalJobId'=job.external_job_id)
            or public.ap_source_projection_url(listing.captured_listing->>'sourceJobUrl')=job.normalized_source_url))
  ), manual as (
    select verified.job_id from verified join public.ap_manual_source_observations receipt on receipt.id=verified.manual_observation_id
    where verified.state='AUTHORIZED_MANUAL_ONLY' and 'MANUAL_REVIEW'=any(verified.allowed_actions)
      and receipt.source_id=verified.source_id and receipt.source_authorization_id=verified.source_authorization_id
      and receipt.authorization_head_revision=verified.authorization_head_revision
      and receipt.content_sha256=verified.observed_content_sha256
  ), automated as (
    select verified.job_id from verified join public.job_source_listing_projections projection on projection.id=verified.projection_id
    join complete_runs run on run.id=projection.run_id and run.source_id=verified.source_id
    join public.job_source_run_listings observation on observation.run_id=projection.run_id and observation.listing_key=projection.listing_key
    where verified.state='AUTHORIZED_AUTOMATED' and 'ENUMERATE_JOBS'=any(verified.allowed_actions)
      and projection.job_id=verified.job_id and projection.source_authorization_id=verified.source_authorization_id
      and projection.authorization_head_revision=verified.authorization_head_revision
      and projection.observation_content_sha256=verified.observed_content_sha256
      and observation.content_sha256=verified.observed_content_sha256
  )
  select jsonb_build_object(
    'jobSourcesRegistered',exists(select 1 from complete_runs) or exists(select 1 from manual),
    'authorizedSourceInventory',exists(select 1 from manual) or exists(select 1 from automated),
    'manualReady',exists(select 1 from manual),'automatedReady',exists(select 1 from automated)
  );
$function$;
revoke all on function public.ap_current_source_readiness() from public,anon,authenticated;
grant execute on function public.ap_current_source_readiness() to service_role;

create or replace function public.ap_current_verified_job_snapshots(p_job_ids uuid[])
returns table(id uuid,legacy_job_id uuid,requirement_completeness integer,live_verified_at timestamptz)
language sql stable security definer set search_path='' as $current$
 select s.id,s.legacy_job_id,s.requirement_completeness::integer,s.live_verified_at
 from public.ap_job_snapshots s join public.ap_current_source_verifications(null) v on v.job_snapshot_id=s.id
 where cardinality(p_job_ids)<=5000 and s.legacy_job_id=any(p_job_ids)
 order by s.live_verified_at desc;
$current$;
-- Preserve all earlier criteria/ownership/idempotency checks while serializing
-- admission with canonical content changes and rejecting pending changed captures.
do $admission$ declare definition text; anchor text;
begin
 definition:=pg_get_functiondef('public.ap_admit_verified_inventory_snapshot(uuid,uuid,uuid,text)'::regprocedure);
 anchor:='select * into j from public.ap_job_snapshots where id=p_job_snapshot_id for share;';
 if position(anchor in definition)=0 then raise exception 'inventory_current_evidence_anchor_missing'; end if;
 execute replace(definition,anchor,anchor||'
 perform 1 from public.jobs where id=j.legacy_job_id for share;
 if not exists(select 1 from public.ap_current_source_verifications(j.id)) then
   raise exception ''inventory_source_verification_lineage_required'';
 end if;');
end $admission$;

-- Delivery, approval and release must recheck the same live source evidence.
-- No historical snapshot without that ledger is treated as verified.
do $release$ declare definition text; anchor text;
begin
 definition:=pg_get_functiondef('public.ap_assert_current_artifact_facts(uuid)'::regprocedure);
 anchor:='  if artifact.artifact_type in (''RESUME'',''COVER_LETTER'') and';
 if position(anchor in definition)=0 then raise exception 'artifact_current_source_anchor_missing'; end if;
 execute replace(definition,anchor,
   '  if artifact.job_snapshot_id is not null and not exists(select 1 from public.ap_current_source_verifications(artifact.job_snapshot_id)) then'
   ||chr(10)||'    raise exception ''material_download_unavailable''; end if;'||chr(10)||anchor);
end $release$;

do $match_release$ declare definition text; anchor text;
begin
 definition:=pg_get_functiondef('public.ap_record_job_release_review(uuid,uuid,uuid,public.ap_staff_review_decision,text)'::regprocedure);
 anchor:='  if p_decision=''APPROVED'' and (';
 if position(anchor in definition)=0 then raise exception 'job_review_current_source_anchor_missing'; end if;
 execute replace(definition,anchor,
   '  if p_decision=''APPROVED'' then
     perform 1 from public.jobs j join public.ap_job_snapshots s on s.legacy_job_id=j.id where s.id=evaluation_row.job_snapshot_id for share of j;
     if not exists(select 1 from public.ap_current_source_verifications(evaluation_row.job_snapshot_id)) then raise exception ''release_current_source_evidence_required''; end if;
   end if;'||chr(10)||anchor);
 definition:=pg_get_functiondef('public.ap_commit_exact_ten_release(uuid,uuid,uuid,jsonb,jsonb,text,uuid,uuid)'::regprocedure);
 anchor:='    select * into job_row from public.ap_job_snapshots where id=evaluation_row.job_snapshot_id;';
 if position(anchor in definition)=0 then raise exception 'exact_ten_current_source_anchor_missing'; end if;
 execute replace(definition,anchor,anchor||'
    perform 1 from public.jobs where id=job_row.legacy_job_id for share;
    if not exists(select 1 from public.ap_current_source_verifications(job_row.id)) then raise exception ''release_current_source_evidence_required''; end if;');
end $match_release$;
commit;

begin;
set local search_path=public,pg_catalog;
-- Prospective only: the verified projection's run is pinned at snapshot creation.
-- Existing null-run snapshots, replay receipts and paid contexts are not changed.
-- Refuse an unreviewed change to the active044 writer before replacing its body.
do $guard$ declare body text; begin
 select regexp_replace(replace(prosrc,E'\r\n',E'\n'),'^\s+|\s+$','','g') into body
 from pg_proc where oid='public.ap_verify_source_observation(uuid,uuid,jsonb,text,jsonb,jsonb,jsonb)'::regprocedure;
 if encode(extensions.digest(body,'sha256'),'hex')<>'68eb771805995e8a1d5148c5d8562ddf1a0e640809bc7cf61e46efda9ba5f95c' then
  raise exception 'verified_source_run_writer_definition_changed';
 end if;
end $guard$;

create or replace function public.ap_verify_source_observation(
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
    'source_authorization_id',authority.id,'source_run_id',run_row.id,'discovery_source',run_row.source_id,
    'live_verified_at',verified_time,'retrieved_at',observation.observed_at,'first_seen_at',job.created_at,
    'employer_identity_result','PASS','application_path_result','PASS','listing_activity_result','PASS','legitimacy_result','PASS');
  insert into public.ap_job_snapshots(
    id,legacy_job_id,origin,discovery_source,external_job_id,canonical_application_url,application_host_type,
    canonical_employer_listing_url,source_url,company,exact_title,normalized_fingerprint,captured_listing,retrieved_at,
    posted_on,posted_date_unknown,live_verified_at,compensation_text,compensation_source,location_and_work_mode,
    parser_version,content_sha256,source_authorization_id,source_run_id,first_seen_at,canonical_employer_domain,employer_identity_result,
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
    (checked_snapshot->>'source_authorization_id')::uuid,run_row.id,(checked_snapshot->>'first_seen_at')::timestamptz,checked_snapshot->>'canonical_employer_domain',
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

-- Include this writer in the existing archive definition contract. No archive
-- relations, storage aliases, customer data or historical signatures change.
insert into public.ap_archive_fence_function_contracts(signature,definition_sha256)
values('public.ap_verify_source_observation(uuid,uuid,jsonb,text,jsonb,jsonb,jsonb)',
 encode(extensions.digest(pg_get_functiondef('public.ap_verify_source_observation(uuid,uuid,jsonb,text,jsonb,jsonb,jsonb)'::regprocedure),'sha256'),'hex'));
do $$ declare definition text; anchor text; begin
 definition:=pg_get_functiondef('public.ap_archive_fence_coverage_current()'::regprocedure);
 anchor:='''public.ap_retention_snapshot_customers(uuid)''';
 if (length(definition)-length(replace(definition,'count(*)=45','')))/length('count(*)=45')<>1
  or (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
  raise exception 'verified_source_run_archive_roster_anchor_missing';
 end if;
 definition:=replace(definition,'count(*)=45','count(*)=46');
 definition:=replace(definition,anchor,anchor||',''public.ap_verify_source_observation(uuid,uuid,jsonb,text,jsonb,jsonb,jsonb)''');
 execute definition;
end $$;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
 values('202610270105','VERIFIED_SOURCE_RUN_BINDING',0,clock_timestamp());
create function public.ap_verified_source_run_schema_installed() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ap_migration_checkpoints where migration_id='202610270105' and checkpoint='VERIFIED_SOURCE_RUN_BINDING')
 and exists(select 1 from pg_proc where oid=to_regprocedure('public.ap_verify_source_observation(uuid,uuid,jsonb,text,jsonb,jsonb,jsonb)')
   and prosecdef and proconfig @> array['search_path=""'])
 and exists(select 1 from public.ap_archive_fence_function_contracts c
   where c.signature='public.ap_verify_source_observation(uuid,uuid,jsonb,text,jsonb,jsonb,jsonb)'
   and c.definition_sha256=encode(extensions.digest(pg_get_functiondef(to_regprocedure(c.signature)),'sha256'),'hex'))
 and has_function_privilege('service_role','public.ap_verify_source_observation(uuid,uuid,jsonb,text,jsonb,jsonb,jsonb)','EXECUTE')
 and not has_function_privilege('authenticated','public.ap_verify_source_observation(uuid,uuid,jsonb,text,jsonb,jsonb,jsonb)','EXECUTE')
 and not has_function_privilege('anon','public.ap_verify_source_observation(uuid,uuid,jsonb,text,jsonb,jsonb,jsonb)','EXECUTE')
 and public.ap_archive_fence_coverage_current();
$$;
revoke all on function public.ap_verified_source_run_schema_installed() from public,anon,authenticated;
grant execute on function public.ap_verified_source_run_schema_installed() to service_role;

-- Append105 while retaining every supported historical archive schema.
do $$ declare definition text; anchor text; begin
 definition:=pg_get_functiondef('public.ap_archive_snapshot_schema_supported(text)'::regprocedure);
 anchor:='''202610260103'',''202610270104''';
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
  raise exception 'verified_source_run_archive_schema_anchor_missing';
 end if;
 execute replace(definition,anchor,anchor||',''202610270105''');
end $$;

do $$ declare definition text; anchor text; begin
 definition:=pg_get_functiondef('public.ap_manual_launch_schema_readiness()'::regprocedure);
 foreach anchor in array array['select count(*)=28 as installed','(''202610270104'',''EMPLOYER_RULE_REVIEW_CONFIRMATION'')',
  '''requiredSchemaVersion'', ''202610270104''','''202610260103'',''202610270104''','public.ap_employer_rule_review_schema_installed()'] loop
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
   raise exception 'verified_source_run_readiness_anchor_missing';
  end if;
 end loop;
 definition:=replace(definition,'select count(*)=28 as installed','select count(*)=29 as installed');
 definition:=replace(definition,'(''202610270104'',''EMPLOYER_RULE_REVIEW_CONFIRMATION'')','(''202610270104'',''EMPLOYER_RULE_REVIEW_CONFIRMATION''),(''202610270105'',''VERIFIED_SOURCE_RUN_BINDING'')');
 definition:=replace(definition,'''requiredSchemaVersion'', ''202610270104''','''requiredSchemaVersion'', ''202610270105''');
 definition:=replace(definition,'''202610260103'',''202610270104''','''202610260103'',''202610270104'',''202610270105''');
 definition:=replace(definition,'public.ap_employer_rule_review_schema_installed()','public.ap_employer_rule_review_schema_installed() and public.ap_verified_source_run_schema_installed()');
 execute definition;
end $$;
commit;

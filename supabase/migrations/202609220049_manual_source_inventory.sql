begin;
-- Explicit operator capture is not a scheduled run or enumeration/closure proof.
create table public.ap_manual_source_observations (
 id uuid primary key, source_id text not null references public.job_sources(id),
 source_authorization_id uuid not null references public.ap_source_authorizations(id),
 authorization_head_revision bigint not null, reviewer_id uuid not null references public.profiles(id),
 observed_at timestamptz not null, captured_posting jsonb not null,
 content_sha256 text not null check(content_sha256 ~ '^[0-9a-f]{64}$'),
 input_sha256 text not null check(input_sha256 ~ '^[0-9a-f]{64}$'),
 review_reason text not null check(length(btrim(review_reason))>=20),
 created_at timestamptz not null default clock_timestamp()
);
alter table public.ap_manual_source_observations enable row level security;
revoke all on public.ap_manual_source_observations from public,anon,authenticated,service_role;
grant select on public.ap_manual_source_observations to service_role;
create trigger ap_manual_source_observations_immutable before update or delete on public.ap_manual_source_observations
 for each row execute function public.ap_prevent_immutable_mutation();
alter table public.ap_source_verifications alter column projection_id drop not null,
 add column manual_observation_id uuid unique references public.ap_manual_source_observations(id),
 add constraint ap_source_verification_one_origin check(num_nonnulls(projection_id,manual_observation_id)=1);
alter table public.ap_source_lifecycle_reviews alter column projection_id drop not null,
 add column manual_observation_id uuid references public.ap_manual_source_observations(id),
 add constraint ap_source_lifecycle_one_origin check(num_nonnulls(projection_id,manual_observation_id)=1);

create function public.ap_verify_manual_source_observation(p_observation_id uuid,p_actor_id uuid,p_source_id text,
 p_posting jsonb,p_review jsonb,p_stable_job_id text,p_job_snapshot jsonb,p_requirement_nodes jsonb,p_normalized jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare head public.ap_source_authorization_heads; authority public.ap_source_authorizations;
 source_row public.job_sources; job public.jobs; normalized public.jobs; prior public.ap_source_verifications;
 receipt public.ap_manual_source_observations; matching_ids uuid[]; target_job uuid; input_hash text;
 previous_snapshot_id uuid; lifecycle_review_id uuid; transition_kind text; verified_time timestamptz;
 reference_id uuid; checked_snapshot jsonb; capture_hash text;
begin
 if not exists(select 1 from public.profiles where id=p_actor_id and role in ('admin','operator')) then
   raise exception 'manual_source_operator_required'; end if;
 select * into head from public.ap_source_authorization_heads where source_id=p_source_id for share;
 select * into authority from public.ap_source_authorizations where id=head.current_authorization_id;
 select * into source_row from public.job_sources where id=p_source_id for share;
 normalized:=jsonb_populate_record(null::public.jobs,p_normalized);
 if authority.state is distinct from 'AUTHORIZED_MANUAL_ONLY'
   or not coalesce('MANUAL_REVIEW'=any(authority.allowed_actions),false)
   or not coalesce(source_row.is_active,false)
   or normalized.source_id is distinct from p_source_id
   or normalized.canonical_employer_id is distinct from source_row.canonical_employer_id
   or normalized.rejection_reason is not null or normalized.content_hash !~ '^[0-9a-f]{64}$'
   or normalized.raw_title is distinct from p_posting->>'title'
   or normalized.external_job_id is distinct from p_posting->>'externalJobId'
   or normalized.source_job_url is distinct from public.ap_source_projection_url(p_posting->>'sourceJobUrl')
   or normalized.normalized_source_url is distinct from normalized.source_job_url
   or regexp_replace(btrim(coalesce(normalized.description,'')),'\s+',' ','g') is distinct from regexp_replace(btrim(coalesce(p_review->>'capturedText','')),'\s+',' ','g')
   or p_posting->>'description' is distinct from p_review->>'capturedText'
   or coalesce(normalized.company,'')='' or coalesce(normalized.title,'')=''
   or p_stable_job_id is distinct from (case when normalized.external_job_id is not null
     then 'requisition|'||normalized.canonical_employer_id||'|'||normalized.external_job_id
     else 'application-url|'||normalized.official_application_url end)
   or not coalesce(lower(substring(normalized.source_job_url from '^https://([^/:?#]+)(?:[/?#]|$)'))=any(authority.allowed_hosts),false)
   or not coalesce(lower(substring(normalized.official_application_url from '^https://([^/:?#]+)(?:[/?#]|$)'))=any(authority.allowed_hosts),false)
   or nullif(p_normalized->>'closing_at','')::timestamptz<=clock_timestamp()
   or length(btrim(coalesce(p_review->>'transitionReason','')))<20
   then raise exception 'manual_source_current_authority_or_identity_required'; end if;
 input_hash:=encode(extensions.digest(convert_to(jsonb_build_object('posting',p_posting,'normalized',p_normalized,'review',p_review,'stableId',p_stable_job_id)::text,'UTF8'),'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended(normalized.canonical_employer_id,0));
 select * into receipt from public.ap_manual_source_observations where id=p_observation_id;
 if found then
   select * into prior from public.ap_source_verifications where manual_observation_id=receipt.id;
   if receipt.input_sha256 is distinct from input_hash or receipt.reviewer_id<>p_actor_id
     or receipt.source_authorization_id<>authority.id or receipt.authorization_head_revision<>head.revision
     or prior.id is null or exists(select 1 from public.ap_job_snapshot_invalidations where job_snapshot_id=prior.job_snapshot_id)
     or not exists(select 1 from public.jobs j join public.job_source_references r on r.job_id=j.id
       where r.id=prior.source_reference_id and r.is_active and j.is_active and j.content_hash=receipt.content_sha256)
     then raise exception 'manual_source_replay_conflict'; end if;
   return prior.job_snapshot_id;
 end if;
 insert into public.ap_manual_source_observations(id,source_id,source_authorization_id,authorization_head_revision,reviewer_id,
   observed_at,captured_posting,content_sha256,input_sha256,review_reason)
 values(p_observation_id,p_source_id,authority.id,head.revision,p_actor_id,(p_review->>'checkedAt')::timestamptz,
   p_posting,normalized.content_hash,input_hash,p_review->>'transitionReason') returning * into receipt;
 select array_agg(id) into matching_ids from public.jobs where canonical_employer_id=normalized.canonical_employer_id
   and ((normalized.external_job_id is not null and external_job_id=normalized.external_job_id)
     or normalized_source_url=normalized.normalized_source_url);
 if coalesce(array_length(matching_ids,1),0)>1 then raise exception 'manual_source_identity_conflict'; end if;
 target_job:=matching_ids[1];
 if target_job is null then
   if exists(select 1 from public.jobs where canonical_employer_id=normalized.canonical_employer_id and deduplication_key=normalized.deduplication_key)
     then raise exception 'manual_source_identity_conflict'; end if;
    insert into public.jobs(company,title,source_url,checked_at,listing_status,
      canonical_employer_id,employer_display_name,source_id,source_name,source_category,
      is_official_source,is_direct_employer_source,source_job_url,official_application_url,
      normalized_source_url,external_job_id,raw_title,normalized_title,description,department,
      content_hash,deduplication_key,last_observed_at,last_verified_at,last_successfully_verified_at,
      lifecycle_state,application_path_status,source_freshness_status,is_active,review_status,
      location_text,employment_type,w2_or_contractor,work_mode,salary_min,salary_max,salary_currency,pay_period,
      employer_aliases,remote_scope,eligible_states,eligible_countries,timezone_requirement,schedule_type,
      pay_model,phone_intensity,sales_flag,commission_flag,marketing_flag,high_volume_contact_center_flag,
      degree_required,experience_level,equipment_requirement,equipment_cost_responsibility,applicant_cost,
      benefits_status,language_requirements,posted_at,closing_at,salary_text)
    values(normalized.company,normalized.title,normalized.source_url,receipt.observed_at,'inactive',
      normalized.canonical_employer_id,normalized.employer_display_name,normalized.source_id,normalized.source_name,normalized.source_category,
      normalized.is_official_source,normalized.is_direct_employer_source,normalized.source_job_url,normalized.official_application_url,
      normalized.normalized_source_url,normalized.external_job_id,normalized.raw_title,normalized.normalized_title,normalized.description,normalized.department,
      normalized.content_hash,normalized.deduplication_key,receipt.observed_at,null,null,
      'observed_open','unverified','unknown',false,'pending',
      normalized.location_text,normalized.employment_type,normalized.w2_or_contractor,normalized.work_mode,
      normalized.salary_min,normalized.salary_max,normalized.salary_currency,normalized.pay_period,
      normalized.employer_aliases,normalized.remote_scope,normalized.eligible_states,normalized.eligible_countries,normalized.timezone_requirement,normalized.schedule_type,
      normalized.pay_model,normalized.phone_intensity,normalized.sales_flag,normalized.commission_flag,normalized.marketing_flag,normalized.high_volume_contact_center_flag,
      normalized.degree_required,normalized.experience_level,normalized.equipment_requirement,normalized.equipment_cost_responsibility,normalized.applicant_cost,
      normalized.benefits_status,normalized.language_requirements,normalized.posted_at,normalized.closing_at,normalized.salary_text)
    returning id into target_job;
 end if;
 select * into job from public.jobs where id=target_job for update;
 perform 1 from public.job_source_references where job_id=job.id and source_id=p_source_id for update;
 if job.source_id is distinct from p_source_id or job.rejection_reason is not null
   or job.last_observed_at>receipt.observed_at then raise exception 'manual_source_newer_observation_exists'; end if;
 -- The database resolves the canonical identity; caller cannot choose another job.
 p_job_snapshot:=p_job_snapshot||jsonb_build_object('legacy_job_id',job.id);
  transition_kind:=coalesce(p_review->>'lifecycleAction','UNCHANGED');
  if normalized.content_hash is distinct from receipt.content_sha256
    or normalized.canonical_employer_id is distinct from job.canonical_employer_id
    or normalized.source_id is distinct from job.source_id
    or normalized.external_job_id is distinct from job.external_job_id
    or normalized.normalized_source_url is distinct from job.normalized_source_url
    or normalized.rejection_reason is not null then raise exception 'source_transition_identity_changed'; end if;
  if job.lifecycle_state='closed' or exists(select 1 from public.job_source_references r
    where r.job_id=job.id and r.source_id=p_source_id and not r.is_active) then
    if transition_kind<>'REOPENED' or exists(select 1 from public.job_source_references r
       where r.job_id=job.id and r.source_id=p_source_id and not r.is_active
         and (r.closed_at is null or receipt.observed_at<=r.closed_at)) then
      raise exception 'source_reopen_requires_new_direct_review'; end if;
  elsif job.content_hash<>receipt.content_sha256 and transition_kind<>'CHANGED' then
    raise exception 'source_changed_content_requires_review';
  end if;
  if transition_kind not in ('UNCHANGED','CHANGED','REOPENED') or
    (transition_kind<>'UNCHANGED' and length(btrim(coalesce(p_review->>'transitionReason','')))<20) then
    raise exception 'source_transition_reason_required'; end if;
  -- Update only the observed canonical fields, inside this same direct-review transaction.
  -- Any later evidence failure rolls the update back.
  if transition_kind<>'UNCHANGED' then
    insert into public.ap_source_lifecycle_reviews(job_id,manual_observation_id,reviewer_id,action,reason,previous_content_sha256,observed_content_sha256)
    values(job.id,p_observation_id,p_actor_id,transition_kind,p_review->>'transitionReason',job.content_hash,receipt.content_sha256)
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
      closing_at=normalized.closing_at,last_observed_at=receipt.observed_at
    where id=job.id returning * into job;
  end if;
  verified_time:=(p_review->>'checkedAt')::timestamptz;
  if verified_time is null or verified_time>clock_timestamp() or verified_time<clock_timestamp()-interval '15 minutes'
    or verified_time<receipt.observed_at
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
    where manual_observation_id=p_observation_id;
  if found then
    if prior.direct_capture_sha256<>capture_hash then
      raise exception 'source_promotion_replay_conflict'; end if;
    return prior.job_snapshot_id;
  end if;
  checked_snapshot:=p_job_snapshot||jsonb_build_object(
    'source_authorization_id',authority.id,'discovery_source',p_source_id,
    'live_verified_at',verified_time,'retrieved_at',receipt.observed_at,'first_seen_at',job.created_at,
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
    where job_id=job.id and source_id=p_source_id and not is_active;
  end if;
  insert into public.job_source_references(job_id,source_id,source_name,source_job_url,normalized_source_url,
    official_application_url,external_job_id,is_official,is_direct_employer,last_verified_at,is_active)
  values(job.id,p_source_id,job.source_name,job.source_job_url,job.normalized_source_url,
    job.official_application_url,job.external_job_id,job.is_official_source,job.is_direct_employer_source,verified_time,true)
  on conflict(job_id,source_id,external_job_id) do update set last_verified_at=excluded.last_verified_at,
    official_application_url=excluded.official_application_url,source_job_url=excluded.source_job_url,
    normalized_source_url=excluded.normalized_source_url
  where job_source_references.is_active
  returning id into reference_id;
  if reference_id is null then raise exception 'source_promotion_inactive_reference_requires_review'; end if;
  insert into public.ap_source_verifications(manual_observation_id,job_snapshot_id,source_reference_id,reviewer_id,
    source_authorization_id,authorization_head_revision,observed_content_sha256,direct_capture_sha256,
    verification_evidence,verified_at,stable_normalized_job_id)
  values(p_observation_id,(checked_snapshot->>'id')::uuid,reference_id,p_actor_id,authority.id,head.revision,
    receipt.content_sha256,capture_hash,p_review,verified_time,p_stable_job_id);
  -- Source display permission and per-customer board rules remain independent.
  -- Do not enable a source, a schedule, or checkout here.
  update public.jobs set is_active=true,listing_status='open',lifecycle_state='verified_open',
    application_path_status='verified_actionable',last_verified_at=verified_time,last_successfully_verified_at=verified_time,
    source_freshness_status='fresh',checked_at=verified_time,last_observed_at=receipt.observed_at
  where id=job.id;
  return (checked_snapshot->>'id')::uuid;
end;
$$;
revoke all on function public.ap_verify_manual_source_observation(uuid,uuid,text,jsonb,jsonb,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.ap_verify_manual_source_observation(uuid,uuid,text,jsonb,jsonb,text,jsonb,jsonb,jsonb) to service_role;
commit;

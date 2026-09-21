-- Observations become hidden canonical research candidates, never verified jobs.
begin;
create table public.job_source_listing_projections (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null,
  listing_key text not null,
  observation_content_sha256 text not null check (observation_content_sha256 ~ '^[0-9a-f]{64}$'),
  projector_version text not null,
  projection_input_sha256 text not null check (projection_input_sha256 ~ '^[0-9a-f]{64}$'),
  source_authorization_id uuid not null references public.ap_source_authorizations(id),
  authorization_head_revision bigint not null,
  job_id uuid not null references public.jobs(id),
  outcome text not null check (outcome='OBSERVED_PENDING_VERIFICATION'),
  created_at timestamptz not null default now(),
  foreign key(run_id,listing_key) references public.job_source_run_listings(run_id,listing_key),
  unique(run_id,listing_key,projector_version)
);
alter table public.job_source_listing_projections enable row level security;
-- Supabase grants new public tables to service_role by default. Reset those
-- defaults before allowing only reads; writes must pass the validated RPC.
revoke all on public.job_source_listing_projections from public,anon,authenticated,service_role;
grant select on public.job_source_listing_projections to service_role;
create function public.ap_guard_source_projection_immutable() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'source_projection_evidence_immutable'; end; $$;
create trigger job_source_projection_immutable before update or delete on public.job_source_listing_projections
  for each row execute function public.ap_guard_source_projection_immutable();

-- Conservative URL equivalence: retain functional query parameters. Exotic URL
-- encodings may require manual review; they must never collapse distinct jobs.
create function public.ap_source_projection_url(value text) returns text
language sql immutable set search_path='' as $$
  with parts as (
    select regexp_match(value,'^https://([^/:?#]+)([^?#]*)(?:\?([^#]*))?(?:#.*)?$') p
  ), query as (
    select string_agg(pair,'&' order by split_part(pair,'=',1) collate "C",position) q
    from parts, unnest(string_to_array(p[3],'&')) with ordinality u(pair,position)
    where pair<>'' and split_part(pair,'=',1)!~* '^(utm_|fbclid$|gclid$|ref$|source$)'
  )
  select case when p is null then null else 'https://'||lower(p[1])||
    coalesce(nullif(regexp_replace(regexp_replace(p[2],'/+','/','g'),'/$',''),''),'/')||
    case when q is null then '' else '?'||q end end from parts,query;
$$;
revoke all on function public.ap_source_projection_url(text) from public,anon,authenticated;

create or replace function public.ap_project_source_observation(
  p_run_id uuid,p_listing_key text,p_content_sha256 text,p_projector_version text,p_normalized jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare observation public.job_source_run_listings; run_row public.job_source_runs;
  head public.ap_source_authorization_heads; authority public.ap_source_authorizations;
  source_row public.job_sources; projection public.job_source_listing_projections;
  normalized public.jobs; target_job uuid; source_host text; matching_ids uuid[];
begin
  select * into observation from public.job_source_run_listings where run_id=p_run_id and listing_key=p_listing_key;
  select * into run_row from public.job_source_runs where id=p_run_id;
  select * into head from public.ap_source_authorization_heads where source_id=run_row.source_id for share;
  select * into authority from public.ap_source_authorizations where id=head.current_authorization_id;
  select * into source_row from public.job_sources where id=run_row.source_id for share;
  if observation.run_id is null or run_row.status<>'succeeded' or run_row.enumeration_status<>'complete'
    or observation.content_sha256 is distinct from p_content_sha256
    or head.current_authorization_id is distinct from run_row.source_authorization_id
    or head.revision is distinct from run_row.authorization_head_revision
    or authority.state is distinct from 'AUTHORIZED_AUTOMATED'
    or not coalesce('ENUMERATE_JOBS'=any(authority.allowed_actions),false)
    or not coalesce(source_row.is_active,false)
    or p_projector_version is distinct from 'pending-source-projection-v1'
    then raise exception 'source_projection_evidence_or_authority_invalid'; end if;
  select * into normalized from jsonb_populate_record(null::public.jobs,p_normalized);
  source_host:=lower(substring(normalized.source_job_url from '^https://([^/:?#]+)(?:[/?#]|$)'));
  if normalized.source_id is distinct from run_row.source_id
    or normalized.canonical_employer_id is distinct from source_row.canonical_employer_id
    or normalized.content_hash is distinct from observation.content_sha256
    or normalized.raw_title is distinct from observation.captured_listing->>'title'
    or normalized.external_job_id is distinct from observation.captured_listing->>'externalJobId'
    or normalized.source_job_url is distinct from public.ap_source_projection_url(observation.captured_listing->>'sourceJobUrl')
    or normalized.normalized_source_url is distinct from normalized.source_job_url
    or coalesce(normalized.company,'')='' or coalesce(normalized.title,'')=''
    or not coalesce(source_host=any(authority.allowed_hosts),false)
    or normalized.normalized_source_url is null
    then raise exception 'source_projection_identity_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(normalized.canonical_employer_id,0));
  select * into projection from public.job_source_listing_projections
    where run_id=p_run_id and listing_key=p_listing_key and projector_version=p_projector_version;
  if found then return projection.job_id; end if;
  select array_agg(id) into matching_ids from public.jobs where canonical_employer_id=normalized.canonical_employer_id
    and ((normalized.external_job_id is not null and external_job_id=normalized.external_job_id)
      or normalized_source_url=normalized.normalized_source_url);
  if coalesce(array_length(matching_ids,1),0)>1 then
    raise exception 'source_projection_identity_conflict_review_required';
  end if;
  target_job:=matching_ids[1];
  if target_job is not null then perform 1 from public.jobs where id=target_job for update; end if;
  if target_job is null then
    if exists(select 1 from public.jobs where canonical_employer_id=normalized.canonical_employer_id
      and deduplication_key=normalized.deduplication_key) then
      raise exception 'source_projection_identity_conflict_review_required';
    end if;
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
    values(normalized.company,normalized.title,normalized.source_url,observation.observed_at,'inactive',
      normalized.canonical_employer_id,normalized.employer_display_name,normalized.source_id,normalized.source_name,normalized.source_category,
      normalized.is_official_source,normalized.is_direct_employer_source,normalized.source_job_url,normalized.official_application_url,
      normalized.normalized_source_url,normalized.external_job_id,normalized.raw_title,normalized.normalized_title,normalized.description,normalized.department,
      normalized.content_hash,normalized.deduplication_key,observation.observed_at,null,null,
      'observed_open','unverified','unknown',false,'pending',
      normalized.location_text,normalized.employment_type,normalized.w2_or_contractor,normalized.work_mode,
      normalized.salary_min,normalized.salary_max,normalized.salary_currency,normalized.pay_period,
      normalized.employer_aliases,normalized.remote_scope,normalized.eligible_states,normalized.eligible_countries,normalized.timezone_requirement,normalized.schedule_type,
      normalized.pay_model,normalized.phone_intensity,normalized.sales_flag,normalized.commission_flag,normalized.marketing_flag,normalized.high_volume_contact_center_flag,
      normalized.degree_required,normalized.experience_level,normalized.equipment_requirement,normalized.equipment_cost_responsibility,normalized.applicant_cost,
      normalized.benefits_status,normalized.language_requirements,normalized.posted_at,normalized.closing_at,normalized.salary_text)
    returning id into target_job;
  end if;
  -- Existing verified data is never overwritten by a weaker observation.
  insert into public.job_source_listing_projections(run_id,listing_key,observation_content_sha256,
    projector_version,projection_input_sha256,source_authorization_id,authorization_head_revision,job_id,outcome)
  values(p_run_id,p_listing_key,p_content_sha256,p_projector_version,
    encode(extensions.digest(convert_to(p_normalized::text||p_projector_version,'UTF8'),'sha256'),'hex'),
    authority.id,head.revision,target_job,'OBSERVED_PENDING_VERIFICATION');
  return target_job;
end;
$$;
revoke all on function public.ap_project_source_observation(uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.ap_project_source_observation(uuid,text,text,text,jsonb) to service_role;
commit;

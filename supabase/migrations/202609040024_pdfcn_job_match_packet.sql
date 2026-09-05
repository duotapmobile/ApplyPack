-- pdfcn/Takumi pilot: approved packet presentation fields and private immutable artifacts.
-- This migration does not change the DOCX resume or cover-letter pipeline.

alter table public.job_matches
  add column match_category text check (match_category in ('DIRECT','TRANSFERABLE','DIRECT_AND_TRANSFERABLE')),
  add column packet_strong_connections jsonb check (packet_strong_connections is null or jsonb_typeof(packet_strong_connections) = 'array'),
  add column packet_things_to_consider jsonb check (packet_things_to_consider is null or jsonb_typeof(packet_things_to_consider) = 'array'),
  add column packet_unknown_warnings jsonb check (packet_unknown_warnings is null or jsonb_typeof(packet_unknown_warnings) = 'array');

alter table public.orders add column job_match_packet_content_revision bigint not null default 0 check (job_match_packet_content_revision >= 0);

create type public.job_match_packet_status as enum ('RENDERING','PREVIEW_READY','APPROVED','FAILED','SUPERSEDED','EXPIRED');

create table public.job_match_packet_artifacts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  customer_id uuid not null references public.profiles(id),
  content_identity text not null check (content_identity ~ '^[0-9a-f]{64}$'),
  content_revision bigint not null check (content_revision > 0),
  content_snapshot_sha256 text not null check (content_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  content_snapshot jsonb not null check (jsonb_typeof(content_snapshot) = 'object'),
  schema_version text not null,
  template_version text not null,
  renderer_version text not null,
  pdfcn_upstream_commit text not null check (pdfcn_upstream_commit ~ '^[0-9a-f]{40}$'),
  takumi_version text not null,
  status public.job_match_packet_status not null default 'RENDERING',
  render_attempts integer not null default 1 check (render_attempts > 0),
  requested_by uuid not null references public.profiles(id),
  storage_bucket text check (storage_bucket is null or storage_bucket = 'customer-deliveries'),
  storage_path text unique,
  customer_filename text,
  checksum_sha256 text check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'),
  size_bytes integer check (size_bytes is null or size_bytes > 0),
  failure_code text,
  rendered_at timestamptz,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  supersedes_id uuid references public.job_match_packet_artifacts(id),
  retention_due_at timestamptz not null,
  render_lease_until timestamptz,
  render_generation uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id, content_identity, content_revision),
  check ((status in ('PREVIEW_READY','APPROVED','SUPERSEDED','EXPIRED')) = (storage_path is not null)),
  check (status not in ('APPROVED','SUPERSEDED') or (approved_by is not null and approved_at is not null)),
  check ((approved_by is null) = (approved_at is null)),
  check (status <> 'FAILED' or failure_code is not null)
);
create index job_match_packet_artifacts_order_status_idx on public.job_match_packet_artifacts(order_id, status, created_at desc);

create unique index job_match_packet_one_current_approved_idx on public.job_match_packet_artifacts(order_id) where status = 'APPROVED';
alter table public.orders add column job_match_packet_artifact_id uuid references public.job_match_packet_artifacts(id);
create index orders_job_match_packet_artifact_idx on public.orders(job_match_packet_artifact_id) where job_match_packet_artifact_id is not null;

alter table public.job_match_packet_artifacts enable row level security;
revoke all on public.job_match_packet_artifacts from public, anon, authenticated;
grant all on public.job_match_packet_artifacts to service_role;

create or replace function public.guard_job_match_packet_immutability()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.order_id <> old.order_id or new.customer_id <> old.customer_id
     or new.content_identity <> old.content_identity
     or new.content_snapshot_sha256 <> old.content_snapshot_sha256
     or new.content_snapshot <> old.content_snapshot
     or new.content_revision <> old.content_revision
     or new.schema_version <> old.schema_version
     or new.template_version <> old.template_version
     or new.renderer_version <> old.renderer_version
     or new.pdfcn_upstream_commit <> old.pdfcn_upstream_commit
     or new.takumi_version <> old.takumi_version
     or new.retention_due_at <> old.retention_due_at
     or new.requested_by <> old.requested_by
     or new.created_at <> old.created_at then
    raise exception 'job_match_packet_snapshot_is_immutable';
  end if;
  if not (
    (old.status = 'RENDERING' and new.status in ('RENDERING','PREVIEW_READY','FAILED'))
    or (old.status = 'FAILED' and new.status = 'RENDERING')
    or (old.status = 'PREVIEW_READY' and new.status in ('PREVIEW_READY','APPROVED','SUPERSEDED'))
    or (old.status = 'APPROVED' and new.status in ('APPROVED','SUPERSEDED','EXPIRED'))
    or (old.status = 'SUPERSEDED' and new.status in ('SUPERSEDED','EXPIRED'))
    or (old.status = 'PREVIEW_READY' and new.status = 'EXPIRED')
    or (old.status = 'EXPIRED' and new.status = 'EXPIRED')
  ) then raise exception 'invalid_job_match_packet_transition'; end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger job_match_packet_immutable before update on public.job_match_packet_artifacts
for each row execute function public.guard_job_match_packet_immutability();

create or replace function public.complete_search_delivery(
  p_order_id uuid,
  p_actor_id uuid,
  p_matches jsonb,
  p_review_checklist jsonb,
  p_delivered_at timestamptz,
  p_retention_due_at timestamptz
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  order_row public.orders%rowtype;
  match_row jsonb;
  selected_job public.jobs%rowtype;
begin
  if not exists(select 1 from public.profiles where id = p_actor_id and role in ('operator','admin')) then raise exception 'authorized operator required'; end if;
  if not coalesce(p_review_checklist @> '{"criteriaCompared":true,"allListingsRechecked":true,"exactlyTenApplicationWorthy":true,"noPadding":true,"humanReleaseApproved":true}'::jsonb, false) then raise exception 'human review checklist incomplete'; end if;
  if jsonb_typeof(p_matches) <> 'array' or jsonb_array_length(p_matches) <> 10 then raise exception 'exactly ten matches required'; end if;
  if (select count(distinct value ->> 'job_id') from jsonb_array_elements(p_matches) value) <> 10 then raise exception 'duplicate match jobs'; end if;

  select * into order_row from public.orders where id = p_order_id for update;
  if not found or order_row.product_kind <> 'job_search' or order_row.status <> 'delivery_processing' then raise exception 'search order is not claimed for delivery'; end if;
  if exists(select 1 from public.job_matches where search_order_id = p_order_id) then raise exception 'matches already delivered'; end if;

  for match_row in select value from jsonb_array_elements(p_matches) value loop
    if coalesce(jsonb_array_length(match_row -> 'matching_experience'), 0) < 1
       or length(trim(coalesce(match_row ->> 'primary_outcome', ''))) < 10
       or coalesce(jsonb_array_length(match_row -> 'core_responsibilities'), 0) < 1
       or coalesce(jsonb_array_length(match_row -> 'requirements'), 0) < 1
       or coalesce(match_row ->> 'match_category', '') not in ('DIRECT','TRANSFERABLE','DIRECT_AND_TRANSFERABLE')
       or coalesce(jsonb_array_length(match_row -> 'packet_strong_connections'), 0) < 1
       or jsonb_typeof(match_row -> 'packet_things_to_consider') <> 'array'
       or jsonb_typeof(match_row -> 'packet_unknown_warnings') <> 'array'
       or not coalesce((match_row -> 'criteria_checks') @> '{"dutiesAligned":true,"experienceConfirmed":true,"levelAcceptable":true,"scheduleAcceptable":true,"locationAcceptable":true,"compensationAcceptable":true,"nonNegotiablesSatisfied":true}'::jsonb, false) then
      raise exception 'match doctrine evidence incomplete';
    end if;

    select * into selected_job from public.jobs where id = (match_row ->> 'job_id')::uuid for update;
    if not found or selected_job.is_active is not true or selected_job.listing_status <> 'open'
       or selected_job.rejection_reason is not null or selected_job.checked_at < p_delivered_at - interval '24 hours'
       or regexp_replace(lower(concat_ws(' ', selected_job.company, selected_job.employer_display_name, selected_job.source_name, selected_job.source_url, selected_job.source_job_url, selected_job.official_application_url)), '[^a-z0-9]+', '', 'g') like '%liveops%' then
      raise exception 'job is not eligible for delivery';
    end if;

    update public.jobs set review_status = 'approved', reviewed_by = p_actor_id, reviewed_at = p_delivered_at where id = selected_job.id;
    insert into public.job_matches(
      search_order_id, job_id, position, fit_summary, matching_experience, primary_outcome,
      core_responsibilities, requirements, hidden_job_functions, concerns, criteria_checks,
      ranking_score, ranking_reason_codes, delivered_at, reviewed_by, reviewed_at,
      match_category, packet_strong_connections, packet_things_to_consider, packet_unknown_warnings
    ) values (
      p_order_id, selected_job.id, (match_row ->> 'position')::integer, match_row ->> 'fit_summary',
      match_row -> 'matching_experience', match_row ->> 'primary_outcome', match_row -> 'core_responsibilities',
      match_row -> 'requirements', coalesce(match_row -> 'hidden_job_functions', '[]'::jsonb),
      coalesce(match_row -> 'concerns', '[]'::jsonb), match_row -> 'criteria_checks',
      (match_row ->> 'ranking_score')::integer, coalesce(match_row -> 'ranking_reason_codes', '[]'::jsonb),
      p_delivered_at, p_actor_id, p_delivered_at, match_row ->> 'match_category',
      match_row -> 'packet_strong_connections', match_row -> 'packet_things_to_consider', match_row -> 'packet_unknown_warnings'
    );
  end loop;

  update public.orders set status = 'delivered', delivered_at = p_delivered_at,
    human_review_checklist = p_review_checklist, human_reviewed_by = p_actor_id, human_reviewed_at = p_delivered_at,
    processing_previous_status = null, processing_started_at = null, updated_at = now()
  where id = p_order_id and status = 'delivery_processing';
  if order_row.intake_id is not null then update public.intakes set source_retention_due_at = p_retention_due_at, updated_at = now() where id = order_row.intake_id; end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
    values (p_actor_id, 'search_delivered', 'order', p_order_id::text, jsonb_build_object('match_count', 10, 'review_checklist', p_review_checklist));
  return true;
end;
$$;

revoke all on function public.complete_search_delivery(uuid, uuid, jsonb, jsonb, timestamptz, timestamptz) from public, anon, authenticated;

-- The prior one-step function is retained for rollback compatibility but may no longer
-- release search matches without an approved packet artifact.
revoke execute on function public.complete_search_delivery(uuid, uuid, jsonb, jsonb, timestamptz, timestamptz) from service_role;


create or replace function public.packet_value_is_unknown(p_value text)
returns boolean language sql immutable set search_path = '' as $$
  select lower(trim(coalesce(p_value,''))) in ('','unknown','not listed','not confirmed','not stated');
$$;
revoke all on function public.packet_value_is_unknown(text) from public,anon,authenticated;
grant execute on function public.packet_value_is_unknown(text) to service_role;

create or replace function public.packet_claims_have_valid_provenance(
  p_claims jsonb,p_match_id uuid,p_job_id uuid,p_customer_id uuid,p_intake_id uuid,
  p_group text,p_require_candidate boolean
)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare
  claim_row jsonb;
  claim_number bigint;
  evidence_ref text;
  fact_id uuid;
  has_candidate boolean;
  has_job boolean;
begin
  if jsonb_typeof(p_claims)<>'array' then return false; end if;
  for claim_row,claim_number in
    select value,n from jsonb_array_elements(p_claims) with ordinality e(value,n)
  loop
    if claim_row->>'claimId' <> 'job-match:'||p_match_id::text||':'||p_group||':'||(claim_number-1)::text
       or jsonb_typeof(claim_row->'evidenceIds')<>'array'
       or jsonb_array_length(claim_row->'evidenceIds')<1 then return false; end if;
    has_candidate := false;
    has_job := false;
    for evidence_ref in select jsonb_array_elements_text(claim_row->'evidenceIds') loop
      if evidence_ref ~ '^candidate-fact:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        fact_id := substring(evidence_ref from 16)::uuid;
        if not exists(
          select 1 from public.ap_candidate_facts f
          where f.id=fact_id and f.customer_id=p_customer_id
            and f.verification in ('CUSTOMER_CONFIRMED','HUMAN_VERIFIED')
            and f.superseded_at is null
            and (f.snapshot_id is null or (p_intake_id is not null and f.snapshot_id=(
              select s.id from public.ap_intake_snapshots s
              where s.intake_id=p_intake_id and s.customer_id=p_customer_id
              order by s.version desc limit 1
            )))
        ) then return false; end if;
        has_candidate := true;
      elsif evidence_ref ~ ('^job:'||p_job_id::text||':(description|requirements|benefits_status|salary_text|work_mode|employment_type|location_text|schedule_type|timezone_requirement|remote_scope|eligible_states|eligible_countries|official_application_url|title|employer)$') then
        has_job := true;
      else
        return false;
      end if;
    end loop;
    if not has_job or (p_require_candidate and not has_candidate) then return false; end if;
  end loop;
  return true;
end;
$$;
revoke all on function public.packet_claims_have_valid_provenance(jsonb,uuid,uuid,uuid,uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.packet_claims_have_valid_provenance(jsonb,uuid,uuid,uuid,uuid,text,boolean) to service_role;

create or replace function public.packet_unknown_warnings_are_complete(p_warnings jsonb,p_job_id uuid)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
declare
  warning_fields text[];
  job_row public.jobs%rowtype;
begin
  if jsonb_typeof(p_warnings)<>'array' then return false; end if;
  select * into job_row from public.jobs where id=p_job_id;
  if not found then return false; end if;
  select coalesce(array_agg(lower(value->>'field')),array[]::text[]) into warning_fields
    from jsonb_array_elements(p_warnings) value;
  if (public.packet_value_is_unknown(job_row.work_mode) and not ('work arrangement'=any(warning_fields)))
     or (public.packet_value_is_unknown(job_row.employment_type) and not ('employment classification'=any(warning_fields)))
     or (public.packet_value_is_unknown(job_row.salary_text) and not ('compensation'=any(warning_fields)))
     or (public.packet_value_is_unknown(job_row.benefits_status) and not ('health benefits'=any(warning_fields)))
     or not ('travel requirements'=any(warning_fields))
     or (public.packet_value_is_unknown(job_row.schedule_type) and public.packet_value_is_unknown(job_row.timezone_requirement)
       and not ('schedule requirements'=any(warning_fields)))
     or (public.packet_value_is_unknown(job_row.remote_scope)
       and coalesce(array_length(job_row.eligible_states,1),0)=0
       and coalesce(array_length(job_row.eligible_countries,1),0)=0
       and not ('geographic eligibility'=any(warning_fields))) then
    return false;
  end if;
  return true;
end;
$$;
revoke all on function public.packet_unknown_warnings_are_complete(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.packet_unknown_warnings_are_complete(jsonb,uuid) to service_role;

create or replace function public.stage_search_delivery(
  p_order_id uuid,
  p_actor_id uuid,
  p_matches jsonb,
  p_review_checklist jsonb,
  p_delivered_at timestamptz,
  p_retention_due_at timestamptz
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  order_row public.orders%rowtype;
  match_row jsonb;
  selected_job public.jobs%rowtype;
  match_id uuid;
  warning_fields text[];
begin
  if not exists(select 1 from public.profiles where id = p_actor_id and role in ('operator','admin')) then raise exception 'authorized operator required'; end if;
  if not coalesce(p_review_checklist @> '{"criteriaCompared":true,"allListingsRechecked":true,"exactlyTenApplicationWorthy":true,"noPadding":true,"humanReleaseApproved":true}'::jsonb, false) then raise exception 'human review checklist incomplete'; end if;
  if jsonb_typeof(p_matches) <> 'array' or jsonb_array_length(p_matches) <> 10 then raise exception 'exactly ten matches required'; end if;
  if (select count(distinct value ->> 'job_id') from jsonb_array_elements(p_matches) value) <> 10
     or (select count(distinct value ->> 'job_match_id') from jsonb_array_elements(p_matches) value) <> 10 then raise exception 'duplicate match records'; end if;

  select * into order_row from public.orders where id = p_order_id for update;
  if not found or order_row.product_kind <> 'job_search' or order_row.status <> 'delivery_processing' then raise exception 'search order is not claimed for staging'; end if;
  if exists(select 1 from public.job_matches where search_order_id = p_order_id) then raise exception 'matches already staged'; end if;

  for match_row in select value from jsonb_array_elements(p_matches) value loop
    match_id := (match_row ->> 'job_match_id')::uuid;
    if coalesce(jsonb_array_length(match_row -> 'matching_experience'), 0) < 1
       or length(trim(coalesce(match_row ->> 'primary_outcome', ''))) < 10
       or coalesce(jsonb_array_length(match_row -> 'core_responsibilities'), 0) < 1
       or coalesce(jsonb_array_length(match_row -> 'requirements'), 0) < 1
       or coalesce(match_row ->> 'match_category', '') not in ('DIRECT','TRANSFERABLE','DIRECT_AND_TRANSFERABLE')
       or coalesce(jsonb_array_length(match_row -> 'packet_strong_connections'), 0) < 1
       or jsonb_typeof(match_row -> 'packet_things_to_consider') <> 'array'
       or jsonb_typeof(match_row -> 'packet_unknown_warnings') <> 'array'
       or not coalesce((match_row -> 'criteria_checks') @> '{"dutiesAligned":true,"experienceConfirmed":true,"levelAcceptable":true,"scheduleAcceptable":true,"locationAcceptable":true,"compensationAcceptable":true,"nonNegotiablesSatisfied":true}'::jsonb, false) then
      raise exception 'match doctrine evidence incomplete';
    end if;

    if not public.packet_claims_have_valid_provenance(match_row->'packet_strong_connections',match_id,(match_row->>'job_id')::uuid,order_row.customer_id,order_row.intake_id,'strong',true)
       or not public.packet_claims_have_valid_provenance(match_row->'packet_things_to_consider',match_id,(match_row->>'job_id')::uuid,order_row.customer_id,order_row.intake_id,'consideration',false)
       or not public.packet_claims_have_valid_provenance(match_row->'packet_unknown_warnings',match_id,(match_row->>'job_id')::uuid,order_row.customer_id,order_row.intake_id,'unknown',false)
    then
      raise exception 'packet evidence provenance is invalid';
    end if;

    select * into selected_job from public.jobs where id = (match_row ->> 'job_id')::uuid for update;
    if not found or selected_job.is_active is not true or selected_job.listing_status <> 'open'
       or selected_job.rejection_reason is not null or selected_job.checked_at < p_delivered_at - interval '24 hours'
       or selected_job.official_application_url is null or selected_job.official_application_url !~ '^https://'
       or regexp_replace(lower(concat_ws(' ', selected_job.company, selected_job.employer_display_name, selected_job.source_name, selected_job.source_url, selected_job.source_job_url, selected_job.official_application_url)), '[^a-z0-9]+', '', 'g') like '%liveops%' then
      raise exception 'job is not eligible for packet staging';
    end if;

    if not public.packet_unknown_warnings_are_complete(match_row->'packet_unknown_warnings',selected_job.id) then
      raise exception 'material unknown warning missing';
    end if;

    update public.jobs set review_status = 'approved', reviewed_by = p_actor_id, reviewed_at = p_delivered_at where id = selected_job.id;
    insert into public.job_matches(
      id,search_order_id,job_id,position,fit_summary,matching_experience,primary_outcome,
      core_responsibilities,requirements,hidden_job_functions,concerns,criteria_checks,
      ranking_score,ranking_reason_codes,delivered_at,reviewed_by,reviewed_at,
      match_category,packet_strong_connections,packet_things_to_consider,packet_unknown_warnings
    ) values (
      match_id,p_order_id,selected_job.id,(match_row ->> 'position')::integer,match_row ->> 'fit_summary',
      match_row -> 'matching_experience',match_row ->> 'primary_outcome',match_row -> 'core_responsibilities',
      match_row -> 'requirements',coalesce(match_row -> 'hidden_job_functions','[]'::jsonb),
      coalesce(match_row -> 'concerns','[]'::jsonb),match_row -> 'criteria_checks',
      (match_row ->> 'ranking_score')::integer,coalesce(match_row -> 'ranking_reason_codes','[]'::jsonb),
      null,p_actor_id,p_delivered_at,match_row ->> 'match_category',
      match_row -> 'packet_strong_connections',match_row -> 'packet_things_to_consider',match_row -> 'packet_unknown_warnings'
    );
  end loop;

  update public.orders set human_review_checklist=p_review_checklist,human_reviewed_by=p_actor_id,human_reviewed_at=p_delivered_at,
    job_match_packet_content_revision=job_match_packet_content_revision+1,processing_started_at=null,updated_at=now() where id=p_order_id and status='delivery_processing';
  if order_row.intake_id is not null then update public.intakes set source_retention_due_at=p_retention_due_at,updated_at=now() where id=order_row.intake_id; end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
    values(p_actor_id,'search_delivery_staged','order',p_order_id::text,jsonb_build_object('match_count',10,'customer_visible',false));
  return true;
end;
$$;
revoke all on function public.stage_search_delivery(uuid,uuid,jsonb,jsonb,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.stage_search_delivery(uuid,uuid,jsonb,jsonb,timestamptz,timestamptz) to service_role;

create or replace function public.approve_job_match_packet_artifact(
  p_artifact_id uuid,p_checksum_sha256 text,p_actor_id uuid,p_approved_at timestamptz
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  artifact_row public.job_match_packet_artifacts%rowtype;
  order_row public.orders%rowtype;
  artifact_order_id uuid;
  prior_id uuid;
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and role in ('operator','admin')) then raise exception 'authorized operator required'; end if;
  select order_id into artifact_order_id from public.job_match_packet_artifacts where id=p_artifact_id;
  if not found then raise exception 'packet approval conflict'; end if;
  select * into order_row from public.orders where id=artifact_order_id for update;
  if not found or order_row.product_kind <> 'job_search' or order_row.status not in ('delivery_processing','delivered') then
    raise exception 'packet order boundary conflict';
  end if;
  select * into artifact_row from public.job_match_packet_artifacts where id=p_artifact_id for update;
  if not found or artifact_row.status <> 'PREVIEW_READY' or artifact_row.checksum_sha256 <> p_checksum_sha256
     or artifact_row.retention_due_at <= p_approved_at or artifact_row.customer_id<>order_row.customer_id
     or artifact_row.content_revision<>order_row.job_match_packet_content_revision then raise exception 'packet approval conflict'; end if;
  if jsonb_array_length(artifact_row.content_snapshot -> 'jobs') <> 10
     or (select count(distinct value ->> 'jobId') from jsonb_array_elements(artifact_row.content_snapshot -> 'jobs') value) <> 10
     or exists(select 1 from jsonb_array_elements(artifact_row.content_snapshot -> 'jobs') value
       where not exists(select 1 from public.job_matches m where m.id=(value ->> 'jobId')::uuid and m.search_order_id=artifact_row.order_id))
     or exists(select 1 from public.job_matches m where m.search_order_id=artifact_row.order_id
       and not exists(select 1 from jsonb_array_elements(artifact_row.content_snapshot -> 'jobs') value where (value ->> 'jobId')::uuid=m.id)) then
    raise exception 'packet snapshot does not match exact staged jobs';
  end if;

  perform 1 from public.job_matches m join public.jobs j on j.id=m.job_id
    where m.search_order_id=artifact_row.order_id for update of m,j;
  if exists(
    select 1 from public.job_matches m join public.jobs j on j.id=m.job_id
    where m.search_order_id=artifact_row.order_id
      and (j.is_active is not true or j.listing_status<>'open' or j.rejection_reason is not null
        or j.checked_at<p_approved_at-interval '24 hours'
        or j.official_application_url is null or j.official_application_url !~ '^https://'
        or regexp_replace(lower(concat_ws(' ',j.company,j.employer_display_name,j.source_name,j.source_url,j.source_job_url,j.official_application_url)),'[^a-z0-9]+','','g') like '%liveops%'
        or not exists(
          select 1 from jsonb_array_elements(artifact_row.content_snapshot->'jobs') value
          where (value->>'jobId')::uuid=m.id and value->>'directApplicationUrl'=j.official_application_url
        ))
  ) then raise exception 'packet job eligibility changed after preview'; end if;
  select id into prior_id from public.job_match_packet_artifacts
    where order_id=artifact_row.order_id and status='APPROVED' and id<>artifact_row.id for update;
  if prior_id is not null then
    update public.job_match_packet_artifacts set status='SUPERSEDED' where id=prior_id;
  end if;
  update public.job_match_packet_artifacts set status='APPROVED',approved_by=p_actor_id,approved_at=p_approved_at,
    supersedes_id=prior_id where id=artifact_row.id and status='PREVIEW_READY';
  if not found then raise exception 'packet approval conflict'; end if;

  if order_row.status='delivery_processing' then
    update public.job_matches set delivered_at=p_approved_at where search_order_id=order_row.id and delivered_at is null;
    if not found or (select count(*) from public.job_matches where search_order_id=order_row.id and delivered_at=p_approved_at)<>10 then
      raise exception 'exactly ten staged matches required for release';
    end if;
  end if;
  update public.orders set job_match_packet_artifact_id=artifact_row.id,
    status=case when status='delivery_processing' then 'delivered'::public.order_status else status end,
    delivered_at=case when status='delivery_processing' then p_approved_at else delivered_at end,
    processing_previous_status=null,processing_started_at=null,updated_at=now()
    where id=order_row.id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
    values(p_actor_id,'packet_approved','job_match_packet_artifact',artifact_row.id::text,
      jsonb_build_object('order_id',artifact_row.order_id,'content_identity',artifact_row.content_identity,'supersedes_id',prior_id,'released',order_row.status='delivery_processing'));
  return artifact_row.id;
end;
$$;
revoke all on function public.approve_job_match_packet_artifact(uuid,text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.approve_job_match_packet_artifact(uuid,text,uuid,timestamptz) to service_role;

create or replace function public.expire_job_match_packet_artifact(p_artifact_id uuid,p_expired_at timestamptz)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare artifact_row public.job_match_packet_artifacts%rowtype;
begin
  select * into artifact_row from public.job_match_packet_artifacts where id=p_artifact_id for update;
  if not found or artifact_row.status not in ('PREVIEW_READY','APPROVED','SUPERSEDED') or artifact_row.retention_due_at>p_expired_at then return false; end if;
  update public.job_match_packet_artifacts set status='EXPIRED' where id=p_artifact_id;
  update public.orders set job_match_packet_artifact_id=null,updated_at=now() where job_match_packet_artifact_id=p_artifact_id;
  insert into public.audit_logs(action,entity_type,entity_id,details)
    values('packet_expired','job_match_packet_artifact',p_artifact_id::text,jsonb_build_object('order_id',artifact_row.order_id,'storage_path',artifact_row.storage_path));
  return true;
end;
$$;
revoke all on function public.expire_job_match_packet_artifact(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.expire_job_match_packet_artifact(uuid,timestamptz) to service_role;

-- A staged search must not be released by generic stale-claim recovery.
create or replace function public.release_order_delivery(p_order_id uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  if exists(select 1 from public.job_matches where search_order_id=p_order_id) then return false; end if;
  update public.orders set status=coalesce(processing_previous_status,'in_fulfillment'::public.order_status),
    processing_previous_status=null,processing_started_at=null,updated_at=now()
    where id=p_order_id and status='delivery_processing';
  return found;
end;
$$;

-- Replacement correction must replace every packet field and invalidate the old
-- customer-visible packet until the corrected snapshot is rendered and approved.
create or replace function public.resolve_conflict_review(
  p_review_id uuid,p_actor_id uuid,p_status text,p_resolution text,
  p_replacement_job_id uuid default null,p_replacement jsonb default null,p_resolved_at timestamptz default now()
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare review_row public.conflict_reviews%rowtype; replacement_job public.jobs%rowtype; order_row public.orders%rowtype; packet_order_id uuid; prior_job_id uuid;
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and role in ('operator','admin')) then raise exception 'authorized operator required'; end if;
  if p_status not in ('accepted','rejected') or length(trim(coalesce(p_resolution,'')))<10 then raise exception 'valid resolution required'; end if;
  select * into review_row from public.conflict_reviews where id=p_review_id for update;
  if not found or review_row.status<>'submitted' then raise exception 'conflict review is not open'; end if;
  if p_status='accepted' then
    if p_replacement_job_id is null or p_replacement is null then raise exception 'reviewed replacement required'; end if;
    if exists(select 1 from public.apply_pack_items where job_match_id=review_row.job_match_id) then raise exception 'match already has an apply pack'; end if;
    select search_order_id into packet_order_id from public.job_matches where id=review_row.job_match_id;
    if not found then raise exception 'reviewed match is unavailable'; end if;
    select * into order_row from public.orders where id=packet_order_id for update;
    if not found or order_row.customer_id<>review_row.customer_id then raise exception 'review order boundary conflict'; end if;
    select job_id into prior_job_id from public.job_matches where id=review_row.job_match_id and search_order_id=packet_order_id for update;
    if not found then raise exception 'reviewed match changed during resolution'; end if;
    if coalesce(jsonb_array_length(p_replacement->'matching_experience'),0)<1
       or length(trim(coalesce(p_replacement->>'primary_outcome','')))<10
       or coalesce(jsonb_array_length(p_replacement->'core_responsibilities'),0)<1
       or coalesce(jsonb_array_length(p_replacement->'requirements'),0)<1
       or coalesce(p_replacement->>'match_category','') not in ('DIRECT','TRANSFERABLE','DIRECT_AND_TRANSFERABLE')
       or coalesce(jsonb_array_length(p_replacement->'packet_strong_connections'),0)<1
       or jsonb_typeof(p_replacement->'packet_things_to_consider')<>'array'
       or jsonb_typeof(p_replacement->'packet_unknown_warnings')<>'array'
       or not coalesce((p_replacement->'criteria_checks') @> '{"dutiesAligned":true,"experienceConfirmed":true,"levelAcceptable":true,"scheduleAcceptable":true,"locationAcceptable":true,"compensationAcceptable":true,"nonNegotiablesSatisfied":true}'::jsonb,false) then
      raise exception 'replacement doctrine evidence incomplete';
    end if;
    if not public.packet_claims_have_valid_provenance(p_replacement->'packet_strong_connections',review_row.job_match_id,p_replacement_job_id,order_row.customer_id,order_row.intake_id,'strong',true)
       or not public.packet_claims_have_valid_provenance(p_replacement->'packet_things_to_consider',review_row.job_match_id,p_replacement_job_id,order_row.customer_id,order_row.intake_id,'consideration',false)
       or not public.packet_claims_have_valid_provenance(p_replacement->'packet_unknown_warnings',review_row.job_match_id,p_replacement_job_id,order_row.customer_id,order_row.intake_id,'unknown',false) then
      raise exception 'replacement evidence provenance is invalid';
    end if;
    select * into replacement_job from public.jobs where id=p_replacement_job_id for update;
    if not found or replacement_job.is_active is not true or replacement_job.listing_status<>'open'
       or replacement_job.rejection_reason is not null or replacement_job.checked_at<p_resolved_at-interval '24 hours'
       or replacement_job.official_application_url is null or replacement_job.official_application_url !~ '^https://'
       or regexp_replace(lower(concat_ws(' ',replacement_job.company,replacement_job.employer_display_name,replacement_job.source_name,replacement_job.source_url,replacement_job.source_job_url,replacement_job.official_application_url)),'[^a-z0-9]+','','g') like '%liveops%' then
      raise exception 'replacement job is not eligible';
    end if;
    if not public.packet_unknown_warnings_are_complete(p_replacement->'packet_unknown_warnings',replacement_job.id) then
      raise exception 'replacement material unknown warning missing';
    end if;
    update public.jobs set review_status='approved',reviewed_by=p_actor_id,reviewed_at=p_resolved_at where id=replacement_job.id;
    update public.job_matches set job_id=p_replacement_job_id,fit_summary=p_replacement->>'fit_summary',
      matching_experience=p_replacement->'matching_experience',primary_outcome=p_replacement->>'primary_outcome',
      core_responsibilities=p_replacement->'core_responsibilities',requirements=p_replacement->'requirements',
      hidden_job_functions=coalesce(p_replacement->'hidden_job_functions','[]'::jsonb),concerns=coalesce(p_replacement->'concerns','[]'::jsonb),
      criteria_checks=p_replacement->'criteria_checks',ranking_score=(p_replacement->>'ranking_score')::integer,
      ranking_reason_codes=coalesce(p_replacement->'ranking_reason_codes','[]'::jsonb),match_category=p_replacement->>'match_category',
      packet_strong_connections=p_replacement->'packet_strong_connections',packet_things_to_consider=p_replacement->'packet_things_to_consider',
      packet_unknown_warnings=p_replacement->'packet_unknown_warnings',customer_decision=null,delivered_at=null,
      reviewed_by=p_actor_id,reviewed_at=p_resolved_at where id=review_row.job_match_id;
    update public.job_match_packet_artifacts set status='SUPERSEDED'
      where id=order_row.job_match_packet_artifact_id
      and status='APPROVED';
    update public.job_matches set delivered_at=null where search_order_id=packet_order_id;
    update public.orders set job_match_packet_artifact_id=null,status='delivery_processing',
      processing_previous_status='delivered',job_match_packet_content_revision=job_match_packet_content_revision+1,updated_at=now()
      where id=packet_order_id;
  end if;
  update public.conflict_reviews set status=p_status,resolution=p_resolution,resolved_at=p_resolved_at where id=p_review_id and status='submitted';
  if not found then raise exception 'conflict review changed during resolution'; end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
    values(p_actor_id,'conflict_'||p_status,'conflict_review',p_review_id::text,
      jsonb_build_object('prior_job_id',prior_job_id,'replacement_job_id',p_replacement_job_id,'prior_content_revision',case when p_status='accepted' then order_row.job_match_packet_content_revision else null end,'next_content_revision',case when p_status='accepted' then order_row.job_match_packet_content_revision+1 else null end,'packet_reapproval_required',p_status='accepted'));
  return true;
end;
$$;
revoke all on function public.resolve_conflict_review(uuid,uuid,text,text,uuid,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.resolve_conflict_review(uuid,uuid,text,text,uuid,jsonb,timestamptz) to service_role;

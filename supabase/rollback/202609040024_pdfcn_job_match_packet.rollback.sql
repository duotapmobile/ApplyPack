-- Refuses rollback when packet artifacts exist; never discard customer artifacts.
do $$ begin
  if exists(select 1 from public.job_match_packet_artifacts) then raise exception 'job_match_packet_artifacts_exist'; end if;
end $$;
drop function if exists public.expire_job_match_packet_artifact(uuid,timestamptz);
drop function if exists public.approve_job_match_packet_artifact(uuid,text,uuid,timestamptz);
drop function if exists public.stage_search_delivery(uuid,uuid,jsonb,jsonb,timestamptz,timestamptz);
drop function public.resolve_conflict_review(uuid,uuid,text,text,uuid,jsonb,timestamptz);
drop function if exists public.packet_claims_have_valid_provenance(jsonb,uuid,uuid,uuid,uuid,text,boolean);
drop function if exists public.packet_unknown_warnings_are_complete(jsonb,uuid);
drop function if exists public.packet_value_is_unknown(text);
alter table public.orders drop column job_match_packet_artifact_id, drop column job_match_packet_content_revision;


drop table public.job_match_packet_artifacts;
drop function public.guard_job_match_packet_immutability();
drop type public.job_match_packet_status;
alter table public.job_matches
  drop column packet_unknown_warnings,
  drop column packet_things_to_consider,
  drop column packet_strong_connections,
  drop column match_category;

-- Restore the exact behavior and privileges from 202609020011_human_review_delivery.sql.
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
  if not exists(select 1 from public.profiles where id = p_actor_id and role in ('operator','admin')) then
    raise exception 'authorized operator required';
  end if;
  if not coalesce(p_review_checklist @> '{
    "criteriaCompared": true,
    "allListingsRechecked": true,
    "exactlyTenApplicationWorthy": true,
    "noPadding": true,
    "humanReleaseApproved": true
  }'::jsonb, false) then
    raise exception 'human review checklist incomplete';
  end if;
  if jsonb_typeof(p_matches) <> 'array' or jsonb_array_length(p_matches) <> 10 then
    raise exception 'exactly ten matches required';
  end if;
  if (select count(distinct value ->> 'job_id') from jsonb_array_elements(p_matches) value) <> 10 then
    raise exception 'duplicate match jobs';
  end if;

  select * into order_row from public.orders where id = p_order_id for update;
  if not found or order_row.product_kind <> 'job_search' or order_row.status <> 'delivery_processing' then
    raise exception 'search order is not claimed for delivery';
  end if;
  if exists(select 1 from public.job_matches where search_order_id = p_order_id) then
    raise exception 'matches already delivered';
  end if;

  for match_row in select value from jsonb_array_elements(p_matches) value loop
    if coalesce(jsonb_array_length(match_row -> 'matching_experience'), 0) < 1
       or length(trim(coalesce(match_row ->> 'primary_outcome', ''))) < 10
       or coalesce(jsonb_array_length(match_row -> 'core_responsibilities'), 0) < 1
       or coalesce(jsonb_array_length(match_row -> 'requirements'), 0) < 1
       or not coalesce((match_row -> 'criteria_checks') @> '{
         "dutiesAligned": true,
         "experienceConfirmed": true,
         "levelAcceptable": true,
         "scheduleAcceptable": true,
         "locationAcceptable": true,
         "compensationAcceptable": true,
         "nonNegotiablesSatisfied": true
       }'::jsonb, false) then
      raise exception 'match doctrine evidence incomplete';
    end if;

    select * into selected_job from public.jobs where id = (match_row ->> 'job_id')::uuid for update;
    if not found
       or selected_job.is_active is not true
       or selected_job.listing_status <> 'open'
       or selected_job.rejection_reason is not null
       or selected_job.checked_at < p_delivered_at - interval '24 hours'
       or regexp_replace(lower(concat_ws(' ', selected_job.company, selected_job.employer_display_name, selected_job.source_name, selected_job.source_url, selected_job.source_job_url, selected_job.official_application_url)), '[^a-z0-9]+', '', 'g') like '%liveops%' then
      raise exception 'job is not eligible for delivery';
    end if;

    update public.jobs set review_status = 'approved', reviewed_by = p_actor_id, reviewed_at = p_delivered_at
      where id = selected_job.id;
    insert into public.job_matches(
      search_order_id, job_id, position, fit_summary, matching_experience,
      primary_outcome, core_responsibilities, requirements, hidden_job_functions,
      concerns, criteria_checks, ranking_score, ranking_reason_codes,
      delivered_at, reviewed_by, reviewed_at
    ) values (
      p_order_id,
      selected_job.id,
      (match_row ->> 'position')::integer,
      match_row ->> 'fit_summary',
      match_row -> 'matching_experience',
      match_row ->> 'primary_outcome',
      match_row -> 'core_responsibilities',
      match_row -> 'requirements',
      coalesce(match_row -> 'hidden_job_functions', '[]'::jsonb),
      coalesce(match_row -> 'concerns', '[]'::jsonb),
      match_row -> 'criteria_checks',
      (match_row ->> 'ranking_score')::integer,
      coalesce(match_row -> 'ranking_reason_codes', '[]'::jsonb),
      p_delivered_at,
      p_actor_id,
      p_delivered_at
    );
  end loop;

  update public.orders set
    status = 'delivered',
    delivered_at = p_delivered_at,
    human_review_checklist = p_review_checklist,
    human_reviewed_by = p_actor_id,
    human_reviewed_at = p_delivered_at,
    processing_previous_status = null,
    processing_started_at = null,
    updated_at = now()
  where id = p_order_id and status = 'delivery_processing';

  if order_row.intake_id is not null then
    update public.intakes set source_retention_due_at = p_retention_due_at, updated_at = now()
      where id = order_row.intake_id;
  end if;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
    values (p_actor_id, 'search_delivered', 'order', p_order_id::text, jsonb_build_object(
      'match_count', 10, 'review_checklist', p_review_checklist
    ));
  return true;
end;
$$;

create or replace function public.release_order_delivery(p_order_id uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  update public.orders set status=coalesce(processing_previous_status,'in_fulfillment'::public.order_status),
    processing_previous_status=null,processing_started_at=null,updated_at=now()
    where id=p_order_id and status='delivery_processing';
  return found;
end;
$$;

create or replace function public.resolve_conflict_review(
  p_review_id uuid,
  p_actor_id uuid,
  p_status text,
  p_resolution text,
  p_replacement_job_id uuid default null,
  p_replacement jsonb default null,
  p_resolved_at timestamptz default now()
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  review_row public.conflict_reviews%rowtype;
  replacement_job public.jobs%rowtype;
begin
  if not exists(select 1 from public.profiles where id=p_actor_id and role in ('operator','admin')) then raise exception 'authorized operator required'; end if;
  if p_status not in ('accepted','rejected') or length(trim(coalesce(p_resolution,'')))<10 then raise exception 'valid resolution required'; end if;
  select * into review_row from public.conflict_reviews where id=p_review_id for update;
  if not found or review_row.status<>'submitted' then raise exception 'conflict review is not open'; end if;
  if p_status='accepted' then
    if p_replacement_job_id is null or p_replacement is null then raise exception 'reviewed replacement required'; end if;
    if exists(select 1 from public.apply_pack_items where job_match_id=review_row.job_match_id) then raise exception 'match already has an apply pack'; end if;
    if coalesce(jsonb_array_length(p_replacement->'matching_experience'),0)<1
       or length(trim(coalesce(p_replacement->>'primary_outcome','')))<10
       or coalesce(jsonb_array_length(p_replacement->'core_responsibilities'),0)<1
       or coalesce(jsonb_array_length(p_replacement->'requirements'),0)<1
       or not coalesce((p_replacement->'criteria_checks') @> '{"dutiesAligned":true,"experienceConfirmed":true,"levelAcceptable":true,"scheduleAcceptable":true,"locationAcceptable":true,"compensationAcceptable":true,"nonNegotiablesSatisfied":true}'::jsonb,false) then
      raise exception 'replacement doctrine evidence incomplete';
    end if;
    select * into replacement_job from public.jobs where id=p_replacement_job_id for update;
    if not found or replacement_job.is_active is not true or replacement_job.listing_status<>'open'
       or replacement_job.rejection_reason is not null or replacement_job.checked_at<p_resolved_at-interval '24 hours'
       or regexp_replace(lower(concat_ws(' ',replacement_job.company,replacement_job.employer_display_name,replacement_job.source_name,replacement_job.source_url,replacement_job.source_job_url,replacement_job.official_application_url)),'[^a-z0-9]+','','g') like '%liveops%' then
      raise exception 'replacement job is not eligible';
    end if;
    update public.jobs set review_status='approved',reviewed_by=p_actor_id,reviewed_at=p_resolved_at where id=replacement_job.id;
    update public.job_matches set job_id=p_replacement_job_id,fit_summary=p_replacement->>'fit_summary',
      matching_experience=p_replacement->'matching_experience',primary_outcome=p_replacement->>'primary_outcome',
      core_responsibilities=p_replacement->'core_responsibilities',requirements=p_replacement->'requirements',
      hidden_job_functions=coalesce(p_replacement->'hidden_job_functions','[]'::jsonb),
      concerns=coalesce(p_replacement->'concerns','[]'::jsonb),criteria_checks=p_replacement->'criteria_checks',
      ranking_score=(p_replacement->>'ranking_score')::integer,
      ranking_reason_codes=coalesce(p_replacement->'ranking_reason_codes','[]'::jsonb),
      customer_decision=null,delivered_at=p_resolved_at,reviewed_by=p_actor_id,reviewed_at=p_resolved_at
      where id=review_row.job_match_id;
  end if;
  update public.conflict_reviews set status=p_status,resolution=p_resolution,resolved_at=p_resolved_at where id=p_review_id and status='submitted';
  if not found then raise exception 'conflict review changed during resolution'; end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
    values(p_actor_id,'conflict_'||p_status,'conflict_review',p_review_id::text,jsonb_build_object('replacement_job_id',p_replacement_job_id));
  return true;
end;
$$;
revoke all on function public.resolve_conflict_review(uuid,uuid,text,text,uuid,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.resolve_conflict_review(uuid,uuid,text,text,uuid,jsonb,timestamptz) to service_role;
grant execute on function public.complete_search_delivery(uuid,uuid,jsonb,jsonb,timestamptz,timestamptz) to service_role;

revoke all on function public.complete_search_delivery(uuid, uuid, jsonb, jsonb, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.complete_search_delivery(uuid, uuid, jsonb, jsonb, timestamptz, timestamptz) to service_role;

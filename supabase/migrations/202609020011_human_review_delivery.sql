alter table public.jobs
  add column reviewed_by uuid references public.profiles(id),
  add column reviewed_at timestamptz;

alter table public.job_matches
  add column matching_experience jsonb not null default '[]'::jsonb,
  add column primary_outcome text,
  add column core_responsibilities jsonb not null default '[]'::jsonb,
  add column hidden_job_functions jsonb not null default '[]'::jsonb,
  add column criteria_checks jsonb not null default '{}'::jsonb,
  add column reviewed_by uuid references public.profiles(id),
  add column reviewed_at timestamptz;

alter table public.orders
  add column human_review_checklist jsonb not null default '{}'::jsonb,
  add column human_reviewed_by uuid references public.profiles(id),
  add column human_reviewed_at timestamptz;

alter table public.apply_pack_items
  add column human_review_checklist jsonb not null default '{}'::jsonb,
  add column human_reviewed_by uuid references public.profiles(id),
  add column human_reviewed_at timestamptz;

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

create or replace function public.complete_apply_pack_item_delivery(
  p_item_id uuid,
  p_actor_id uuid,
  p_resume_path text,
  p_cover_letter_path text,
  p_review_checklist jsonb,
  p_delivered_at timestamptz
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  item_row public.apply_pack_items%rowtype;
  order_row public.orders%rowtype;
begin
  if not exists(select 1 from public.profiles where id = p_actor_id and role in ('operator','admin')) then
    raise exception 'authorized operator required';
  end if;
  if not coalesce(p_review_checklist @> '{
    "factsVerified": true,
    "jobTargetConfirmed": true,
    "noInventedClaims": true,
    "resumeReviewed": true,
    "coverLetterReviewed": true,
    "humanReleaseApproved": true
  }'::jsonb, false) then
    raise exception 'human review checklist incomplete';
  end if;
  if p_resume_path is null or p_cover_letter_path is null then raise exception 'delivery paths required'; end if;

  select * into item_row from public.apply_pack_items where id = p_item_id for update;
  if not found or item_row.status <> 'delivery_processing' then raise exception 'item is not claimed for delivery'; end if;
  select * into order_row from public.orders where id = item_row.order_id for update;
  if not found or order_row.product_kind <> 'apply_pack' or order_row.status <> 'delivery_processing' then
    raise exception 'order is not claimed for delivery';
  end if;

  update public.apply_pack_items set
    status = 'delivered', resume_path = p_resume_path, cover_letter_path = p_cover_letter_path,
    delivered_at = p_delivered_at, delivery_claimed_at = null,
    human_review_checklist = p_review_checklist, human_reviewed_by = p_actor_id,
    human_reviewed_at = p_delivered_at
  where id = p_item_id;
  update public.orders set
    status = 'delivered', delivered_at = p_delivered_at,
    human_review_checklist = p_review_checklist, human_reviewed_by = p_actor_id,
    human_reviewed_at = p_delivered_at, processing_previous_status = null,
    processing_started_at = null, updated_at = now()
  where id = order_row.id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
    values (p_actor_id, 'apply_pack_delivered', 'apply_pack_item', p_item_id::text,
      jsonb_build_object('review_checklist', p_review_checklist));
  return true;
end;
$$;

revoke all on function public.complete_search_delivery(uuid, uuid, jsonb, jsonb, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.complete_apply_pack_item_delivery(uuid, uuid, text, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.complete_search_delivery(uuid, uuid, jsonb, jsonb, timestamptz, timestamptz) to service_role;
grant execute on function public.complete_apply_pack_item_delivery(uuid, uuid, text, text, jsonb, timestamptz) to service_role;

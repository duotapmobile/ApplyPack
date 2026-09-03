create or replace function public.resolve_conflict_review(
  p_review_id uuid,
  p_actor_id uuid,
  p_status text,
  p_resolution text,
  p_replacement_job_id uuid default null,
  p_replacement jsonb default null,
  p_resolved_at timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  review_row public.conflict_reviews%rowtype;
  replacement_job public.jobs%rowtype;
begin
  if not exists(select 1 from public.profiles where id = p_actor_id and role in ('operator','admin')) then
    raise exception 'authorized operator required';
  end if;
  if p_status not in ('accepted','rejected') or length(trim(coalesce(p_resolution, ''))) < 10 then
    raise exception 'valid resolution required';
  end if;

  select * into review_row from public.conflict_reviews where id = p_review_id for update;
  if not found or review_row.status <> 'submitted' then raise exception 'conflict review is not open'; end if;

  if p_status = 'accepted' then
    if p_replacement_job_id is null or p_replacement is null then raise exception 'reviewed replacement required'; end if;
    if exists(select 1 from public.apply_pack_items where job_match_id = review_row.job_match_id) then
      raise exception 'match already has an apply pack';
    end if;
    if coalesce(jsonb_array_length(p_replacement -> 'matching_experience'), 0) < 1
       or length(trim(coalesce(p_replacement ->> 'primary_outcome', ''))) < 10
       or coalesce(jsonb_array_length(p_replacement -> 'core_responsibilities'), 0) < 1
       or coalesce(jsonb_array_length(p_replacement -> 'requirements'), 0) < 1
       or not coalesce((p_replacement -> 'criteria_checks') @> '{
         "dutiesAligned": true,
         "experienceConfirmed": true,
         "levelAcceptable": true,
         "scheduleAcceptable": true,
         "locationAcceptable": true,
         "compensationAcceptable": true,
         "nonNegotiablesSatisfied": true
       }'::jsonb, false) then
      raise exception 'replacement doctrine evidence incomplete';
    end if;

    select * into replacement_job from public.jobs where id = p_replacement_job_id for update;
    if not found
       or replacement_job.is_active is not true
       or replacement_job.listing_status <> 'open'
       or replacement_job.rejection_reason is not null
       or replacement_job.checked_at < p_resolved_at - interval '24 hours'
       or regexp_replace(lower(concat_ws(' ', replacement_job.company, replacement_job.employer_display_name, replacement_job.source_name, replacement_job.source_url, replacement_job.source_job_url, replacement_job.official_application_url)), '[^a-z0-9]+', '', 'g') like '%liveops%' then
      raise exception 'replacement job is not eligible';
    end if;

    update public.jobs
      set review_status = 'approved', reviewed_by = p_actor_id, reviewed_at = p_resolved_at
      where id = replacement_job.id;
    update public.job_matches
      set job_id = p_replacement_job_id,
          fit_summary = p_replacement ->> 'fit_summary',
          matching_experience = p_replacement -> 'matching_experience',
          primary_outcome = p_replacement ->> 'primary_outcome',
          core_responsibilities = p_replacement -> 'core_responsibilities',
          requirements = p_replacement -> 'requirements',
          hidden_job_functions = coalesce(p_replacement -> 'hidden_job_functions', '[]'::jsonb),
          concerns = coalesce(p_replacement -> 'concerns', '[]'::jsonb),
          criteria_checks = p_replacement -> 'criteria_checks',
          ranking_score = (p_replacement ->> 'ranking_score')::integer,
          ranking_reason_codes = coalesce(p_replacement -> 'ranking_reason_codes', '[]'::jsonb),
          customer_decision = null,
          delivered_at = p_resolved_at,
          reviewed_by = p_actor_id,
          reviewed_at = p_resolved_at
      where id = review_row.job_match_id;
  end if;

  update public.conflict_reviews
    set status = p_status, resolution = p_resolution, resolved_at = p_resolved_at
    where id = p_review_id and status = 'submitted';
  if not found then raise exception 'conflict review changed during resolution'; end if;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
    values (p_actor_id, 'conflict_' || p_status, 'conflict_review', p_review_id::text,
      jsonb_build_object('replacement_job_id', p_replacement_job_id));
  return true;
end;
$$;

revoke all on function public.resolve_conflict_review(uuid, uuid, text, text, uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.resolve_conflict_review(uuid, uuid, text, text, uuid, jsonb, timestamptz) to service_role;

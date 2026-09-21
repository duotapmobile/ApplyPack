-- Readiness follows current rotation authority, never legacy schedule flags.
begin;
create function public.ap_current_source_readiness() returns jsonb
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
  )
  select jsonb_build_object(
    'jobSourcesRegistered',exists(select 1 from complete_runs),
    'authorizedSourceInventory',exists(
      select 1 from complete_runs
      join public.job_source_listing_projections projection on projection.run_id=complete_runs.id
      join public.jobs job on job.id=projection.job_id and job.source_id=complete_runs.source_id
      where job.is_active and job.listing_status='open' and job.application_path_status='verified_actionable'
        and job.source_freshness_status in ('fresh','aging')
        and job.last_successfully_verified_at between statement_timestamp()-interval '72 hours' and statement_timestamp()
        and (job.closing_at is null or job.closing_at>statement_timestamp())
    )
  );
$function$;
revoke all on function public.ap_current_source_readiness() from public,anon,authenticated;
grant execute on function public.ap_current_source_readiness() to service_role;
commit;

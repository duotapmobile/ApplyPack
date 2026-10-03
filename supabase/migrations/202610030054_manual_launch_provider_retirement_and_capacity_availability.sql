-- Bind public checkout to provider-side subscription retirement evidence and
-- report whether the configured rolling capacity has room for a new order.
-- Forward-only: historical activations remain valid records but cannot unlock
-- checkout without the new provider-retirement reference.

begin;

alter table public.ap_manual_launch_activations
  add column legacy_subscription_retirement_reference text
    check (
      legacy_subscription_retirement_reference is null
      or length(btrim(legacy_subscription_retirement_reference)) between 12 and 500
    );

create or replace function public.ap_manual_launch_capacity_readiness()
returns jsonb language sql stable security definer set search_path='' as $$
  with required(resource,maximum) as (values
    ('SEARCH'::public.ap_capacity_resource,1),
    ('MATERIALS'::public.ap_capacity_resource,2)
  ), status as (
    select required.resource,required.maximum,pool.id as pool_id,pool.enabled,
      count(bucket.id) filter(where bucket.starts_at<=clock_timestamp() and bucket.ends_at>clock_timestamp()) as current_buckets,
      coalesce((select sum(allocation.units) from public.ap_capacity_allocations allocation
        join public.ap_capacity_buckets used_bucket on used_bucket.id=allocation.bucket_id
        where used_bucket.pool_id=pool.id and allocation.debit_disposition in ('HELD','SPENT')
          and ((required.resource='SEARCH' and (allocation.request_key like 'search-invitation:%'
            or allocation.request_key like 'search-checkout:%' or allocation.request_key like 'search-reacquire:%'))
            or (required.resource='MATERIALS' and allocation.request_key like 'materials-checkout:%'))
          and coalesce(allocation.consumed_at,allocation.reserved_at,allocation.created_at)>clock_timestamp()-interval '24 hours'),0) as rolling_units
    from required left join public.ap_capacity_pools pool on pool.resource=required.resource
      left join public.ap_capacity_buckets bucket on bucket.pool_id=pool.id
    group by required.resource,required.maximum,pool.id,pool.enabled
  ) select jsonb_build_object(
    'ready',coalesce(bool_and(pool_id is not null and enabled and current_buckets=1 and rolling_units<=maximum),false),
    'available',coalesce(bool_and(pool_id is not null and enabled and current_buckets=1 and rolling_units<maximum),false),
    'resources',jsonb_agg(jsonb_build_object('resource',resource,'maximum',maximum,'enabled',coalesce(enabled,false),
      'currentBuckets',current_buckets,'rollingUnits',rolling_units,'available',rolling_units<maximum) order by resource)
  ) from status;
$$;
revoke all on function public.ap_manual_launch_capacity_readiness() from public,anon,authenticated;
grant execute on function public.ap_manual_launch_capacity_readiness() to service_role;

commit;

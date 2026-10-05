-- Report product-specific checkout admission without rejecting a search
-- invitation that already owns the single permitted search reservation.

begin;

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
          and coalesce(allocation.consumed_at,allocation.reserved_at,allocation.created_at)>clock_timestamp()-interval '24 hours'),0) as rolling_units,
      coalesce((select sum(allocation.units) from public.ap_capacity_allocations allocation
        join public.ap_capacity_buckets used_bucket on used_bucket.id=allocation.bucket_id
        where required.resource='SEARCH' and used_bucket.pool_id=pool.id
          and allocation.request_key like 'search-invitation:%'
          and allocation.lifecycle='RESERVED' and allocation.debit_disposition='HELD'
          and allocation.expires_at>clock_timestamp()),0) as reserved_search_invitation_units
    from required left join public.ap_capacity_pools pool on pool.resource=required.resource
      left join public.ap_capacity_buckets bucket on bucket.pool_id=pool.id
    group by required.resource,required.maximum,pool.id,pool.enabled
  ), admission as (
    select *,
      pool_id is not null and enabled and current_buckets=1 and rolling_units<maximum as new_capacity_available,
      pool_id is not null and enabled and current_buckets=1 and (
        rolling_units<maximum or (resource='SEARCH' and reserved_search_invitation_units>0)
      ) as checkout_available
    from status
  ) select jsonb_build_object(
    'ready',coalesce(bool_and(pool_id is not null and enabled and current_buckets=1 and rolling_units<=maximum),false),
    'available',coalesce(bool_or(checkout_available),false),
    'resources',jsonb_agg(jsonb_build_object('resource',resource,'maximum',maximum,'enabled',coalesce(enabled,false),
      'currentBuckets',current_buckets,'rollingUnits',rolling_units,
      'newCapacityAvailable',new_capacity_available,'checkoutAvailable',checkout_available,
      'reservedSearchInvitationUnits',reserved_search_invitation_units) order by resource)
  ) from admission;
$$;
revoke all on function public.ap_manual_launch_capacity_readiness() from public,anon,authenticated;
grant execute on function public.ap_manual_launch_capacity_readiness() to service_role;

commit;

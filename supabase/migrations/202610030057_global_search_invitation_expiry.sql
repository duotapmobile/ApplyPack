-- Release expired search-invitation holds across every draft before reserving
-- the single rolling search slot. This is forward-only: published migrations
-- remain immutable.

begin;

create or replace function public.ap_expire_search_checkout_invitations()
returns integer language plpgsql security definer set search_path='' as $$
declare expired_count integer;
begin
  update public.ap_search_checkout_invitations
  set revoked_at=clock_timestamp()
  where consumed_at is null
    and revoked_at is null
    and expires_at<=clock_timestamp();
  get diagnostics expired_count=row_count;
  return expired_count;
end;
$$;
revoke all on function public.ap_expire_search_checkout_invitations() from public,anon,authenticated;
grant execute on function public.ap_expire_search_checkout_invitations() to service_role;

do $migration$
declare
  definition text;
  old_predicate constant text :=
    'where draft_id=p_draft_id and consumed_at is null and revoked_at is null and expires_at<=now_at';
  new_predicate constant text :=
    'where consumed_at is null and revoked_at is null and expires_at<=now_at';
begin
  if not exists (
    select 1
    from pg_trigger
    where tgrelid='public.ap_search_checkout_invitations'::regclass
      and tgname='ap_release_revoked_search_invitation_capacity'
      and not tgisinternal
  ) then
    raise exception 'search_invitation_capacity_release_trigger_missing';
  end if;

  select pg_get_functiondef(
    'public.ap_issue_search_checkout_invitation(uuid,uuid,uuid,uuid,text,timestamptz,uuid,text)'::regprocedure
  ) into definition;
  definition:=replace(definition,chr(13),'');

  if definition is null or position(old_predicate in definition)=0 then
    raise exception 'global_search_invitation_expiry_anchor_missing';
  end if;

  definition:=replace(definition,old_predicate,new_predicate);
  if position(old_predicate in definition)>0 or position(new_predicate in definition)=0 then
    raise exception 'global_search_invitation_expiry_rewrite_failed';
  end if;

  execute definition;
end;
$migration$;

-- Expired HELD rows cannot reduce either physical bucket capacity or the
-- rolling launch allowance while the recurring cleanup is waiting to run.
create or replace function public.ap_capacity_available(p_bucket_id uuid)
returns integer language sql stable security definer set search_path='' as $$
  select greatest(0,b.total_units-coalesce(sum(a.units) filter(where
    a.debit_disposition='SPENT' or (
      a.debit_disposition='HELD'
      and (a.expires_at is null or a.expires_at>clock_timestamp())
    )
  ),0))::integer
  from public.ap_capacity_buckets b
  left join public.ap_capacity_allocations a on a.bucket_id=b.id
  where b.id=p_bucket_id
  group by b.id,b.total_units;
$$;

do $migration$
declare
  definition text;
  old_rolling constant text :=
    'where used_bucket.pool_id=pool_row.id and allocation.debit_disposition in (''HELD'',''SPENT'')';
  new_rolling constant text :=
    'where used_bucket.pool_id=pool_row.id and allocation.debit_disposition in (''HELD'',''SPENT'')'||chr(10)||
    '      and (allocation.debit_disposition=''SPENT'' or allocation.expires_at is null or allocation.expires_at>clock_timestamp())';
  old_bucket constant text :=
    'where a.bucket_id=b.id and a.debit_disposition in (''HELD'',''SPENT'')),0) >= p_units';
  new_bucket constant text :=
    'where a.bucket_id=b.id and a.debit_disposition in (''HELD'',''SPENT'')'||chr(10)||
    '        and (a.debit_disposition=''SPENT'' or a.expires_at is null or a.expires_at>clock_timestamp())),0) >= p_units';
begin
  select pg_get_functiondef(
    'public.ap_reserve_capacity(uuid,public.ap_capacity_resource,integer,text,timestamptz,jsonb,uuid)'::regprocedure
  ) into definition;
  definition:=replace(definition,chr(13),'');
  if definition is null or position(old_rolling in definition)=0 or position(old_bucket in definition)=0 then
    raise exception 'expired_capacity_exclusion_anchor_missing';
  end if;
  definition:=replace(replace(definition,old_rolling,new_rolling),old_bucket,new_bucket);
  if position(new_rolling in definition)=0 or position(new_bucket in definition)=0 then
    raise exception 'expired_capacity_exclusion_rewrite_failed';
  end if;
  execute definition;
end;
$migration$;

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
          and (allocation.debit_disposition='SPENT' or allocation.expires_at is null
            or allocation.expires_at>clock_timestamp())
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

-- Close holds that expired after the prior migration was installed. The
-- existing AFTER UPDATE trigger returns each allocation and records the audit.
select public.ap_expire_search_checkout_invitations();

commit;

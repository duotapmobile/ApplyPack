create or replace function public.available_capacity(p_kind public.product_kind)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  limit_units integer;
  used_units integer;
begin
  select units_per_24h into limit_units from public.capacity_limits
    where kind = p_kind and enabled = true;
  if limit_units is null then return 0; end if;
  select coalesce(sum(units), 0) into used_units from public.capacity_reservations
    where kind = p_kind and (
      (status = 'reserved' and expires_at > now())
      or (status = 'confirmed' and confirmed_at > now() - interval '24 hours')
    );
  return greatest(0, limit_units - used_units);
end;
$$;

revoke all on function public.available_capacity(public.product_kind) from public, anon, authenticated;
grant execute on function public.available_capacity(public.product_kind) to service_role;

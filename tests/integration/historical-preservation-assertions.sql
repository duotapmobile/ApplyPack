do $$
begin
  if not exists(
    select 1 from public.profiles
    where id = '12000000-0000-0000-0000-000000000001'
      and email = 'historical@example.invalid'
  ) then raise exception 'historical profile was lost'; end if;

  if not exists(
    select 1 from public.intakes
    where id = '22000000-0000-0000-0000-000000000001'
      and direction = 'Historical operations direction'
      and experience_summary = 'Historical confirmed experience.'
  ) then raise exception 'historical intake was lost or overwritten'; end if;

  if not exists(
    select 1 from public.orders
    where id = '32000000-0000-0000-0000-000000000001'
      and status = 'paid'
      and amount_cents = 2000
  ) then raise exception 'historical paid order was lost or relabeled'; end if;

  if not exists(
    select 1 from public.payments
    where id = '42000000-0000-0000-0000-000000000001'
      and status = 'paid'
      and amount_cents = 2000
  ) then raise exception 'historical payment was lost or relabeled'; end if;

  if not exists(
    select 1 from public.jobs
    where id = '52000000-0000-0000-0000-000000000001'
      and company = 'Historical Acme Company'
      and title = 'Historical Operations Coordinator'
      and source_url = 'https://historical.example/jobs/operations'
  ) then raise exception 'historical job identity or URL was overwritten'; end if;

  if exists(
    select 1 from public.jobs
    where id = '52000000-0000-0000-0000-000000000001'
      and regexp_replace(lower(concat_ws(' ', company, title, source_url)), '[^a-z0-9]+', '', 'g') like '%liveops%'
  ) then raise exception 'historical job was contaminated by the excluded fixture'; end if;

  if exists(
    select 1 from public.workflow_tasks
    where order_id = '32000000-0000-0000-0000-000000000001'
  ) then raise exception 'migration auto-enqueued historical paid production work'; end if;
end;
$$;

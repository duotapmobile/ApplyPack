create table public.customer_job_delivery_history (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  search_order_id uuid not null references public.orders(id),
  job_match_id uuid not null references public.job_matches(id),
  job_id uuid not null references public.jobs(id),
  delivery_kind text not null check (delivery_kind in ('initial','replacement','historical_backfill')),
  canonical_employer_id text,
  external_job_id text,
  normalized_source_url text,
  source_url text not null,
  source_job_url text,
  official_application_url text,
  deduplication_key text,
  delivered_at timestamptz not null,
  recorded_at timestamptz not null default now()
);

create index customer_job_delivery_history_customer_idx
  on public.customer_job_delivery_history(customer_id, delivered_at desc);
create index customer_job_delivery_history_job_idx
  on public.customer_job_delivery_history(customer_id, job_id);
create index customer_job_delivery_history_external_idx
  on public.customer_job_delivery_history(customer_id, canonical_employer_id, external_job_id)
  where canonical_employer_id is not null and external_job_id is not null;
create index customer_job_delivery_history_source_idx
  on public.customer_job_delivery_history(customer_id, normalized_source_url)
  where normalized_source_url is not null;
create index customer_job_delivery_history_dedup_idx
  on public.customer_job_delivery_history(customer_id, deduplication_key)
  where deduplication_key is not null;

alter table public.customer_job_delivery_history enable row level security;

revoke all on public.customer_job_delivery_history from public, anon, authenticated, service_role;
grant select on public.customer_job_delivery_history to service_role;

insert into public.customer_job_delivery_history(
  customer_id,
  search_order_id,
  job_match_id,
  job_id,
  delivery_kind,
  canonical_employer_id,
  external_job_id,
  normalized_source_url,
  source_url,
  source_job_url,
  official_application_url,
  deduplication_key,
  delivered_at
)
select
  search_order.customer_id,
  match.search_order_id,
  match.id,
  job.id,
  'historical_backfill',
  job.canonical_employer_id,
  job.external_job_id,
  job.normalized_source_url,
  job.source_url,
  job.source_job_url,
  job.official_application_url,
  job.deduplication_key,
  coalesce(match.delivered_at, search_order.delivered_at, match.created_at)
from public.job_matches match
join public.orders search_order on search_order.id = match.search_order_id
join public.jobs job on job.id = match.job_id
where match.delivered_at is not null
   or search_order.delivered_at is not null
   or search_order.status in ('delivered','delivered_refunded');

create or replace function public.normalize_job_delivery_url(p_url text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    regexp_replace(
      regexp_replace(lower(trim(coalesce(p_url, ''))), '#.*$', ''),
      '/+$',
      ''
    ),
    ''
  );
$$;

create or replace function public.customer_has_previously_received_job(
  p_customer_id uuid,
  p_job_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1
    from public.jobs candidate
    join public.customer_job_delivery_history history
      on history.customer_id = p_customer_id
    where candidate.id = p_job_id
      and (
        history.job_id = candidate.id
        or (
          candidate.canonical_employer_id is not null
          and history.canonical_employer_id = candidate.canonical_employer_id
          and candidate.external_job_id is not null
          and lower(trim(history.external_job_id)) = lower(trim(candidate.external_job_id))
        )
        or (
          candidate.normalized_source_url is not null
          and public.normalize_job_delivery_url(history.normalized_source_url)
            = public.normalize_job_delivery_url(candidate.normalized_source_url)
        )
        or (
          candidate.source_url is not null
          and public.normalize_job_delivery_url(history.source_url)
            = public.normalize_job_delivery_url(candidate.source_url)
        )
        or (
          candidate.source_job_url is not null
          and public.normalize_job_delivery_url(history.source_job_url)
            = public.normalize_job_delivery_url(candidate.source_job_url)
        )
        or (
          candidate.official_application_url is not null
          and public.normalize_job_delivery_url(history.official_application_url)
            = public.normalize_job_delivery_url(candidate.official_application_url)
        )
        or (
          candidate.deduplication_key is not null
          and history.deduplication_key = candidate.deduplication_key
        )
      )
  );
$$;

create or replace function public.find_previously_delivered_jobs(
  p_customer_id uuid,
  p_job_ids uuid[]
)
returns table(job_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select candidate_job_id
  from unnest(coalesce(p_job_ids, array[]::uuid[])) candidate_job_id
  where public.customer_has_previously_received_job(p_customer_id, candidate_job_id);
$$;

create or replace function public.record_customer_job_delivery_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  search_customer_id uuid;
  delivered_job public.jobs%rowtype;
  effective_delivered_at timestamptz;
begin
  if new.delivered_at is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if old.job_id = new.job_id and old.delivered_at is not null then
      return new;
    end if;
  end if;

  select customer_id into search_customer_id
  from public.orders
  where id = new.search_order_id;
  if not found then
    raise exception 'search order required for delivery history';
  end if;

  perform 1 from public.profiles where id = search_customer_id for update;
  if not found then
    raise exception 'customer required for delivery history';
  end if;
  if public.customer_has_previously_received_job(search_customer_id, new.job_id) then
    raise exception 'job previously delivered to customer';
  end if;

  select * into delivered_job from public.jobs where id = new.job_id;
  if not found then
    raise exception 'job required for delivery history';
  end if;
  effective_delivered_at := coalesce(new.delivered_at, now());

  insert into public.customer_job_delivery_history(
    customer_id,
    search_order_id,
    job_match_id,
    job_id,
    delivery_kind,
    canonical_employer_id,
    external_job_id,
    normalized_source_url,
    source_url,
    source_job_url,
    official_application_url,
    deduplication_key,
    delivered_at
  ) values (
    search_customer_id,
    new.search_order_id,
    new.id,
    new.job_id,
    case when tg_op = 'INSERT' then 'initial' else 'replacement' end,
    delivered_job.canonical_employer_id,
    delivered_job.external_job_id,
    delivered_job.normalized_source_url,
    delivered_job.source_url,
    delivered_job.source_job_url,
    delivered_job.official_application_url,
    delivered_job.deduplication_key,
    effective_delivered_at
  );
  return new;
end;
$$;

create trigger job_matches_record_delivery_history
after insert or update of job_id, delivered_at on public.job_matches
for each row execute function public.record_customer_job_delivery_history();

create or replace function public.prevent_customer_job_delivery_history_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'customer job delivery history is append-only';
end;
$$;

create trigger customer_job_delivery_history_append_only
before update or delete on public.customer_job_delivery_history
for each row execute function public.prevent_customer_job_delivery_history_mutation();

revoke all on function public.normalize_job_delivery_url(text) from public, anon, authenticated;
revoke all on function public.customer_has_previously_received_job(uuid, uuid) from public, anon, authenticated;
revoke all on function public.find_previously_delivered_jobs(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.record_customer_job_delivery_history() from public, anon, authenticated;
revoke all on function public.prevent_customer_job_delivery_history_mutation() from public, anon, authenticated;
grant execute on function public.find_previously_delivered_jobs(uuid, uuid[]) to service_role;

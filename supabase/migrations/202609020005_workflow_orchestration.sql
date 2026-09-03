create table public.workflow_tasks (
  id uuid primary key default gen_random_uuid(),
  task_kind text not null check (task_kind in ('search_discovery','document_draft')),
  reference_id uuid not null,
  order_id uuid not null references public.orders(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued','processing','awaiting_review','blocked','completed','failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  not_before timestamptz not null default now(),
  locked_at timestamptz,
  completed_at timestamptz,
  last_error_code text,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(task_kind, reference_id)
);

create index workflow_tasks_queue_idx on public.workflow_tasks(status, not_before, created_at);

create table public.search_candidates (
  id uuid primary key default gen_random_uuid(),
  search_order_id uuid not null references public.orders(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  ranking_score integer not null,
  ranking_reason_codes jsonb not null default '[]'::jsonb,
  fit_summary text not null,
  requirements jsonb not null default '[]'::jsonb,
  concerns jsonb not null default '[]'::jsonb,
  review_status text not null default 'proposed' check (review_status in ('proposed','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  unique(search_order_id, job_id)
);

alter table public.workflow_tasks enable row level security;
alter table public.search_candidates enable row level security;
create policy workflow_task_admin_all on public.workflow_tasks for all using (public.is_admin()) with check (public.is_admin());
create policy search_candidate_admin_all on public.search_candidates for all using (public.is_admin()) with check (public.is_admin());
revoke all on public.workflow_tasks, public.search_candidates from anon, authenticated;
grant all privileges on public.workflow_tasks, public.search_candidates to service_role;

create or replace function public.enqueue_paid_work()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'paid' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    if new.product_kind = 'job_search' then
      insert into public.workflow_tasks(task_kind, reference_id, order_id)
        values ('search_discovery', new.id, new.id)
        on conflict(task_kind, reference_id) do nothing;
    end if;
  end if;
  return new;
end;
$$;

create trigger orders_enqueue_paid_work_after_write
after insert or update of status on public.orders
for each row execute function public.enqueue_paid_work();

create or replace function public.enqueue_apply_pack_item_work()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  order_status public.order_status;
begin
  select status into order_status from public.orders where id = new.order_id;
  if order_status = 'paid' then
    insert into public.workflow_tasks(task_kind, reference_id, order_id)
      values ('document_draft', new.id, new.order_id)
      on conflict(task_kind, reference_id) do nothing;
  end if;
  return new;
end;
$$;

create trigger apply_pack_items_enqueue_work_after_insert
after insert on public.apply_pack_items
for each row execute function public.enqueue_apply_pack_item_work();

create or replace function public.claim_workflow_tasks(p_limit integer default 2)
returns setof public.workflow_tasks language plpgsql security definer set search_path = ''
as $$
begin
  return query
  with claimed as (
    select id from public.workflow_tasks
    where (
        (status in ('queued','failed') and not_before <= now())
        or (status = 'processing' and locked_at < now() - interval '15 minutes')
      )
      and attempt_count < 5
    order by created_at
    for update skip locked
    limit greatest(1, least(p_limit, 10))
  )
  update public.workflow_tasks task
    set status = 'processing', locked_at = now(), attempt_count = task.attempt_count + 1, updated_at = now()
    from claimed
    where task.id = claimed.id
    returning task.*;
end;
$$;

revoke all on function public.claim_workflow_tasks(integer) from public, anon, authenticated;
grant execute on function public.claim_workflow_tasks(integer) to service_role;

-- Existing production orders are intentionally not backfilled here. An
-- operator must classify and enqueue preserved work explicitly after upgrade.

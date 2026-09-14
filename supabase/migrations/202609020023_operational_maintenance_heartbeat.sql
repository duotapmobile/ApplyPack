create table public.operational_heartbeats (
  task_name text primary key check (task_name ~ '^[a-z0-9_]{1,64}$'),
  last_succeeded_at timestamptz not null,
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.operational_heartbeats enable row level security;
revoke all on public.operational_heartbeats from public, anon, authenticated;
grant all privileges on public.operational_heartbeats to service_role;

comment on table public.operational_heartbeats is
  'PII-free completion markers used to prove scheduled operational maintenance is running.';

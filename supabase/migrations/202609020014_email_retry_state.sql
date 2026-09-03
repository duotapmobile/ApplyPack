alter table public.email_events
  add column attempt_count integer not null default 1 check (attempt_count >= 0),
  add column last_attempt_at timestamptz,
  add column last_error_code text,
  add column updated_at timestamptz not null default now();

create index email_events_retry_idx on public.email_events(status, attempt_count, updated_at)
  where status = 'failed';

create table public.intake_drafts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null unique references public.profiles(id) on delete cascade,
  email text not null,
  current_step integer not null default 0 check (current_step between 0 and 6),
  answers jsonb not null default '{}'::jsonb,
  resume_document jsonb,
  cover_letter_document jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days'
);

alter table public.intake_drafts enable row level security;
revoke all on public.intake_drafts from public, anon, authenticated;
grant all privileges on public.intake_drafts to service_role;
create index intake_drafts_expiry_idx on public.intake_drafts(expires_at);

alter table public.intakes drop constraint if exists intakes_source_scan_status_check;
alter table public.intakes add constraint intakes_source_scan_status_check
  check (source_scan_status in ('pending','clean','blocked','scan_error'));

create table public.source_documents (
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.intakes(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  document_kind text not null check (document_kind in ('resume','cover_letter')),
  storage_path text not null unique,
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  claimed_mime_type text not null,
  verified_mime_type text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  scan_status text not null default 'pending' check (scan_status in ('pending','clean','blocked','scan_error')),
  scan_provider text,
  scan_provider_reference text,
  scan_error_code text,
  scan_attempts integer not null default 0 check (scan_attempts >= 0),
  scanned_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(intake_id, document_kind)
);

create index source_documents_intake_idx on public.source_documents(intake_id, scan_status);
alter table public.source_documents enable row level security;
create policy source_document_admin_select on public.source_documents for select using (public.is_admin());
revoke insert, update, delete on public.source_documents from anon, authenticated;
grant all privileges on public.source_documents to service_role;

create or replace function public.refresh_intake_scan_status(p_intake_id uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare
  aggregate_status text;
begin
  if exists(select 1 from public.source_documents where intake_id = p_intake_id and scan_status = 'blocked') then
    aggregate_status := 'blocked';
  elsif exists(select 1 from public.source_documents where intake_id = p_intake_id and scan_status = 'scan_error') then
    aggregate_status := 'scan_error';
  elsif exists(select 1 from public.source_documents where intake_id = p_intake_id)
    and not exists(select 1 from public.source_documents where intake_id = p_intake_id and scan_status <> 'clean') then
    aggregate_status := 'clean';
  else
    aggregate_status := 'pending';
  end if;

  update public.intakes
    set source_scan_status = aggregate_status,
        source_scanned_at = case when aggregate_status in ('clean','blocked','scan_error') then now() else null end,
        status = case when aggregate_status = 'clean' then 'ready_for_payment'::public.intake_status else 'draft'::public.intake_status end,
        updated_at = now()
    where id = p_intake_id;
  return aggregate_status;
end;
$$;

revoke all on function public.refresh_intake_scan_status(uuid) from public, anon, authenticated;
grant execute on function public.refresh_intake_scan_status(uuid) to service_role;

create table public.storage_cleanup_queue (
  id uuid primary key default gen_random_uuid(),
  bucket text not null check (bucket in ('customer-source-documents','customer-deliveries','operator-drafts')),
  storage_path text not null,
  reason text not null,
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  unique(bucket, storage_path)
);

alter table public.storage_cleanup_queue enable row level security;
revoke all on public.storage_cleanup_queue from public, anon, authenticated;
grant all privileges on public.storage_cleanup_queue to service_role;
create index storage_cleanup_retry_idx on public.storage_cleanup_queue(attempts, created_at);

create or replace function public.finalize_intake_source_retention(
  p_intake_id uuid,
  p_document_count integer,
  p_deleted_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.source_documents
    set deleted_at = p_deleted_at, updated_at = p_deleted_at
    where intake_id = p_intake_id and deleted_at is null;
  update public.intakes
    set source_deleted_at = p_deleted_at, updated_at = p_deleted_at
    where id = p_intake_id and source_deleted_at is null;
  if not found then return false; end if;
  insert into public.audit_logs(action, entity_type, entity_id, details)
    values ('source_documents_deleted', 'intake', p_intake_id::text,
      jsonb_build_object('document_count', greatest(0, p_document_count)));
  return true;
end;
$$;

revoke all on function public.finalize_intake_source_retention(uuid, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.finalize_intake_source_retention(uuid, integer, timestamptz) to service_role;

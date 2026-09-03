alter table public.source_documents
  add column if not exists scan_claimed_at timestamptz;

create index if not exists source_documents_scan_queue_idx
  on public.source_documents(scan_status, scan_attempts, created_at)
  where deleted_at is null and scan_status in ('pending','scan_error');

create or replace function public.claim_source_document_scans(p_limit integer default 5)
returns setof public.source_documents
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with candidates as (
    select id
    from public.source_documents
    where deleted_at is null
      and scan_status in ('pending','scan_error')
      and scan_attempts < 5
      and (scan_claimed_at is null or scan_claimed_at < now() - interval '15 minutes')
    order by created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 5), 20))
  )
  update public.source_documents document
  set scan_claimed_at = now(),
      scan_attempts = document.scan_attempts + 1,
      updated_at = now()
  from candidates
  where document.id = candidates.id
  returning document.*;
end;
$$;

revoke all on function public.claim_source_document_scans(integer) from public, anon, authenticated;
grant execute on function public.claim_source_document_scans(integer) to service_role;

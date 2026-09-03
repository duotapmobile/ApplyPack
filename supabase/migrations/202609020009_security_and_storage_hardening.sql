-- Preserve the historical role model while making privileged Data API reads
-- require the same AAL2 assurance enforced by the application.
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    and exists(
      select 1 from public.profiles
      where id = auth.uid() and role in ('operator','admin')
    );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- Customers keep historical delivered jobs, even after freshness changes, but
-- prohibited-source evidence remains visible only to an AAL2 administrator.
drop policy if exists job_owner_select on public.jobs;
create policy job_owner_select on public.jobs for select to authenticated using (
  public.is_admin()
  or (
    rejection_reason is distinct from 'hard_exclusion'
    and regexp_replace(lower(concat_ws(' ', company, employer_display_name, source_name, source_url, source_job_url, official_application_url)), '[^a-z0-9]+', '', 'g') not like '%liveops%'
    and exists(
      select 1 from public.job_matches match
      join public.orders order_row on order_row.id = match.search_order_id
      where match.job_id = jobs.id
        and order_row.status = 'delivered'
        and order_row.customer_id = auth.uid()
    )
  )
);

drop policy if exists match_owner_select on public.job_matches;
create policy match_owner_select on public.job_matches for select to authenticated using (
  public.is_admin()
  or (
    exists(
      select 1 from public.orders order_row
      where order_row.id = search_order_id
        and order_row.status = 'delivered'
        and order_row.customer_id = auth.uid()
    )
    and exists(
      select 1 from public.jobs job
      where job.id = job_id
        and job.rejection_reason is distinct from 'hard_exclusion'
        and regexp_replace(lower(concat_ws(' ', job.company, job.employer_display_name, job.source_name, job.source_url, job.source_job_url, job.official_application_url)), '[^a-z0-9]+', '', 'g') not like '%liveops%'
    )
  )
);

update storage.buckets
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array[
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]::text[]
where id in ('customer-source-documents','customer-deliveries');

update storage.buckets
set public = false,
    file_size_limit = 10485760,
    allowed_mime_types = array[
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ]::text[]
where id = 'operator-drafts';

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
        status = case
          when status in ('draft','ready_for_payment') and aggregate_status = 'clean' then 'ready_for_payment'::public.intake_status
          when status in ('draft','ready_for_payment') then 'draft'::public.intake_status
          else status
        end,
        updated_at = now()
    where id = p_intake_id;
  return aggregate_status;
end;
$$;

revoke all on function public.refresh_intake_scan_status(uuid) from public, anon, authenticated;
grant execute on function public.refresh_intake_scan_status(uuid) to service_role;

create index if not exists webhook_events_retry_idx
  on public.webhook_events(processing_status, claimed_at)
  where processed_at is null;

alter type public.order_status add value if not exists 'delivery_processing';
alter type public.order_status add value if not exists 'refund_pending';
alter type public.order_status add value if not exists 'delivered_refunded';

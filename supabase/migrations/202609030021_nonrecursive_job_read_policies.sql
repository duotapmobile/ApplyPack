-- Customer reads previously used jobs -> job_matches and job_matches -> jobs
-- policies, which PostgreSQL correctly rejected as recursive. Keep the same
-- delivered-order ownership and Liveops exclusion rules behind SECURITY DEFINER
-- predicates so policy evaluation never re-enters either protected table.

create or replace function public.can_view_delivered_job(p_job_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1
    from public.jobs job
    join public.job_matches match on match.job_id = job.id
    join public.orders order_row on order_row.id = match.search_order_id
    where job.id = p_job_id
      and order_row.status = 'delivered'
      and order_row.customer_id = auth.uid()
      and job.rejection_reason is distinct from 'hard_exclusion'
      and regexp_replace(
        lower(concat_ws(' ', job.company, job.employer_display_name, job.source_name,
          job.source_url, job.source_job_url, job.official_application_url)),
        '[^a-z0-9]+', '', 'g'
      ) not like '%liveops%'
  );
$$;

create or replace function public.can_view_delivered_job_match(p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1
    from public.job_matches match
    join public.jobs job on job.id = match.job_id
    join public.orders order_row on order_row.id = match.search_order_id
    where match.id = p_match_id
      and order_row.status = 'delivered'
      and order_row.customer_id = auth.uid()
      and job.rejection_reason is distinct from 'hard_exclusion'
      and regexp_replace(
        lower(concat_ws(' ', job.company, job.employer_display_name, job.source_name,
          job.source_url, job.source_job_url, job.official_application_url)),
        '[^a-z0-9]+', '', 'g'
      ) not like '%liveops%'
  );
$$;

revoke all on function public.can_view_delivered_job(uuid) from public, anon;
revoke all on function public.can_view_delivered_job_match(uuid) from public, anon;
grant execute on function public.can_view_delivered_job(uuid) to authenticated, service_role;
grant execute on function public.can_view_delivered_job_match(uuid) to authenticated, service_role;

drop policy if exists job_owner_select on public.jobs;
create policy job_owner_select on public.jobs
for select to authenticated
using (public.is_admin() or public.can_view_delivered_job(id));

drop policy if exists match_owner_select on public.job_matches;
create policy match_owner_select on public.job_matches
for select to authenticated
using (public.is_admin() or public.can_view_delivered_job_match(id));

drop policy if exists source_references_owner_select on public.job_source_references;
create policy source_references_owner_select on public.job_source_references
for select to authenticated
using (public.is_admin() or public.can_view_delivered_job(job_id));

\set ON_ERROR_STOP on

begin transaction isolation level repeatable read read only;

select exists(
  select 1
  from public.ap_inventory_members left_member
  join public.ap_inventory_members right_member
    on right_member.inventory_version_id=left_member.inventory_version_id
    and right_member.id>left_member.id
    and right_member.selected_by_deduplication
  join public.ap_job_snapshots left_job on left_job.id=left_member.job_snapshot_id
  join public.ap_job_snapshots right_job on right_job.id=right_member.job_snapshot_id
  where left_member.selected_by_deduplication and (
    left_member.stable_normalized_job_id=right_member.stable_normalized_job_id
    or (
      left_job.external_job_id is not null and right_job.external_job_id is not null
      and left_job.external_job_id=right_job.external_job_id
      and left_job.canonical_employer_domain is not distinct from right_job.canonical_employer_domain
    )
    or (
      array_remove(array[left_job.canonical_employer_listing_url,left_job.canonical_application_url],null)
      && array_remove(array[right_job.canonical_employer_listing_url,right_job.canonical_application_url],null)
    )
    or (
      (
        (left_job.external_job_id is null and left_job.canonical_employer_listing_url is null and left_job.canonical_application_url is null)
        or
        (right_job.external_job_id is null and right_job.canonical_employer_listing_url is null and right_job.canonical_application_url is null)
      )
      and left_job.normalized_fingerprint=right_job.normalized_fingerprint
    )
  )
) as has_conflicts
\gset

\if :has_conflicts
  rollback;
  \echo INVENTORY_IDENTITY_PREFLIGHT_CONFLICT
  select 1/0;
\else
  commit;
  \echo INVENTORY_IDENTITY_PREFLIGHT_CLEAN
\endif

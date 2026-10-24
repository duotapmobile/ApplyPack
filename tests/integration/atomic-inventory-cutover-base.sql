insert into public.ap_job_snapshots(
  id,origin,discovery_source,external_job_id,canonical_application_url,application_host_type,
  canonical_employer_listing_url,source_url,company,exact_title,normalized_fingerprint,
  captured_listing,retrieved_at,posted_on,posted_date_unknown,live_verified_at,
  location_and_work_mode,parser_version,content_sha256,source_authorization_id,first_seen_at,
  canonical_employer_domain,employer_identity_result,application_path_result,
  listing_activity_result,legitimacy_result,requirement_completeness,compensation_completeness,
  canonicalization_version,legacy_compatibility,material_source_qualities
)
select
  'f7000000-0000-4000-8000-000000000001','APPLYPACK_FOUND','manual-reviewed','RACE-REQ-A',
  'https://identity-cutover.example/apply/shared','EMPLOYER_HOSTED',
  'https://identity-cutover.example/jobs/a','https://identity-cutover.example/jobs/a',
  'Identity Cutover Employer','Inventory A',repeat('4',64),
  '{"text":"Current permitted inventory A."}',clock_timestamp(),current_date,false,clock_timestamp(),
  '{"mode":"REMOTE"}','listing-requirements-v3',repeat('5',64),source_authorization.id,clock_timestamp(),
  'identity-cutover.example','PASS','PASS','PASS','PASS',100,100,'applypack-c14n-v1',false,array[0.8]::numeric[]
from public.ap_source_authorizations source_authorization
where source_authorization.source_id='manual-reviewed' and source_authorization.state='AUTHORIZED_MANUAL_ONLY'
order by source_authorization.created_at
limit 1;

insert into public.ap_inventory_members(
  id,inventory_version_id,job_snapshot_id,stable_normalized_job_id,selected_by_deduplication
) values(
  'f7010000-0000-4000-8000-000000000001','f6300000-0000-4000-8000-000000000001',
  'f7000000-0000-4000-8000-000000000001','requisition|identity-cutover.example|RACE-REQ-A',true
);

select 'ATOMIC_INVENTORY_CUTOVER_BASE_OK' as case;

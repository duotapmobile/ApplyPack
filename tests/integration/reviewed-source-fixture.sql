-- Included inside the calling fixture's rollback-only transaction. These .example
-- permissions are synthetic test evidence, never production source authorization.
insert into public.employers(id,display_name,source_category)
values('fixture-reviewed-employer','Synthetic reviewed source fixture','core_direct_employer');
insert into public.job_sources(id,canonical_employer_id,source_name,source_category,official_url,
 adapter_kind,automation_status,is_official,is_direct_employer,is_active,paid_display_permission_status)
values('manual-reviewed','fixture-reviewed-employer','Synthetic rollback-only manual fixture','core_direct_employer',
 'https://chunk5-employer.example','official_link_only','official_link_only',true,true,true,'documented_paid_display_authorized')
on conflict(id) do update set canonical_employer_id=excluded.canonical_employer_id,is_active=true,
 paid_display_permission_status=excluded.paid_display_permission_status;
insert into public.ap_source_authorizations(source_id,source_display_name,state,access_method,evidence_reference,
 allowed_hosts,allowed_actions,verified_by_role,verified_at,authorization_version,content_sha256)
values('manual-reviewed','Synthetic rollback-only manual fixture','AUTHORIZED_MANUAL_ONLY','MANUAL',
 'tests/integration/reviewed-source-fixture.sql: synthetic authorization, transaction rolled back',
 array['chunk5-employer.example','employer1.example','employer2.example','employer3.example','employer4.example',
 'employer5.example','employer6.example','employer7.example','employer8.example','employer9.example','employer10.example'],
 array['MANUAL_REVIEW'],'operator',clock_timestamp(),'zz-chunk-fixture',repeat('a',64));

create function pg_temp.verify_fixture_snapshot(snapshot jsonb,actor uuid) returns uuid
language plpgsql as $$
declare payload jsonb; posting jsonb; review jsonb; nodes jsonb; authority uuid; revision bigint;
 body text:='Current reviewed operations role with an employer-hosted application path.';
begin
 select id into authority from public.ap_source_authorizations
 where source_id='manual-reviewed' and authorization_version='zz-chunk-fixture';
 select h.revision into revision from public.ap_source_authorization_heads h where h.source_id='manual-reviewed';
 if not exists(select 1 from public.ap_source_authorization_heads where source_id='manual-reviewed' and current_authorization_id=authority) then
   perform public.ap_set_source_authorization_head('manual-reviewed',authority,coalesce(revision,0),actor);
 end if;
 update public.jobs set source_id='manual-reviewed',canonical_employer_id='fixture-reviewed-employer',
  source_name='Synthetic rollback-only manual fixture',source_category='core_direct_employer',
  is_official_source=true,is_direct_employer_source=true,raw_title=title,normalized_title=lower(title),
  description=body,content_hash=snapshot->>'content_sha256',deduplication_key=snapshot->>'normalized_fingerprint',
  last_observed_at=transaction_timestamp()-interval '1 minute'
 where id=(snapshot->>'legacy_job_id')::uuid;
 select to_jsonb(j) into payload from public.jobs j where id=(snapshot->>'legacy_job_id')::uuid;
 posting:=jsonb_build_object('title',payload->>'raw_title','externalJobId',payload->>'external_job_id',
  'sourceJobUrl',payload->>'source_job_url','description',body);
 review:=jsonb_build_object('method','HUMAN_DIRECT_OFFICIAL_REVIEW','checkedAt',transaction_timestamp(),
  'officialListingUrl',payload->>'source_job_url','officialApplicationUrl',payload->>'official_application_url',
  'capturedText',body,'captureSha256',encode(extensions.digest(convert_to(body,'UTF8'),'sha256'),'hex'),
  'evidenceNotes','Synthetic operator checked the explicit fixture listing and employer application path.',
  'transitionReason','Explicit synthetic source review inside a rollback-only integration fixture.',
  'employerIdentityConfirmed',true,'applicationPathConfirmed',true,'listingActiveConfirmed',true,'legitimacyConfirmed',true);
 snapshot:=snapshot||jsonb_build_object('captured_listing',jsonb_build_object('text',body),
  'location_and_work_mode',(snapshot->>'location_and_work_mode')::jsonb);
 nodes:=jsonb_build_array(jsonb_build_object('id',case when snapshot->>'id' like 'b4100000-%'
  then replace(snapshot->>'id','b4100000-','b4300000-')::uuid else gen_random_uuid() end,'position',0,'node_kind','ALL_OF',
  'classification_method','fixture-human-reviewed','human_correction_history','[]'::jsonb));
 return public.ap_verify_manual_source_observation(gen_random_uuid(),actor,'manual-reviewed',posting,review,
  'requisition|fixture-reviewed-employer|'||(payload->>'external_job_id'),snapshot,nodes,payload);
end $$;

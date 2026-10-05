begin;

create function pg_temp.assert_true(value boolean,failure_message text)
returns void language plpgsql as $$ begin if value is not true then raise exception '%',failure_message; end if; end $$;

select pg_temp.assert_true(exists(
  select 1 from public.ap_migration_checkpoints
  where migration_id='202610030071' and checkpoint='CUSTOMER_SOURCE_UPLOAD_CLEANUP_INTENTS'
),'customer source cleanup checkpoint missing');

insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('17000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','source-cleanup@example.invalid','',now(),'{}','{}',now(),now());

select * from public.ap_create_anonymous_draft(
  '27000000-0000-4000-8000-000000000001',repeat('a',64),now()+interval '1 day');
insert into public.storage_cleanup_queue(bucket,storage_path,reason,not_before)
values('customer-source-documents',
  'anonymous/27000000-0000-4000-8000-000000000001/resume/37000000-0000-4000-8000-000000000001.pdf',
  'anonymous_source_upload_intent',now()+interval '1 hour');
select * from public.ap_register_anonymous_document(
  '27000000-0000-4000-8000-000000000001',repeat('a',64),1,
  '37000000-0000-4000-8000-000000000001','RESUME','resume.pdf',
  'anonymous/27000000-0000-4000-8000-000000000001/resume/37000000-0000-4000-8000-000000000001.pdf',
  128,'application/pdf','application/pdf',repeat('1',64));
select pg_temp.assert_true(not exists(select 1 from public.storage_cleanup_queue
  where storage_path='anonymous/27000000-0000-4000-8000-000000000001/resume/37000000-0000-4000-8000-000000000001.pdf'),
  'anonymous registration did not clear cleanup intent');

insert into public.storage_cleanup_queue(bucket,storage_path,reason,not_before)
values('customer-source-documents',
  'anonymous/27000000-0000-4000-8000-000000000001/resume/37000000-0000-4000-8000-000000000099.pdf',
  'anonymous_source_upload_intent',now()+interval '1 hour');
do $$ begin
  perform public.ap_register_anonymous_document(
    '27000000-0000-4000-8000-000000000001',repeat('a',64),2,
    '37000000-0000-4000-8000-000000000002','RESUME','resume.pdf',
    'anonymous/27000000-0000-4000-8000-000000000001/resume/37000000-0000-4000-8000-000000000099.pdf',
    128,'application/pdf','application/pdf',repeat('2',64));
  raise exception 'mismatched anonymous cleanup path accepted';
exception when others then
  if sqlerrm<>'anonymous_source_upload_cleanup_path_invalid' then raise; end if;
end $$;
select pg_temp.assert_true(not exists(select 1 from public.ap_document_versions
  where id='37000000-0000-4000-8000-000000000002'),
  'invalid anonymous registration was not rolled back');
delete from public.storage_cleanup_queue where storage_path like 'anonymous/27000000-0000-4000-8000-000000000001/%';

insert into public.intake_drafts(id,customer_id,email)
values('47000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000001',
  'source-cleanup@example.invalid');
insert into public.storage_cleanup_queue(bucket,storage_path,reason,not_before)
values('customer-source-documents',
  '17000000-0000-4000-8000-000000000001/drafts/47000000-0000-4000-8000-000000000001/resume-57000000-0000-4000-8000-000000000001.pdf',
  'draft_source_upload_intent',now()+interval '1 hour');
select public.ap_register_intake_draft_document(
  '47000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000001','resume',
  jsonb_build_object(
    'path','17000000-0000-4000-8000-000000000001/drafts/47000000-0000-4000-8000-000000000001/resume-57000000-0000-4000-8000-000000000001.pdf',
    'name','resume.pdf','size',512,'mimeType','application/pdf','sha256',repeat('3',64),
    'scanStatus','clean','scanProvider','document_validation','scanProviderReference','fixture',
    'scanErrorCode',null,'scannedAt',now()::text));
select pg_temp.assert_true(not exists(select 1 from public.storage_cleanup_queue
  where storage_path like '17000000-0000-4000-8000-000000000001/drafts/%'),
  'draft registration did not clear cleanup intent');
select pg_temp.assert_true((select resume_document->>'path' from public.intake_drafts
  where id='47000000-0000-4000-8000-000000000001') like '%57000000-0000-4000-8000-000000000001.pdf',
  'draft document was not registered atomically');
do $$ begin
  perform public.ap_register_intake_draft_document(
    '47000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000001','resume',
    jsonb_build_object(
      'path','17000000-0000-4000-8000-000000000001/drafts/47000000-0000-4000-8000-000000000001/resume-57000000-0000-4000-8000-000000000002.pdf',
      'name','resume.pdf','size',512,'mimeType','application/pdf','sha256',repeat('4',64),
      'scanStatus','clean'));
  raise exception 'draft registration without cleanup intent accepted';
exception when others then
  if sqlerrm<>'draft_source_upload_intent_missing' then raise; end if;
end $$;

insert into public.storage_cleanup_queue(bucket,storage_path,reason,not_before)
values('customer-source-documents',
  '17000000-0000-4000-8000-000000000001/intakes/67000000-0000-4000-8000-000000000001/source/resume-77000000-0000-4000-8000-000000000001.pdf',
  'intake_source_upload_intent',now()+interval '1 hour');
select public.create_completed_intake(
  '67000000-0000-4000-8000-000000000001','17000000-0000-4000-8000-000000000001',
  'source-cleanup@example.invalid','Source Cleanup',
  jsonb_build_object('direction','Operations','priorities','[]'::jsonb,'dealbreakers','None',
    'location_preference','Remote','schedule_preference','Weekdays','minimum_salary',null,
    'cover_letter_path',null,'experience_summary','Confirmed','notes',null,
    'resume_path','17000000-0000-4000-8000-000000000001/intakes/67000000-0000-4000-8000-000000000001/source/resume-77000000-0000-4000-8000-000000000001.pdf',
    'source_retention_due_at',(now()+interval '30 days')::text),
  '{"criteriaApproved":true}',
  jsonb_build_array(jsonb_build_object('document_kind','resume',
    'storage_path','17000000-0000-4000-8000-000000000001/intakes/67000000-0000-4000-8000-000000000001/source/resume-77000000-0000-4000-8000-000000000001.pdf',
    'size_bytes',512,'claimed_mime_type','application/pdf','verified_mime_type','application/pdf',
    'sha256',repeat('5',64),'scan_status','clean','scan_provider','document_validation',
    'scan_provider_reference','fixture','scan_error_code','','scan_attempts',1,'scanned_at',now()::text)),null);
select pg_temp.assert_true(not exists(select 1 from public.storage_cleanup_queue
  where storage_path like '%/intakes/67000000-0000-4000-8000-000000000001/%'),
  'completed intake did not clear cleanup intent transactionally');

insert into public.storage_cleanup_queue(bucket,storage_path,reason,not_before)
values('customer-source-documents',
  '17000000-0000-4000-8000-000000000001/intakes/67000000-0000-4000-8000-000000000099/source/resume-77000000-0000-4000-8000-000000000002.pdf',
  'intake_source_upload_intent',now()+interval '1 hour');
do $$ begin
  perform public.create_completed_intake(
    '67000000-0000-4000-8000-000000000002','17000000-0000-4000-8000-000000000001',
    'source-cleanup@example.invalid','Source Cleanup',
    jsonb_build_object('direction','Operations','priorities','[]'::jsonb,'dealbreakers','None',
      'location_preference','Remote','schedule_preference','Weekdays','minimum_salary',null,
      'cover_letter_path',null,'experience_summary','Confirmed','notes',null,
      'resume_path','17000000-0000-4000-8000-000000000001/intakes/67000000-0000-4000-8000-000000000099/source/resume-77000000-0000-4000-8000-000000000002.pdf',
      'source_retention_due_at',(now()+interval '30 days')::text),
    '{"criteriaApproved":true}',
    jsonb_build_array(jsonb_build_object('document_kind','resume',
      'storage_path','17000000-0000-4000-8000-000000000001/intakes/67000000-0000-4000-8000-000000000099/source/resume-77000000-0000-4000-8000-000000000002.pdf',
      'size_bytes',512,'claimed_mime_type','application/pdf','verified_mime_type','application/pdf',
      'sha256',repeat('6',64),'scan_status','clean','scan_provider','document_validation',
      'scan_provider_reference','fixture','scan_error_code','','scan_attempts',1,'scanned_at',now()::text)),null);
  raise exception 'cross-intake cleanup path accepted';
exception when others then
  if sqlerrm<>'intake_source_upload_cleanup_path_invalid' then raise; end if;
end $$;
select pg_temp.assert_true(not exists(select 1 from public.intakes
  where id='67000000-0000-4000-8000-000000000002'),
  'invalid completed intake was not rolled back');

select pg_temp.assert_true(not has_function_privilege('authenticated',
  'public.ap_register_intake_draft_document(uuid,uuid,text,jsonb)','execute'),
  'draft document registration is customer executable');

rollback;

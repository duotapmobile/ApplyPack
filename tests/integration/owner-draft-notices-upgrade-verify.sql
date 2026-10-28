begin;
select owner_notice_fixture.assert_true(public.ap_owner_draft_notices_schema_installed(),'106 install predicate failed after retained105 upgrade');
do $$ declare r record; current_rows jsonb; missing integer; begin
 for r in select * from owner_notice_fixture.before_rows order by table_name loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from public.%I t',r.table_name) into current_rows;
  select count(*) into missing from (select value from jsonb_array_elements(r.rows) except all select value from jsonb_array_elements(current_rows)) lost;
  perform owner_notice_fixture.assert_true(missing=0,'106 changed preexisting rows in '||r.table_name);
 end loop;
end $$;
select owner_notice_fixture.assert_true((select count(*)=2 from public.ap_material_draft_owner_notices),'catch-up did not select exactly the two current actionable phases');
select owner_notice_fixture.assert_true(exists(select 1 from public.ap_material_draft_owner_notices n join owner_notice_fixture.state s on s.job_id=n.job_id where s.namespace='d106' and n.phase='SOURCE_READY' and n.draft_version_id=s.version_id),'current model source was not caught up');
select owner_notice_fixture.assert_true(exists(select 1 from public.ap_material_draft_owner_notices n join owner_notice_fixture.state s on s.job_id=n.job_id where s.namespace='e106' and n.phase='REVIEW_READY' and n.member_set_sha256=s.member_sha256),'current registered pair was not caught up');
select owner_notice_fixture.assert_true(not exists(select 1 from public.ap_material_draft_owner_notices n join owner_notice_fixture.state s on s.job_id=n.job_id where s.namespace='f106'),'owner-created source generated a redundant automatic notice');
select owner_notice_fixture.assert_true(public.ap_catch_up_owner_draft_notices()->>'queued'='0','catch-up replay duplicated events');
select owner_notice_fixture.assert_true((select count(*)=2 from public.ap_scheduled_jobs j join public.ap_material_draft_owner_notices n on n.message_id=j.reference_id where j.job_kind='OUTBOX_SEND'),'catch-up did not create durable schedules');
select owner_notice_fixture.assert_true(public.ap_archive_snapshot_schema_supported('202610270105') and public.ap_archive_snapshot_schema_supported('202610280106'),'upgrade lost historical105 restore support');
select owner_notice_fixture.assert_true(not exists(select 1 from public.ap_material_draft_runtime where enabled) and not exists(select 1 from public.ap_material_draft_permits),'upgrade enabled generation');
set constraints all immediate;
select 'OWNER_DRAFT_READY_NOTICES_106_UPGRADE_PRESERVED';
rollback;

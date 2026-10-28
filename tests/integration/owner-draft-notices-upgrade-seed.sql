-- This exact105 seed commits only in an isolated upgrade rehearsal.
begin;
do $$ begin if public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion'<>'202610270105' or to_regprocedure('public.ap_owner_draft_notices_schema_installed()') is not null then raise exception 'owner_notice_upgrade_requires_exact105'; end if; end $$;
\ir owner-draft-notices-fixture.sql
select owner_notice_fixture.seed('d106');
select owner_notice_fixture.seed('e106');
select owner_notice_fixture.to_review('e106');
select owner_notice_fixture.seed('f106');
-- An actual owner-created successor has no validated model attempt and must not
-- masquerade as an automatic SOURCE_READY notice during current-only catch-up.
do $$ declare s owner_notice_fixture.state; payload uuid; begin
 select * into s from owner_notice_fixture.state where namespace='f106';
 select id into payload from public.ap_sensitive_payloads where customer_id=s.customer_id and content_sha256=repeat('4',64);
 perform public.ap_revise_material_draft_source(s.version_id,repeat('2',64),payload,repeat('4',64),s.operator_id);
end $$;
create table owner_notice_fixture.before_rows(table_name text primary key,rows jsonb);
do $$ declare r record; captured jsonb; begin
 for r in select tablename from pg_tables where schemaname='public' and tablename not in('ap_migration_checkpoints','ap_archive_fence_relations','ap_archive_fence_function_contracts','ap_retention_private_tables') order by tablename loop
  execute format('select coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) from public.%I t',r.tablename) into captured;
  insert into owner_notice_fixture.before_rows values(r.tablename,captured);
 end loop;
end $$;
select owner_notice_fixture.assert_true(not exists(select 1 from public.ap_material_draft_runtime where enabled),'upgrade seed left generation runtime enabled');
select owner_notice_fixture.assert_true(not exists(select 1 from public.ap_material_draft_permits),'upgrade seed left a generation permit');
select 'OWNER_DRAFT_READY_NOTICES_105_SEEDED';
commit;

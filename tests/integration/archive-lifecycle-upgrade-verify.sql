-- 098 adds default-disabled archive controls without rewriting prior records.
do $$ declare item record; digest text; begin
 if (select max(version) from supabase_migrations.schema_migrations)<>'202610250098'
  or public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion'<>'202610250098'
  or not public.ap_protected_archive_schema_installed()
  or not exists(select 1 from public.ap_archive_lifecycle_configuration where singleton and not enabled)
  or not exists(select 1 from public.ap_material_draft_runtime where singleton and not enabled and policy_id is null)
  or not exists(select 1 from public.ap_checkout_mode_configuration where singleton and mode='LOCKED')
  or exists(select 1 from public.ap_archive_writer_runs)
  or exists(select 1 from public.ap_archive_retention_runs)
  or exists(select 1 from public.ap_archive_retention_versions)
 then raise exception 'archive_upgrade_exact_inactive_098_required'; end if;
 for item in select * from public.archive_098_upgrade_preservation_fixture loop
  if item.kind='table' then
   execute format('select encode(extensions.digest(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb)::text,''sha256''),''hex'') from public.%I t',item.identity) into digest;
  else select encode(extensions.digest(pg_get_functiondef(item.identity::regprocedure),'sha256'),'hex') into digest; end if;
  if digest is distinct from item.body_sha256 then raise exception 'archive_upgrade_modified_existing_%_%',item.kind,item.identity; end if;
 end loop;
 if (select count(*) from public.archive_098_upgrade_preservation_fixture where kind='function')<>5
  or not exists(select 1 from public.ap_payment_attempts where provider_payment_id='pi_fictional_archive_upgrade_097' and settlement='PAID' and amount_cents=799)
  or not exists(select 1 from public.operational_heartbeats where task_name='protected_recovery_retention' and last_succeeded_at='2026-10-01T12:00:00Z' and summary='{"historicalFixture":true}')
 then raise exception 'archive_upgrade_preservation_evidence_incomplete'; end if;
end $$;
drop table public.archive_098_upgrade_preservation_fixture;
select 'ARCHIVE_LIFECYCLE_098_UPGRADE_PRESERVED';

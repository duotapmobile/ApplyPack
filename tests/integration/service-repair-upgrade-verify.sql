-- Repairs add their own ledger; original financial/private history is retained.
do $$ declare item record; digest text; preserved boolean; begin
 if (select max(version) from supabase_migrations.schema_migrations)<>'202610250099'
  or public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion'<>'202610250099'
  or not public.ap_service_repair_schema_installed()
  or not public.ap_protected_archive_schema_installed()
  or not exists(select 1 from public.ap_material_draft_runtime where singleton and not enabled and policy_id is null)
  or not exists(select 1 from public.ap_archive_lifecycle_configuration where singleton and not enabled)
  or not exists(select 1 from public.ap_checkout_mode_configuration where singleton and mode='LOCKED')
  or exists(select 1 from public.ap_service_repair_jobs) or exists(select 1 from public.ap_service_repair_versions)
  or exists(select 1 from public.ap_service_repair_files) or exists(select 1 from public.ap_service_repair_releases)
  or exists(select 1 from public.ap_service_repair_case_events) or exists(select 1 from public.ap_service_repair_feedback)
 then raise exception 'repair_upgrade_exact_locked_099_required'; end if;
 for item in select * from public.repair_099_upgrade_preservation_fixture loop
  if item.kind='table' then
   execute format('select encode(extensions.digest(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb)::text,''sha256''),''hex'') from public.%I t',item.identity) into digest;
  elsif item.kind='row' then
   execute format('select exists(select 1 from public.%I t where encode(extensions.digest(to_jsonb(t)::text,''sha256''),''hex'')=$1)',item.identity) into preserved using item.body_sha256;
   if not preserved then raise exception 'repair_upgrade_rewrote_existing_registry_row_%',item.identity; end if;
   continue;
  else select encode(extensions.digest(pg_get_functiondef(item.identity::regprocedure),'sha256'),'hex') into digest; end if;
  if digest is distinct from item.body_sha256 then raise exception 'repair_upgrade_modified_existing_%_%',item.kind,item.identity; end if;
 end loop;
 if (select count(*) from public.repair_099_upgrade_preservation_fixture where kind='function')<>7
  or not exists(select 1 from public.ap_payment_attempts where provider_payment_id='pi_fictional_repair_upgrade_098' and settlement='PAID' and amount_cents=799)
 then raise exception 'repair_upgrade_preservation_evidence_incomplete'; end if;
end $$;
drop table public.repair_099_upgrade_preservation_fixture;
select 'SERVICE_REPAIR_099_UPGRADE_PRESERVED';

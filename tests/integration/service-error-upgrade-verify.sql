--096 installs reporting and review; previous receipts and remedies are unchanged.
do $$ declare item record; digest text; begin
 if (select max(version) from supabase_migrations.schema_migrations)<>'202610250096'
  or public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion'<>'202610250096'
  or not public.ap_service_error_triage_schema_installed()
  or not exists(select 1 from public.ap_material_draft_runtime where singleton and not enabled and policy_id is null)
  or not exists(select 1 from public.ap_checkout_mode_configuration where singleton and mode='LOCKED')
  or exists(select 1 from public.ap_service_error_contracts)
 then raise exception 'service_error_upgrade_exact_inactive_096_required'; end if;
 for item in select * from public.service_error_096_upgrade_preservation_fixture loop
  if item.kind='table' then
   if item.identity='ap_retention_private_tables' then
    select encode(extensions.digest(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)::text,'sha256'),'hex') into digest
    from public.ap_retention_private_tables t where table_name not in('ap_service_error_contracts','ap_service_error_reports','ap_service_error_decisions','ap_service_error_affected_members');
   else
    execute format('select encode(extensions.digest(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb)::text,''sha256''),''hex'') from public.%I t',item.identity) into digest;
   end if;
  else
   select encode(extensions.digest(pg_get_functiondef(item.identity::regprocedure),'sha256'),'hex') into digest;
  end if;
  if digest is distinct from item.body_sha256 then raise exception 'service_error_upgrade_modified_existing_%_%',item.kind,item.identity; end if;
 end loop;
 if (select count(*) from public.service_error_096_upgrade_preservation_fixture where kind='function')<>5
  or not exists(select 1 from public.ap_payment_attempts where provider_payment_id='pi_fictional_service_error_upgrade_095' and settlement='PAID' and amount_cents=799)
 then raise exception 'service_error_upgrade_preservation_evidence_incomplete'; end if;
end $$;
drop table public.service_error_096_upgrade_preservation_fixture;
select 'SERVICE_ERROR_096_UPGRADE_PRESERVED';

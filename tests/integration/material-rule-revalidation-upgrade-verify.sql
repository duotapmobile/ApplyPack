-- No existing public records, document generator guards, timers or budgets may
-- change merely because rule-revalidation evidence support is installed.
do $$ declare item record; digest text; begin
 if (select max(version) from supabase_migrations.schema_migrations)<>'202610250092'
  or public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion'<>'202610250092'
  or not public.ap_material_rule_revalidation_schema_installed()
  or not exists(select 1 from public.ap_material_draft_runtime where singleton and not enabled and policy_id is null)
  or exists(select 1 from public.ap_material_rule_revalidations)
  or not exists(select 1 from public.ap_checkout_mode_configuration where singleton and mode='LOCKED')
 then raise exception 'rule_upgrade_exact_locked_092_required'; end if;
 for item in select * from public.rule_092_upgrade_preservation_fixture loop
  if item.kind='table' then
   execute format('select encode(extensions.digest(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb)::text,''sha256''),''hex'') from public.%I t%s',item.identity,
    case when item.identity='ap_retention_private_tables' then ' where table_name<>''ap_material_rule_revalidations''' else '' end) into digest;
  else
   select encode(extensions.digest(pg_get_functiondef(item.identity::regprocedure),'sha256'),'hex') into digest;
  end if;
  if digest is distinct from item.body_sha256 then raise exception 'rule_upgrade_modified_existing_%_%',item.kind,item.identity; end if;
 end loop;
 if (select count(*) from public.rule_092_upgrade_preservation_fixture where kind='function')<>3
  or not exists(select 1 from public.ap_payment_attempts where provider_payment_id='pi_fictional_rule_upgrade_091' and settlement='PAID' and amount_cents=799)
 then raise exception 'rule_upgrade_preservation_evidence_incomplete'; end if;
end $$;
drop table public.rule_092_upgrade_preservation_fixture;
select 'MATERIAL_RULE_092_UPGRADE_PRESERVED';

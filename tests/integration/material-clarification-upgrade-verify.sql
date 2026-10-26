do $$ declare item record; digest text; preserved boolean; begin
 if (select max(version) from supabase_migrations.schema_migrations)<>'202610250101'
  or public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion'<>'202610250101'
  or not (public.ap_manual_launch_schema_readiness()->>'ready')::boolean
  or jsonb_array_length(public.ap_manual_launch_schema_readiness()->'requiredMigrations')<>25
  or not public.ap_manual_launch_schema_readiness()->'requiredMigrations' @> '["202610250099","202610250100","202610250101"]'::jsonb
  or not public.ap_material_clarification_schema_installed()
  or not public.ap_automatic_research_schema_installed()
  or not public.ap_service_repair_schema_installed()
  or not exists(select 1 from public.ap_material_draft_runtime where singleton and not enabled and policy_id is null)
  or not exists(select 1 from public.ap_research_preparation_configuration where singleton and not enabled)
  or not exists(select 1 from public.ap_archive_lifecycle_configuration where singleton and not enabled)
  or not exists(select 1 from public.ap_checkout_mode_configuration where singleton and mode='LOCKED')
  or exists(select 1 from public.ap_intake_clarifications) or exists(select 1 from public.ap_intake_inherited_documents)
  or exists(select 1 from public.ap_intake_clarification_answers)
 then raise exception 'clarification_upgrade_exact_locked_101_required'; end if;
 for item in select * from public.clarification_101_upgrade_preservation_fixture loop
  if item.kind='table' then
   execute format('select encode(extensions.digest(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb)::text,''sha256''),''hex'') from public.%I t',item.identity) into digest;
  elsif item.kind='row' then
   execute format('select exists(select 1 from public.%I t where encode(extensions.digest(to_jsonb(t)::text,''sha256''),''hex'')=$1)',item.identity) into preserved using item.body_sha256;
   if not preserved then raise exception 'clarification_upgrade_rewrote_existing_registry_row_%',item.identity; end if;
   continue;
  else select encode(extensions.digest(pg_get_functiondef(item.identity::regprocedure),'sha256'),'hex') into digest; end if;
  if digest is distinct from item.body_sha256 then raise exception 'clarification_upgrade_modified_existing_%_%',item.kind,item.identity; end if;
 end loop;
 if (select count(*) from public.clarification_101_upgrade_preservation_fixture where kind='function')<>9
  or not exists(select 1 from public.ap_payment_attempts where provider_payment_id='pi_fictional_clarification_upgrade_100' and settlement='PAID' and amount_cents=799)
  or not exists(select 1 from public.ap_anonymous_drafts where id='a1030000-0000-4000-8000-000000000803' and version=2 and current_step=2 and state='IN_PROGRESS')
 then raise exception 'clarification_upgrade_preservation_evidence_incomplete'; end if;
end $$;
drop table public.clarification_101_upgrade_preservation_fixture;
select 'MATERIAL_CLARIFICATION_101_UPGRADE_PRESERVED';

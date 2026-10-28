--093 may add acceptance guards, never change prior records or enable work.
do $$ declare item record; digest text; begin
 if (select max(version) from supabase_migrations.schema_migrations)<>'202610250093'
  or public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion'<>'202610250093'
  or not public.ap_source_aware_document_schema_installed()
  or not exists(select 1 from public.ap_material_draft_runtime where singleton and not enabled and policy_id is null)
  or not exists(select 1 from public.ap_checkout_mode_configuration where singleton and mode='LOCKED')
 then raise exception 'source_aware_upgrade_exact_locked_093_required'; end if;
 for item in select * from public.source_093_upgrade_preservation_fixture loop
  if item.kind='table' then
   execute format('select encode(extensions.digest(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb)::text,''sha256''),''hex'') from public.%I t',item.identity) into digest;
  else
   select encode(extensions.digest(pg_get_functiondef(item.identity::regprocedure),'sha256'),'hex') into digest;
  end if;
  if digest is distinct from item.body_sha256 then raise exception 'source_aware_upgrade_modified_existing_%_%',item.kind,item.identity; end if;
 end loop;
 if (select count(*) from public.source_093_upgrade_preservation_fixture where kind='function')<>3
  or not exists(select 1 from public.ap_payment_attempts where provider_payment_id='pi_fictional_source_aware_upgrade_092' and settlement='PAID' and amount_cents=799)
 then raise exception 'source_aware_upgrade_preservation_evidence_incomplete'; end if;
end $$;
drop table public.source_093_upgrade_preservation_fixture;
select 'SOURCE_AWARE_093_UPGRADE_PRESERVED';

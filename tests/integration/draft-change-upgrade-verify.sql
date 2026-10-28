--097 wraps new-request dispatch without changing old rows or budget logic.
do $$ declare item record; digest text; begin
 if (select max(version) from supabase_migrations.schema_migrations)<>'202610250097'
  or public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion'<>'202610250097'
  or not public.ap_material_draft_change_schema_installed()
  or not exists(select 1 from public.ap_material_draft_runtime where singleton and not enabled and policy_id is null)
  or not exists(select 1 from public.ap_checkout_mode_configuration where singleton and mode='LOCKED')
  or exists(select 1 from public.ap_material_draft_change_requests)
 then raise exception 'draft_change_upgrade_exact_inactive_097_required'; end if;
 for item in select * from public.draft_change_097_upgrade_preservation_fixture loop
  if item.kind='table' then
   if item.identity='ap_retention_private_tables' then
    select encode(extensions.digest(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb)::text,'sha256'),'hex') into digest
    from public.ap_retention_private_tables t where table_name<>'ap_material_draft_change_requests';
   else
    execute format('select encode(extensions.digest(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb)::text,''sha256''),''hex'') from public.%I t',item.identity) into digest;
   end if;
  elsif item.kind='budget_body' then
   select encode(extensions.digest(p.prosrc,'sha256'),'hex') into digest from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='ap_begin_material_draft_request_before097';
  else
   select encode(extensions.digest(pg_get_functiondef(item.identity::regprocedure),'sha256'),'hex') into digest;
  end if;
  if digest is distinct from item.body_sha256 then raise exception 'draft_change_upgrade_modified_existing_%_%',item.kind,item.identity; end if;
 end loop;
 if (select count(*) from public.draft_change_097_upgrade_preservation_fixture where kind='function')<>4
  or (select count(*) from public.draft_change_097_upgrade_preservation_fixture where kind='budget_body')<>1
  or not exists(select 1 from public.ap_payment_attempts where provider_payment_id='pi_fictional_draft_change_upgrade_096' and settlement='PAID' and amount_cents=799)
 then raise exception 'draft_change_upgrade_preservation_evidence_incomplete'; end if;
end $$;
drop table public.draft_change_097_upgrade_preservation_fixture;
select 'DRAFT_CHANGE_097_UPGRADE_PRESERVED';

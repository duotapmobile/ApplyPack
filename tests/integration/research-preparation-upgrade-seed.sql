-- Exact099 predecessor. Fictional rows; complete existing table preservation.
do $$ begin
 if (select max(version) from supabase_migrations.schema_migrations)<>'202610250099'
  or public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion'<>'202610250099'
  or not public.ap_service_repair_schema_installed()
  or to_regclass('public.ap_research_preparations') is not null
 then raise exception 'research_upgrade_exact_099_required'; end if;
end $$;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values('a0000000-0000-4000-8000-000000000801','00000000-0000-0000-0000-000000000000','authenticated','authenticated','research-upgrade@example.invalid','',now(),'{}','{}',now(),now());
insert into public.ap_payment_attempts(id,customer_id,provider,provider_payment_id,amount_cents,currency,settlement,dispute,payment_verified_at,provider_payment_status,payment_method_type,immediate_charge_verified)
 values('a0000000-0000-4000-8000-000000000802','a0000000-0000-4000-8000-000000000801','stripe','pi_fictional_research_upgrade_099',799,'USD','PAID','NONE','2026-10-01T12:00:00Z','succeeded','card',true);
create table public.research_100_upgrade_preservation_fixture(kind text,identity text,body_sha256 text);
do $$ declare item record; digest text; row_value jsonb; begin
 for item in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in('r','p') and c.relname<>'research_100_upgrade_preservation_fixture' order by c.relname loop
  if item.relname in('ap_migration_checkpoints','ap_retention_private_tables','ap_archive_fence_relations','ap_archive_fence_function_contracts') then
   for row_value in execute format('select to_jsonb(t) from public.%I t',item.relname) loop
    insert into public.research_100_upgrade_preservation_fixture values('row',item.relname,encode(extensions.digest(row_value::text,'sha256'),'hex'));
   end loop;
  else
   execute format('select encode(extensions.digest(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb)::text,''sha256''),''hex'') from public.%I t',item.relname) into digest;
   insert into public.research_100_upgrade_preservation_fixture values('table',item.relname,digest);
  end if;
 end loop;
 insert into public.research_100_upgrade_preservation_fixture
 select 'function',p.oid::regprocedure::text,encode(extensions.digest(pg_get_functiondef(p.oid),'sha256'),'hex')
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and p.proname in('ap_claim_material_draft_stage','ap_request_material_draft_changes','ap_send_material_draft_pair','ap_apply_retention_restore_overlay',
    'ap_service_retention_order_protected','ap_begin_archive_writer','ap_dispatch_archive_retention_version');
end $$;
select 'AUTOMATIC_RESEARCH_100_UPGRADE_SEEDED';

-- Disposable local upgrade fixture only; executed at exact091 before092.
do $$ begin
 if (select max(version) from supabase_migrations.schema_migrations)<>'202610250091'
  or public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion'<>'202610250091'
  or to_regclass('public.ap_material_rule_revalidations') is not null
 then raise exception 'rule_upgrade_exact_091_required'; end if;
end $$;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
 raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('92000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','rule-upgrade@example.invalid','',now(),'{}','{}',now(),now());
insert into public.ap_payment_attempts(id,customer_id,provider,provider_payment_id,amount_cents,
 currency,settlement,dispute,payment_verified_at,provider_payment_status,payment_method_type,immediate_charge_verified)
values('92000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001',
 'stripe','pi_fictional_rule_upgrade_091',799,'USD','PAID','NONE','2026-10-01T12:00:00Z','succeeded','card',true);
create table public.rule_092_upgrade_preservation_fixture(kind text,identity text,body_sha256 text);
do $$ declare item record; digest text; begin
 for item in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in('r','p')
   and c.relname not in('ap_migration_checkpoints','rule_092_upgrade_preservation_fixture') order by c.relname
 loop
  execute format('select encode(extensions.digest(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb)::text,''sha256''),''hex'') from public.%I t',item.relname) into digest;
  insert into public.rule_092_upgrade_preservation_fixture values('table',item.relname,digest);
 end loop;
 insert into public.rule_092_upgrade_preservation_fixture
 select 'function',p.oid::regprocedure::text,encode(extensions.digest(pg_get_functiondef(p.oid),'sha256'),'hex')
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and p.proname in('ap_register_material_artifact_version','ap_assert_current_artifact_facts','ap_assert_supported_artifact_facts');
end $$;
select 'MATERIAL_RULE_092_UPGRADE_SEEDED';

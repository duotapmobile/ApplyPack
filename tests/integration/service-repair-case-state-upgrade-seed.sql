-- Exact101 predecessor with immutable paid history; local fictional data only.
do $$ begin
 if (select max(version) from supabase_migrations.schema_migrations)<>'202610250101'
  or public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion'<>'202610250101'
  or not (public.ap_manual_launch_schema_readiness()->>'ready')::boolean
  or jsonb_array_length(public.ap_manual_launch_schema_readiness()->'requiredMigrations')<>25
  or not public.ap_material_clarification_schema_installed()
  or to_regprocedure('public.ap_read_service_repair_case_review(uuid,uuid)') is not null
  or not has_function_privilege('service_role','public.ap_set_service_repair_case_state(uuid,uuid,text,boolean,uuid,text,uuid)','EXECUTE')
 then raise exception 'case_state_upgrade_exact_101_required'; end if;
end $$;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values('a1040000-0000-4000-8000-000000000801','00000000-0000-0000-0000-000000000000','authenticated','authenticated','case-state-upgrade@example.invalid','',now(),'{}','{}',now(),now());
insert into public.ap_payment_attempts(id,customer_id,provider,provider_payment_id,amount_cents,currency,settlement,dispute,payment_verified_at,provider_payment_status,payment_method_type,immediate_charge_verified)
 values('a1040000-0000-4000-8000-000000000802','a1040000-0000-4000-8000-000000000801','stripe','pi_fictional_case_state_upgrade_101',799,'USD','PAID','NONE','2026-10-01T12:00:00Z','succeeded','card',true);
create table public.case_state_102_upgrade_preservation_fixture(kind text,identity text,body_sha256 text);
do $$ declare item record; digest text; row_value jsonb; begin
 for item in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in('r','p') and c.relname<>'case_state_102_upgrade_preservation_fixture' order by c.relname loop
  if item.relname='ap_migration_checkpoints' then
   for row_value in execute format('select to_jsonb(t) from public.%I t',item.relname) loop
    insert into public.case_state_102_upgrade_preservation_fixture values('row',item.relname,encode(extensions.digest(row_value::text,'sha256'),'hex'));
   end loop;
  else
   execute format('select encode(extensions.digest(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb)::text,''sha256''),''hex'') from public.%I t',item.relname) into digest;
   insert into public.case_state_102_upgrade_preservation_fixture values('table',item.relname,digest);
  end if;
 end loop;
 insert into public.case_state_102_upgrade_preservation_fixture
 select 'function',p.oid::regprocedure::text,encode(extensions.digest(pg_get_functiondef(p.oid),'sha256'),'hex')
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and p.proname in('ap_set_service_repair_case_state','ap_record_service_repair_feedback','ap_open_service_repair','ap_send_service_repair',
   'ap_apply_retention_restore_overlay','ap_service_retention_order_protected','ap_begin_archive_writer','ap_dispatch_archive_retention_version','ap_lock_material_clarification');
end $$;
select 'SERVICE_REPAIR_CASE_STATE_102_UPGRADE_SEEDED';

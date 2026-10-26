-- Exact094 predecessor fixture; all records are fictional and local.
do $$ begin
 if (select max(version) from supabase_migrations.schema_migrations)<>'202610250094'
  or public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion'<>'202610250094'
  or not public.ap_material_draft_stage_claiming_schema_installed()
  or to_regprocedure('public.ap_material_draft_reference_evidence(uuid)') is not null
 then raise exception 'reference_draft_upgrade_exact_094_required'; end if;
end $$;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
 raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('95000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','reference-draft-upgrade@example.invalid','',now(),'{}','{}',now(),now());
insert into public.ap_payment_attempts(id,customer_id,provider,provider_payment_id,amount_cents,
 currency,settlement,dispute,payment_verified_at,provider_payment_status,payment_method_type,immediate_charge_verified)
values('95000000-0000-4000-8000-000000000002','95000000-0000-4000-8000-000000000001',
 'stripe','pi_fictional_reference_draft_upgrade_094',799,'USD','PAID','NONE','2026-10-01T12:00:00Z','succeeded','card',true);
create table public.reference_095_upgrade_preservation_fixture(kind text,identity text,body_sha256 text);
do $$ declare item record; digest text; begin
 for item in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in('r','p')
   and c.relname not in('ap_migration_checkpoints','reference_095_upgrade_preservation_fixture') order by c.relname loop
  execute format('select encode(extensions.digest(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb)::text,''sha256''),''hex'') from public.%I t',item.relname) into digest;
  insert into public.reference_095_upgrade_preservation_fixture values('table',item.relname,digest);
 end loop;
 insert into public.reference_095_upgrade_preservation_fixture
 select 'function',p.oid::regprocedure::text,encode(extensions.digest(pg_get_functiondef(p.oid),'sha256'),'hex')
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  and p.proname in('ap_claim_material_draft_jobs','ap_refresh_material_draft_packet','ap_begin_material_draft_request','ap_send_material_draft_pair','ap_apply_retention_restore_overlay');
end $$;
select 'REFERENCE_DRAFT_095_UPGRADE_SEEDED';

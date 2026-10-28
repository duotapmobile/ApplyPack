-- Verify the exact102 source and every pre-existing public row/function before
-- exercising103. Retain the fictional paid history and edited review afterward.
do $$ declare item record; digest text; preserved boolean; reply jsonb; q uuid; before_row jsonb; begin
 if (select max(version) from supabase_migrations.schema_migrations)<>'202610260103'
  or public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion'<>'202610260103'
  or not (public.ap_manual_launch_schema_readiness()->>'ready')::boolean
  or jsonb_array_length(public.ap_manual_launch_schema_readiness()->'requiredMigrations')<>27
  or not public.ap_material_clarification_resume_schema_installed()
  or not exists(select 1 from public.ap_checkout_mode_configuration where singleton and mode='LOCKED')
  or not exists(select 1 from public.ap_commerce_configuration where singleton and not checkout_enabled)
  or not exists(select 1 from public.ap_material_draft_runtime where singleton and not enabled and policy_id is null)
  or not exists(select 1 from public.ap_research_preparation_configuration where singleton and not enabled)
  or not exists(select 1 from public.ap_archive_lifecycle_configuration where singleton and not enabled)
 then raise exception 'clarification_resume_upgrade_exact_locked_103_required'; end if;
 for item in select * from public.clarification_resume_103_upgrade_preservation_fixture loop
  if item.kind='table' then
   if item.identity='ap_checkout_attempts' then
    if exists(select 1 from public.ap_checkout_attempts where claimed_customer_email is not null) then raise exception 'upgrade_backfilled_checkout_pin'; end if;
    select encode(extensions.digest(coalesce(jsonb_agg(to_jsonb(t)-'claimed_customer_email' order by (to_jsonb(t)-'claimed_customer_email')::text),'[]'::jsonb)::text,'sha256'),'hex') into digest from public.ap_checkout_attempts t;
   elsif item.identity='ap_outbox_messages' then
    if exists(select 1 from public.ap_outbox_messages where claimed_root_draft_id is not null or claimed_recipient_email is not null or claimed_delivery_envelope_sha256 is not null)
     then raise exception 'upgrade_backfilled_outbox_pin'; end if;
    select encode(extensions.digest(coalesce(jsonb_agg(to_jsonb(t)-ARRAY['claimed_root_draft_id','claimed_recipient_email','claimed_delivery_envelope_sha256']
     order by (to_jsonb(t)-ARRAY['claimed_root_draft_id','claimed_recipient_email','claimed_delivery_envelope_sha256'])::text),'[]'::jsonb)::text,'sha256'),'hex') into digest from public.ap_outbox_messages t;
   else execute format('select encode(extensions.digest(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),''[]''::jsonb)::text,''sha256''),''hex'') from public.%I t',item.identity) into digest; end if;
  elsif item.kind='row' then
   execute format('select exists(select 1 from public.%I t where encode(extensions.digest(to_jsonb(t)::text,''sha256''),''hex'')=$1)',item.identity) into preserved using item.body_sha256;
   if not preserved then raise exception 'clarification_resume_upgrade_rewrote_existing_checkpoint'; end if;
   continue;
  else select encode(extensions.digest(pg_get_functiondef(item.identity::regprocedure),'sha256'),'hex') into digest; end if;
  if digest is distinct from item.body_sha256 then raise exception 'clarification_resume_upgrade_modified_existing_%_%',item.kind,item.identity; end if;
 end loop;
 if not exists(select 1 from public.clarification_resume_103_upgrade_preservation_fixture where kind='function' and identity='ap_answer_material_clarification(uuid,uuid,text,uuid,text,uuid,text)')
  or not exists(select 1 from public.ap_payment_attempts where provider_payment_id='pi_fictional_clarification_resume_upgrade_102' and settlement='PAID' and amount_cents=799)
  then raise exception 'clarification_resume_upgrade_preservation_evidence_incomplete'; end if;
 select question_id into strict q from public.ap_intake_clarification_answers where draft_id='a1070000-0000-4000-8000-000000000005';
 select to_jsonb(d) into before_row from public.ap_anonymous_drafts d where id='a1070000-0000-4000-8000-000000000005';
 if before_row#>>'{answers,clarifications,0,answer}'<>'I answered customer calls and scheduled appointments.'
  or not exists(select 1 from public.ap_intake_clarification_answers where question_id=q and answer_sha256=encode(extensions.digest('I answered customer calls.','sha256'),'hex'))
  then raise exception 'clarification_resume_upgrade_edited_source_missing'; end if;
 reply:=public.ap_resume_material_clarification(q,'a1070000-0000-4000-8000-000000000002',repeat('c',64),null,'a1070000-0000-4000-8000-000000000005',repeat('d',64));
 if reply<>jsonb_build_object('state','FULL_REVIEW_REQUIRED','draftId',before_row->'id','version',before_row->'version','expiresAt',before_row->'expires_at','replayed',true)
  or not exists(select 1 from public.ap_anonymous_drafts d where id='a1070000-0000-4000-8000-000000000005' and to_jsonb(d)=before_row)
  then raise exception 'clarification_resume_upgrade_rewrote_working_review'; end if;
end $$;
drop table public.clarification_resume_103_upgrade_preservation_fixture;
select 'MATERIAL_CLARIFICATION_RESUME_103_UPGRADE_PRESERVED';

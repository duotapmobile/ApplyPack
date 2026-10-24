begin;

create or replace function pg_temp.assert_true(value boolean,message text) returns void
language plpgsql as $$ begin if value is distinct from true then raise exception '%',message; end if; end $$;

select pg_temp.assert_true(
  (select not materials_generation_approved
    and materials_generation_approval_reference is null
    and document_font_family is null
    and document_font_sha256 is null
    and document_font_manifest_sha256 is null
    and document_renderer_identity is null
    from public.ap_commerce_configuration where singleton),
  'open-font migration did not revoke inherited renderer approval'
);

do $$ begin
  update public.ap_commerce_configuration set document_font_family='Arial' where singleton;
  raise exception 'arial_generation_configuration_accepted';
exception when check_violation then null; end $$;

select pg_temp.assert_true(
  position('new.document_font_family:=''Liberation Sans'''
    in pg_get_functiondef('public.ap_stamp_document_safety_policy()'::regprocedure))>0,
  'document safety stamp does not force Liberation Sans'
);

select pg_temp.assert_true(
  exists(select 1 from public.ap_migration_checkpoints
    where migration_id='202610190081' and checkpoint='OPEN_FONT_DOCUMENT_CONTRACT')
  and public.ap_manual_launch_schema_readiness()->>'requiredSchemaVersion'=(case when to_regprocedure('public.ap_sandbox_activation_schema_installed()') is null then '202610220085' else '202610230086' end)
  and (public.ap_manual_launch_schema_readiness()->'requiredMigrations') ?& array['202610190081','202610190082','202610190083','202610190084'],
  'open-font migration is not part of launch schema readiness'
);

select pg_temp.assert_true(
  to_regclass('public.ap_applicant_document_format_requests') is not null
  and exists(select 1 from pg_trigger where tgrelid='public.ap_applicant_document_format_requests'::regclass
    and tgname='ap_applicant_document_format_requests_immutable' and tgenabled='O')
  and has_function_privilege('service_role',
    'public.ap_record_applicant_document_format_request(uuid,uuid,uuid,text,text)','EXECUTE')
  and not has_function_privilege('authenticated',
    'public.ap_record_applicant_document_format_request(uuid,uuid,uuid,text,text)','EXECUTE'),
  'immutable service-role applicant Word-request receipt is not enforced'
);

select pg_temp.assert_true(
  position('APPLICANT_REQUEST' in pg_get_functiondef('public.ap_guard_document_delivery_format_decision()'::regprocedure))>0
  and position('request_reference_sha256' in pg_get_functiondef('public.ap_guard_document_delivery_format_decision()'::regprocedure))>0
  and position('d89582771ff8dde19015f5aa3965810d656f93fcb08cee6280497e780de614bb'
    in pg_get_functiondef('public.ap_guard_document_delivery_format_decision()'::regprocedure))>0
  and position('698da70fc191cc5f33ad4d6d3fe830fe4624b898ea2e3169955928b7c491f1ee'
    in pg_get_functiondef('public.ap_guard_document_delivery_format_decision()'::regprocedure))>0
  and position('document_delivery_file_format_mismatch'
    in pg_get_functiondef('public.ap_guard_document_delivery_file_format()'::regprocedure))>0,
  'delivery-format request provenance or file-format enforcement is missing'
);

select pg_temp.assert_true(
  position('applypack-universal-document-standard-2026-10-19.1'
    in pg_get_functiondef('public.ap_assert_current_artifact_facts(uuid)'::regprocedure))>0
  and position('applypack-universal-document-standard-2026-10-03.1'
    in pg_get_functiondef('public.ap_assert_current_artifact_facts(uuid)'::regprocedure))=0
  and position('applypack-universal-document-standard-2026-10-19.1'
    in pg_get_functiondef('public.ap_assert_supported_artifact_facts(uuid)'::regprocedure))>0
  and position('applypack-universal-document-standard-2026-10-03.1'
    in pg_get_functiondef('public.ap_assert_supported_artifact_facts(uuid)'::regprocedure))>0,
  'current-versus-historical document contract split is incorrect'
);

rollback;
select 'OPEN_FONT_DOCUMENT_CONTRACT_OK';

begin;

-- The DOCX requests Arial. Rendering may resolve to the explicitly approved
-- Liberation Sans substitute on Linux, but the actual approved family and font
-- file hash remain bound to every quality review.
alter table public.ap_commerce_configuration
  drop constraint if exists ap_commerce_configuration_document_font_family_check;
alter table public.ap_commerce_configuration
  add constraint ap_commerce_configuration_document_font_family_check
  check (document_font_family is null or document_font_family in ('Arial','Liberation Sans'));

-- A changed content/template/export tuple must receive a fresh operator approval.
update public.ap_commerce_configuration
set materials_generation_approved=false,
    materials_generation_approval_reference=null;

create or replace function public.ap_stamp_document_safety_policy()
returns trigger language plpgsql set search_path='' as $$
declare config public.ap_commerce_configuration;
begin
  select * into config from public.ap_commerce_configuration where singleton;
  if new.document_safety_policy<>'NOT_SCANNED:generated-structural-v1'
    or not found
    or not config.materials_generation_approved
    or config.document_font_family not in ('Arial','Liberation Sans')
    or new.document_font_sha256 is distinct from config.document_font_sha256
    then raise exception 'explicit_document_safety_policy_required'; end if;
  new.document_safety_policy:='generated-structural-v1';
  new.document_font_family:=config.document_font_family;
  new.malware_verdict:='NOT_SCANNED';
  return new;
end $$;

do $$
declare definition text;
begin
  definition:=pg_get_functiondef('public.ap_assert_current_artifact_facts(uuid)'::regprocedure);
  if position('applypack-documents|content=applypack-content-2026-09-22.1|template=applypack-template-2026-09-22.1|exporter=libreoffice-tagged-pdf-2026-09-22.1' in definition)=0
    then raise exception 'document_generator_version_guard_anchor_missing'; end if;
  definition:=replace(definition,
    'applypack-documents|content=applypack-content-2026-09-22.1|template=applypack-template-2026-09-22.1|exporter=libreoffice-tagged-pdf-2026-09-22.1',
    'applypack-documents|content=applypack-content-2026-09-23.1|template=applypack-template-2026-09-23.1|exporter=libreoffice-tagged-pdf-2026-09-23.1');
  execute definition;

  select pg_get_functiondef(p.oid) into strict definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='ap_register_material_artifact_version';
  if position('config.document_font_family = ''Liberation Sans''' in definition)=0
    and position('config.document_font_family=''Liberation Sans''' in definition)=0
    then raise exception 'document_font_policy_guard_anchor_missing'; end if;
  definition:=replace(definition,
    'config.document_font_family = ''Liberation Sans''',
    'config.document_font_family in (''Arial'',''Liberation Sans'')');
  definition:=replace(definition,
    'config.document_font_family=''Liberation Sans''',
    'config.document_font_family in (''Arial'',''Liberation Sans'')');
  execute definition;
end $$;

commit;

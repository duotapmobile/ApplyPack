begin;

-- October 3 supersedes the prior fallback-font contract. Historical artifact
-- quality rows remain immutable; only new approvals and new renders use Arial.
update public.ap_commerce_configuration
set materials_generation_approved=false,
    materials_generation_approval_reference=null,
    document_font_family=null,
    document_font_sha256=null
where singleton;

alter table public.ap_commerce_configuration
  drop constraint if exists ap_commerce_configuration_document_font_family_check;
alter table public.ap_commerce_configuration
  add constraint ap_commerce_configuration_document_font_family_check
  check (document_font_family is null or document_font_family='Arial');

create or replace function public.ap_stamp_document_safety_policy() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.document_safety_policy='NOT_SCANNED:generated-structural-v1' then
    new.document_safety_policy:='generated-structural-v1';
    new.document_font_family:='Arial';
    new.malware_verdict:='NOT_SCANNED';
  else
    raise exception 'explicit_document_safety_policy_required';
  end if;
  return new;
end $$;
revoke all on function public.ap_stamp_document_safety_policy() from public,anon,authenticated;

-- Rolling deployments retain the stable RPC signatures. Update the embedded
-- policy constants without mutating any already-published migration.
do $$
declare fn record; definition text;
begin
  for fn in
    select p.oid
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f'
  loop
    definition:=pg_get_functiondef(fn.oid);
    if definition like '%document_font_family = ''Liberation Sans''%'
       or definition like '%document_font_family=''Liberation Sans''%'
       or definition like '%applypack-content-2026-09-22.1%' then
      definition:=replace(definition, 'document_font_family = ''Liberation Sans''', 'document_font_family = ''Arial''');
      definition:=replace(definition, 'document_font_family=''Liberation Sans''', 'document_font_family=''Arial''');
      definition:=replace(
        definition,
        'applypack-documents|content=applypack-content-2026-09-22.1|template=applypack-template-2026-09-22.1|exporter=libreoffice-tagged-pdf-2026-09-22.1',
        'applypack-documents|instructions=applypack-universal-document-standard-2026-10-03.1|standardSha256=1d85789d434c0252d1797e366cd732931756fd4baa74bc36045fdeb2547786cf|content=applypack-content-2026-10-03.1|template=applypack-template-2026-10-03.1|exporter=libreoffice-tagged-pdf-2026-10-03.1'
      );
      execute definition;
    end if;
  end loop;
end $$;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202610030066','LOCKED_DOCUMENT_GENERATION_STANDARD',0,clock_timestamp())
on conflict(migration_id,checkpoint) do update
set rows_processed=excluded.rows_processed,completed_at=excluded.completed_at;

commit;

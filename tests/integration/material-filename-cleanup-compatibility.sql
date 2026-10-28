begin;

create function pg_temp.assert_true(value boolean,failure_message text)
returns void language plpgsql as $$ begin if value is not true then raise exception '%',failure_message; end if; end $$;

select pg_temp.assert_true(exists(
  select 1 from public.ap_migration_checkpoints
  where migration_id='202610040072'
    and checkpoint='MATERIAL_DELIVERY_FILENAME_CLEANUP_COMPATIBILITY'
),'material delivery filename compatibility checkpoint missing');

create temp table material_cleanup_probe(
  customer_id uuid not null,
  material_line_id uuid not null,
  claim_provenance jsonb not null
);
create trigger material_cleanup_probe_clear
after insert on material_cleanup_probe
for each row execute function public.ap_clear_registered_editable_source_cleanup();

insert into public.storage_cleanup_queue(bucket,storage_path,reason)
values
  ('operator-drafts',
    '18000000-0000-4000-8000-000000000001/materials/28000000-0000-4000-8000-000000000001/38000000-0000-4000-8000-000000000001/editable-source/resume.docx',
    'material_sensitive_upload_intent'),
  ('operator-render-previews',
    '18000000-0000-4000-8000-000000000001/materials/28000000-0000-4000-8000-000000000001/38000000-0000-4000-8000-000000000001/render-preview.pdf',
    'material_sensitive_upload_intent'),
  ('customer-deliveries',
    '18000000-0000-4000-8000-000000000001/materials/28000000-0000-4000-8000-000000000001/38000000-0000-4000-8000-000000000001/render-preview.pdf',
    'material_sensitive_upload_intent');

insert into material_cleanup_probe(customer_id,material_line_id,claim_provenance)
values(
  '18000000-0000-4000-8000-000000000001',
  '28000000-0000-4000-8000-000000000001',
  jsonb_build_object(
    'editableSource',jsonb_build_object(
      'storageBucket','operator-drafts',
      'storagePath','18000000-0000-4000-8000-000000000001/materials/28000000-0000-4000-8000-000000000001/38000000-0000-4000-8000-000000000001/editable-source/resume.docx'),
    'uploadCleanup',jsonb_build_array(
      jsonb_build_object(
        'storageBucket','operator-drafts',
        'storagePath','18000000-0000-4000-8000-000000000001/materials/28000000-0000-4000-8000-000000000001/38000000-0000-4000-8000-000000000001/editable-source/resume.docx'),
      jsonb_build_object(
        'storageBucket','operator-render-previews',
        'storagePath','18000000-0000-4000-8000-000000000001/materials/28000000-0000-4000-8000-000000000001/38000000-0000-4000-8000-000000000001/render-preview.pdf'),
      jsonb_build_object(
        'storageBucket','customer-deliveries',
        'storagePath','18000000-0000-4000-8000-000000000001/materials/28000000-0000-4000-8000-000000000001/38000000-0000-4000-8000-000000000001/render-preview.pdf'))));

select pg_temp.assert_true(not exists(
  select 1 from public.storage_cleanup_queue
  where storage_path like '18000000-0000-4000-8000-000000000001/materials/%'
),'valid employer delivery filename did not clear all cleanup intents');

rollback;

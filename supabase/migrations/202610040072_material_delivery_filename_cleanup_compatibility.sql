begin;

-- A delivery object and its render preview live in different private buckets.
-- An employer may therefore legitimately require the delivery filename
-- render-preview.pdf without colliding with the canonical preview object.
create or replace function public.ap_clear_registered_editable_source_cleanup()
returns trigger language plpgsql security definer set search_path='' as $$
declare source jsonb; cleanup jsonb; upload jsonb; file_version_id text; base_path text;
begin
  source:=new.claim_provenance->'editableSource';
  if jsonb_typeof(source)='object' then
    delete from public.storage_cleanup_queue
    where bucket=source->>'storageBucket' and storage_path=source->>'storagePath';
  end if;
  cleanup:=new.claim_provenance->'uploadCleanup';
  if cleanup is not null then
    if jsonb_typeof(cleanup)<>'array' or jsonb_array_length(cleanup)<>3
      or (select count(distinct value->>'storageBucket') from jsonb_array_elements(cleanup))<>3
      then raise exception 'material_upload_cleanup_shape_invalid'; end if;
    select split_part(value->>'storagePath','/',4) into file_version_id
    from jsonb_array_elements(cleanup)
    where value->>'storageBucket'='operator-drafts';
    if file_version_id is null
      or file_version_id!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then raise exception 'material_upload_cleanup_path_invalid'; end if;
    base_path:=new.customer_id::text||'/materials/'||new.material_line_id::text||'/'||file_version_id;
    if exists(select 1 from jsonb_array_elements(cleanup) entry(value)
      where jsonb_typeof(value)<>'object' or
        case value->>'storageBucket'
          when 'operator-drafts' then value->>'storagePath' is distinct from source->>'storagePath'
            or value->>'storagePath' not like base_path||'/editable-source/%'
            or split_part(value->>'storagePath','/',7)<>''
          when 'operator-render-previews' then value->>'storagePath' is distinct from base_path||'/render-preview.pdf'
          when 'customer-deliveries' then value->>'storagePath' not like base_path||'/%'
            or split_part(value->>'storagePath','/',6)<>''
          else true
        end
    ) then raise exception 'material_upload_cleanup_path_invalid'; end if;
    for upload in select value from jsonb_array_elements(cleanup) loop
      delete from public.storage_cleanup_queue
      where bucket=upload->>'storageBucket' and storage_path=upload->>'storagePath';
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function public.ap_clear_registered_editable_source_cleanup()
from public,anon,authenticated,service_role;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202610040072','MATERIAL_DELIVERY_FILENAME_CLEANUP_COMPATIBILITY',0,clock_timestamp())
on conflict(migration_id,checkpoint) do update
set rows_processed=excluded.rows_processed,completed_at=excluded.completed_at;

commit;

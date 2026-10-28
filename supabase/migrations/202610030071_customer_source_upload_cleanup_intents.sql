begin;

-- Anonymous source uploads are placed in the cleanup queue before the storage
-- write. Registration clears the exact intent in the same transaction that
-- creates the durable document version.
create function public.ap_clear_registered_anonymous_source_cleanup()
returns trigger language plpgsql security definer set search_path='' as $$
declare expected_pattern text;
begin
  if new.storage_bucket='customer-source-documents'
    and exists(select 1 from public.storage_cleanup_queue
      where bucket='customer-source-documents' and storage_path=new.storage_path
        and reason='anonymous_source_upload_intent') then
    expected_pattern:='^anonymous/'||new.draft_id::text||'/'||lower(new.kind::text)||'/'||new.id::text||E'\\.(pdf|docx)$';
    if new.draft_id is null or new.storage_path!~expected_pattern then
      raise exception 'anonymous_source_upload_cleanup_path_invalid';
    end if;
    delete from public.storage_cleanup_queue
    where bucket='customer-source-documents' and storage_path=new.storage_path
      and reason='anonymous_source_upload_intent';
  end if;
  return new;
end;
$$;
create trigger ap_registered_anonymous_source_cleanup
after insert on public.ap_document_versions
for each row execute function public.ap_clear_registered_anonymous_source_cleanup();
revoke all on function public.ap_clear_registered_anonymous_source_cleanup()
from public,anon,authenticated,service_role;

-- The signed-in draft route calls this function after a successful storage
-- upload. The draft mutation and removal of its pre-upload cleanup intent are
-- one transaction, so maintenance can never race a registered current file.
create function public.ap_register_intake_draft_document(
  p_draft_id uuid,p_customer_id uuid,p_kind text,p_document jsonb
) returns text language plpgsql security definer set search_path='' as $$
declare draft public.intake_drafts; new_path text; expected_pattern text; prior_path text;
begin
  if p_kind not in ('resume','cover_letter') or jsonb_typeof(p_document)<>'object' then
    raise exception 'draft_source_document_invalid';
  end if;
  select * into draft from public.intake_drafts
  where id=p_draft_id and customer_id=p_customer_id for update;
  if not found then raise exception 'intake_draft_not_found'; end if;

  new_path:=p_document->>'path';
  expected_pattern:='^'||p_customer_id::text||'/drafts/'||p_draft_id::text||'/'||p_kind||
    '-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'||E'\\.(pdf|docx)$';
  if new_path is null or new_path!~expected_pattern
    or length(coalesce(p_document->>'name','')) not between 1 and 255
    or (p_document->>'size')::integer not between 1 and 10485760
    or p_document->>'mimeType' not in (
      'application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    or p_document->>'sha256'!~'^[0-9a-f]{64}$'
    or p_document->>'scanStatus' not in ('pending','clean','blocked','scan_error') then
    raise exception 'draft_source_document_invalid';
  end if;

  perform 1 from public.storage_cleanup_queue
  where bucket='customer-source-documents' and storage_path=new_path
    and reason='draft_source_upload_intent' for update;
  if not found then raise exception 'draft_source_upload_intent_missing'; end if;

  if p_kind='resume' then
    prior_path:=draft.resume_document->>'path';
    update public.intake_drafts set resume_document=p_document,updated_at=clock_timestamp(),
      expires_at=clock_timestamp()+interval '7 days' where id=p_draft_id;
  else
    prior_path:=draft.cover_letter_document->>'path';
    update public.intake_drafts set cover_letter_document=p_document,updated_at=clock_timestamp(),
      expires_at=clock_timestamp()+interval '7 days' where id=p_draft_id;
  end if;
  delete from public.storage_cleanup_queue
  where bucket='customer-source-documents' and storage_path=new_path
    and reason='draft_source_upload_intent';
  return prior_path;
end;
$$;
revoke all on function public.ap_register_intake_draft_document(uuid,uuid,text,jsonb)
from public,anon,authenticated,service_role;
grant execute on function public.ap_register_intake_draft_document(uuid,uuid,text,jsonb) to service_role;

-- Fresh authenticated intake uploads use an intake-scoped path. The existing
-- create_completed_intake transaction inserts source_documents; this trigger
-- clears only an exact matching pre-upload intent during that same commit.
create function public.ap_clear_registered_intake_source_cleanup()
returns trigger language plpgsql security definer set search_path='' as $$
declare expected_kind text; expected_pattern text;
begin
  if exists(select 1 from public.storage_cleanup_queue
    where bucket='customer-source-documents' and storage_path=new.storage_path
      and reason='intake_source_upload_intent') then
    expected_kind:=case new.document_kind when 'resume' then 'resume' else 'cover-letter' end;
    expected_pattern:='^'||new.customer_id::text||'/intakes/'||new.intake_id::text||'/source/'||
      expected_kind||'-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'||E'\\.(pdf|docx)$';
    if new.storage_path!~expected_pattern then
      raise exception 'intake_source_upload_cleanup_path_invalid';
    end if;
    delete from public.storage_cleanup_queue
    where bucket='customer-source-documents' and storage_path=new.storage_path
      and reason='intake_source_upload_intent';
  end if;
  return new;
end;
$$;
create trigger ap_registered_intake_source_cleanup
after insert on public.source_documents
for each row execute function public.ap_clear_registered_intake_source_cleanup();
revoke all on function public.ap_clear_registered_intake_source_cleanup()
from public,anon,authenticated,service_role;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202610030071','CUSTOMER_SOURCE_UPLOAD_CLEANUP_INTENTS',0,clock_timestamp())
on conflict(migration_id,checkpoint) do update
set rows_processed=excluded.rows_processed,completed_at=excluded.completed_at;

commit;

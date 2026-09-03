create or replace function public.create_completed_intake(
  p_intake_id uuid,
  p_customer_id uuid,
  p_email text,
  p_display_name text,
  p_intake jsonb,
  p_answers jsonb,
  p_documents jsonb,
  p_draft_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  document_row jsonb;
  aggregate_status text;
  resume_count integer;
begin
  if not exists(
    select 1 from public.profiles
    where id = p_customer_id and lower(email) = lower(trim(p_email))
  ) then raise exception 'authenticated profile mismatch'; end if;
  if length(trim(coalesce(p_display_name, ''))) < 2 then raise exception 'display name required'; end if;
  if jsonb_typeof(p_answers) <> 'object' then raise exception 'intake answers required'; end if;
  if jsonb_typeof(p_documents) <> 'array' or jsonb_array_length(p_documents) not between 1 and 2 then
    raise exception 'one or two source documents required';
  end if;
  select count(*) into resume_count from jsonb_array_elements(p_documents) value
    where value ->> 'document_kind' = 'resume';
  if resume_count <> 1 then raise exception 'exactly one resume required'; end if;

  update public.profiles set display_name = trim(p_display_name), updated_at = now()
    where id = p_customer_id;
  insert into public.intakes(
    id, customer_id, email, direction, priorities, dealbreakers,
    location_preference, schedule_preference, minimum_salary,
    cover_letter_path, experience_summary, notes, resume_path,
    status, source_retention_due_at, criteria_version, criteria_approved_at
  ) values (
    p_intake_id,
    p_customer_id,
    lower(trim(p_email)),
    p_intake ->> 'direction',
    coalesce(p_intake -> 'priorities', '[]'::jsonb),
    p_intake ->> 'dealbreakers',
    p_intake ->> 'location_preference',
    p_intake ->> 'schedule_preference',
    nullif(p_intake ->> 'minimum_salary', ''),
    nullif(p_intake ->> 'cover_letter_path', ''),
    p_intake ->> 'experience_summary',
    nullif(p_intake ->> 'notes', ''),
    p_intake ->> 'resume_path',
    'draft',
    (p_intake ->> 'source_retention_due_at')::timestamptz,
    1,
    now()
  );
  insert into public.intake_answers(intake_id, customer_id, answers)
    values (p_intake_id, p_customer_id, p_answers);
  insert into public.criteria_versions(intake_id, version, approved_by, snapshot)
    values (p_intake_id, 1, p_customer_id, p_answers);

  for document_row in select value from jsonb_array_elements(p_documents) value loop
    if document_row ->> 'document_kind' not in ('resume','cover_letter')
       or (document_row ->> 'storage_path') not like p_customer_id::text || '/%'
       or (document_row ->> 'verified_mime_type') not in (
         'application/pdf',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
       )
       or (document_row ->> 'sha256') !~ '^[0-9a-f]{64}$'
       or (document_row ->> 'scan_status') not in ('pending','clean','blocked','scan_error') then
      raise exception 'invalid source document record';
    end if;
    insert into public.source_documents(
      intake_id, customer_id, document_kind, storage_path, size_bytes,
      claimed_mime_type, verified_mime_type, sha256, scan_status,
      scan_provider, scan_provider_reference, scan_error_code,
      scan_attempts, scanned_at
    ) values (
      p_intake_id,
      p_customer_id,
      document_row ->> 'document_kind',
      document_row ->> 'storage_path',
      (document_row ->> 'size_bytes')::integer,
      document_row ->> 'claimed_mime_type',
      document_row ->> 'verified_mime_type',
      document_row ->> 'sha256',
      document_row ->> 'scan_status',
      nullif(document_row ->> 'scan_provider', ''),
      nullif(document_row ->> 'scan_provider_reference', ''),
      nullif(document_row ->> 'scan_error_code', ''),
      (document_row ->> 'scan_attempts')::integer,
      nullif(document_row ->> 'scanned_at', '')::timestamptz
    );
  end loop;

  aggregate_status := public.refresh_intake_scan_status(p_intake_id);
  if p_draft_id is not null then
    delete from public.intake_drafts where id = p_draft_id and customer_id = p_customer_id;
    if not found then raise exception 'saved draft changed during completion'; end if;
  end if;
  return aggregate_status;
end;
$$;

revoke all on function public.create_completed_intake(uuid, uuid, text, text, jsonb, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.create_completed_intake(uuid, uuid, text, text, jsonb, jsonb, jsonb, uuid) to service_role;

alter table public.apply_pack_items
  add column resume_pdf_path text,
  add column cover_letter_pdf_path text;

alter table public.apply_pack_delivery_revisions
  add column resume_pdf_path text,
  add column cover_letter_pdf_path text;

comment on column public.apply_pack_items.resume_path is 'Current reviewed editable Word resume storage path.';
comment on column public.apply_pack_items.cover_letter_path is 'Current reviewed editable Word cover-letter storage path.';
comment on column public.apply_pack_items.resume_pdf_path is 'Current reviewed PDF resume storage path; nullable for historical Word-only deliveries.';
comment on column public.apply_pack_items.cover_letter_pdf_path is 'Current reviewed PDF cover-letter storage path; nullable for historical Word-only deliveries.';

create function public.complete_apply_pack_item_delivery(
  p_item_id uuid,
  p_actor_id uuid,
  p_resume_path text,
  p_resume_pdf_path text,
  p_cover_letter_path text,
  p_cover_letter_pdf_path text,
  p_review_checklist jsonb,
  p_delivered_at timestamptz
)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare
  item_row public.apply_pack_items%rowtype;
  order_row public.orders%rowtype;
begin
  if not exists(select 1 from public.profiles where id = p_actor_id and role in ('operator','admin')) then
    raise exception 'authorized operator required';
  end if;
  if not coalesce(p_review_checklist @> '{
    "factsVerified": true,
    "jobTargetConfirmed": true,
    "noInventedClaims": true,
    "resumeReviewed": true,
    "coverLetterReviewed": true,
    "humanReleaseApproved": true
  }'::jsonb, false) then
    raise exception 'human review checklist incomplete';
  end if;
  if length(trim(coalesce(p_review_checklist ->> 'reviewerNote', ''))) < 20 then
    raise exception 'human review note required';
  end if;
  if p_resume_path is null or p_resume_pdf_path is null or p_cover_letter_path is null or p_cover_letter_pdf_path is null then
    raise exception 'Word and PDF delivery paths required';
  end if;

  select * into item_row from public.apply_pack_items where id = p_item_id for update;
  if not found or item_row.status <> 'delivery_processing' then raise exception 'item is not claimed for delivery'; end if;
  select * into order_row from public.orders where id = item_row.order_id for update;
  if not found or order_row.product_kind <> 'apply_pack' or order_row.status <> 'delivery_processing' then
    raise exception 'order is not claimed for delivery';
  end if;

  update public.apply_pack_items set
    status = 'delivered',
    resume_path = p_resume_path,
    resume_pdf_path = p_resume_pdf_path,
    cover_letter_path = p_cover_letter_path,
    cover_letter_pdf_path = p_cover_letter_pdf_path,
    delivered_at = p_delivered_at,
    delivery_claimed_at = null,
    human_review_checklist = p_review_checklist,
    human_reviewed_by = p_actor_id,
    human_reviewed_at = p_delivered_at
  where id = p_item_id;

  insert into public.apply_pack_delivery_revisions(
    apply_pack_item_id, version, resume_path, resume_pdf_path,
    cover_letter_path, cover_letter_pdf_path, delivered_at, reviewed_by, review_note
  ) values (
    p_item_id, 1, p_resume_path, p_resume_pdf_path,
    p_cover_letter_path, p_cover_letter_pdf_path, p_delivered_at,
    p_actor_id, trim(p_review_checklist ->> 'reviewerNote')
  );

  update public.orders set
    status = 'delivered',
    delivered_at = p_delivered_at,
    human_review_checklist = p_review_checklist,
    human_reviewed_by = p_actor_id,
    human_reviewed_at = p_delivered_at,
    processing_previous_status = null,
    processing_started_at = null,
    updated_at = now()
  where id = order_row.id;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
    values (p_actor_id, 'apply_pack_delivered', 'apply_pack_item', p_item_id::text,
      jsonb_build_object('review_checklist', p_review_checklist, 'delivery_version', 1, 'formats', jsonb_build_array('docx','pdf')));
  return true;
end;
$$;

revoke all on function public.complete_apply_pack_item_delivery(uuid, uuid, text, text, text, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.complete_apply_pack_item_delivery(uuid, uuid, text, text, text, text, jsonb, timestamptz) to service_role;

create function public.complete_correction_delivery(
  p_request_id uuid,
  p_actor_id uuid,
  p_resume_path text,
  p_resume_pdf_path text,
  p_cover_letter_path text,
  p_cover_letter_pdf_path text,
  p_resolution text,
  p_resolved_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  correction_row public.correction_requests%rowtype;
  item_row public.apply_pack_items%rowtype;
  order_row public.orders%rowtype;
  next_version integer;
begin
  if not exists(select 1 from public.profiles where id = p_actor_id and role in ('operator','admin')) then
    raise exception 'authorized operator required';
  end if;
  if p_resume_path is null or p_resume_pdf_path is null or p_cover_letter_path is null or p_cover_letter_pdf_path is null then
    raise exception 'Word and PDF correction paths required';
  end if;
  if length(trim(coalesce(p_resolution, ''))) < 10 then raise exception 'correction review note required'; end if;

  select * into correction_row from public.correction_requests where id = p_request_id for update;
  if not found or correction_row.status <> 'submitted' then raise exception 'correction request is not open'; end if;
  select * into item_row from public.apply_pack_items where id = correction_row.apply_pack_item_id for update;
  if not found or item_row.status <> 'delivered' then raise exception 'apply pack item is not delivered'; end if;
  select * into order_row from public.orders where id = item_row.order_id for update;
  if not found or order_row.status not in ('delivered','delivered_refunded') then raise exception 'order is not delivered'; end if;

  select coalesce(max(version), 0) + 1 into next_version
    from public.apply_pack_delivery_revisions where apply_pack_item_id = item_row.id;

  insert into public.apply_pack_delivery_revisions(
    apply_pack_item_id, correction_request_id, version, resume_path,
    resume_pdf_path, cover_letter_path, cover_letter_pdf_path,
    delivered_at, reviewed_by, review_note
  ) values (
    item_row.id, correction_row.id, next_version, p_resume_path,
    p_resume_pdf_path, p_cover_letter_path, p_cover_letter_pdf_path,
    p_resolved_at, p_actor_id, trim(p_resolution)
  );

  update public.apply_pack_items
    set resume_path = p_resume_path,
        resume_pdf_path = p_resume_pdf_path,
        cover_letter_path = p_cover_letter_path,
        cover_letter_pdf_path = p_cover_letter_pdf_path,
        delivered_at = p_resolved_at
    where id = item_row.id;

  update public.correction_requests
    set status = 'resolved', admin_notes = trim(p_resolution), resolved_at = p_resolved_at
    where id = correction_row.id and status = 'submitted';
  if not found then raise exception 'correction changed during resolution'; end if;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
    values (p_actor_id, 'correction_delivered', 'correction_request', p_request_id::text,
      jsonb_build_object('delivery_version', next_version, 'formats', jsonb_build_array('docx','pdf')));
  return true;
end;
$$;

revoke all on function public.complete_correction_delivery(uuid, uuid, text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.complete_correction_delivery(uuid, uuid, text, text, text, text, text, timestamptz) to service_role;

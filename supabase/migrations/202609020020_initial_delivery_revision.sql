create or replace function public.complete_apply_pack_item_delivery(
  p_item_id uuid,
  p_actor_id uuid,
  p_resume_path text,
  p_cover_letter_path text,
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
  if p_resume_path is null or p_cover_letter_path is null then raise exception 'delivery paths required'; end if;

  select * into item_row from public.apply_pack_items where id = p_item_id for update;
  if not found or item_row.status <> 'delivery_processing' then raise exception 'item is not claimed for delivery'; end if;
  select * into order_row from public.orders where id = item_row.order_id for update;
  if not found or order_row.product_kind <> 'apply_pack' or order_row.status <> 'delivery_processing' then
    raise exception 'order is not claimed for delivery';
  end if;

  update public.apply_pack_items set
    status = 'delivered', resume_path = p_resume_path, cover_letter_path = p_cover_letter_path,
    delivered_at = p_delivered_at, delivery_claimed_at = null,
    human_review_checklist = p_review_checklist, human_reviewed_by = p_actor_id,
    human_reviewed_at = p_delivered_at
  where id = p_item_id;
  insert into public.apply_pack_delivery_revisions(
    apply_pack_item_id, version, resume_path, cover_letter_path,
    delivered_at, reviewed_by, review_note
  ) values (
    p_item_id, 1, p_resume_path, p_cover_letter_path,
    p_delivered_at, p_actor_id, trim(p_review_checklist ->> 'reviewerNote')
  );
  update public.orders set
    status = 'delivered', delivered_at = p_delivered_at,
    human_review_checklist = p_review_checklist, human_reviewed_by = p_actor_id,
    human_reviewed_at = p_delivered_at, processing_previous_status = null,
    processing_started_at = null, updated_at = now()
  where id = order_row.id;
  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
    values (p_actor_id, 'apply_pack_delivered', 'apply_pack_item', p_item_id::text,
      jsonb_build_object('review_checklist', p_review_checklist, 'delivery_version', 1));
  return true;
end;
$$;

revoke all on function public.complete_apply_pack_item_delivery(uuid, uuid, text, text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.complete_apply_pack_item_delivery(uuid, uuid, text, text, jsonb, timestamptz) to service_role;

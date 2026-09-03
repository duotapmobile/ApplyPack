create table public.apply_pack_delivery_revisions (
  id uuid primary key default gen_random_uuid(),
  apply_pack_item_id uuid not null references public.apply_pack_items(id) on delete cascade,
  correction_request_id uuid references public.correction_requests(id),
  version integer not null check (version > 0),
  resume_path text not null,
  cover_letter_path text not null,
  delivered_at timestamptz not null,
  reviewed_by uuid references public.profiles(id),
  review_note text,
  created_at timestamptz not null default now(),
  unique(apply_pack_item_id, version),
  unique(correction_request_id)
);

insert into public.apply_pack_delivery_revisions(
  apply_pack_item_id, version, resume_path, cover_letter_path, delivered_at,
  reviewed_by, review_note
)
select id, 1, resume_path, cover_letter_path, delivered_at,
  human_reviewed_by, 'Original reviewed delivery recorded during revision-history migration.'
from public.apply_pack_items
where status = 'delivered'
  and resume_path is not null
  and cover_letter_path is not null
  and delivered_at is not null
on conflict (apply_pack_item_id, version) do nothing;

alter table public.apply_pack_delivery_revisions enable row level security;
create policy delivery_revision_admin_select on public.apply_pack_delivery_revisions
  for select to authenticated using (public.is_admin());
revoke insert, update, delete on public.apply_pack_delivery_revisions from public, anon, authenticated;
grant all privileges on public.apply_pack_delivery_revisions to service_role;

create or replace function public.complete_correction_delivery(
  p_request_id uuid,
  p_actor_id uuid,
  p_resume_path text,
  p_cover_letter_path text,
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
  if p_resume_path is null or p_cover_letter_path is null then raise exception 'correction paths required'; end if;
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
    cover_letter_path, delivered_at, reviewed_by, review_note
  ) values (
    item_row.id, correction_row.id, next_version, p_resume_path,
    p_cover_letter_path, p_resolved_at, p_actor_id, trim(p_resolution)
  );

  update public.apply_pack_items
    set resume_path = p_resume_path, cover_letter_path = p_cover_letter_path,
        delivered_at = p_resolved_at
    where id = item_row.id;
  update public.correction_requests
    set status = 'resolved', admin_notes = trim(p_resolution), resolved_at = p_resolved_at
    where id = correction_row.id and status = 'submitted';
  if not found then raise exception 'correction changed during resolution'; end if;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
    values (p_actor_id, 'correction_delivered', 'correction_request', p_request_id::text,
      jsonb_build_object('delivery_version', next_version));
  return true;
end;
$$;

revoke all on function public.complete_correction_delivery(uuid, uuid, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.complete_correction_delivery(uuid, uuid, text, text, text, timestamptz) to service_role;

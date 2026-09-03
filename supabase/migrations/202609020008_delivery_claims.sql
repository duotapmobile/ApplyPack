alter table public.apply_pack_items
  add column delivery_claimed_at timestamptz;

create index apply_pack_delivery_claim_idx
  on public.apply_pack_items(delivery_claimed_at)
  where status = 'delivery_processing';

do $$
begin
  if (select count(*) from public.orders where id='a2000000-0000-4000-8000-000000000001' and status='paid') <> 1 then raise exception 'legacy paid order changed'; end if;
  if (select count(*) from public.payments where id='a3000000-0000-4000-8000-000000000001' and status='paid') <> 1 then raise exception 'legacy payment changed'; end if;
  if (select count(*) from public.ap_payment_attempts where legacy_payment_id='a3000000-0000-4000-8000-000000000001' and settlement='PAID') <> 1 then raise exception 'legacy payment compatibility missing'; end if;
  if (select count(*) from public.ap_search_services where legacy_order_id='a2000000-0000-4000-8000-000000000001' and legacy_record) <> 1 then raise exception 'legacy order compatibility missing'; end if;
  if (select count(*) from public.ap_legacy_order_compatibility where id='a2000000-0000-4000-8000-000000000001' and corrected_settlement='PAID') <> 1 then raise exception 'compatibility read failed'; end if;
  if (select count(*) from public.ap_migration_checkpoints where migration_id='202609040022' and checkpoint='LEGACY_ORDERS_V1' and completed_at is not null) <> 1 then raise exception 'backfill checkpoint missing'; end if;
end $$;
select 'LEGACY_BACKFILL_OK' as result;

-- Preserve the immediately preceding application's finalization contract for
-- the documented rollback window. Untrusted roles remain denied; only the
-- already-privileged server role may invoke the compatibility wrapper.

revoke all on function public.ap_finalize_four_step_intake_with_legal_acceptance(
  uuid,text,bigint,uuid,jsonb,text,uuid,jsonb,text,text,text
) from public,anon,authenticated;
grant execute on function public.ap_finalize_four_step_intake_with_legal_acceptance(
  uuid,text,bigint,uuid,jsonb,text,uuid,jsonb,text,text,text
) to service_role;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202610030065','INTAKE_ROLLBACK_COMPATIBILITY',0,clock_timestamp())
on conflict(migration_id,checkpoint) do update
set rows_processed=excluded.rows_processed,completed_at=excluded.completed_at;

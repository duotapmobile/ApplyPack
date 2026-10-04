begin;

-- Migration 077 deliberately invalidated every assessment and quote derived
-- before the atomic opportunity-identity policy. Revoke any still-active
-- invitation bound to those assessments first; the existing trigger returns
-- its held capacity and writes the capacity audit in the same transaction.
do $$
declare
  policy_at timestamptz:=clock_timestamp();
  revoked_count integer:=0;
  requeued_count integer:=0;
begin
  update public.ap_search_checkout_invitations invitation
  set revoked_at=policy_at
  from public.ap_feasibility_assessments assessment
  where invitation.assessment_id=assessment.id
    and assessment.invalidated_at is not null
    and invitation.consumed_at is null
    and invitation.revoked_at is null;
  get diagnostics revoked_count=row_count;

  update public.ap_feasibility_requests request
  set state='PENDING',
      completed_assessment_id=null,
      claimed_by=null,
      claimed_at=null,
      stale_reason=null,
      error_code=null,
      updated_at=policy_at
  from public.ap_feasibility_assessments assessment
  where request.completed_assessment_id=assessment.id
    and assessment.invalidated_at is not null
    and request.state='COMPLETED';
  get diagnostics requeued_count=row_count;

  insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
  values(
    '202610040078','REQUEUE_IDENTITY_POLICY_FEASIBILITY',
    revoked_count+requeued_count,policy_at
  )
  on conflict(migration_id,checkpoint) do update
  set rows_processed=excluded.rows_processed,completed_at=excluded.completed_at;
end;
$$;

commit;

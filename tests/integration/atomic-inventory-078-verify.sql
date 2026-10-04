do $$
begin
  if not exists(
    select 1 from public.ap_migration_checkpoints
    where migration_id='202610040077' and checkpoint='ATOMIC_INVENTORY_IDENTITY_ENFORCEMENT'
  ) then raise exception 'migration_077_checkpoint_missing'; end if;
  if not exists(
    select 1 from public.ap_migration_checkpoints
    where migration_id='202610040078' and checkpoint='REQUEUE_IDENTITY_POLICY_FEASIBILITY'
      and rows_processed=2
  ) then raise exception 'migration_078_checkpoint_or_count_missing'; end if;
  if not exists(
    select 1 from public.ap_feasibility_assessments
    where id='f6600000-0000-4000-8000-000000000001' and invalidated_at is not null
  ) then raise exception 'pre_policy_assessment_not_invalidated'; end if;
  if not exists(
    select 1 from public.ap_quotes
    where id='f6c00000-0000-4000-8000-000000000001' and invalidated_at is not null
  ) then raise exception 'pre_policy_quote_not_invalidated'; end if;
  if not exists(
    select 1 from public.ap_feasibility_requests
    where id='f6700000-0000-4000-8000-000000000001' and state='PENDING'
      and completed_assessment_id is null and claimed_by is null and claimed_at is null
      and stale_reason is null and error_code is null
  ) then raise exception 'completed_feasibility_not_requeued_cleanly'; end if;
  if not exists(
    select 1 from public.ap_search_checkout_invitations
    where id='f6b00000-0000-4000-8000-000000000001' and revoked_at is not null
  ) then raise exception 'pre_policy_invitation_not_revoked'; end if;
  if not exists(
    select 1 from public.ap_capacity_allocations
    where id='f6a00000-0000-4000-8000-000000000001'
      and lifecycle='RELEASED' and debit_disposition='RETURNED'
      and returned_at is not null and expires_at is null
  ) then raise exception 'pre_policy_invitation_capacity_not_returned'; end if;
  if not exists(
    select 1 from public.ap_capacity_audit
    where allocation_id='f6a00000-0000-4000-8000-000000000001'
      and reason_code='INVITATION_REVOKED' and to_lifecycle='RELEASED' and to_debit='RETURNED'
  ) then raise exception 'pre_policy_invitation_capacity_audit_missing'; end if;
end;
$$;

select * from public.ap_claim_feasibility_request(
  'f6700000-0000-4000-8000-000000000001','identity-upgrade-worker'
);
insert into public.ap_feasibility_assessments(
  id,snapshot_id,coverage_plan_id,state,outcome,resolution_blocker,preliminarily_deliverable_count,
  reviewable_count,excluded_count,reasons,primary_reason,rules_version,expires_at
) values(
  'f6600000-0000-4000-8000-000000000002','f6200000-0000-4000-8000-000000000001',
  'f6500000-0000-4000-8000-000000000001','COMPLETE','LIKELY','NONE',10,0,0,'{}',null,
  'atomic-identity-v2',clock_timestamp()+interval '1 hour'
);
select public.ap_complete_feasibility_request(
  'f6700000-0000-4000-8000-000000000001','identity-upgrade-worker',
  'f6600000-0000-4000-8000-000000000002'
);
select public.ap_issue_search_checkout_invitation(
  'f6b00000-0000-4000-8000-000000000002','f6100000-0000-4000-8000-000000000001',
  'f6200000-0000-4000-8000-000000000001','f6600000-0000-4000-8000-000000000002',
  repeat('3',64),clock_timestamp()+interval '20 minutes','f6000000-0000-4000-8000-000000000001',
  'Fresh invitation issued after the identity-policy feasibility recovery completed.'
);

do $$
begin
  if not exists(
    select 1 from public.ap_feasibility_requests
    where id='f6700000-0000-4000-8000-000000000001' and state='COMPLETED'
      and completed_assessment_id='f6600000-0000-4000-8000-000000000002'
  ) then raise exception 'requeued_feasibility_did_not_complete'; end if;
  if not exists(
    select 1 from public.ap_search_checkout_invitations invitation
    join public.ap_capacity_allocations allocation on allocation.id=invitation.capacity_allocation_id
    where invitation.id='f6b00000-0000-4000-8000-000000000002'
      and invitation.revoked_at is null and invitation.consumed_at is null
      and invitation.assessment_id='f6600000-0000-4000-8000-000000000002'
      and allocation.lifecycle='RESERVED' and allocation.debit_disposition='HELD'
  ) then raise exception 'fresh_invitation_not_issued_after_recovery'; end if;
end;
$$;

select 'ATOMIC_INVENTORY_078_RECOVERY_OK' as case;

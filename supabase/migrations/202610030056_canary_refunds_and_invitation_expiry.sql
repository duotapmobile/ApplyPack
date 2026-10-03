-- Release expired or revoked invitation holds and expose a narrow, audited
-- post-delivery refund entrypoint for the two manual-launch canaries.

begin;

create or replace function public.ap_release_revoked_search_invitation_capacity()
returns trigger language plpgsql security definer set search_path='' as $$
declare allocation public.ap_capacity_allocations;
begin
  if old.revoked_at is null and new.revoked_at is not null then
    select * into allocation from public.ap_capacity_allocations
      where id=new.capacity_allocation_id for update;
    if found and allocation.lifecycle='RESERVED' and allocation.debit_disposition='HELD' then
      update public.ap_capacity_allocations set
        lifecycle='RELEASED',debit_disposition='RETURNED',returned_at=new.revoked_at,
        expires_at=null,updated_at=clock_timestamp()
      where id=allocation.id;
      insert into public.ap_capacity_audit(
        allocation_id,from_lifecycle,to_lifecycle,from_debit,to_debit,actor_id,reason_code
      ) values(
        allocation.id,allocation.lifecycle,'RELEASED',allocation.debit_disposition,'RETURNED',
        new.issued_by,'INVITATION_REVOKED'
      );
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.ap_release_revoked_search_invitation_capacity() from public,anon,authenticated;

drop trigger if exists ap_release_revoked_search_invitation_capacity on public.ap_search_checkout_invitations;
create trigger ap_release_revoked_search_invitation_capacity
after update of revoked_at on public.ap_search_checkout_invitations
for each row execute function public.ap_release_revoked_search_invitation_capacity();

-- Forward-clean any stale holds created before the trigger existed.
do $$
declare invitation record; allocation public.ap_capacity_allocations; released_at timestamptz;
begin
  for invitation in
    select * from public.ap_search_checkout_invitations
    where consumed_at is null and (revoked_at is not null or expires_at<=clock_timestamp())
    order by issued_at,id
  loop
    select * into allocation from public.ap_capacity_allocations
      where id=invitation.capacity_allocation_id for update;
    if found and allocation.lifecycle='RESERVED' and allocation.debit_disposition='HELD' then
      released_at:=coalesce(invitation.revoked_at,clock_timestamp());
      update public.ap_search_checkout_invitations set revoked_at=released_at
        where id=invitation.id and revoked_at is null;
      update public.ap_capacity_allocations set
        lifecycle='RELEASED',debit_disposition='RETURNED',returned_at=released_at,
        expires_at=null,updated_at=clock_timestamp()
      where id=allocation.id and lifecycle='RESERVED' and debit_disposition='HELD';
      if found then
        insert into public.ap_capacity_audit(
          allocation_id,from_lifecycle,to_lifecycle,from_debit,to_debit,actor_id,reason_code
        ) values(
          allocation.id,allocation.lifecycle,'RELEASED',allocation.debit_disposition,'RETURNED',
          invitation.issued_by,'INVITATION_EXPIRY_BACKFILL'
        );
      end if;
    end if;
  end loop;
end;
$$;

create or replace function public.ap_queue_manual_launch_canary_refund(
  p_payment_attempt_id uuid,
  p_actor_id uuid,
  p_evidence_reference text
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  payment public.ap_payment_attempts;
  service public.ap_search_services;
  quote public.ap_quotes;
  material_line public.ap_material_lines;
  purchase public.ap_material_purchases;
  material_line_count integer;
  refund_id uuid;
  evidence text:=btrim(p_evidence_reference);
begin
  if length(evidence) not between 12 and 500 then
    raise exception 'manual_launch_canary_evidence_required';
  end if;
  if not exists(select 1 from public.profiles where id=p_actor_id and role in ('operator','admin')) then
    raise exception 'manual_launch_canary_operator_required';
  end if;

  select * into payment from public.ap_payment_attempts where id=p_payment_attempt_id for update;
  if not found or payment.provider<>'stripe' or payment.provider_payment_id is null
    or payment.settlement<>'PAID' or payment.currency<>'USD'
    or not payment.immediate_charge_verified or payment.payment_method_type<>'card'
    or payment.dispute in ('OPEN','LOST') or payment.customer_id is null then
    raise exception 'manual_launch_canary_verified_payment_required';
  end if;

  if payment.amount_cents=1899 then
    select * into service from public.ap_search_services
      where winning_payment_attempt_id=payment.id for update;
    if not found or service.customer_id<>payment.customer_id or service.fulfillment<>'DELIVERED'
      or service.quote_id is null then
      raise exception 'manual_launch_canary_search_delivery_required';
    end if;
    select * into quote from public.ap_quotes where id=service.quote_id;
    if not found or quote.price_cents<>1899 or quote.currency<>'USD'
      or quote.pricing_version<>'manual-launch-pricing-2026-10-02-v2'
      or quote.terms_version<>'manual-launch-terms-2026-10-02-v2'
      or service.version_bundle->>'pricingVersion'<>'manual-launch-pricing-2026-10-02-v2'
      or service.version_bundle->>'termsVersion'<>'manual-launch-terms-2026-10-02-v2'
      or not exists(select 1 from public.ap_releases release
        where release.order_id=service.legacy_order_id and release.release_kind='SEARCH_EXACT_TEN') then
      raise exception 'manual_launch_canary_search_contract_invalid';
    end if;
    refund_id:=public.ap_queue_search_refund(payment.id,payment.customer_id,'FULL_SEARCH','MANUAL_LAUNCH_CANARY');
  elsif payment.amount_cents=799 then
    select count(*) into material_line_count from public.ap_material_lines line
      where line.payment_attempt_id=payment.id;
    if material_line_count<>1 then
      raise exception 'manual_launch_canary_single_material_line_required';
    end if;
    select * into material_line from public.ap_material_lines
      where payment_attempt_id=payment.id for update;
    select * into purchase from public.ap_material_purchases where id=material_line.purchase_id for update;
    if not found or purchase.customer_id<>payment.customer_id or purchase.payment_attempt_id<>payment.id
      or purchase.amount_cents<>799 or purchase.currency<>'USD'
      or material_line.allocated_amount_cents<>799 or material_line.fulfillment<>'DELIVERED'
      or not exists(select 1 from public.ap_releases release
        where release.material_line_id=material_line.id
          and release.release_kind in ('MATERIAL_PAIR','MATERIAL_TRIPLE')) then
      raise exception 'manual_launch_canary_material_delivery_required';
    end if;
    refund_id:=public.ap_queue_material_line_refund(
      payment.id,payment.customer_id,material_line.id,'MANUAL_LAUNCH_CANARY'
    );
  else
    raise exception 'manual_launch_canary_current_price_required';
  end if;

  insert into public.ap_audit_events(
    customer_id,actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version
  ) values(
    payment.customer_id,p_actor_id,'MANUAL_LAUNCH_CANARY_REFUND_QUEUED','REFUND_OPERATION',refund_id,
    jsonb_build_object('paymentAttemptId',payment.id,'amountCents',payment.amount_cents,
      'evidenceReference',evidence),'manual-launch-canary-v1'
  );
  return refund_id;
end;
$$;
revoke all on function public.ap_queue_manual_launch_canary_refund(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.ap_queue_manual_launch_canary_refund(uuid,uuid,text) to service_role;

commit;

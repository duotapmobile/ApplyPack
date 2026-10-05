-- Bind each production canary to one exact release, product, payment attempt,
-- and expected customer before card payment. Ordinary customer payments can
-- never enter the canary-only refund path.

begin;

create table public.ap_manual_launch_canary_designations (
  id uuid primary key default gen_random_uuid(),
  release_sha text not null check (release_sha ~ '^[0-9a-f]{40}$'),
  product_kind text not null check (product_kind in ('SEARCH','MATERIALS')),
  payment_attempt_id uuid not null unique references public.ap_payment_attempts(id),
  expected_customer_id uuid not null references public.profiles(id),
  expected_amount_cents integer not null,
  designated_by uuid not null references public.profiles(id),
  evidence_reference text not null check (length(btrim(evidence_reference)) between 12 and 500),
  designated_at timestamptz not null default clock_timestamp(),
  check (
    (product_kind='SEARCH' and expected_amount_cents=1899)
    or (product_kind='MATERIALS' and expected_amount_cents=799)
  ),
  unique(release_sha,product_kind)
);
alter table public.ap_manual_launch_canary_designations enable row level security;
revoke all on public.ap_manual_launch_canary_designations from public,anon,authenticated,service_role;
grant select on public.ap_manual_launch_canary_designations to service_role;

create or replace function public.ap_manual_launch_canary_designation_is_immutable()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'manual_launch_canary_designation_is_immutable';
end;
$$;
create trigger ap_manual_launch_canary_designation_immutable
before update or delete on public.ap_manual_launch_canary_designations
for each row execute function public.ap_manual_launch_canary_designation_is_immutable();

create or replace function public.ap_designate_manual_launch_canary_payment(
  p_payment_attempt_id uuid,
  p_expected_customer_id uuid,
  p_product_kind text,
  p_release_sha text,
  p_actor_id uuid,
  p_evidence_reference text
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  payment public.ap_payment_attempts;
  existing public.ap_manual_launch_canary_designations;
  expected_email text;
  draft_email text;
  evidence text:=btrim(coalesce(p_evidence_reference,''));
  designation_id uuid:=gen_random_uuid();
begin
  if p_product_kind not in ('SEARCH','MATERIALS')
    or p_release_sha !~ '^[0-9a-f]{40}$'
    or length(evidence) not between 12 and 500 then
    raise exception 'manual_launch_canary_designation_input_invalid';
  end if;
  if not exists(select 1 from public.profiles where id=p_actor_id and role in ('operator','admin')) then
    raise exception 'manual_launch_canary_operator_required';
  end if;
  select lower(btrim(email)) into expected_email from public.profiles
    where id=p_expected_customer_id and role='customer';
  if expected_email is null then raise exception 'manual_launch_canary_customer_required'; end if;

  select * into payment from public.ap_payment_attempts where id=p_payment_attempt_id for update;
  if not found or payment.provider<>'stripe' or payment.settlement<>'UNPAID'
    or payment.payment_verified_at is not null or payment.provider_payment_id is not null
    or payment.dispute<>'NONE' then
    raise exception 'manual_launch_canary_precharge_payment_required';
  end if;

  select * into existing from public.ap_manual_launch_canary_designations
    where payment_attempt_id=payment.id;
  if found then
    if existing.expected_customer_id<>p_expected_customer_id
      or existing.product_kind<>p_product_kind
      or existing.release_sha<>p_release_sha
      or existing.evidence_reference<>evidence then
      raise exception 'manual_launch_canary_designation_conflict';
    end if;
    return existing.id;
  end if;
  if exists(select 1 from public.ap_manual_launch_canary_designations
    where release_sha=p_release_sha and product_kind=p_product_kind) then
    raise exception 'manual_launch_canary_product_already_designated';
  end if;

  if p_product_kind='SEARCH' then
    if payment.amount_cents<>1899 or payment.currency<>'USD'
      or payment.draft_id is null or payment.customer_id is not null then
      raise exception 'manual_launch_canary_search_precharge_invalid';
    end if;
    select snapshot.access_email_normalized into draft_email
    from public.ap_anonymous_drafts draft
      join public.ap_intake_snapshots snapshot on snapshot.id=draft.finalized_snapshot_id
    where draft.id=payment.draft_id;
    if draft_email is null or lower(btrim(draft_email))<>expected_email then
      raise exception 'manual_launch_canary_search_customer_mismatch';
    end if;
  else
    if payment.amount_cents<>799 or payment.currency<>'USD'
      or payment.customer_id is distinct from p_expected_customer_id
      or payment.draft_id is not null then
      raise exception 'manual_launch_canary_material_precharge_invalid';
    end if;
  end if;

  insert into public.ap_manual_launch_canary_designations(
    id,release_sha,product_kind,payment_attempt_id,expected_customer_id,
    expected_amount_cents,designated_by,evidence_reference
  ) values(
    designation_id,p_release_sha,p_product_kind,payment.id,p_expected_customer_id,
    payment.amount_cents,p_actor_id,evidence
  );
  insert into public.ap_audit_events(
    customer_id,actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version
  ) values(
    p_expected_customer_id,p_actor_id,'MANUAL_LAUNCH_CANARY_DESIGNATED',
    'MANUAL_LAUNCH_CANARY_DESIGNATION',designation_id,
    jsonb_build_object('paymentAttemptId',payment.id,'productKind',p_product_kind,
      'releaseSha',p_release_sha,'evidenceReference',evidence),
    'manual-launch-canary-v2'
  );
  return designation_id;
end;
$$;
revoke all on function public.ap_designate_manual_launch_canary_payment(uuid,uuid,text,text,uuid,text)
  from public,anon,authenticated;
grant execute on function public.ap_designate_manual_launch_canary_payment(uuid,uuid,text,text,uuid,text)
  to service_role;

-- Bind material delivery evidence to the same immutable contract versions that
-- created the payment. This applies to future releases only.
do $migration$
declare
  definition text;
  old_bundle constant text :=
    '''submissionRuleId'',revision.employer_rule_snapshot_id,''reviewChecklist'',p_review_checklist';
  new_bundle constant text :=
    '''submissionRuleId'',revision.employer_rule_snapshot_id,''reviewChecklist'',p_review_checklist,'||
    '''pricingVersion'',config.pricing_version,''termsVersion'',config.terms_version,''privacyVersion'',config.privacy_version';
begin
  select pg_get_functiondef(
    'public.ap_commit_material_release_v2(uuid,uuid,uuid,jsonb,text,uuid)'::regprocedure
  ) into definition;
  definition:=replace(definition,chr(13),'');
  if definition is null or position(old_bundle in definition)=0 then
    raise exception 'material_release_contract_bundle_anchor_missing';
  end if;
  definition:=replace(definition,old_bundle,new_bundle);
  if position(new_bundle in definition)=0 then
    raise exception 'material_release_contract_bundle_rewrite_failed';
  end if;
  execute definition;
end;
$migration$;

drop function public.ap_queue_manual_launch_canary_refund(uuid,uuid,text);
create function public.ap_queue_manual_launch_canary_refund(
  p_payment_attempt_id uuid,
  p_actor_id uuid,
  p_evidence_reference text,
  p_release_sha text
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  payment public.ap_payment_attempts;
  designation public.ap_manual_launch_canary_designations;
  service public.ap_search_services;
  quote public.ap_quotes;
  material_line public.ap_material_lines;
  purchase public.ap_material_purchases;
  delivery_release public.ap_releases;
  refund_id uuid;
  existing_refund_id uuid;
  material_line_count integer;
  evidence text:=btrim(coalesce(p_evidence_reference,''));
begin
  if p_release_sha !~ '^[0-9a-f]{40}$' or length(evidence) not between 12 and 500 then
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
  select * into designation from public.ap_manual_launch_canary_designations
    where payment_attempt_id=payment.id and release_sha=p_release_sha;
  if not found or designation.expected_customer_id<>payment.customer_id
    or designation.expected_amount_cents<>payment.amount_cents then
    raise exception 'manual_launch_canary_designation_required';
  end if;

  select id into existing_refund_id from public.ap_refund_operations
    where payment_attempt_id=payment.id and reason_code='MANUAL_LAUNCH_CANARY'
      and superseded_at is null
    order by created_at,id limit 1;
  if existing_refund_id is not null then return existing_refund_id; end if;

  if designation.product_kind='SEARCH' then
    if payment.amount_cents<>1899 then raise exception 'manual_launch_canary_current_price_required'; end if;
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
  elsif designation.product_kind='MATERIALS' then
    if payment.amount_cents<>799 then raise exception 'manual_launch_canary_current_price_required'; end if;
    select count(*) into material_line_count from public.ap_material_lines line
      where line.payment_attempt_id=payment.id;
    if material_line_count<>1 then
      raise exception 'manual_launch_canary_single_material_line_required';
    end if;
    select * into material_line from public.ap_material_lines
      where payment_attempt_id=payment.id for update;
    select * into purchase from public.ap_material_purchases where id=material_line.purchase_id for update;
    select * into delivery_release from public.ap_releases
      where material_line_id=material_line.id
        and release_kind in ('MATERIAL_PAIR','MATERIAL_TRIPLE');
    if not found or purchase.customer_id<>payment.customer_id or purchase.payment_attempt_id<>payment.id
      or purchase.amount_cents<>799 or purchase.currency<>'USD'
      or material_line.allocated_amount_cents<>799 or material_line.fulfillment<>'DELIVERED'
      or delivery_release.version_bundle->>'pricingVersion'<>'manual-launch-pricing-2026-10-02-v2'
      or delivery_release.version_bundle->>'termsVersion'<>'manual-launch-terms-2026-10-02-v2'
      or delivery_release.version_bundle->>'privacyVersion' is null then
      raise exception 'manual_launch_canary_material_delivery_required';
    end if;
    refund_id:=public.ap_queue_material_line_refund(
      payment.id,payment.customer_id,material_line.id,'MANUAL_LAUNCH_CANARY'
    );
  else
    raise exception 'manual_launch_canary_designation_required';
  end if;

  insert into public.ap_audit_events(
    customer_id,actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version
  ) values(
    payment.customer_id,p_actor_id,'MANUAL_LAUNCH_CANARY_REFUND_QUEUED','REFUND_OPERATION',refund_id,
    jsonb_build_object('paymentAttemptId',payment.id,'designationId',designation.id,
      'releaseSha',designation.release_sha,'amountCents',payment.amount_cents,
      'evidenceReference',evidence),'manual-launch-canary-v2'
  );
  return refund_id;
end;
$$;
revoke all on function public.ap_queue_manual_launch_canary_refund(uuid,uuid,text,text)
  from public,anon,authenticated;
grant execute on function public.ap_queue_manual_launch_canary_refund(uuid,uuid,text,text)
  to service_role;

commit;

-- Add an independent emergency-stop audit path, make abandoned canaries
-- recoverable only after their provider checkout is terminal and reconciled,
-- and move operator capacity controls onto the authoritative pools.

begin;

alter table public.ap_manual_launch_canary_authorizations
  add column revoked_at timestamptz,
  add column revoked_by uuid references public.profiles(id),
  add column revocation_evidence_reference text,
  add constraint ap_manual_launch_canary_authorization_revocation_complete check (
    (revoked_at is null and revoked_by is null and revocation_evidence_reference is null)
    or (
      revoked_at is not null and revoked_by is not null
      and length(btrim(revocation_evidence_reference)) between 12 and 500
    )
  );

alter table public.ap_manual_launch_canary_designations
  add column authorization_id uuid references public.ap_manual_launch_canary_authorizations(id),
  add column provider_terminal_reconciled_at timestamptz,
  add column provider_terminal_reconciled_by uuid references public.profiles(id),
  add column provider_terminal_session_id text,
  add column provider_terminal_status text,
  add column provider_terminal_payment_status text,
  add column provider_terminal_evidence_reference text,
  add column superseded_at timestamptz,
  add column superseded_by uuid references public.profiles(id),
  add column supersession_evidence_reference text,
  add constraint ap_manual_launch_canary_designation_supersession_complete check (
    (superseded_at is null and superseded_by is null and supersession_evidence_reference is null)
    or (
      superseded_at is not null and superseded_by is not null
      and length(btrim(supersession_evidence_reference)) between 12 and 500
    )
  ),
  add constraint ap_manual_launch_canary_provider_terminal_complete check (
    (
      provider_terminal_reconciled_at is null and provider_terminal_reconciled_by is null
      and provider_terminal_session_id is null and provider_terminal_status is null
      and provider_terminal_payment_status is null and provider_terminal_evidence_reference is null
    ) or (
      provider_terminal_reconciled_at is not null and provider_terminal_reconciled_by is not null
      and nullif(btrim(provider_terminal_session_id),'') is not null
      and provider_terminal_status='expired' and provider_terminal_payment_status='unpaid'
      and length(btrim(provider_terminal_evidence_reference)) between 12 and 500
    )
  );

do $drop_release_product_unique$
declare constraint_name text;
begin
  select constraint_row.conname into constraint_name
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid='public.ap_manual_launch_canary_designations'::regclass
    and constraint_row.contype='u'
    and pg_catalog.pg_get_constraintdef(constraint_row.oid)='UNIQUE (release_sha, product_kind)';
  if constraint_name is null then
    raise exception 'manual_launch_canary_release_product_unique_missing';
  end if;
  execute format('alter table public.ap_manual_launch_canary_designations drop constraint %I',constraint_name);
end;
$drop_release_product_unique$;

create unique index ap_manual_launch_canary_active_release_product_unique
  on public.ap_manual_launch_canary_designations(release_sha,product_kind)
  where superseded_at is null;

create table public.ap_manual_launch_canary_receipt_update_tokens(
  designation_id uuid primary key references public.ap_manual_launch_canary_designations(id) on delete cascade,
  transaction_id bigint not null,
  created_at timestamptz not null default clock_timestamp()
);
revoke all on public.ap_manual_launch_canary_receipt_update_tokens from public,anon,authenticated,service_role;

create or replace function public.ap_manual_launch_canary_authorization_is_immutable()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE'
    and old.revoked_at is null and new.revoked_at is not null
    and new.revoked_by is not null and new.revocation_evidence_reference is not null
    and (to_jsonb(new)-array['revoked_at','revoked_by','revocation_evidence_reference'])
      = (to_jsonb(old)-array['revoked_at','revoked_by','revocation_evidence_reference']) then
    return new;
  end if;
  raise exception 'manual_launch_canary_authorization_is_immutable';
end;
$$;

create or replace function public.ap_manual_launch_canary_designation_is_immutable()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE'
    and exists(select 1 from public.ap_manual_launch_canary_receipt_update_tokens token
      where token.designation_id=old.id and token.transaction_id=txid_current())
    and old.provider_terminal_reconciled_at is null
    and new.provider_terminal_reconciled_at is not null then
    return new;
  end if;
  if tg_op='UPDATE'
    and old.superseded_at is null and new.superseded_at is not null
    and new.superseded_by is not null and new.supersession_evidence_reference is not null
    and (to_jsonb(new)-array['superseded_at','superseded_by','supersession_evidence_reference'])
      = (to_jsonb(old)-array['superseded_at','superseded_by','supersession_evidence_reference']) then
    return new;
  end if;
  raise exception 'manual_launch_canary_designation_is_immutable';
end;
$$;

create or replace function public.ap_authorize_manual_launch_canary_checkout(
  p_release_sha text,
  p_product_kind text,
  p_expected_customer_id uuid,
  p_search_draft_id uuid,
  p_actor_id uuid,
  p_evidence_reference text,
  p_expires_at timestamptz
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  existing public.ap_manual_launch_canary_authorizations;
  activation public.ap_manual_launch_activations;
  expected_email text;
  draft_email text;
  evidence text:=btrim(coalesce(p_evidence_reference,''));
  authorization_id uuid:=gen_random_uuid();
  now_at timestamptz:=clock_timestamp();
begin
  if p_release_sha !~ '^[0-9a-f]{40}$' or p_product_kind not in ('SEARCH','MATERIALS')
    or length(evidence) not between 12 and 500 or p_expires_at<=now_at
    or p_expires_at>now_at+interval '24 hours' then
    raise exception 'manual_launch_canary_authorization_input_invalid';
  end if;
  if not exists(select 1 from public.profiles where id=p_actor_id and role='admin') then
    raise exception 'manual_launch_canary_admin_required';
  end if;
  select lower(btrim(email)) into expected_email from public.profiles
    where id=p_expected_customer_id and role='customer';
  if expected_email is null then raise exception 'manual_launch_canary_customer_required'; end if;

  select activation_row.* into activation
  from public.ap_commerce_configuration configuration
    join public.ap_manual_launch_activations activation_row
      on activation_row.id=configuration.launch_activation_id
  where configuration.singleton
    and configuration.checkout_enabled
    and configuration.launch_release_sha=p_release_sha
    and activation_row.release_sha=p_release_sha
    and activation_row.activation_phase='CANARY'
    and activation_row.canary_reconciled_amount_cents=0
    and activation_row.unresolved_p0_count=0
    and activation_row.unresolved_p1_count=0;
  if not found then raise exception 'manual_launch_canary_activation_required'; end if;

  if p_product_kind='SEARCH' then
    if p_search_draft_id is null then raise exception 'manual_launch_canary_search_draft_required'; end if;
    select lower(btrim(snapshot.access_email_normalized)) into draft_email
    from public.ap_anonymous_drafts draft
      join public.ap_intake_snapshots snapshot on snapshot.id=draft.finalized_snapshot_id
    where draft.id=p_search_draft_id and draft.state='COMPLETE' and draft.expires_at>now_at;
    if draft_email is null or draft_email<>expected_email then
      raise exception 'manual_launch_canary_search_customer_mismatch';
    end if;
  elsif p_search_draft_id is not null then
    raise exception 'manual_launch_canary_material_draft_forbidden';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_release_sha||':'||p_product_kind,0)
  );
  select * into existing from public.ap_manual_launch_canary_authorizations
    where release_sha=p_release_sha and product_kind=p_product_kind
      and expires_at>now_at and revoked_at is null
    order by created_at desc,id desc limit 1;
  if found then
    if existing.expected_customer_id<>p_expected_customer_id
      or existing.search_draft_id is distinct from p_search_draft_id
      or existing.authorized_by<>p_actor_id
      or existing.evidence_reference<>evidence
      or existing.expires_at<>p_expires_at then
      raise exception 'manual_launch_canary_authorization_conflict';
    end if;
    return existing.id;
  end if;
  if exists(select 1 from public.ap_manual_launch_canary_designations
    where release_sha=p_release_sha and product_kind=p_product_kind and superseded_at is null) then
    raise exception 'manual_launch_canary_product_already_designated';
  end if;

  insert into public.ap_manual_launch_canary_authorizations(
    id,release_sha,product_kind,expected_customer_id,search_draft_id,
    authorized_by,evidence_reference,expires_at
  ) values(
    authorization_id,p_release_sha,p_product_kind,p_expected_customer_id,p_search_draft_id,
    p_actor_id,evidence,p_expires_at
  );
  insert into public.ap_audit_events(
    customer_id,actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version
  ) values(
    p_expected_customer_id,p_actor_id,'MANUAL_LAUNCH_CANARY_CHECKOUT_AUTHORIZED',
    'MANUAL_LAUNCH_CANARY_AUTHORIZATION',authorization_id,
    jsonb_build_object('releaseSha',p_release_sha,'productKind',p_product_kind,
      'searchDraftId',p_search_draft_id,'expiresAt',p_expires_at,
      'evidenceReference',evidence),
    'manual-launch-canary-v4'
  );
  return authorization_id;
end;
$$;

create or replace function public.ap_manual_launch_canary_checkout_authorized(
  p_release_sha text,
  p_product_kind text,
  p_expected_customer_id uuid default null,
  p_search_draft_id uuid default null
) returns boolean language sql stable security definer set search_path='' as $$
  select p_release_sha ~ '^[0-9a-f]{40}$'
    and p_product_kind in ('SEARCH','MATERIALS')
    and exists(
      select 1 from public.ap_manual_launch_canary_authorizations authz
      where authz.release_sha=p_release_sha
        and authz.product_kind=p_product_kind
        and authz.expected_customer_id is not distinct from p_expected_customer_id
        and authz.search_draft_id is not distinct from p_search_draft_id
        and authz.expires_at>clock_timestamp()
        and authz.revoked_at is null
    )
    and not exists(
      select 1 from public.ap_manual_launch_canary_designations designation
        join public.ap_payment_attempts payment on payment.id=designation.payment_attempt_id
      where designation.release_sha=p_release_sha
        and designation.product_kind=p_product_kind
        and designation.superseded_at is null
        and not (
          payment.settlement='UNPAID'
          and payment.provider_payment_id is null
          and payment.payment_verified_at is null
          and (
            (p_product_kind='SEARCH' and payment.draft_id=p_search_draft_id)
            or (p_product_kind='MATERIALS' and payment.customer_id=p_expected_customer_id)
          )
        )
    );
$$;

create or replace function public.ap_bind_manual_launch_canary_payment(
  p_payment_attempt_id uuid,
  p_release_sha text
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  payment public.ap_payment_attempts;
  canary_authorization public.ap_manual_launch_canary_authorizations;
  existing public.ap_manual_launch_canary_designations;
  v_product_kind text;
  designation_id uuid:=gen_random_uuid();
begin
  if p_release_sha !~ '^[0-9a-f]{40}$' then
    raise exception 'manual_launch_canary_release_invalid';
  end if;
  if not exists(
    select 1 from public.ap_commerce_configuration configuration
      join public.ap_manual_launch_activations activation
        on activation.id=configuration.launch_activation_id
    where configuration.singleton and configuration.checkout_enabled
      and configuration.launch_release_sha=p_release_sha
      and activation.release_sha=p_release_sha and activation.activation_phase='CANARY'
      and activation.canary_reconciled_amount_cents=0
      and activation.unresolved_p0_count=0 and activation.unresolved_p1_count=0
  ) then
    raise exception 'manual_launch_canary_activation_required';
  end if;
  select * into payment from public.ap_payment_attempts where id=p_payment_attempt_id for update;
  if not found or payment.provider<>'stripe' or payment.settlement<>'UNPAID'
    or payment.provider_payment_id is not null or payment.payment_verified_at is not null
    or payment.dispute<>'NONE' then
    raise exception 'manual_launch_canary_precharge_payment_required';
  end if;
  v_product_kind:=case
    when payment.draft_id is not null and payment.customer_id is null and payment.amount_cents=1899 then 'SEARCH'
    when payment.draft_id is null and payment.customer_id is not null and payment.amount_cents=799 then 'MATERIALS'
    else null end;
  if v_product_kind is null then raise exception 'manual_launch_canary_payment_shape_invalid'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_release_sha||':'||v_product_kind,0)
  );
  select * into canary_authorization from public.ap_manual_launch_canary_authorizations candidate
    where candidate.release_sha=p_release_sha
      and candidate.product_kind=v_product_kind
      and candidate.expires_at>clock_timestamp()
      and candidate.revoked_at is null
      and (
        (v_product_kind='SEARCH' and candidate.search_draft_id=payment.draft_id)
        or (v_product_kind='MATERIALS' and candidate.expected_customer_id=payment.customer_id)
      )
    order by candidate.created_at desc,candidate.id desc limit 1
    for update;
  if not found then raise exception 'manual_launch_canary_authorization_required'; end if;
  select * into existing from public.ap_manual_launch_canary_designations
    where payment_attempt_id=payment.id;
  if found then
    if existing.superseded_at is not null
      or existing.authorization_id is distinct from canary_authorization.id
      or existing.release_sha<>p_release_sha or existing.product_kind<>v_product_kind then
      raise exception 'manual_launch_canary_designation_conflict';
    end if;
    return existing.id;
  end if;
  if exists(select 1 from public.ap_manual_launch_canary_designations
    where release_sha=p_release_sha and product_kind=v_product_kind and superseded_at is null) then
    raise exception 'manual_launch_canary_product_already_designated';
  end if;

  insert into public.ap_manual_launch_canary_designations(
    id,release_sha,product_kind,payment_attempt_id,expected_customer_id,
    expected_amount_cents,designated_by,evidence_reference,authorization_id
  ) values(
    designation_id,p_release_sha,v_product_kind,payment.id,canary_authorization.expected_customer_id,
    payment.amount_cents,canary_authorization.authorized_by,
    canary_authorization.evidence_reference,canary_authorization.id
  );
  insert into public.ap_audit_events(
    customer_id,actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version
  ) values(
    canary_authorization.expected_customer_id,canary_authorization.authorized_by,
    'MANUAL_LAUNCH_CANARY_DESIGNATED','MANUAL_LAUNCH_CANARY_DESIGNATION',designation_id,
    jsonb_build_object('paymentAttemptId',payment.id,'authorizationId',canary_authorization.id,
      'productKind',v_product_kind,'releaseSha',p_release_sha,
      'evidenceReference',canary_authorization.evidence_reference),
    'manual-launch-canary-v4'
  );
  return designation_id;
end;
$$;

revoke all on function public.ap_designate_manual_launch_canary_payment(uuid,uuid,text,text,uuid,text)
  from public,anon,authenticated,service_role;

create or replace function public.ap_revoke_manual_launch_canary_checkout(
  p_authorization_id uuid,
  p_release_sha text,
  p_actor_id uuid,
  p_evidence_reference text
) returns boolean language plpgsql security definer set search_path='' as $$
declare
  authorization_row public.ap_manual_launch_canary_authorizations;
  evidence text:=btrim(coalesce(p_evidence_reference,''));
  now_at timestamptz:=clock_timestamp();
begin
  if p_release_sha !~ '^[0-9a-f]{40}$' or length(evidence) not between 12 and 500 then
    raise exception 'manual_launch_canary_revocation_input_invalid';
  end if;
  if not exists(select 1 from public.profiles where id=p_actor_id and role='admin') then
    raise exception 'manual_launch_canary_admin_required';
  end if;
  select * into authorization_row from public.ap_manual_launch_canary_authorizations
    where id=p_authorization_id and release_sha=p_release_sha;
  if not found then raise exception 'manual_launch_canary_authorization_not_found'; end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(authorization_row.release_sha||':'||authorization_row.product_kind,0)
  );
  select * into authorization_row from public.ap_manual_launch_canary_authorizations
    where id=p_authorization_id and release_sha=p_release_sha for update;
  if not found then raise exception 'manual_launch_canary_authorization_not_found'; end if;
  if authorization_row.revoked_at is not null then
    if authorization_row.revoked_by<>p_actor_id or authorization_row.revocation_evidence_reference<>evidence then
      raise exception 'manual_launch_canary_revocation_conflict';
    end if;
    return true;
  end if;
  if exists(
    select 1 from public.ap_manual_launch_canary_designations designation
    where designation.authorization_id=authorization_row.id
      and designation.superseded_at is null
  ) then
    raise exception 'manual_launch_canary_designation_already_bound';
  end if;
  update public.ap_manual_launch_canary_authorizations
  set revoked_at=now_at,revoked_by=p_actor_id,revocation_evidence_reference=evidence
  where id=authorization_row.id;
  insert into public.ap_audit_events(
    customer_id,actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version
  ) values(
    authorization_row.expected_customer_id,p_actor_id,'MANUAL_LAUNCH_CANARY_CHECKOUT_REVOKED',
    'MANUAL_LAUNCH_CANARY_AUTHORIZATION',authorization_row.id,
    jsonb_build_object('releaseSha',authorization_row.release_sha,'productKind',authorization_row.product_kind,
      'evidenceReference',evidence),'manual-launch-canary-v4'
  );
  return true;
end;
$$;
revoke all on function public.ap_revoke_manual_launch_canary_checkout(uuid,text,uuid,text)
  from public,anon,authenticated;
grant execute on function public.ap_revoke_manual_launch_canary_checkout(uuid,text,uuid,text)
  to service_role;

create or replace function public.ap_reconcile_manual_launch_canary_provider_terminal(
  p_designation_id uuid,
  p_release_sha text,
  p_actor_id uuid,
  p_provider_session_id text,
  p_provider_session_status text,
  p_provider_payment_status text,
  p_evidence_reference text
) returns boolean language plpgsql security definer set search_path='' as $$
declare
  designation public.ap_manual_launch_canary_designations;
  payment public.ap_payment_attempts;
  search_checkout public.ap_checkout_attempts;
  material_checkout public.ap_material_checkout_intents;
  command public.ap_external_commands;
  evidence text:=btrim(coalesce(p_evidence_reference,''));
  provider_session_id text:=btrim(coalesce(p_provider_session_id,''));
  now_at timestamptz:=clock_timestamp();
  actor_id uuid;
begin
  if p_release_sha !~ '^[0-9a-f]{40}$'
    or length(evidence) not between 12 and 500
    or provider_session_id=''
    or p_provider_session_status<>'expired'
    or p_provider_payment_status<>'unpaid' then
    raise exception 'manual_launch_canary_provider_terminal_input_invalid';
  end if;
  select * into designation from public.ap_manual_launch_canary_designations
    where id=p_designation_id and release_sha=p_release_sha for update;
  if not found or designation.superseded_at is not null then
    raise exception 'manual_launch_canary_designation_not_active';
  end if;
  actor_id:=coalesce(p_actor_id,(select authorized_by
    from public.ap_manual_launch_canary_authorizations where id=designation.authorization_id));
  if not exists(select 1 from public.profiles where id=actor_id and role='admin') then
    raise exception 'manual_launch_canary_admin_required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(designation.release_sha||':'||designation.product_kind,0)
  );
  select * into payment from public.ap_payment_attempts
    where id=designation.payment_attempt_id for update;
  if not found or payment.settlement not in ('UNPAID','FAILED')
    or payment.provider_payment_id is not null or payment.payment_verified_at is not null
    or payment.immediate_charge_verified or payment.dispute<>'NONE' then
    raise exception 'manual_launch_canary_uncharged_payment_required';
  end if;

  if designation.product_kind='SEARCH' then
    select * into search_checkout from public.ap_checkout_attempts
      where id=payment.checkout_attempt_id for update;
    if not found or (
      search_checkout.provider_checkout_session_id is not null
      and search_checkout.provider_checkout_session_id is distinct from provider_session_id
    ) then
      raise exception 'manual_launch_canary_provider_session_mismatch';
    end if;
    select * into command from public.ap_external_commands
      where id=search_checkout.command_id for update;
    if search_checkout.state='NONE' then
      if not public.ap_compensate_search_checkout(
        search_checkout.id,'CANARY_PROVIDER_SESSION_EXPIRED',provider_session_id
      ) then
        raise exception 'manual_launch_canary_provider_reconciliation_failed';
      end if;
    elsif search_checkout.state in ('OPEN','EXPIRED','CANCELED','FAILED') then
      if search_checkout.state='OPEN' and not public.ap_expire_search_checkout(
        search_checkout.id,'CANARY_PROVIDER_SESSION_EXPIRED'
      ) then
        raise exception 'manual_launch_canary_provider_reconciliation_failed';
      end if;
      if command.state in ('CREATING','CREATED','APPLYING') then
        update public.ap_external_commands set state='COMPENSATING',
          provider_object_id=coalesce(provider_object_id,provider_session_id),updated_at=now_at
        where id=command.id;
        update public.ap_external_commands set state='COMPENSATED',
          reconciliation_state='RECONCILED',failure_code='CANARY_PROVIDER_SESSION_EXPIRED',
          compensated_at=coalesce(compensated_at,now_at),updated_at=now_at
        where id=command.id;
      end if;
    else
      raise exception 'manual_launch_canary_provider_reconciliation_failed';
    end if;
  else
    select * into material_checkout from public.ap_material_checkout_intents
      where payment_attempt_id=payment.id for update;
    if not found or (
      material_checkout.provider_checkout_session_id is not null
      and material_checkout.provider_checkout_session_id is distinct from provider_session_id
    ) then
      raise exception 'manual_launch_canary_provider_session_mismatch';
    end if;
    select * into command from public.ap_external_commands
      where id=material_checkout.command_id for update;
    if material_checkout.state in ('READY','OPEN','PREFLIGHT','BLOCKED') then
      update public.ap_external_commands set state='COMPENSATING',
        provider_object_id=coalesce(provider_object_id,provider_session_id),updated_at=now_at
      where id=command.id and state in ('CREATING','CREATED','APPLYING');
      if not public.ap_expire_material_checkout(
        material_checkout.id,'CANARY_PROVIDER_SESSION_EXPIRED'
      ) then
        raise exception 'manual_launch_canary_provider_reconciliation_failed';
      end if;
    end if;
    if material_checkout.state not in ('READY','OPEN','PREFLIGHT','BLOCKED','EXPIRED','FAILED') then
      raise exception 'manual_launch_canary_provider_reconciliation_failed';
    end if;
    update public.ap_external_commands
    set provider_object_id=coalesce(provider_object_id,provider_session_id),
      reconciliation_state='RECONCILED',failure_code='CANARY_PROVIDER_SESSION_EXPIRED',
      updated_at=now_at
    where id=command.id;
  end if;

  insert into public.ap_manual_launch_canary_receipt_update_tokens(designation_id,transaction_id)
  values(designation.id,txid_current());
  update public.ap_manual_launch_canary_designations
  set provider_terminal_reconciled_at=now_at,provider_terminal_reconciled_by=actor_id,
    provider_terminal_session_id=provider_session_id,provider_terminal_status=p_provider_session_status,
    provider_terminal_payment_status=p_provider_payment_status,
    provider_terminal_evidence_reference=evidence
  where id=designation.id;
  delete from public.ap_manual_launch_canary_receipt_update_tokens where designation_id=designation.id;

  insert into public.ap_audit_events(
    customer_id,actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version
  ) values(
    designation.expected_customer_id,actor_id,'MANUAL_LAUNCH_CANARY_PROVIDER_TERMINAL_RECONCILED',
    'MANUAL_LAUNCH_CANARY_DESIGNATION',designation.id,
    jsonb_build_object('releaseSha',designation.release_sha,'productKind',designation.product_kind,
      'providerSessionId',provider_session_id,'providerSessionStatus',p_provider_session_status,
      'providerPaymentStatus',p_provider_payment_status,'evidenceReference',evidence),
    'manual-launch-canary-v4'
  );
  return true;
end;
$$;
revoke all on function public.ap_reconcile_manual_launch_canary_provider_terminal(
  uuid,text,uuid,text,text,text,text
) from public,anon,authenticated;
grant execute on function public.ap_reconcile_manual_launch_canary_provider_terminal(
  uuid,text,uuid,text,text,text,text
) to service_role;

create or replace function public.ap_supersede_manual_launch_canary_designation(
  p_designation_id uuid,
  p_release_sha text,
  p_actor_id uuid,
  p_evidence_reference text
) returns boolean language plpgsql security definer set search_path='' as $$
declare
  designation public.ap_manual_launch_canary_designations;
  payment public.ap_payment_attempts;
  search_checkout public.ap_checkout_attempts;
  material_checkout public.ap_material_checkout_intents;
  command public.ap_external_commands;
  evidence text:=btrim(coalesce(p_evidence_reference,''));
  now_at timestamptz:=clock_timestamp();
  terminal_and_reconciled boolean:=false;
begin
  if p_release_sha !~ '^[0-9a-f]{40}$' or length(evidence) not between 12 and 500 then
    raise exception 'manual_launch_canary_supersession_input_invalid';
  end if;
  if not exists(select 1 from public.profiles where id=p_actor_id and role='admin') then
    raise exception 'manual_launch_canary_admin_required';
  end if;
  select * into designation from public.ap_manual_launch_canary_designations
    where id=p_designation_id and release_sha=p_release_sha for update;
  if not found then raise exception 'manual_launch_canary_designation_not_found'; end if;
  if designation.superseded_at is not null then
    if designation.superseded_by<>p_actor_id
      or designation.supersession_evidence_reference<>evidence then
      raise exception 'manual_launch_canary_supersession_conflict';
    end if;
    return true;
  end if;
  select * into payment from public.ap_payment_attempts
    where id=designation.payment_attempt_id for update;
  if not found or payment.settlement not in ('UNPAID','FAILED')
    or payment.provider_payment_id is not null or payment.payment_verified_at is not null
    or payment.immediate_charge_verified or payment.dispute<>'NONE' then
    raise exception 'manual_launch_canary_uncharged_payment_required';
  end if;

  if designation.product_kind='SEARCH' then
    select * into search_checkout from public.ap_checkout_attempts
      where id=payment.checkout_attempt_id for update;
    if found then
      select * into command from public.ap_external_commands
        where id=search_checkout.command_id for update;
      terminal_and_reconciled:=(
          search_checkout.state in ('EXPIRED','CANCELED','FAILED')
          or (search_checkout.state='NONE' and search_checkout.invalidated_at is not null)
        )
        and (
          (
            search_checkout.provider_checkout_session_id is null
            and command.state='COMPENSATED' and command.reconciliation_state='RECONCILED'
          ) or (
            search_checkout.provider_checkout_session_id is not null
            and designation.provider_terminal_reconciled_at is not null
            and designation.provider_terminal_session_id=search_checkout.provider_checkout_session_id
            and designation.provider_terminal_status='expired'
            and designation.provider_terminal_payment_status='unpaid'
          )
        );
    end if;
  else
    select * into material_checkout from public.ap_material_checkout_intents
      where payment_attempt_id=payment.id for update;
    if found then
      select * into command from public.ap_external_commands
        where id=material_checkout.command_id for update;
      terminal_and_reconciled:=material_checkout.state in ('EXPIRED','FAILED')
        and (
          (
            material_checkout.provider_checkout_session_id is null
            and command.state='COMPENSATED' and command.reconciliation_state='RECONCILED'
          ) or (
            material_checkout.provider_checkout_session_id is not null
            and designation.provider_terminal_reconciled_at is not null
            and designation.provider_terminal_session_id=material_checkout.provider_checkout_session_id
            and designation.provider_terminal_status='expired'
            and designation.provider_terminal_payment_status='unpaid'
          )
        );
    end if;
  end if;
  if not terminal_and_reconciled then
    raise exception 'manual_launch_canary_terminal_reconciliation_required';
  end if;

  update public.ap_manual_launch_canary_designations
  set superseded_at=now_at,superseded_by=p_actor_id,supersession_evidence_reference=evidence
  where id=designation.id;
  update public.ap_manual_launch_canary_authorizations
  set revoked_at=now_at,revoked_by=p_actor_id,revocation_evidence_reference=evidence
  where id=designation.authorization_id and revoked_at is null;
  insert into public.ap_audit_events(
    customer_id,actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version
  ) values(
    designation.expected_customer_id,p_actor_id,'MANUAL_LAUNCH_CANARY_DESIGNATION_SUPERSEDED',
    'MANUAL_LAUNCH_CANARY_DESIGNATION',designation.id,
    jsonb_build_object('paymentAttemptId',designation.payment_attempt_id,
      'authorizationId',designation.authorization_id,'releaseSha',designation.release_sha,
      'productKind',designation.product_kind,'evidenceReference',evidence),
    'manual-launch-canary-v4'
  );
  return true;
end;
$$;
revoke all on function public.ap_supersede_manual_launch_canary_designation(uuid,text,uuid,text)
  from public,anon,authenticated;
grant execute on function public.ap_supersede_manual_launch_canary_designation(uuid,text,uuid,text)
  to service_role;

create or replace function public.ap_set_manual_launch_capacity_state(
  p_resource public.ap_capacity_resource,
  p_enabled boolean,
  p_actor_id uuid,
  p_reason text
) returns boolean language plpgsql security definer set search_path='' as $$
declare
  pool public.ap_capacity_pools;
  reason text:=btrim(coalesce(p_reason,''));
  bucket_created boolean:=false;
  bucket_units integer:=case when p_resource='SEARCH' then 32 else 64 end;
  now_at timestamptz:=clock_timestamp();
begin
  if p_resource not in ('SEARCH','MATERIALS') or length(reason) not between 12 and 500 then
    raise exception 'manual_launch_capacity_state_input_invalid';
  end if;
  if not exists(select 1 from public.profiles where id=p_actor_id and role='admin') then
    raise exception 'manual_launch_capacity_admin_required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('manual-launch-capacity:'||p_resource::text,0)
  );
  insert into public.ap_capacity_pools(resource,enabled,configuration_version)
  values(p_resource,false,'manual-launch-rolling-24h-v1')
  on conflict(resource) do nothing;
  select * into pool from public.ap_capacity_pools where resource=p_resource for update;
  if not found then raise exception 'manual_launch_capacity_pool_provision_failed'; end if;
  if p_enabled and not exists(
    select 1 from public.ap_capacity_buckets bucket
    where bucket.pool_id=pool.id and bucket.starts_at<=now_at and bucket.ends_at>now_at
  ) then
    if exists(select 1 from public.ap_capacity_buckets bucket
      where bucket.pool_id=pool.id and bucket.ends_at>now_at) then
      raise exception 'manual_launch_capacity_future_bucket_conflict';
    end if;
    insert into public.ap_capacity_buckets(
      pool_id,starts_at,ends_at,total_units,staffing_version
    ) values(
      pool.id,now_at,now_at+interval '31 days',bucket_units,'manual-launch-rolling-24h-v1'
    );
    bucket_created:=true;
  end if;
  if pool.enabled=p_enabled and not bucket_created then return true; end if;
  update public.ap_capacity_pools
  set enabled=p_enabled,configuration_version='manual-launch-rolling-24h-v1',updated_at=now_at
  where id=pool.id;
  insert into public.ap_audit_events(
    actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version
  ) values(
    p_actor_id,case when bucket_created then 'MANUAL_LAUNCH_CAPACITY_PROVISIONED'
      else 'MANUAL_LAUNCH_CAPACITY_STATE_CHANGED' end,'CAPACITY_POOL',pool.id,
    jsonb_build_object('resource',p_resource,'fromEnabled',pool.enabled,
      'toEnabled',p_enabled,'bucketCreated',bucket_created,'bucketUnits',bucket_units,
      'bucketEndsAt',case when bucket_created then now_at+interval '31 days' else null end,
      'reason',reason),'manual-launch-capacity-v2'
  );
  return true;
end;
$$;
revoke all on function public.ap_set_manual_launch_capacity_state(public.ap_capacity_resource,boolean,uuid,text)
  from public,anon,authenticated;
grant execute on function public.ap_set_manual_launch_capacity_state(public.ap_capacity_resource,boolean,uuid,text)
  to service_role;

create or replace function public.ap_record_manual_launch_activation(
  p_activation_phase text,
  p_release_sha text,
  p_evidence jsonb,
  p_actor_id uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  activation_id uuid:=gen_random_uuid();
  existing_id uuid;
  existing_phase text;
  canary_amount integer:=case when p_activation_phase='PUBLIC' then 2698 else 0 end;
  successful_canary_amount integer:=0;
  successful_canary_products integer:=0;
  successful_canary_customers integer:=0;
  required_reference text;
begin
  if p_activation_phase not in ('CANARY','PUBLIC') or p_release_sha !~ '^[0-9a-f]{40}$'
    or jsonb_typeof(p_evidence)<>'object'
    or coalesce(p_evidence->>'workerNetworkAttestationSha256','') !~ '^[0-9a-f]{64}$'
    or coalesce(p_evidence->>'evidenceBundleSha256','') !~ '^[0-9a-f]{64}$' then
    raise exception 'manual_launch_activation_input_invalid';
  end if;
  if not exists(select 1 from public.profiles where id=p_actor_id and role='admin') then
    raise exception 'manual_launch_activation_admin_required';
  end if;
  foreach required_reference in array array[
    'healthEvidenceReference','databaseEvidenceReference','paymentEvidenceReference',
    'emailEvidenceReference','kmsEvidenceReference','workerEvidenceReference',
    'maintenanceEvidenceReference','backupRestoreEvidenceReference','inventoryEvidenceReference',
    'accessibilityEvidenceReference','productSupervisorReference','securitySupervisorReference',
    'operationsSupervisorReference','tenthManSupervisorReference','acceptedP2DispositionReference',
    'canaryReconciliationReference','taxApprovalReference','legacySubscriptionRetirementReference'
  ] loop
    if length(btrim(coalesce(p_evidence->>required_reference,''))) not between 12 and 500 then
      raise exception 'manual_launch_activation_evidence_incomplete';
    end if;
  end loop;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('manual-launch-activation:'||p_release_sha||':'||p_activation_phase,0)
  );
  select id,activation_phase into existing_id,existing_phase from public.ap_manual_launch_activations
    where release_sha=p_release_sha
      and evidence_bundle_sha256=p_evidence->>'evidenceBundleSha256';
  if existing_id is not null then
    if existing_phase<>p_activation_phase then
      raise exception 'manual_launch_activation_evidence_phase_conflict';
    end if;
    return existing_id;
  end if;

  if p_activation_phase='PUBLIC' then
    if not exists(select 1 from public.ap_manual_launch_activations
      where release_sha=p_release_sha and activation_phase='CANARY'
        and unresolved_p0_count=0 and unresolved_p1_count=0) then
      raise exception 'manual_launch_canary_activation_missing';
    end if;
    select coalesce(sum(refund.amount_cents),0),count(distinct designation.product_kind),
      count(distinct designation.expected_customer_id)
      into successful_canary_amount,successful_canary_products,successful_canary_customers
    from public.ap_manual_launch_canary_designations designation
      join public.ap_refund_operations refund
        on refund.payment_attempt_id=designation.payment_attempt_id
    where designation.release_sha=p_release_sha and designation.superseded_at is null
      and refund.reason_code='MANUAL_LAUNCH_CANARY' and refund.state='SUCCEEDED'
      and refund.superseded_at is null;
    if successful_canary_amount<>2698 or successful_canary_products<>2
      or successful_canary_customers<>1 then
      raise exception 'manual_launch_canary_refunds_not_reconciled';
    end if;
  end if;

  insert into public.ap_manual_launch_activations(
    id,release_sha,health_evidence_reference,database_evidence_reference,
    payment_evidence_reference,email_evidence_reference,kms_evidence_reference,
    worker_evidence_reference,maintenance_evidence_reference,backup_restore_evidence_reference,
    inventory_evidence_reference,accessibility_evidence_reference,product_supervisor_reference,
    security_supervisor_reference,operations_supervisor_reference,tenth_man_supervisor_reference,
    accepted_p2_disposition_reference,unresolved_p0_count,unresolved_p1_count,
    canary_reconciliation_reference,canary_reconciled_amount_cents,tax_approval_reference,
    worker_network_attestation_sha256,evidence_bundle_sha256,approved_by,
    legacy_subscription_retirement_reference,activation_phase
  ) values(
    activation_id,p_release_sha,p_evidence->>'healthEvidenceReference',
    p_evidence->>'databaseEvidenceReference',p_evidence->>'paymentEvidenceReference',
    p_evidence->>'emailEvidenceReference',p_evidence->>'kmsEvidenceReference',
    p_evidence->>'workerEvidenceReference',p_evidence->>'maintenanceEvidenceReference',
    p_evidence->>'backupRestoreEvidenceReference',p_evidence->>'inventoryEvidenceReference',
    p_evidence->>'accessibilityEvidenceReference',p_evidence->>'productSupervisorReference',
    p_evidence->>'securitySupervisorReference',p_evidence->>'operationsSupervisorReference',
    p_evidence->>'tenthManSupervisorReference',p_evidence->>'acceptedP2DispositionReference',
    0,0,p_evidence->>'canaryReconciliationReference',canary_amount,
    p_evidence->>'taxApprovalReference',p_evidence->>'workerNetworkAttestationSha256',
    p_evidence->>'evidenceBundleSha256',p_actor_id,
    p_evidence->>'legacySubscriptionRetirementReference',p_activation_phase
  );
  update public.ap_commerce_configuration set
    tax_configuration_approved=true,
    tax_approval_reference=p_evidence->>'taxApprovalReference',
    sales_activation_approved=true,
    sales_activation_reference='manual-launch-activation:'||activation_id::text,
    launch_activation_id=activation_id,
    launch_release_sha=p_release_sha,
    document_worker_network_attestation_sha256=p_evidence->>'workerNetworkAttestationSha256',
    updated_at=clock_timestamp()
  where singleton;
  insert into public.ap_audit_events(
    actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version
  ) values(
    p_actor_id,'MANUAL_LAUNCH_ACTIVATION_RECORDED','MANUAL_LAUNCH_ACTIVATION',activation_id,
    jsonb_build_object('releaseSha',p_release_sha,'activationPhase',p_activation_phase,
      'evidenceBundleSha256',p_evidence->>'evidenceBundleSha256',
      'canaryReconciledAmountCents',canary_amount),'manual-launch-activation-v2'
  );
  return activation_id;
end;
$$;
revoke all on function public.ap_record_manual_launch_activation(text,text,jsonb,uuid)
  from public,anon,authenticated;
grant execute on function public.ap_record_manual_launch_activation(text,text,jsonb,uuid)
  to service_role;

-- Preserve the prior deployed application's refund RPC during a code rollback.
create or replace function public.ap_queue_manual_launch_canary_refund(
  p_payment_attempt_id uuid,
  p_actor_id uuid,
  p_evidence_reference text
) returns uuid language plpgsql security definer set search_path='' as $$
declare release_sha text;
begin
  select designation.release_sha into release_sha
  from public.ap_manual_launch_canary_designations designation
  where designation.payment_attempt_id=p_payment_attempt_id
    and designation.superseded_at is null;
  if release_sha is null then raise exception 'manual_launch_canary_designation_required'; end if;
  return public.ap_queue_manual_launch_canary_refund(
    p_payment_attempt_id,p_actor_id,p_evidence_reference,release_sha
  );
end;
$$;
revoke all on function public.ap_queue_manual_launch_canary_refund(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.ap_queue_manual_launch_canary_refund(uuid,uuid,text)
  to service_role;

commit;

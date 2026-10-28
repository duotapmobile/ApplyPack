-- Break the canary/public-activation dependency without opening public checkout.
-- A CANARY activation still requires the exact deployed release and all pre-canary
-- evidence, but only an immutable, short-lived, customer-bound authorization may
-- use it. The normal application checkout gate continues to require PUBLIC and
-- the fully reconciled $26.98 canary amount.

begin;

alter table public.ap_manual_launch_activations
  add column activation_phase text not null default 'PUBLIC'
    check (activation_phase in ('CANARY','PUBLIC'));
alter table public.ap_manual_launch_activations
  drop constraint ap_manual_launch_activations_canary_reconciled_amount_cen_check;
alter table public.ap_manual_launch_activations
  add constraint ap_manual_launch_activations_canary_reconciled_amount_phase_check
  check (
    (activation_phase='CANARY' and canary_reconciled_amount_cents=0)
    or (activation_phase='PUBLIC' and canary_reconciled_amount_cents=2698)
  );

create table public.ap_manual_launch_canary_authorizations (
  id uuid primary key default gen_random_uuid(),
  release_sha text not null check (release_sha ~ '^[0-9a-f]{40}$'),
  product_kind text not null check (product_kind in ('SEARCH','MATERIALS')),
  expected_customer_id uuid not null references public.profiles(id),
  search_draft_id uuid references public.ap_anonymous_drafts(id),
  authorized_by uuid not null references public.profiles(id),
  evidence_reference text not null check (length(btrim(evidence_reference)) between 12 and 500),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  check (
    (product_kind='SEARCH' and search_draft_id is not null)
    or (product_kind='MATERIALS' and search_draft_id is null)
  ),
  check (expires_at>created_at and expires_at<=created_at+interval '24 hours')
);
create index ap_manual_launch_canary_authorizations_active_lookup
  on public.ap_manual_launch_canary_authorizations(release_sha,product_kind,expires_at desc);
alter table public.ap_manual_launch_canary_authorizations enable row level security;
revoke all on public.ap_manual_launch_canary_authorizations from public,anon,authenticated,service_role;
grant select on public.ap_manual_launch_canary_authorizations to service_role;

create or replace function public.ap_manual_launch_canary_authorization_is_immutable()
returns trigger language plpgsql set search_path='' as $$
begin
  raise exception 'manual_launch_canary_authorization_is_immutable';
end;
$$;
create trigger ap_manual_launch_canary_authorization_immutable
before update or delete on public.ap_manual_launch_canary_authorizations
for each row execute function public.ap_manual_launch_canary_authorization_is_immutable();

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
    where release_sha=p_release_sha and product_kind=p_product_kind and expires_at>now_at
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
    where release_sha=p_release_sha and product_kind=p_product_kind) then
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
    'manual-launch-canary-v3'
  );
  return authorization_id;
end;
$$;
revoke all on function public.ap_authorize_manual_launch_canary_checkout(text,text,uuid,uuid,uuid,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.ap_authorize_manual_launch_canary_checkout(text,text,uuid,uuid,uuid,text,timestamptz)
  to service_role;

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
    )
    and not exists(
      select 1 from public.ap_manual_launch_canary_designations designation
        join public.ap_payment_attempts payment on payment.id=designation.payment_attempt_id
      where designation.release_sha=p_release_sha
        and designation.product_kind=p_product_kind
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
revoke all on function public.ap_manual_launch_canary_checkout_authorized(text,text,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.ap_manual_launch_canary_checkout_authorized(text,text,uuid,uuid)
  to service_role;

create or replace function public.ap_bind_manual_launch_canary_payment(
  p_payment_attempt_id uuid,
  p_release_sha text
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  payment public.ap_payment_attempts;
  canary_authorization public.ap_manual_launch_canary_authorizations;
  v_product_kind text;
begin
  if p_release_sha !~ '^[0-9a-f]{40}$' then
    raise exception 'manual_launch_canary_release_invalid';
  end if;
  select * into payment from public.ap_payment_attempts where id=p_payment_attempt_id for update;
  if not found or payment.provider<>'stripe' or payment.settlement<>'UNPAID'
    or payment.provider_payment_id is not null or payment.payment_verified_at is not null then
    raise exception 'manual_launch_canary_precharge_payment_required';
  end if;
  v_product_kind:=case
    when payment.draft_id is not null and payment.customer_id is null and payment.amount_cents=1899 then 'SEARCH'
    when payment.draft_id is null and payment.customer_id is not null and payment.amount_cents=799 then 'MATERIALS'
    else null end;
  if v_product_kind is null then raise exception 'manual_launch_canary_payment_shape_invalid'; end if;

  select * into canary_authorization from public.ap_manual_launch_canary_authorizations candidate
    where candidate.release_sha=p_release_sha
      and candidate.product_kind=v_product_kind
      and candidate.expires_at>clock_timestamp()
      and (
        (v_product_kind='SEARCH' and candidate.search_draft_id=payment.draft_id)
        or (v_product_kind='MATERIALS' and candidate.expected_customer_id=payment.customer_id)
      )
    order by candidate.created_at desc,candidate.id desc limit 1;
  if not found then raise exception 'manual_launch_canary_authorization_required'; end if;

  return public.ap_designate_manual_launch_canary_payment(
    payment.id,canary_authorization.expected_customer_id,canary_authorization.product_kind,
    canary_authorization.release_sha,canary_authorization.authorized_by,canary_authorization.evidence_reference
  );
end;
$$;
revoke all on function public.ap_bind_manual_launch_canary_payment(uuid,text)
  from public,anon,authenticated;
grant execute on function public.ap_bind_manual_launch_canary_payment(uuid,text)
  to service_role;

commit;

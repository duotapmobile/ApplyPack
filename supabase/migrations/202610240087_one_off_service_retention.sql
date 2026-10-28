begin;

-- Prospective consent, never an age-based backfill. Historical receipts and paid
-- services retain their original contract. Financial rows are not deleted.
create table public.ap_retention_checkout_contracts (
  checkout_attempt_id uuid primary key references public.ap_checkout_attempts(id),
  legal_receipt_id uuid not null references public.ap_snapshot_legal_content_receipts(id),
  policy_version text not null check(policy_version='one_off_30d_v1'),
  created_at timestamptz not null default clock_timestamp()
);
create table public.ap_order_retention_contracts (
  order_id uuid primary key references public.orders(id),
  search_service_id uuid not null unique references public.ap_search_services(id),
  customer_id uuid not null references public.profiles(id),
  checkout_attempt_id uuid not null references public.ap_retention_checkout_contracts(checkout_attempt_id),
  legal_receipt_id uuid not null references public.ap_snapshot_legal_content_receipts(id),
  policy_version text not null check(policy_version='one_off_30d_v1'),
  state text not null default 'ACTIVE' check(state in('ACTIVE','PURGING','PURGED')),
  purged_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check((state='PURGED')=(purged_at is not null))
);
create table public.ap_service_retention_holds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.ap_order_retention_contracts(order_id),
  reason_code text not null check(reason_code in('LEGAL_REQUIREMENT','PAYMENT_DISPUTE','SUPPORT_REVIEW','UNFULFILLED_WORK')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  released_by uuid references public.profiles(id),
  released_at timestamptz,
  check((released_at is null)=(released_by is null))
);
create table public.ap_service_retention_claims (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  order_ids uuid[] not null check(cardinality(order_ids)>0),
  state text not null default 'PENDING' check(state in('PENDING','COMPLETE')),
  redaction_sha256 text,
  redacted_rows integer not null default 0,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  check((state='COMPLETE')=(completed_at is not null)),
  check(redaction_sha256 is null or redaction_sha256 ~ '^[0-9a-f]{64}$')
);
create unique index ap_one_pending_service_retention_claim on public.ap_service_retention_claims(customer_id) where state='PENDING';
create table public.ap_service_retention_objects (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.ap_service_retention_claims(id),
  bucket text not null check(bucket in('customer-source-documents','customer-deliveries','operator-drafts','operator-render-previews')),
  path text,
  path_sha256 text not null check(path_sha256 ~ '^[0-9a-f]{64}$'),
  deleted_at timestamptz,
  unique(claim_id,bucket,path_sha256),
  check((deleted_at is null)=(path is not null))
);
-- Only the private SECURITY DEFINER redactor can create an exact row permit.
-- A caller-set session flag cannot bypass immutability.
create table public.ap_retention_redaction_permits (
  transaction_id bigint not null,
  backend_pid integer not null,
  relation_id oid not null,
  before_sha256 text not null,
  after_sha256 text not null,
  primary key(transaction_id,backend_pid,relation_id,before_sha256,after_sha256)
);
do $$ declare t text; begin
  foreach t in array array['ap_retention_checkout_contracts','ap_order_retention_contracts','ap_service_retention_holds',
    'ap_service_retention_claims','ap_service_retention_objects','ap_retention_redaction_permits'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    if t<>'ap_retention_redaction_permits' then execute format('grant select on public.%I to service_role',t); end if;
  end loop;
end $$;

create function public.ap_retention_redaction_permitted(p_relation oid,p_before jsonb,p_after jsonb)
returns boolean language sql security definer set search_path='' as $$
  select exists(select 1 from public.ap_retention_redaction_permits p
    where p.transaction_id=txid_current() and p.backend_pid=pg_backend_pid() and p.relation_id=p_relation
    and p.before_sha256=encode(extensions.digest((p_before-'updated_at')::text,'sha256'),'hex')
    and p.after_sha256=encode(extensions.digest((p_after-'updated_at')::text,'sha256'),'hex'));
$$;
revoke all on function public.ap_retention_redaction_permitted(oid,jsonb,jsonb) from public,anon,authenticated,service_role;

create function public.ap_guard_retention_contract_history() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' and public.ap_retention_redaction_permitted(tg_relid,to_jsonb(old),to_jsonb(new)) then return new; end if;
  raise exception 'service_retention_history_immutable';
end $$;
create trigger ap_retention_checkout_contract_immutable before update or delete on public.ap_retention_checkout_contracts
  for each row execute function public.ap_guard_retention_contract_history();
create trigger ap_order_retention_contract_immutable before update or delete on public.ap_order_retention_contracts
  for each row execute function public.ap_guard_retention_contract_history();
create trigger ap_retention_hold_immutable before update or delete on public.ap_service_retention_holds
  for each row execute function public.ap_guard_retention_contract_history();

create function public.ap_bind_prospective_retention_checkout() returns trigger language plpgsql security definer set search_path='' as $$
declare q public.ap_quotes; receipt public.ap_snapshot_legal_content_receipts;
begin
  select * into q from public.ap_quotes where id=new.quote_id;
  if q.terms_version='manual-launch-terms-2026-10-24-v3' and q.privacy_version='privacy-2026-10-24-v3' then
    if not public.ap_one_off_retention_schema_installed() then raise exception 'service_retention_cleanup_unavailable'; end if;
    select r.* into receipt from public.ap_snapshot_legal_content_receipts r
      where r.draft_id=new.draft_id and r.snapshot_id=q.snapshot_id
        and r.terms_version=q.terms_version and r.privacy_version=q.privacy_version
        and r.terms_content_sha256='bac56f51e78cd099c8676efcfca5616d2fbdaeb9fc40c8aa0d5053ff968a3428'
        and r.privacy_content_sha256='2d7a8f194c8246775f1bb9803378596bf8bf60fb2a72cb34bf3c009adaa6e311'
        and r.acceptance_copy_version='applypack-legal-acceptance-copy-2026-10-04-v1'
        and r.acceptance_copy_sha256='0d687e93a090a536b90b1508cf61746cb0167d464a951d9ae5cfe0739d7bd283'
      order by r.accepted_at desc,r.id limit 1;
    if receipt.id is null then raise exception 'service_retention_current_consent_required'; end if;
    insert into public.ap_retention_checkout_contracts(checkout_attempt_id,legal_receipt_id,policy_version)
      values(new.id,receipt.id,'one_off_30d_v1');
  end if;
  return new;
end $$;
create trigger ap_bind_prospective_retention_checkout after insert on public.ap_checkout_attempts
  for each row execute function public.ap_bind_prospective_retention_checkout();
create function public.ap_bind_prospective_retention_order() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.ap_retention_checkout_contracts;
begin
  select contract.* into c from public.ap_retention_checkout_contracts contract
    join public.ap_payment_attempts payment on payment.checkout_attempt_id=contract.checkout_attempt_id
    where payment.id=new.winning_payment_attempt_id;
  if c.checkout_attempt_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('service-retention:'||new.customer_id::text,0));
    if exists(select 1 from public.ap_service_retention_claims where customer_id=new.customer_id and state='PENDING')
      then raise exception 'service_retention_purge_committed'; end if;
    insert into public.ap_order_retention_contracts(order_id,search_service_id,customer_id,checkout_attempt_id,legal_receipt_id,policy_version)
      values(new.legacy_order_id,new.id,new.customer_id,c.checkout_attempt_id,c.legal_receipt_id,c.policy_version);
  end if;
  return new;
end $$;
create trigger ap_bind_prospective_retention_order after insert on public.ap_search_services
  for each row execute function public.ap_bind_prospective_retention_order();

create function public.ap_service_retention_deadlines(p_order_id uuid)
returns table(action_expires_at timestamptz,access_expires_at timestamptz,family_expires_at timestamptz)
language sql stable security definer set search_path='' as $$
  with delivery as (
    select min(r.committed_at) filter(where r.release_kind='SEARCH_EXACT_TEN') as first_search,
      max(r.committed_at) filter(where r.release_kind='SEARCH_EXACT_TEN') as last_search,max(r.committed_at) as last_any
    from public.ap_releases r where r.order_id=p_order_id
      or r.material_line_id in(select id from public.ap_material_lines where delivered_order_id=p_order_id)
  ), replacement as (
    select max(c.resolved_at) as last_replacement from public.conflict_reviews c
      join public.job_matches m on m.id=c.job_match_id
      where m.search_order_id=p_order_id and c.status='accepted' and c.resolved_at is not null
        and m.delivered_at>=c.resolved_at and m.reviewed_at>=c.resolved_at and m.reviewed_by is not null
  ) select first_search+interval '720 hours',greatest(last_search,last_replacement)+interval '720 hours',
    greatest(last_any,last_replacement)+interval '720 hours' from delivery cross join replacement;
$$;
create function public.ap_material_retention_deadline(p_line_id uuid) returns timestamptz
language sql stable security definer set search_path='' as $$
  select max(committed_at)+interval '720 hours' from public.ap_releases where material_line_id=p_line_id;
$$;
create function public.ap_service_retention_access_allowed(p_order_id uuid,p_line_id uuid default null,p_action boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
  select not exists(select 1 from public.ap_order_retention_contracts c
    cross join lateral public.ap_service_retention_deadlines(c.order_id) d where (c.order_id=p_order_id
      or c.order_id=(select parent_order_id from public.orders where id=p_order_id)
      or c.order_id=(select delivered_order_id from public.ap_material_lines where id=p_line_id))
    and (c.state<>'ACTIVE' or clock_timestamp()>=case when p_action then d.action_expires_at
      when p_line_id is not null then public.ap_material_retention_deadline(p_line_id) else d.access_expires_at end));
$$;
create function public.ap_assert_service_retention_access(p_order_id uuid,p_line_id uuid default null,p_action boolean default false)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.ap_service_retention_access_allowed(p_order_id,p_line_id,p_action) then
    if p_action then raise exception 'service_retention_action_expired'; else raise exception 'service_retention_access_expired'; end if;
  end if;
end $$;
create function public.ap_customer_retention_access(p_customer_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' and auth.uid() is distinct from p_customer_id
    then raise exception 'service_retention_owner_required'; end if;
  return jsonb_build_object('policyVersion','one_off_30d_v1','orders',coalesce((
    select jsonb_agg(jsonb_build_object('order_id',c.order_id,'policy_version',c.policy_version,
      'action_expires_at',d.action_expires_at,'access_expires_at',d.access_expires_at,
      'access_expired',not public.ap_service_retention_access_allowed(c.order_id),
      'action_expired',not public.ap_service_retention_access_allowed(c.order_id,null,true),'purged_at',c.purged_at) order by c.order_id)
    from public.ap_order_retention_contracts c cross join lateral public.ap_service_retention_deadlines(c.order_id) d
      where c.customer_id=p_customer_id),'[]'::jsonb),'materials',coalesce((
    select jsonb_agg(jsonb_build_object('material_line_id',l.id,'order_id',c.order_id,'policy_version',c.policy_version,
      'access_expires_at',public.ap_material_retention_deadline(l.id),
      'access_expired',not public.ap_service_retention_access_allowed(c.order_id,l.id)) order by l.id)
    from public.ap_order_retention_contracts c join public.ap_material_lines l on l.delivered_order_id=c.order_id
      where c.customer_id=p_customer_id),'[]'::jsonb));
end $$;

-- Existing paid corrections/substitutions keep their obligation workflow. Only
-- creation of a new optional checkout/selection or covered conflict is gated.
create function public.ap_guard_service_retention_action() returns trigger language plpgsql security definer set search_path='' as $$
declare order_id_value uuid;
begin
  if tg_table_name='ap_material_checkout_intents' then order_id_value:=new.delivered_order_id;
  elsif tg_table_name='conflict_reviews' then select search_order_id into order_id_value from public.job_matches where id=new.job_match_id;
  else order_id_value:=new.search_order_id; end if;
  perform public.ap_assert_service_retention_access(order_id_value,null,true);
  return new;
end $$;
create trigger ap_retention_material_checkout_gate before insert on public.ap_material_checkout_intents
  for each row execute function public.ap_guard_service_retention_action();
create trigger ap_retention_conflict_gate before insert on public.conflict_reviews
  for each row execute function public.ap_guard_service_retention_action();
create trigger ap_retention_selection_gate before update of customer_decision on public.job_matches
  for each row when(new.customer_decision is not null and old.customer_decision is distinct from new.customer_decision)
  execute function public.ap_guard_service_retention_action();

-- An access deadline may leave less than the normal fifteen-minute link window.
-- Existing audit rows satisfy this tighter upper bound without alteration.
alter table public.ap_material_download_audits drop constraint ap_material_download_audits_check;
alter table public.ap_material_download_audits add constraint ap_material_download_audits_check
  check(expires_at>issued_at and expires_at<=issued_at+interval '15 minutes');

do $$ declare definition text; begin
  definition:=replace(pg_get_functiondef('public.ap_authorize_material_download(uuid,uuid,uuid,timestamptz)'::regprocedure),chr(13),'');
  if position('  expires_value:=now_at+interval ''15 minutes'';' in definition)=0 then raise exception 'retention_download_anchor_missing'; end if;
  definition:=replace(definition,'  expires_value:=now_at+interval ''15 minutes'';',
    '  perform public.ap_assert_service_retention_access(artifact.order_id,artifact.material_line_id,false);
  expires_value:=now_at+interval ''15 minutes'';
  if exists(select 1 from public.ap_order_retention_contracts where order_id=artifact.order_id) then
    expires_value:=least(expires_value,public.ap_material_retention_deadline(artifact.material_line_id));
  end if;');
  execute definition;
end $$;

create function public.ap_service_retention_order_protected(p_order_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select not exists(select 1 from public.ap_order_retention_contracts where order_id=p_order_id)
    or exists(select 1 from public.ap_service_retention_holds where order_id=p_order_id and released_at is null)
    or exists(select 1 from public.ap_search_services where legacy_order_id=p_order_id
      and (fulfillment not in('DELIVERED','CANCELED') or adjustment='PROPOSED'))
    or exists(select 1 from public.conflict_reviews c join public.job_matches m on m.id=c.job_match_id
      where m.search_order_id=p_order_id and (c.resolved_at is null or c.status='submitted'))
    or exists(select 1 from public.ap_material_lines where delivered_order_id=p_order_id
      and (fulfillment not in('DELIVERED','CANCELED','NOT_PURCHASED') or substitution in('REQUIRED','OFFERED')))
    or exists(select 1 from public.ap_material_change_proposals p join public.ap_material_lines l on l.id=p.material_line_id
      where l.delivered_order_id=p_order_id and (p.state='PROPOSED' or (p.state='ACCEPTED' and l.fulfillment not in('DELIVERED','CANCELED'))))
    or exists(select 1 from public.ap_material_support_cases s join public.ap_material_lines l on l.id=s.material_line_id
      where l.delivered_order_id=p_order_id and s.state='OPEN')
    or exists(select 1 from public.ap_reference_regenerations r join public.ap_material_lines l on l.id=r.material_line_id
      where l.delivered_order_id=p_order_id and r.state::text not in('DELIVERED','FAILED','CANCELED'))
    or exists(select 1 from public.ap_material_checkout_intents where delivered_order_id=p_order_id
      and state::text not in('COMPLETED','EXPIRED','FAILED'))
    or exists(select 1 from public.ap_payment_attempts p where p.id in(
      select winning_payment_attempt_id from public.ap_search_services where legacy_order_id=p_order_id
      union select payment_attempt_id from public.ap_material_lines where delivered_order_id=p_order_id)
      and (p.dispute='OPEN' or p.settlement='PROCESSING'))
    or exists(select 1 from public.ap_refund_operations r where r.payment_attempt_id in(
      select winning_payment_attempt_id from public.ap_search_services where legacy_order_id=p_order_id
      union select payment_attempt_id from public.ap_material_lines where delivered_order_id=p_order_id)
      and r.state<>'SUCCEEDED' and r.superseded_at is null)
    -- Losing/stale attempts share the same intake and must finish payment/refund
    -- reconciliation before its private evidence can be minimized.
    or exists(select 1 from public.ap_search_services s
      join public.ap_intake_snapshots snapshot on snapshot.id=s.original_snapshot_id
      join public.ap_payment_attempts p on p.draft_id=snapshot.draft_id
      where s.legacy_order_id=p_order_id and p.id is distinct from s.winning_payment_attempt_id
        and (p.dispute='OPEN' or p.settlement in('PROCESSING','PAID'))
        and not exists(select 1 from public.ap_refund_operations r where r.payment_attempt_id=p.id
          and r.state='SUCCEEDED' and r.amount_cents=p.amount_cents))
    or exists(select 1 from public.ap_search_services s
      join public.ap_intake_snapshots snapshot on snapshot.id=s.original_snapshot_id
      join public.ap_payment_attempts p on p.draft_id=snapshot.draft_id
      join public.ap_refund_operations r on r.payment_attempt_id=p.id
      where s.legacy_order_id=p_order_id and r.state<>'SUCCEEDED' and r.superseded_at is null)
    or exists(select 1 from public.ap_generated_artifacts where order_id=p_order_id and retention_state='LEGAL_HOLD');
$$;

create function public.ap_service_retention_customer_protected(p_customer_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select
    -- A historical order can share snapshots, facts, source objects or a profile.
    exists(select 1 from public.orders o where o.customer_id=p_customer_id
      and ((o.product_kind='job_search' and not exists(select 1 from public.ap_order_retention_contracts c where c.order_id=o.id))
        or (o.product_kind='apply_pack' and not exists(select 1 from public.ap_order_retention_contracts c where c.order_id=o.parent_order_id))))
    or exists(select 1 from public.ap_order_retention_contracts c
      cross join lateral public.ap_service_retention_deadlines(c.order_id) d
      where c.customer_id=p_customer_id and c.state='ACTIVE' and
        (d.family_expires_at is null or d.family_expires_at>clock_timestamp() or public.ap_service_retention_order_protected(c.order_id)))
    or exists(select 1 from public.ap_document_versions where customer_id=p_customer_id and retention_state='LEGAL_HOLD')
    or exists(select 1 from public.ap_sensitive_payloads where customer_id=p_customer_id and retention_state='LEGAL_HOLD')
    or exists(select 1 from public.ap_reference_records where customer_id=p_customer_id and retention_state='LEGAL_HOLD')
    or exists(select 1 from public.ap_anonymous_drafts where converted_customer_id=p_customer_id and retention_state='LEGAL_HOLD')
    or exists(select 1 from public.ap_checkout_initiations where customer_id=p_customer_id and state in('INITIATED','OPEN','EXPIRATION_REQUIRED'));
$$;

create function public.ap_set_service_retention_hold(p_order_id uuid,p_actor_id uuid,p_reason_code text,
  p_hold_id uuid default null,p_release boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.ap_order_retention_contracts; h public.ap_service_retention_holds; after_value jsonb; hold_id uuid;
begin
  if p_reason_code is null or p_reason_code not in('LEGAL_REQUIREMENT','PAYMENT_DISPUTE','SUPPORT_REVIEW','UNFULFILLED_WORK')
    or not exists(select 1 from public.profiles where id=p_actor_id and role='admin')
    then raise exception 'service_retention_hold_invalid'; end if;
  select * into c from public.ap_order_retention_contracts where order_id=p_order_id for update;
  if c.order_id is null then raise exception 'service_retention_contract_missing'; end if;
  perform pg_advisory_xact_lock(hashtextextended('service-retention:'||c.customer_id::text,0));
  if c.state<>'ACTIVE' then raise exception 'service_retention_purge_committed'; end if;
  if p_release then
    select * into h from public.ap_service_retention_holds where id=p_hold_id and order_id=p_order_id and reason_code=p_reason_code for update;
    if h.id is null then raise exception 'service_retention_hold_missing'; end if;
    if h.released_at is not null then return h.id; end if;
    after_value:=to_jsonb(h)||jsonb_build_object('released_by',p_actor_id,'released_at',clock_timestamp());
    insert into public.ap_retention_redaction_permits values(txid_current(),pg_backend_pid(),'public.ap_service_retention_holds'::regclass,
      encode(extensions.digest(to_jsonb(h)::text,'sha256'),'hex'),encode(extensions.digest(after_value::text,'sha256'),'hex'));
    update public.ap_service_retention_holds set released_by=p_actor_id,released_at=(after_value->>'released_at')::timestamptz where id=h.id;
    delete from public.ap_retention_redaction_permits where transaction_id=txid_current() and backend_pid=pg_backend_pid();
    return h.id;
  end if;
  if p_hold_id is not null then raise exception 'service_retention_hold_invalid'; end if;
  insert into public.ap_service_retention_holds(order_id,reason_code,created_by) values(p_order_id,p_reason_code,p_actor_id) returning id into hold_id;
  return hold_id;
end $$;

create function public.ap_legacy_intake_retention_allowed(p_intake_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select not exists(select 1 from public.orders o join public.ap_order_retention_contracts c on c.order_id=o.id
    where o.intake_id=p_intake_id)
    and not exists(select 1 from public.ap_intake_snapshots s join public.ap_search_services service
      on service.original_snapshot_id=s.id or service.active_snapshot_id=s.id
      join public.ap_order_retention_contracts c on c.order_id=service.legacy_order_id where s.intake_id=p_intake_id);
$$;

create function public.ap_legacy_delivery_access_allowed(p_item_id uuid,p_customer_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.apply_pack_items item join public.orders o on o.id=item.order_id
    join public.job_matches m on m.id=item.job_match_id where item.id=p_item_id and o.customer_id=p_customer_id
    and not exists(select 1 from public.ap_order_retention_contracts c
      where c.order_id=o.parent_order_id or c.order_id=m.search_order_id));
$$;

create function public.ap_admin_service_retention_status(p_limit integer default 100) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'service_retention_limit_invalid'; end if;
  return jsonb_build_object('policyVersion','one_off_30d_v1','orders',coalesce((
    select jsonb_agg(item order by order_id) from (
      select c.order_id,jsonb_build_object('order_id',c.order_id,'customer_id',c.customer_id,
        'action_expires_at',d.action_expires_at,'access_expires_at',d.access_expires_at,'family_expires_at',d.family_expires_at,
        'state',c.state,'purged_at',c.purged_at,'protected',public.ap_service_retention_customer_protected(c.customer_id),
        'holds',coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'reason_code',h.reason_code,
          'created_at',h.created_at,'released_at',h.released_at) order by h.created_at,h.id)
          from public.ap_service_retention_holds h where h.order_id=c.order_id),'[]'::jsonb)) as item
      from public.ap_order_retention_contracts c cross join lateral public.ap_service_retention_deadlines(c.order_id) d
      order by c.order_id limit p_limit
    ) entries),'[]'::jsonb));
end $$;

create function public.ap_service_retention_customer_expiry(p_customer_id uuid) returns timestamptz
language sql stable security definer set search_path='' as $$
  select case when exists(select 1 from public.orders o where o.customer_id=p_customer_id
      and ((o.product_kind='job_search' and not exists(select 1 from public.ap_order_retention_contracts c where c.order_id=o.id))
        or (o.product_kind='apply_pack' and not exists(select 1 from public.ap_order_retention_contracts c where c.order_id=o.parent_order_id))))
    or exists(select 1 from public.ap_order_retention_contracts c cross join lateral public.ap_service_retention_deadlines(c.order_id) d
      where c.customer_id=p_customer_id and (d.family_expires_at is null or public.ap_service_retention_order_protected(c.order_id)))
    or exists(select 1 from public.ap_document_versions where customer_id=p_customer_id and retention_state='LEGAL_HOLD')
    or exists(select 1 from public.ap_sensitive_payloads where customer_id=p_customer_id and retention_state='LEGAL_HOLD')
    or exists(select 1 from public.ap_reference_records where customer_id=p_customer_id and retention_state='LEGAL_HOLD')
    then null else (select max(d.family_expires_at) from public.ap_order_retention_contracts c
      cross join lateral public.ap_service_retention_deadlines(c.order_id) d where c.customer_id=p_customer_id) end;
$$;

create function public.ap_service_retention_object_policies() returns jsonb
language sql stable security definer set search_path='' as $$
  with artifacts as (
    select a.*,c.order_id is not null as prospective,
      case when c.order_id is null or a.retention_state='LEGAL_HOLD' or public.ap_service_retention_order_protected(c.order_id) then null
        when a.material_line_id is not null then public.ap_material_retention_deadline(a.material_line_id)
        else d.access_expires_at end as expiry
    from public.ap_generated_artifacts a left join public.ap_material_lines l on l.id=a.material_line_id
      left join public.ap_order_retention_contracts c on c.order_id=coalesce(l.delivered_order_id,a.order_id)
      cross join lateral public.ap_service_retention_deadlines(c.order_id) d
  ), object_rows as (
    select d.storage_bucket as bucket,d.storage_path as path,
      case when d.retention_state='LEGAL_HOLD' then null
        else public.ap_service_retention_customer_expiry(coalesce(d.customer_id,draft.converted_customer_id)) end as expiry,
      exists(select 1 from public.ap_order_retention_contracts c where c.customer_id=coalesce(d.customer_id,draft.converted_customer_id)) as prospective
      from public.ap_document_versions d left join public.ap_anonymous_drafts draft on draft.id=d.draft_id
    union all select f.storage_bucket,f.storage_path,a.expiry,a.prospective from public.ap_generated_file_versions f join artifacts a on a.id=f.artifact_id
    union all select q.render_preview_bucket,q.render_preview_path,a.expiry,a.prospective from public.ap_artifact_quality_reviews q
      join public.ap_generated_file_versions f on f.id=q.file_version_id join artifacts a on a.id=f.artifact_id
    union all select a.claim_provenance#>>'{editableSource,storageBucket}',a.claim_provenance#>>'{editableSource,storagePath}',a.expiry,a.prospective
      from artifacts a where a.claim_provenance#>>'{editableSource,storagePath}' is not null
    union all select 'customer-source-documents',i.resume_path,public.ap_service_retention_customer_expiry(i.customer_id),
      exists(select 1 from public.ap_order_retention_contracts c where c.customer_id=i.customer_id)
      from public.intakes i where i.resume_path<>''
    union all select 'customer-source-documents',i.cover_letter_path,public.ap_service_retention_customer_expiry(i.customer_id),
      exists(select 1 from public.ap_order_retention_contracts c where c.customer_id=i.customer_id)
      from public.intakes i where i.cover_letter_path is not null and i.cover_letter_path<>''
    -- Include every historical alias before grouping. Only paths with a
    -- prospective alias receive a policy; an ungoverned alias vetoes expiry.
    union all select 'customer-source-documents',s.storage_path,null::timestamptz,false from public.source_documents s
    union all select 'customer-source-documents',v.document->>'path',null::timestamptz,false
      from public.intake_drafts d cross join lateral(values(d.resume_document),(d.cover_letter_document)) v(document)
    union all select v.bucket,v.path,null::timestamptz,false from public.apply_pack_items i
      cross join lateral(values('customer-deliveries',i.resume_path),('customer-deliveries',i.cover_letter_path),
        ('operator-drafts',i.draft_resume_path),('operator-drafts',i.draft_cover_letter_path)) v(bucket,path)
    union all select 'customer-deliveries',v.path,null::timestamptz,false from public.apply_pack_delivery_revisions r
      cross join lateral(values(r.resume_path),(r.cover_letter_path)) v(path)
  ), grouped as (
    select bucket,encode(extensions.digest(path,'sha256'),'hex') as path_hash,
      bool_or(expiry is null) as protected,case when bool_or(expiry is null) then null else max(expiry) end as expiry
      from object_rows where bucket in('customer-source-documents','customer-deliveries','operator-drafts','operator-render-previews')
        and path is not null and path<>'' group by bucket,path having bool_or(prospective)
  ) select coalesce(jsonb_agg(jsonb_build_object('bucket',bucket,'pathSha256',path_hash,'retentionExpiresAt',expiry,'protected',protected)
    order by bucket,path_hash),'[]'::jsonb) from grouped;
$$;

create function public.ap_export_service_retention_overlay() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare object_policies jsonb;
begin
  if (select count(*) from public.ap_order_retention_contracts)>10000
    or (select count(*) from public.ap_service_retention_holds)>40000
    or (select count(*) from public.ap_service_retention_objects where deleted_at is not null)>40000
    then raise exception 'service_retention_overlay_bound_exceeded'; end if;
  object_policies:=public.ap_service_retention_object_policies();
  if jsonb_array_length(object_policies)>40000 then raise exception 'service_retention_overlay_bound_exceeded'; end if;
  return (select jsonb_build_object('schemaVersion','applypack-service-retention-overlay-v1','policyVersion','one_off_30d_v1',
    'sourceWatermark',greatest(coalesce((select max(updated_at) from public.ap_order_retention_contracts),'1970-01-01Z'::timestamptz),
      coalesce((select max(greatest(created_at,released_at)) from public.ap_service_retention_holds),'1970-01-01Z'::timestamptz),
      coalesce((select max(r.created_at) from public.ap_releases r where r.order_id in(select order_id from public.ap_order_retention_contracts)
        or r.material_line_id in(select l.id from public.ap_material_lines l join public.ap_order_retention_contracts c on c.order_id=l.delivered_order_id)),'1970-01-01Z'::timestamptz),
      coalesce((select max(greatest(c.created_at,c.resolved_at)) from public.conflict_reviews c
        join public.job_matches m on m.id=c.job_match_id join public.ap_order_retention_contracts r on r.order_id=m.search_order_id),'1970-01-01Z'::timestamptz),
      coalesce((select max(deleted_at) from public.ap_service_retention_objects),'1970-01-01Z'::timestamptz)),
    'orders',coalesce((select jsonb_agg(jsonb_build_object('orderId',c.order_id,'customerId',c.customer_id,
      'legalReceiptId',c.legal_receipt_id,'actionExpiresAt',d.action_expires_at,'accessExpiresAt',d.access_expires_at,
      'familyExpiresAt',d.family_expires_at,'protected',public.ap_service_retention_customer_protected(c.customer_id),
      'state',c.state,'purgedAt',c.purged_at) order by c.order_id)
      from public.ap_order_retention_contracts c cross join lateral public.ap_service_retention_deadlines(c.order_id) d),'[]'::jsonb),
    'holds',coalesce((select jsonb_agg(jsonb_build_object('id',id,'orderId',order_id,'reasonCode',reason_code,
      'createdAt',created_at,'releasedAt',released_at) order by id) from public.ap_service_retention_holds),'[]'::jsonb),
    'objectTombstones',coalesce((select jsonb_agg(jsonb_build_object('bucket',bucket,'pathSha256',path_sha256,'deletedAt',deleted_at)
      order by bucket,path_sha256) from (select bucket,path_sha256,max(deleted_at) as deleted_at
        from public.ap_service_retention_objects where deleted_at is not null group by bucket,path_sha256) t),'[]'::jsonb),
    'objectPolicies',object_policies));
end;
$$;

-- The same restrictive boundary applies to direct authenticated database reads,
-- independently of portal filtering and delayed physical minimization.
create function public.ap_retention_customer_private_access_allowed(p_customer_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select not exists(select 1 from public.ap_order_retention_contracts where customer_id=p_customer_id)
    or exists(select 1 from public.orders o where o.customer_id=p_customer_id and o.product_kind='job_search'
      and not exists(select 1 from public.ap_order_retention_contracts c where c.order_id=o.id))
    or exists(select 1 from public.ap_order_retention_contracts c cross join lateral public.ap_service_retention_deadlines(c.order_id) d
      where c.customer_id=p_customer_id and c.state='ACTIVE' and (d.family_expires_at is null or d.family_expires_at>clock_timestamp()
        or exists(select 1 from public.ap_material_lines l where l.delivered_order_id=c.order_id
          and l.materials_payment_verified_at is not null and l.fulfillment not in('DELIVERED','CANCELED'))
        or exists(select 1 from public.ap_material_change_proposals p join public.ap_material_lines l on l.id=p.material_line_id
          where l.delivered_order_id=c.order_id and p.state='PROPOSED')
        or exists(select 1 from public.ap_material_support_cases s join public.ap_material_lines l on l.id=s.material_line_id
          where l.delivered_order_id=c.order_id and s.state='OPEN')));
$$;
create function public.ap_retention_snapshot_private_access_allowed(p_snapshot_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  with families as (
    select legacy_order_id as order_id from public.ap_search_services where original_snapshot_id=p_snapshot_id or active_snapshot_id=p_snapshot_id
    union select l.delivered_order_id from public.ap_material_lines l join public.ap_material_line_revisions v on v.line_id=l.id where v.source_snapshot_id=p_snapshot_id
    union select s.legacy_order_id from public.ap_criteria_amendments a join public.ap_search_services s on s.id=a.search_service_id
      where a.parent_snapshot_id=p_snapshot_id or a.child_snapshot_id=p_snapshot_id
  ) select not exists(select 1 from families)
    or exists(select 1 from families f where not exists(select 1 from public.ap_order_retention_contracts c where c.order_id=f.order_id))
    or exists(select 1 from families f join public.ap_order_retention_contracts c on c.order_id=f.order_id
      cross join lateral public.ap_service_retention_deadlines(c.order_id) d where c.state='ACTIVE' and
      (d.family_expires_at is null or d.family_expires_at>clock_timestamp()
        or exists(select 1 from public.ap_material_lines l where l.delivered_order_id=c.order_id and l.materials_payment_verified_at is not null
          and l.fulfillment not in('DELIVERED','CANCELED'))
        or exists(select 1 from public.ap_material_change_proposals p join public.ap_material_lines l on l.id=p.material_line_id
          where l.delivered_order_id=c.order_id and p.state='PROPOSED')
        or exists(select 1 from public.ap_material_support_cases s join public.ap_material_lines l on l.id=s.material_line_id
          where l.delivered_order_id=c.order_id and s.state='OPEN')));
$$;

create function public.ap_retention_reference_permission_visible(p_release_id uuid,p_job_snapshot_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select public.ap_service_retention_access_allowed(r.order_id,r.material_line_id)
    or exists(select 1 from public.ap_material_lines l join public.ap_material_line_revisions v on v.line_id=l.id
      where l.delivered_order_id=r.order_id and v.version=l.active_revision and v.job_snapshot_id=p_job_snapshot_id
        and l.materials_payment_verified_at is not null and public.ap_service_retention_access_allowed(l.delivered_order_id,l.id))
  from public.ap_releases r where r.id=p_release_id;
$$;
create function public.ap_customer_visible_reference_permissions(p_customer_id uuid) returns uuid[]
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' and auth.uid() is distinct from p_customer_id
    then raise exception 'service_retention_owner_required'; end if;
  return coalesce((select array_agg(id order by id) from public.ap_reference_permissions where customer_id=p_customer_id
    and public.ap_retention_reference_permission_visible(delivered_release_id,job_snapshot_id)),array[]::uuid[]);
end $$;
create function public.ap_retention_private_row_visible(p_table text,p_row jsonb) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare owner_id uuid; order_id_value uuid; line_id uuid; artifact public.ap_generated_artifacts; snapshot public.ap_intake_snapshots;
begin
  if public.is_admin() then return true; end if;
  if p_table='ap_reference_permissions' then
    return coalesce(public.ap_retention_reference_permission_visible((p_row->>'delivered_release_id')::uuid,(p_row->>'job_snapshot_id')::uuid),false);
  end if;
  if p_table='ap_intake_snapshots' then return public.ap_retention_snapshot_private_access_allowed((p_row->>'id')::uuid); end if;
  if p_table in('ap_candidate_facts','ap_match_evaluations','ap_human_review_records','ap_candidate_questions') and p_row->>'snapshot_id' is not null then
    return public.ap_retention_snapshot_private_access_allowed((p_row->>'snapshot_id')::uuid);
  end if;
  if p_table='apply_pack_items' then
    select customer_id into owner_id from public.orders where id=(p_row->>'order_id')::uuid;
    return public.ap_legacy_delivery_access_allowed((p_row->>'id')::uuid,owner_id);
  end if;
  if p_table='correction_requests' then
    return public.ap_legacy_delivery_access_allowed((p_row->>'apply_pack_item_id')::uuid,(p_row->>'customer_id')::uuid);
  end if;
  if p_table='job_matches' then return public.ap_service_retention_access_allowed((p_row->>'search_order_id')::uuid); end if;
  if p_table='conflict_reviews' then
    select search_order_id into order_id_value from public.job_matches where id=(p_row->>'job_match_id')::uuid;
    return public.ap_service_retention_access_allowed(order_id_value);
  end if;
  if p_table='ap_releases' then return public.ap_service_retention_access_allowed((p_row->>'order_id')::uuid,(p_row->>'material_line_id')::uuid); end if;
  if p_table='ap_generated_file_versions' then
    select * into artifact from public.ap_generated_artifacts where id=(p_row->>'artifact_id')::uuid;
    return public.ap_service_retention_access_allowed(artifact.order_id,artifact.material_line_id);
  end if;
  if p_table='ap_generated_artifacts' then
    return public.ap_service_retention_access_allowed((p_row->>'order_id')::uuid,(p_row->>'material_line_id')::uuid);
  end if;
  if p_table='ap_material_lines' then
    return public.ap_service_retention_access_allowed((p_row->>'delivered_order_id')::uuid,(p_row->>'id')::uuid);
  end if;
  if p_table in('ap_material_line_revisions','ap_material_change_proposals','ap_material_listing_checks','ap_material_entitlement_claims','ap_material_entitlement_history') then
    line_id:=coalesce((p_row->>'material_line_id')::uuid,(p_row->>'line_id')::uuid);
    if p_table='ap_material_entitlement_claims' then
      select h.line_id into line_id from public.ap_material_entitlement_history h where h.id=(p_row->>'entitlement_history_id')::uuid;
    end if;
    select delivered_order_id into order_id_value from public.ap_material_lines where id=line_id;
    return order_id_value is not null and public.ap_service_retention_access_allowed(order_id_value,line_id);
  end if;
  if p_table='ap_artifact_quality_reviews' then
    select a.* into artifact from public.ap_generated_artifacts a join public.ap_generated_file_versions f on f.artifact_id=a.id
      where f.id=(p_row->>'file_version_id')::uuid;
    return artifact.id is not null and public.ap_service_retention_access_allowed(artifact.order_id,artifact.material_line_id);
  end if;
  if p_table='ap_artifact_reference_permissions' then
    select * into artifact from public.ap_generated_artifacts where id=(p_row->>'artifact_id')::uuid;
    return artifact.id is not null and public.ap_service_retention_access_allowed(artifact.order_id,artifact.material_line_id);
  end if;
  owner_id:=coalesce((p_row->>'customer_id')::uuid,(p_row->>'converted_customer_id')::uuid);
  if owner_id is null and p_table in('ap_reference_record_versions','ap_reference_staff_access') then
    select customer_id into owner_id from public.ap_reference_records where id=(p_row->>'reference_record_id')::uuid;
  end if;
  if owner_id is null and p_table in('ap_material_checkout_items','ap_material_checkout_references') then
    select customer_id into owner_id from public.ap_material_checkout_intents where id=(p_row->>'checkout_intent_id')::uuid;
  end if;
  if owner_id is null and p_table='ap_candidate_fact_conflicts' then
    select coalesce(f.customer_id,d.converted_customer_id) into owner_id from public.ap_candidate_facts f
      left join public.ap_anonymous_drafts d on d.id=f.draft_id where f.id=(p_row->>'fact_id')::uuid;
  end if;
  if owner_id is null and p_table='ap_criteria_amendments' then
    select customer_id into owner_id from public.ap_search_services where id=(p_row->>'search_service_id')::uuid;
  end if;
  if owner_id is null and p_row->>'intake_id' is not null then
    select customer_id into owner_id from public.intakes where id=(p_row->>'intake_id')::uuid;
  end if;
  if owner_id is null and p_row->>'draft_id' is not null then
    select converted_customer_id into owner_id from public.ap_anonymous_drafts where id=(p_row->>'draft_id')::uuid;
  end if;
  if owner_id is null and p_row->>'snapshot_id' is not null then
    select * into snapshot from public.ap_intake_snapshots where id=(p_row->>'snapshot_id')::uuid;
    owner_id:=snapshot.customer_id;
    if owner_id is null then select converted_customer_id into owner_id from public.ap_anonymous_drafts where id=snapshot.draft_id; end if;
  end if;
  return owner_id is not null and public.ap_retention_customer_private_access_allowed(owner_id);
end $$;

create function public.ap_customer_private_retention_access(p_customer_id uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' and auth.uid() is distinct from p_customer_id
    then raise exception 'service_retention_owner_required'; end if;
  return public.ap_retention_customer_private_access_allowed(p_customer_id);
end $$;

create function public.ap_guard_reference_retention_access() returns trigger
language plpgsql security definer set search_path='' as $$
declare order_id_value uuid;
begin
  select order_id into order_id_value from public.ap_releases where id=new.delivered_release_id;
  if public.ap_service_retention_access_allowed(order_id_value,null,true) then return new; end if;
  if exists(select 1 from public.ap_material_lines l join public.ap_material_line_revisions v
      on v.line_id=l.id and v.version=l.active_revision
    where l.delivered_order_id=order_id_value and l.materials_payment_verified_at is not null
      and l.selected_reference_sheet and l.fulfillment not in('DELIVERED','CANCELED')
      and v.job_snapshot_id=new.job_snapshot_id) then return new; end if;
  raise exception 'service_retention_action_expired';
end $$;
create trigger ap_reference_retention_access before insert on public.ap_reference_permissions
  for each row execute function public.ap_guard_reference_retention_access();

do $$ declare definition text; name text; begin
  foreach name in array array['can_view_delivered_job','can_view_delivered_job_match'] loop
    definition:=replace(pg_get_functiondef(('public.'||name||'(uuid)')::regprocedure),chr(13),'');
    if position('and order_row.customer_id = auth.uid()' in definition)=0 then raise exception 'retention_job_visibility_anchor_missing'; end if;
    execute replace(definition,'and order_row.customer_id = auth.uid()',
      'and order_row.customer_id = auth.uid() and public.ap_service_retention_access_allowed(order_row.id)');
  end loop;
  definition:=pg_get_functiondef('public.ap_current_customer_question(uuid,uuid)'::regprocedure);
  if position('where q.id=p_question_id and public.ap_customer_owns_snapshot(p_customer_id,s.id)' in definition)=0 then raise exception 'retention_questions_anchor_missing'; end if;
  execute replace(definition,'where q.id=p_question_id and public.ap_customer_owns_snapshot(p_customer_id,s.id)',
    'where q.id=p_question_id and public.ap_customer_owns_snapshot(p_customer_id,s.id) and public.ap_retention_snapshot_private_access_allowed(s.id)');
  foreach name in array array['ap_create_reference_record(uuid,uuid,text,text)','ap_replace_reference(uuid,uuid,uuid,text,text)','ap_confirm_reference_version(uuid,uuid)'] loop
    definition:=replace(pg_get_functiondef(('public.'||name)::regprocedure),chr(13),'');
    if position(chr(10)||'begin'||chr(10) in definition)=0 then raise exception 'retention_reference_mutation_anchor_missing'; end if;
    execute replace(definition,chr(10)||'begin'||chr(10),chr(10)||'begin'||chr(10)||
      '  if not public.ap_retention_customer_private_access_allowed(p_customer_id) then raise exception ''service_retention_access_expired''; end if;'||chr(10));
  end loop;
end $$;
do $$ declare t text; begin
  foreach t in array array['job_matches','intakes','intake_answers','ap_anonymous_drafts','ap_intake_snapshots',
    'ap_sensitive_payloads','ap_candidate_facts','ap_experience_identities','ap_document_versions','ap_generated_artifacts',
    'ap_generated_file_versions','ap_material_lines','ap_material_checkout_intents','ap_human_review_records','ap_match_evaluations',
    'ap_reference_records','ap_reference_permissions','ap_independent_verification_sources','ap_candidate_questions',
    'ap_material_support_cases','ap_reference_regenerations','ap_reference_isolation_reviews','conflict_reviews',
    'correction_requests','ap_releases','apply_pack_items','ap_artifact_quality_reviews','ap_artifact_reference_permissions',
    'ap_material_line_revisions','ap_material_change_proposals','ap_material_listing_checks','ap_material_entitlement_claims',
    'ap_material_entitlement_history','ap_reference_record_versions','ap_reference_staff_access','ap_material_checkout_items',
    'ap_material_checkout_references','ap_candidate_fact_conflicts','ap_criteria_amendments','criteria_versions'] loop
    execute format('create policy ap_retention_private_read on public.%I as restrictive for select to authenticated using(public.ap_retention_private_row_visible(%L,to_jsonb(%I.*)))',t,t,t);
  end loop;
end $$;

-- Forward legal-content binding. The immutable earlier episodes remain intact.
update public.ap_commerce_configuration set terms_version='manual-launch-terms-2026-10-24-v3',
  terms_content_sha256='bac56f51e78cd099c8676efcfca5616d2fbdaeb9fc40c8aa0d5053ff968a3428',
  privacy_version='privacy-2026-10-24-v3',privacy_content_sha256='2d7a8f194c8246775f1bb9803378596bf8bf60fb2a72cb34bf3c009adaa6e311',
  sales_activation_approved=false,sales_activation_reference=null,launch_activation_id=null,launch_release_sha=null,
  updated_at=clock_timestamp() where singleton;
update public.ap_checkout_mode_configuration set mode='LOCKED',release_sha=null,generation=generation+1,updated_at=clock_timestamp() where singleton;
update public.ap_checkout_initiations set state='EXPIRATION_REQUIRED',updated_at=clock_timestamp() where state in('INITIATED','OPEN');

do $$ declare f record; begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any(array['ap_bind_prospective_retention_checkout','ap_bind_prospective_retention_order',
      'ap_guard_retention_contract_history','ap_service_retention_deadlines','ap_material_retention_deadline','ap_service_retention_access_allowed',
      'ap_assert_service_retention_access','ap_customer_retention_access','ap_guard_service_retention_action','ap_service_retention_order_protected',
      'ap_service_retention_customer_protected','ap_set_service_retention_hold','ap_legacy_intake_retention_allowed','ap_legacy_delivery_access_allowed',
      'ap_admin_service_retention_status','ap_export_service_retention_overlay','ap_retention_customer_private_access_allowed','ap_retention_private_row_visible',
      'ap_customer_private_retention_access','ap_guard_reference_retention_access','ap_retention_snapshot_private_access_allowed',
      'ap_retention_reference_permission_visible','ap_customer_visible_reference_permissions','ap_service_retention_customer_expiry',
      'ap_service_retention_object_policies']) loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  end loop;
end $$;
grant execute on function public.ap_customer_retention_access(uuid) to authenticated,service_role;
grant execute on function public.ap_customer_private_retention_access(uuid) to authenticated,service_role;
grant execute on function public.ap_customer_visible_reference_permissions(uuid) to authenticated,service_role;
grant execute on function public.ap_service_retention_access_allowed(uuid,uuid,boolean),public.ap_retention_private_row_visible(text,jsonb) to authenticated;
grant execute on function public.ap_set_service_retention_hold(uuid,uuid,text,uuid,boolean),public.ap_legacy_intake_retention_allowed(uuid),
  public.ap_legacy_delivery_access_allowed(uuid,uuid),public.ap_admin_service_retention_status(integer),public.ap_export_service_retention_overlay() to service_role;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202610240087','ONE_OFF_SERVICE_RETENTION',0,clock_timestamp());

-- Presence alone is insufficient: the independently guarded cleanup and restore
-- implementations must exist before this contract can be sold or activated.
create function public.ap_one_off_retention_schema_installed() returns boolean
language sql stable security definer set search_path='' as $$
  select to_regprocedure('public.ap_claim_expired_service_retention(integer)') is not null
    and to_regprocedure('public.ap_authorize_service_retention_object(uuid,uuid)') is not null
    and to_regprocedure('public.ap_finish_service_retention_object(uuid,uuid)') is not null
    and to_regprocedure('public.ap_apply_retention_restore_overlay(text,text)') is not null
    and exists(select 1 from pg_trigger where tgrelid='public.ap_checkout_attempts'::regclass
      and tgname='ap_bind_prospective_retention_checkout' and not tgisinternal and tgenabled='O')
    and exists(select 1 from pg_trigger where tgrelid='public.ap_search_services'::regclass
      and tgname='ap_bind_prospective_retention_order' and not tgisinternal and tgenabled='O')
    and exists(select 1 from pg_policies where schemaname='public' and tablename='ap_intake_snapshots'
      and policyname='ap_retention_private_read' and permissive='RESTRICTIVE');
$$;
revoke all on function public.ap_one_off_retention_schema_installed() from public,anon,authenticated;
grant execute on function public.ap_one_off_retention_schema_installed() to service_role;
do $$ declare definition text; begin
  definition:=pg_get_functiondef('public.ap_manual_launch_schema_readiness()'::regprocedure);
  if position('select count(*)=10 as installed' in definition)=0
    or position('''requiredSchemaVersion'', ''202610230086''' in definition)=0
    or position('public.ap_sandbox_activation_schema_installed()' in definition)=0
    then raise exception 'service_retention_readiness_anchor_missing'; end if;
  definition:=replace(definition,'select count(*)=10 as installed','select count(*)=11 as installed');
  definition:=replace(definition,'(''202610230086'',''SANDBOX_VALIDATION_LAUNCH_ACTIVATION'')',
    '(''202610230086'',''SANDBOX_VALIDATION_LAUNCH_ACTIVATION''),(''202610240087'',''ONE_OFF_SERVICE_RETENTION'')');
  definition:=replace(definition,'''requiredSchemaVersion'', ''202610230086''','''requiredSchemaVersion'', ''202610240087''');
  definition:=replace(definition,'''202610220085'',''202610230086''','''202610220085'',''202610230086'',''202610240087''');
  definition:=replace(definition,'public.ap_sandbox_activation_schema_installed()',
    'public.ap_sandbox_activation_schema_installed() and public.ap_one_off_retention_schema_installed()');
  execute definition;
end $$;

do $$ declare definition text; begin
  definition:=replace(pg_get_functiondef('public.ap_record_manual_launch_activation(text,text,jsonb,uuid)'::regprocedure),chr(13),'');
  if position('begin'||chr(10)||'  if p_activation_phase is null' in definition)=0 then raise exception 'retention_activation_anchor_missing'; end if;
  execute replace(definition,'begin'||chr(10)||'  if p_activation_phase is null',
    'begin'||chr(10)||'  if not public.ap_one_off_retention_schema_installed() then raise exception ''service_retention_cleanup_unavailable''; end if;'||chr(10)||'  if p_activation_phase is null');
end $$;

commit;

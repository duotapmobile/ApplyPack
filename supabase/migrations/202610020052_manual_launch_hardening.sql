-- October 2 manual-launch authority. Forward-only: historical $20/$8 rows remain valid.

alter table public.ap_commerce_configuration
  drop constraint if exists ap_commerce_configuration_search_price_cents_check,
  drop constraint if exists ap_commerce_configuration_material_line_price_cents_check;
alter table public.ap_commerce_configuration
  alter column search_price_cents set default 1899,
  alter column material_line_price_cents set default 799;
update public.ap_commerce_configuration set
  search_price_cents=1899,
  material_line_price_cents=799
where singleton;
alter table public.ap_commerce_configuration
  add constraint ap_commerce_configuration_search_price_cents_check check (search_price_cents = 1899),
  add constraint ap_commerce_configuration_material_line_price_cents_check check (material_line_price_cents = 799);

alter table public.ap_quotes drop constraint if exists ap_quotes_price_cents_check;
alter table public.ap_quotes add constraint ap_quotes_price_cents_check check (price_cents in (1899,2000));
alter table public.ap_material_purchases drop constraint if exists ap_material_purchases_amount_cents_check;
alter table public.ap_material_purchases add constraint ap_material_purchases_amount_cents_check
  check (amount_cents > 0 and (amount_cents % 799 = 0 or amount_cents % 800 = 0));
alter table public.ap_material_lines drop constraint if exists ap_material_lines_allocated_amount_cents_check;
alter table public.ap_material_lines add constraint ap_material_lines_allocated_amount_cents_check
  check (allocated_amount_cents in (799,800));
alter table public.ap_material_checkout_intents drop constraint if exists ap_material_checkout_intents_amount_cents_check;
alter table public.ap_material_checkout_intents add constraint ap_material_checkout_intents_amount_cents_check
  check (amount_cents in (line_count * 799,line_count * 800));

alter table public.ap_commerce_configuration drop column checkout_enabled;
alter table public.ap_commerce_configuration
  add column launch_product_scope text not null default 'MANUAL_ONLY'
    check (launch_product_scope = 'MANUAL_ONLY'),
  add column sales_activation_approved boolean not null default false,
  add column sales_activation_reference text,
  add column checkout_enabled boolean generated always as (
    tax_configuration_approved
    and tax_approval_reference is not null
    and sales_activation_approved
    and sales_activation_reference is not null
    and launch_product_scope = 'MANUAL_ONLY'
  ) stored;

update public.ap_commerce_configuration set
  search_price_cents=1899,
  material_line_price_cents=799,
  pricing_version='manual-launch-pricing-2026-10-02-v2',
  terms_version='manual-launch-terms-2026-10-02-v2',
  launch_product_scope='MANUAL_ONLY',
  sales_activation_approved=false,
  sales_activation_reference=null,
  tax_configuration_approved=false,
  tax_approval_reference=null
where singleton;

create table public.ap_search_checkout_invitations (
  id uuid primary key,
  draft_id uuid not null references public.ap_anonymous_drafts(id),
  snapshot_id uuid not null references public.ap_intake_snapshots(id),
  assessment_id uuid not null references public.ap_feasibility_assessments(id),
  capacity_allocation_id uuid not null references public.ap_capacity_allocations(id),
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  issued_by uuid not null references public.profiles(id),
  issued_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  rationale text not null check (length(btrim(rationale)) between 20 and 1000),
  check (expires_at > issued_at and expires_at <= issued_at + interval '30 minutes'),
  unique(secret_hash)
);
create unique index ap_search_checkout_invitations_one_active_per_draft
  on public.ap_search_checkout_invitations(draft_id)
  where consumed_at is null and revoked_at is null;
alter table public.ap_search_checkout_invitations enable row level security;
revoke all on public.ap_search_checkout_invitations from public,anon,authenticated;
grant all on public.ap_search_checkout_invitations to service_role;

create or replace function public.ap_issue_search_checkout_invitation(
  p_invitation_id uuid,p_draft_id uuid,p_snapshot_id uuid,p_assessment_id uuid,
  p_secret_hash text,p_expires_at timestamptz,p_issued_by uuid,p_rationale text
) returns uuid language plpgsql security definer set search_path='' as $$
declare d public.ap_anonymous_drafts; assessment public.ap_feasibility_assessments;
  allocation_id uuid; now_at timestamptz:=clock_timestamp();
begin
  if p_secret_hash !~ '^[0-9a-f]{64}$' or length(btrim(p_rationale))<20
    or p_expires_at<=now_at or p_expires_at>now_at+interval '30 minutes'
    then raise exception 'checkout_invitation_input_invalid'; end if;
  if not exists(select 1 from public.profiles where id=p_issued_by and role in ('operator','admin'))
    then raise exception 'checkout_invitation_operator_required'; end if;
  select * into d from public.ap_anonymous_drafts where id=p_draft_id and finalized_snapshot_id=p_snapshot_id
    and state='COMPLETE' and expires_at>now_at for update;
  if not found then raise exception 'checkout_invitation_draft_invalid'; end if;
  select * into assessment from public.ap_feasibility_assessments where id=p_assessment_id
    and snapshot_id=p_snapshot_id and state='COMPLETE' and outcome='LIKELY'
    and resolution_blocker='NONE' and invalidated_at is null and expires_at>now_at for update;
  if not found or coalesce(assessment.preliminarily_deliverable_count,0)<10
    then raise exception 'checkout_invitation_ten_not_supported'; end if;
  if not exists(select 1 from public.ap_commerce_configuration where singleton
    and launch_product_scope='MANUAL_ONLY' and search_price_cents=1899)
    then raise exception 'manual_launch_configuration_required'; end if;
  -- Expiry is a valid terminal state. Mark expired rows before the partial
  -- uniqueness check so the same completed intake can receive a fresh invite.
  update public.ap_search_checkout_invitations set revoked_at=now_at
    where draft_id=p_draft_id and consumed_at is null and revoked_at is null and expires_at<=now_at;
  allocation_id:=public.ap_reserve_capacity(null,'SEARCH',1,'search-invitation:'||p_invitation_id::text,p_expires_at,'[]',p_draft_id);
  update public.ap_capacity_allocations set criteria_revision_id=p_snapshot_id where id=allocation_id;
  insert into public.ap_search_checkout_invitations(
    id,draft_id,snapshot_id,assessment_id,capacity_allocation_id,secret_hash,issued_by,expires_at,rationale
  ) values(p_invitation_id,p_draft_id,p_snapshot_id,p_assessment_id,allocation_id,p_secret_hash,p_issued_by,p_expires_at,btrim(p_rationale));
  insert into public.ap_audit_events(actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
  values(p_issued_by,'SEARCH_CHECKOUT_INVITATION_ISSUED','SEARCH_CHECKOUT_INVITATION',p_invitation_id,
    jsonb_build_object('draftId',p_draft_id,'snapshotId',p_snapshot_id,'assessmentId',p_assessment_id,'expiresAt',p_expires_at),
    'manual-launch-search-v2');
  return p_invitation_id;
end;
$$;

-- Rebind current search pricing and require a wrapper-authorized invitation.
do $migration$
declare definition text;
begin
  select pg_get_functiondef(p.oid) into definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='ap_begin_search_checkout';
  definition:=replace(definition,chr(13),'');
  if definition is null or position('values(p_quote_id,p_draft_id,p_snapshot_id,p_assessment_id,allocation_id_local,2000' in definition)=0
    then raise exception 'manual_launch_search_function_anchor_missing'; end if;
  definition:=replace(definition,
    'begin'||chr(10)||'  if p_quote_sha256',
    'begin'||chr(10)||$search$  if nullif(current_setting('applypack.checkout_invitation_id',true),'') is null then raise exception 'checkout_invitation_required'; end if;$search$||chr(10)||'  if p_quote_sha256');
  definition:=replace(definition,$old$allocation_id_local,2000,'USD',true$old$,$new$allocation_id_local,configuration.search_price_cents,'USD',true$new$);
  definition:=replace(definition,$old$p_checkout_attempt_id,'stripe',2000,'USD','UNPAID'$old$,$new$p_checkout_attempt_id,'stripe',configuration.search_price_cents,'USD','UNPAID'$new$);
  definition:=replace(definition,$old$'chunk4-v1'$old$,$new$'manual-launch-search-v2'$new$);
  if position('checkout_invitation_required' in definition)=0 or position('configuration.search_price_cents' in definition)=0
    then raise exception 'manual_launch_search_rewrite_failed'; end if;
  execute definition;

  select pg_get_functiondef(p.oid) into definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='ap_apply_verified_search_payment';
  definition:=replace(definition,chr(13),'');
  if definition is null or position('p_amount_cents<>2000' in definition)=0 then raise exception 'manual_launch_payment_anchor_missing'; end if;
  definition:=replace(definition,'p_amount_cents<>2000','p_amount_cents<>quote_row.price_cents');
  definition:=replace(definition,$old$'job_search',2000,'paid'$old$,$new$'job_search',quote_row.price_cents,'paid'$new$);
  definition:=replace(definition,$old$'chunk4-v1'$old$,$new$'manual-launch-search-v2'$new$);
  execute definition;
end;
$migration$;

-- Refund both historical and current search payments at their immutable paid amount.
do $migration$
declare definition text;
begin
  select pg_get_functiondef(p.oid) into definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='ap_queue_search_refund';
  definition:=replace(definition,chr(13),'');
  if definition is null or position($anchor$operation_key||':2000:USD'$anchor$ in definition)=0
    or position($anchor$p_scope,2000,'USD'$anchor$ in definition)=0
    then raise exception 'manual_launch_search_refund_anchor_missing'; end if;
  definition:=replace(definition,$old$operation_key||':2000:USD'$old$,
    $new$operation_key||':'||payment_row.amount_cents::text||':USD'$new$);
  definition:=replace(definition,$old$p_scope,2000,'USD'$old$,
    $new$p_scope,payment_row.amount_cents,'USD'$new$);
  definition:=replace(definition,$old$'amountCents',2000$old$,
    $new$'amountCents',payment_row.amount_cents$new$);
  execute definition;
end;
$migration$;

create or replace function public.ap_begin_invited_search_checkout(
  p_invitation_id uuid,p_invitation_secret_hash text,
  p_draft_id uuid,p_secret_hash text,p_snapshot_id uuid,p_assessment_id uuid,p_request_key text,
  p_quote_id uuid,p_quote_sha256 text,p_command_id uuid,p_provider_idempotency_key text,
  p_checkout_attempt_id uuid,p_payment_attempt_id uuid,p_browser_secret_hash text,p_email_secret_hash text,
  p_access_payload_id uuid default null
) returns table(
  quote_id uuid,command_id uuid,checkout_attempt_id uuid,payment_attempt_id uuid,
  allocation_id uuid,provider_idempotency_key text,lease_expires_at timestamptz,
  reservation_expires_at timestamptz,access_email text
) language plpgsql security definer set search_path='' as $$
declare invitation public.ap_search_checkout_invitations; held public.ap_capacity_allocations;
begin
  select * into invitation from public.ap_search_checkout_invitations where id=p_invitation_id for update;
  if not found or invitation.draft_id<>p_draft_id or invitation.snapshot_id<>p_snapshot_id
    or invitation.assessment_id<>p_assessment_id or invitation.secret_hash<>p_invitation_secret_hash
    or invitation.consumed_at is not null or invitation.revoked_at is not null or invitation.expires_at<=clock_timestamp()
    then raise exception 'checkout_invitation_invalid'; end if;
  select * into held from public.ap_capacity_allocations where id=invitation.capacity_allocation_id for update;
  if not found or held.lifecycle<>'RESERVED' or held.debit_disposition<>'HELD' or held.expires_at<=clock_timestamp()
    then raise exception 'checkout_invitation_capacity_invalid'; end if;
  update public.ap_capacity_allocations set lifecycle='RELEASED',debit_disposition='RETURNED',returned_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=held.id;
  insert into public.ap_capacity_audit(allocation_id,from_lifecycle,to_lifecycle,from_debit,to_debit,actor_id,reason_code)
    values(held.id,held.lifecycle,'RELEASED',held.debit_disposition,'RETURNED',invitation.issued_by,'INVITATION_CONVERTED');
  perform set_config('applypack.checkout_invitation_id',p_invitation_id::text,true);
  return query select * from public.ap_begin_search_checkout(
    p_draft_id,p_secret_hash,p_snapshot_id,p_assessment_id,p_request_key,p_quote_id,p_quote_sha256,
    p_command_id,p_provider_idempotency_key,p_checkout_attempt_id,p_payment_attempt_id,
    p_browser_secret_hash,p_email_secret_hash,p_access_payload_id);
  update public.ap_search_checkout_invitations set consumed_at=clock_timestamp() where id=p_invitation_id;
end;
$$;

-- Rebind current Apply Pack creation to the $7.99 contract. Historical rows remain untouched.
do $migration$
declare definition text;
begin
  select pg_get_functiondef(p.oid) into definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='ap_begin_material_checkout';
  definition:=replace(definition,chr(13),'');
  if definition is null or position('config.material_line_price_cents<>800' in definition)=0
    then raise exception 'manual_launch_material_function_anchor_missing'; end if;
  definition:=replace(definition,'config.material_line_price_cents<>800','config.material_line_price_cents<>799');
  definition:=replace(definition,'line_count*800','line_count*config.material_line_price_cents');
  definition:=replace(definition,$old$,800,'CHECKOUT_ELIGIBLE'$old$,$new$,config.material_line_price_cents,'CHECKOUT_ELIGIBLE'$new$);
  definition:=replace(definition,$old$'chunk5-v1'$old$,$new$'manual-launch-pack-v2'$new$);
  if position('line_count*config.material_line_price_cents' in definition)=0
    or position($check$config.material_line_price_cents,'CHECKOUT_ELIGIBLE'$check$ in definition)=0
    then raise exception 'manual_launch_material_rewrite_failed'; end if;
  execute definition;
end;
$migration$;

-- Correct pairwise uniqueness: identifier match first, then any cross-field URL match,
-- with fingerprint fallback only when at least one record has no stronger identifier.
do $migration$
declare definition text; old_predicate text; new_predicate text;
begin
  select pg_get_functiondef(p.oid) into definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='ap_commit_exact_ten_release';
  definition:=replace(definition,chr(13),'');
  old_predicate:=$old$where (
      left_job.external_job_id is not null and right_job.external_job_id is not null
      and left_job.external_job_id=right_job.external_job_id
      and left_job.canonical_employer_domain is not distinct from right_job.canonical_employer_domain
    ) or (
      coalesce(left_job.canonical_employer_listing_url,left_job.canonical_application_url)
        =coalesce(right_job.canonical_employer_listing_url,right_job.canonical_application_url)
    ) or (
      (left_job.external_job_id is null or right_job.external_job_id is null)
      and (left_job.canonical_employer_listing_url is null or right_job.canonical_employer_listing_url is null)
      and left_job.normalized_fingerprint=right_job.normalized_fingerprint
    )$old$;
  new_predicate:=$new$where (
      left_job.external_job_id is not null and right_job.external_job_id is not null
      and left_job.external_job_id=right_job.external_job_id
      and left_job.canonical_employer_domain is not distinct from right_job.canonical_employer_domain
    ) or (
      array_remove(array[left_job.canonical_employer_listing_url,left_job.canonical_application_url],null)
      && array_remove(array[right_job.canonical_employer_listing_url,right_job.canonical_application_url],null)
    ) or (
      (
        (left_job.external_job_id is null and left_job.canonical_employer_listing_url is null and left_job.canonical_application_url is null)
        or
        (right_job.external_job_id is null and right_job.canonical_employer_listing_url is null and right_job.canonical_application_url is null)
      )
      and left_job.normalized_fingerprint=right_job.normalized_fingerprint
    )$new$;
  if definition is null or position(old_predicate in definition)=0 then raise exception 'exact_ten_uniqueness_anchor_missing'; end if;
  definition:=replace(definition,old_predicate,new_predicate);
  definition:=replace(definition,$old$'chunk4-v1'$old$,$new$'manual-launch-search-v2'$new$);
  execute definition;
end;
$migration$;

revoke all on function public.ap_issue_search_checkout_invitation(uuid,uuid,uuid,uuid,text,timestamptz,uuid,text) from public,anon,authenticated;
revoke all on function public.ap_begin_invited_search_checkout(uuid,text,uuid,text,uuid,uuid,text,uuid,text,uuid,text,uuid,uuid,text,text,uuid) from public,anon,authenticated;
revoke execute on function public.ap_begin_search_checkout(uuid,text,uuid,uuid,text,uuid,text,uuid,text,uuid,uuid,text,text,uuid) from service_role;
grant execute on function public.ap_issue_search_checkout_invitation(uuid,uuid,uuid,uuid,text,timestamptz,uuid,text) to service_role;
grant execute on function public.ap_begin_invited_search_checkout(uuid,text,uuid,text,uuid,uuid,text,uuid,text,uuid,text,uuid,uuid,text,text,uuid) to service_role;

comment on table public.ap_search_checkout_invitations is
  'Short-lived, single-use manual-launch search checkout invitations backed by atomic capacity reservations.';

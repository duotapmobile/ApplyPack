-- Keep maintenance reconciliation separate from signed provider-event ordering.
-- Terminal board refund/dispute events revoke historical access atomically even
-- when Stripe delivers them after a newer nonterminal event.

begin;

alter table public.ap_board_subscriptions
  add column if not exists last_reconciled_at timestamptz;

-- Old code could record a delayed terminal receipt without applying it when a
-- newer subscription event had already advanced the ordering watermark. With
-- the board retired, uncertain historical refund receipts fail closed rather
-- than leaving paid archive or billing-portal access open.
with latest_refund as (
  select distinct on (provider_subscription_id)
    provider_subscription_id,provider_refund_id,amount_cents,full_amount_cents
  from public.ap_board_provider_events
  where event_type in ('refund.created','refund.updated')
    and provider_refund_id is not null
  order by provider_subscription_id,provider_created desc,created_at desc,id desc
)
update public.ap_board_subscriptions subscription set
  state=case
    when refund.full_amount_cents is not null and refund.full_amount_cents>0
      and refund.amount_cents>=refund.full_amount_cents then 'REFUNDED'
    else 'CANCELED'
  end,
  access_ends_at=null,
  refund_state=case
    when refund.full_amount_cents is not null and refund.full_amount_cents>0
      and refund.amount_cents>=refund.full_amount_cents then 'FULL'
    else 'PARTIAL'
  end,
  provider_refund_id=refund.provider_refund_id,
  updated_at=clock_timestamp()
from latest_refund refund
where subscription.provider_subscription_id=refund.provider_subscription_id
  and subscription.provider_dispute_id is null;

with latest_dispute as (
  select distinct on (provider_subscription_id)
    provider_subscription_id,provider_dispute_id
  from public.ap_board_provider_events
  where event_type in ('charge.dispute.created','charge.dispute.updated','charge.dispute.closed')
    and provider_dispute_id is not null
  order by provider_subscription_id,provider_created desc,created_at desc,id desc
)
update public.ap_board_subscriptions subscription set
  state='DISPUTED',access_ends_at=null,
  provider_dispute_id=dispute.provider_dispute_id,
  updated_at=clock_timestamp()
from latest_dispute dispute
where subscription.provider_subscription_id=dispute.provider_subscription_id;

revoke all on function public.ap_legacy_board_has_access(uuid,timestamptz)
  from public,anon,authenticated;
grant execute on function public.ap_legacy_board_has_access(uuid,timestamptz)
  to service_role;

create or replace function public.ap_board_has_access(
  p_customer_id uuid,
  p_now timestamptz default now()
) returns boolean language sql stable security definer set search_path='' as $$
  select case
    when auth.role()='service_role' then public.ap_legacy_board_has_access(p_customer_id,p_now)
    when auth.uid() is not null and p_customer_id=auth.uid()
      then public.ap_legacy_board_has_access(auth.uid(),p_now)
    else false
  end;
$$;
revoke all on function public.ap_board_has_access(uuid,timestamptz)
  from public,anon,authenticated;
grant execute on function public.ap_board_has_access(uuid,timestamptz)
  to authenticated,service_role;

drop policy if exists ap_legacy_board_archive_owner_select
  on public.ap_legacy_board_archive_entries;
create policy ap_legacy_board_archive_owner_select
  on public.ap_legacy_board_archive_entries
  for select to authenticated using (
    customer_id=auth.uid() and public.ap_board_has_access(auth.uid())
  );

create or replace function public.ap_apply_legacy_board_terminal_event(
  p_provider_subscription_id text,
  p_provider_event_id text,
  p_event_type text,
  p_provider_created bigint,
  p_resulting_state text,
  p_refund_state text default null,
  p_provider_refund_id text default null,
  p_provider_dispute_id text default null,
  p_amount_cents integer default null,
  p_full_amount_cents integer default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  subscription public.ap_board_subscriptions%rowtype;
  prior_event public.ap_board_provider_events%rowtype;
  event_replayed boolean:=false;
  final_state text;
begin
  if nullif(btrim(p_provider_subscription_id),'') is null
    or nullif(btrim(p_provider_event_id),'') is null
    or p_provider_created<0
    or p_amount_cents is null or p_amount_cents<0
    or p_full_amount_cents is null or p_full_amount_cents<0
  then raise exception 'invalid_legacy_board_terminal_event'; end if;

  if p_event_type in ('refund.created','refund.updated') then
    if p_refund_state not in ('PARTIAL','FULL')
      or nullif(btrim(p_provider_refund_id),'') is null
      or p_provider_dispute_id is not null
      or (p_refund_state='FULL' and p_resulting_state<>'REFUNDED')
      or (p_refund_state='PARTIAL' and p_resulting_state<>'CANCELED')
    then raise exception 'invalid_legacy_board_terminal_refund'; end if;
  elsif p_event_type in ('charge.dispute.created','charge.dispute.updated','charge.dispute.closed') then
    if p_refund_state is not null
      or p_provider_refund_id is not null
      or nullif(btrim(p_provider_dispute_id),'') is null
      or p_resulting_state not in ('CANCELED','DISPUTED')
    then raise exception 'invalid_legacy_board_terminal_dispute'; end if;
  else
    raise exception 'unsupported_legacy_board_terminal_event';
  end if;

  select * into subscription
  from public.ap_board_subscriptions
  where provider_subscription_id=p_provider_subscription_id
  for update;
  if not found then raise exception 'legacy_board_subscription_missing'; end if;

  select * into prior_event
  from public.ap_board_provider_events
  where provider_event_id=p_provider_event_id;
  if found then
    if prior_event.provider_subscription_id is distinct from p_provider_subscription_id
      or prior_event.event_type is distinct from p_event_type
      or prior_event.provider_created is distinct from p_provider_created
      or prior_event.provider_refund_id is distinct from p_provider_refund_id
      or prior_event.provider_dispute_id is distinct from p_provider_dispute_id
      or prior_event.amount_cents is distinct from p_amount_cents
      or prior_event.full_amount_cents is distinct from p_full_amount_cents
    then raise exception 'legacy_board_terminal_event_replay_mismatch'; end if;
    if prior_event.resulting_state is distinct from p_resulting_state then
      if prior_event.resulting_state in ('REFUNDED','DISPUTED') then
        raise exception 'legacy_board_terminal_event_replay_mismatch';
      end if;
      update public.ap_board_provider_events
      set resulting_state=p_resulting_state
      where id=prior_event.id;
    end if;
    event_replayed:=true;
  else
    insert into public.ap_board_provider_events(
      provider_event_id,provider_subscription_id,event_type,provider_created,
      provider_refund_id,provider_dispute_id,amount_cents,full_amount_cents,resulting_state
    ) values(
      p_provider_event_id,p_provider_subscription_id,p_event_type,p_provider_created,
      p_provider_refund_id,p_provider_dispute_id,p_amount_cents,p_full_amount_cents,p_resulting_state
    );
  end if;

  final_state:=case
    when p_provider_refund_id is not null and subscription.provider_dispute_id is not null
      then subscription.state
    else p_resulting_state
  end;

  update public.ap_board_subscriptions set
    state=final_state,
    access_ends_at=null,
    refund_state=coalesce(p_refund_state,subscription.refund_state),
    provider_refund_id=coalesce(p_provider_refund_id,subscription.provider_refund_id),
    provider_dispute_id=coalesce(p_provider_dispute_id,subscription.provider_dispute_id),
    last_provider_event_created=greatest(subscription.last_provider_event_created,p_provider_created),
    last_provider_event_id=case
      when p_provider_created>=subscription.last_provider_event_created then p_provider_event_id
      else subscription.last_provider_event_id
    end,
    updated_at=clock_timestamp()
  where id=subscription.id;

  return jsonb_build_object(
    'subscriptionId',subscription.id,
    'replayed',event_replayed,
    'accessRevoked',true
  );
end;
$$;
revoke all on function public.ap_apply_legacy_board_terminal_event(
  text,text,text,bigint,text,text,text,text,integer,integer
) from public,anon,authenticated;
grant execute on function public.ap_apply_legacy_board_terminal_event(
  text,text,text,bigint,text,text,text,text,integer,integer
) to service_role;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202610190084','LEGACY_BOARD_TERMINAL_EVENT_ORDERING',0,clock_timestamp())
on conflict(migration_id,checkpoint) do nothing;

do $$
declare definition text;
begin
  definition:=pg_catalog.pg_get_functiondef('public.ap_manual_launch_schema_readiness()'::regprocedure);
  definition:=replace(definition,'select count(*)=7 as installed','select count(*)=8 as installed');
  definition:=replace(definition,
    '(''202610190083'',''LEGACY_BOARD_READ_ONLY_ARCHIVE'')',
    '(''202610190083'',''LEGACY_BOARD_READ_ONLY_ARCHIVE''),'||E'\n      '||
      '(''202610190084'',''LEGACY_BOARD_TERMINAL_EVENT_ORDERING'')');
  definition:=replace(definition,'''requiredSchemaVersion'', ''202610190083''',
    '''requiredSchemaVersion'', ''202610190084''');
  definition:=replace(definition,
    '''202610040077'',''202610040078'',''202610040079'',''202610040080'',''202610190081'',''202610190082'',''202610190083''',
    '''202610040077'',''202610040078'',''202610040079'',''202610040080'',''202610190081'',''202610190082'',''202610190083'',''202610190084''');
  if position('202610190084' in definition)=0 or position('count(*)=8' in definition)=0 then
    raise exception 'launch_schema_legacy_board_terminal_event_anchor_missing';
  end if;
  execute definition;
end $$;

commit;

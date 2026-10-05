-- A single-use invitation may replay only the exact already-provisioned command.
-- This preserves provider retry safety after an ambiguous Stripe response without
-- permitting a consumed invitation to create another quote or payment attempt.

begin;

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
    or invitation.revoked_at is not null or invitation.expires_at<=clock_timestamp()
    then raise exception 'checkout_invitation_invalid'; end if;

  if invitation.consumed_at is not null then
    if not exists(
      select 1 from public.ap_quotes quote
        join public.ap_checkout_attempts checkout_attempt on checkout_attempt.quote_id=quote.id
        join public.ap_payment_attempts payment on payment.checkout_attempt_id=checkout_attempt.id
      where quote.id=p_quote_id and quote.draft_id=p_draft_id and quote.snapshot_id=p_snapshot_id
        and quote.feasibility_assessment_id=p_assessment_id and quote.idempotency_key=p_request_key
        and quote.content_sha256=p_quote_sha256 and checkout_attempt.id=p_checkout_attempt_id
        and checkout_attempt.command_id=p_command_id and payment.id=p_payment_attempt_id
    ) then raise exception 'checkout_invitation_consumed'; end if;
    perform set_config('applypack.checkout_invitation_id',p_invitation_id::text,true);
    return query select * from public.ap_begin_search_checkout(
      p_draft_id,p_secret_hash,p_snapshot_id,p_assessment_id,p_request_key,p_quote_id,p_quote_sha256,
      p_command_id,p_provider_idempotency_key,p_checkout_attempt_id,p_payment_attempt_id,
      p_browser_secret_hash,p_email_secret_hash,p_access_payload_id);
    return;
  end if;

  select * into held from public.ap_capacity_allocations where id=invitation.capacity_allocation_id for update;
  if not found or held.lifecycle<>'RESERVED' or held.debit_disposition<>'HELD' or held.expires_at<=clock_timestamp()
    then raise exception 'checkout_invitation_capacity_invalid'; end if;
  update public.ap_capacity_allocations set lifecycle='RELEASED',debit_disposition='RETURNED',
    returned_at=clock_timestamp(),updated_at=clock_timestamp() where id=held.id;
  insert into public.ap_capacity_audit(
    allocation_id,from_lifecycle,to_lifecycle,from_debit,to_debit,actor_id,reason_code
  ) values(
    held.id,held.lifecycle,'RELEASED',held.debit_disposition,'RETURNED',invitation.issued_by,'INVITATION_CONVERTED'
  );
  perform set_config('applypack.checkout_invitation_id',p_invitation_id::text,true);
  return query select * from public.ap_begin_search_checkout(
    p_draft_id,p_secret_hash,p_snapshot_id,p_assessment_id,p_request_key,p_quote_id,p_quote_sha256,
    p_command_id,p_provider_idempotency_key,p_checkout_attempt_id,p_payment_attempt_id,
    p_browser_secret_hash,p_email_secret_hash,p_access_payload_id);
  update public.ap_search_checkout_invitations set consumed_at=clock_timestamp() where id=p_invitation_id;
end;
$$;
revoke all on function public.ap_begin_invited_search_checkout(uuid,text,uuid,text,uuid,uuid,text,uuid,text,uuid,text,uuid,uuid,text,text,uuid)
  from public,anon,authenticated;
grant execute on function public.ap_begin_invited_search_checkout(uuid,text,uuid,text,uuid,uuid,text,uuid,text,uuid,text,uuid,uuid,text,text,uuid)
  to service_role;

do $migration$
declare
  definition text;
  old_replay constant text :=
    '''lineCount'',existing.line_count,''expiresAt'',existing.expires_at,''replayed'',true';
  new_replay constant text :=
    '''lineCount'',existing.line_count,''expiresAt'',existing.expires_at,'||
    '''providerIdempotencyKey'',''materials-checkout/''||existing.command_id::text,''replayed'',true';
begin
  select pg_get_functiondef(
    'public.ap_begin_material_checkout(uuid,uuid,uuid,uuid,uuid,text,text,jsonb,text,text,boolean,boolean,boolean)'::regprocedure
  ) into definition;
  definition:=replace(definition,chr(13),'');
  if definition is null or position(old_replay in definition)=0 then
    raise exception 'material_checkout_replay_anchor_missing';
  end if;
  definition:=replace(definition,old_replay,new_replay);
  if position(new_replay in definition)=0 then
    raise exception 'material_checkout_replay_rewrite_failed';
  end if;
  execute definition;
end;
$migration$;

commit;

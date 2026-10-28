begin;

-- A scheduler claim is permission to run one already-ready stage, never to
-- resolve an owner decision, reserve provider spending or retry an unknown call.
-- The published general claim RPC remains available for historical callers.
create function public.ap_claim_material_draft_stage(p_worker_id uuid,p_stage text,p_limit integer default 1) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare candidate record; j public.ap_material_draft_jobs; v public.ap_material_draft_versions;
 runtime public.ap_material_draft_runtime; policy public.ap_material_draft_policies;
 context_hash text; reserved bigint; committed bigint; result jsonb:='[]'; locked_id uuid;
begin
 if p_worker_id is null or p_stage is null or p_stage not in('PREPARE','GENERATE','RENDER')
  or p_limit is null or p_limit not between 1 and 5 then raise exception 'material_draft_stage_claim_invalid'; end if;

 -- Recovery does not depend on the requested stage or an enabled provider.
 -- No provider request can be reissued from an expired ambiguous dispatch.
 for candidate in select job.id,job.customer_id from public.ap_material_draft_jobs job
  join public.ap_material_lines line on line.id=job.material_line_id
  join public.ap_material_line_revisions revision on revision.id=job.line_revision_id
  join public.ap_payment_attempts payment on payment.id=line.payment_attempt_id
  where job.state in('READY','DRAFTING','SOURCE_READY','RENDERING')
   and revision.superseded_at is null and revision.version=line.active_revision and revision.due_at>clock_timestamp()
   and line.fulfillment in('PAID','GENERATING','HUMAN_REVIEW','READY_TO_RELEASE')
   and payment.settlement='PAID' and payment.dispute not in('OPEN','LOST') and payment.funds_reversed_at is null
   and payment.customer_id=job.customer_id and payment.immediate_charge_verified and payment.payment_verified_at is not null
   and not exists(select 1 from public.ap_refund_operations refund where refund.material_line_id=line.id and refund.superseded_at is null)
   and not exists(select 1 from public.ap_releases release where release.material_line_id=line.id)
   and (job.lease_expires_at is null or job.lease_expires_at<=clock_timestamp())
   and exists(select 1 from public.ap_material_draft_attempts a where a.job_id=job.id and a.state='DISPATCHED')
  order by job.created_at,job.id limit 25 loop
  begin
   perform 1 from public.ap_retention_restore_lock where singleton and not locked for share skip locked;
   if not found then raise exception using errcode='P0940',message='material_draft_stage_skip'; end if;
   if not pg_try_advisory_xact_lock(hashtextextended('service-retention:'||candidate.customer_id::text,0))
    then raise exception using errcode='P0940',message='material_draft_stage_skip'; end if;
   -- Take only the existing first payment row lock here, before the central
   -- helper locks line/revision/job. A concurrent scheduler skips rather than
   -- waiting on a job row while holding the locks that its peer needs.
   select payment.id into locked_id from public.ap_payment_attempts payment
    join public.ap_material_lines line on line.payment_attempt_id=payment.id
    join public.ap_material_draft_jobs job on job.material_line_id=line.id
    where job.id=candidate.id for update of payment skip locked;
   if locked_id is null then raise exception using errcode='P0940',message='material_draft_stage_skip'; end if;
   j:=public.ap_lock_material_draft_job(candidate.id);
   if j.lease_expires_at>clock_timestamp() or j.state not in('READY','DRAFTING','SOURCE_READY','RENDERING')
    then raise exception using errcode='P0940',message='material_draft_stage_skip'; end if;
   if exists(select 1 from public.ap_material_draft_attempts where job_id=j.id and state='DISPATCHED') then
    update public.ap_material_draft_attempts set state='RESULT_UNKNOWN' where job_id=j.id and state='DISPATCHED';
    update public.ap_material_draft_jobs set state='RESULT_UNKNOWN',error_code='PROVIDER_RESULT_UNKNOWN',
     lease_owner=null,lease_token=null,lease_expires_at=null,updated_at=clock_timestamp() where id=j.id;
   end if;
  exception when sqlstate 'P0940' or lock_not_available then null;
   when raise_exception then
    if sqlerrm not in('material_draft_obligation_not_active','material_draft_restore_locked') then raise; end if;
  end;
 end loop;
 -- Inactive/refunded obligations retain their original dispatched accounting
 -- records and full reservation for explicit financial reconciliation. Their
 -- absence from this work queue is not evidence that provider spend is settled.

 -- Exclude ordinary owner waits before the bounded scan. A fresh listing is a
 -- necessary precondition only: the complete rule/source digest is checked
 -- again under locks below. Old approved/released/unknown rows never qualify.
 for candidate in
  select job.id,job.customer_id
  from public.ap_material_draft_jobs job
  join public.ap_material_lines line on line.id=job.material_line_id
  join public.ap_payment_attempts payment on payment.id=line.payment_attempt_id
  join public.ap_material_line_revisions revision on revision.id=job.line_revision_id
  left join public.ap_material_draft_versions version on version.id=job.active_version_id
  cross join lateral(select checks.* from public.ap_material_listing_checks checks
   where checks.material_line_id=line.id and checks.line_revision_id=revision.id and checks.phase='BEFORE_GENERATION'
   order by checks.checked_at desc,checks.id desc limit 1) listing
  where (job.lease_expires_at is null or job.lease_expires_at<=clock_timestamp())
   and revision.superseded_at is null and revision.version=line.active_revision and revision.due_at>clock_timestamp()
   and line.fulfillment in('PAID','GENERATING','HUMAN_REVIEW','READY_TO_RELEASE')
   and payment.settlement='PAID' and payment.dispute not in('OPEN','LOST') and payment.funds_reversed_at is null
   and payment.customer_id=job.customer_id and payment.immediate_charge_verified and payment.payment_verified_at is not null
   and not exists(select 1 from public.ap_refund_operations refund where refund.material_line_id=line.id and refund.superseded_at is null)
   and not exists(select 1 from public.ap_releases release where release.material_line_id=line.id)
   and listing.result='ACTIVE' and listing.checked_at<=clock_timestamp() and listing.checked_at>clock_timestamp()-interval '1 hour'
   and listing.submission_rule_id=revision.employer_rule_snapshot_id
   and not exists(select 1 from public.ap_material_draft_attempts a where a.job_id=job.id and a.state in('DISPATCHED','RESULT_UNKNOWN'))
   and (job.active_version_id is null or exists(select 1 from public.ap_sensitive_payloads payload
    where payload.id=version.packet_encrypted_payload_id and payload.customer_id=job.customer_id
     and payload.retention_state='ACTIVE' and payload.content_sha256=version.packet_sha256))
   and (
    p_stage='PREPARE' and job.state in('EVIDENCE_PENDING','PREPARING') and job.active_version_id is null
    or p_stage='GENERATE' and job.state='READY' and version.invalidated_at is null and version.encrypted_payload_id is null
     and version.release_id is null and exists(select 1 from public.ap_material_draft_runtime r
      join public.ap_material_draft_policies p on p.id=r.policy_id where r.singleton and r.enabled and p.provider='openai'
       and (select count(*) from public.ap_material_draft_attempts a where a.job_id=job.id)<p.max_attempts)
    or p_stage='RENDER' and job.state in('SOURCE_READY','RENDERING') and not line.selected_reference_sheet
     and version.invalidated_at is null and version.release_id is null and version.encrypted_payload_id is not null
     and version.claim_review_sha256 is not null and version.claim_review_encrypted_payload_id is not null
     and version.claim_review_metadata is not null and version.claims_reviewed_by is not null
     and exists(select 1 from public.profiles reviewer where reviewer.id=version.claims_reviewed_by and reviewer.role in('operator','admin'))
     and version.claims_reviewed_at<=clock_timestamp() and version.member_set_sha256 is null
     and exists(select 1 from public.ap_sensitive_payloads payload where payload.id=version.encrypted_payload_id
      and payload.customer_id=job.customer_id and payload.retention_state='ACTIVE' and payload.content_sha256=version.source_sha256)
     and exists(select 1 from public.ap_sensitive_payloads payload where payload.id=version.claim_review_encrypted_payload_id
      and payload.customer_id=job.customer_id and payload.retention_state='ACTIVE' and payload.content_sha256=version.claim_review_sha256)
     and not exists(select 1 from public.ap_material_draft_members member where member.draft_version_id=version.id)
   )
  order by job.created_at,job.id limit 25
 loop
  begin
   -- Filtered-candidate locks are released by this row-local subtransaction.
   perform 1 from public.ap_retention_restore_lock where singleton and not locked for share skip locked;
   if not found then raise exception using errcode='P0940',message='material_draft_stage_skip'; end if;
   if not pg_try_advisory_xact_lock(hashtextextended('service-retention:'||candidate.customer_id::text,0))
    then raise exception using errcode='P0940',message='material_draft_stage_skip'; end if;
   select payment.id into locked_id from public.ap_payment_attempts payment
    join public.ap_material_lines line on line.payment_attempt_id=payment.id
    join public.ap_material_draft_jobs job on job.material_line_id=line.id
    where job.id=candidate.id for update of payment skip locked;
   if locked_id is null then raise exception using errcode='P0940',message='material_draft_stage_skip'; end if;
   j:=public.ap_lock_material_draft_job(candidate.id);
   if j.lease_expires_at>clock_timestamp()
    or exists(select 1 from public.ap_material_draft_attempts where job_id=j.id and state in('DISPATCHED','RESULT_UNKNOWN'))
    or p_stage='PREPARE' and (j.active_version_id is not null or j.state not in('EVIDENCE_PENDING','PREPARING'))
    or p_stage='GENERATE' and (j.active_version_id is null or j.state<>'READY')
    or p_stage='RENDER' and (j.active_version_id is null or j.state not in('SOURCE_READY','RENDERING'))
    then raise exception using errcode='P0940',message='material_draft_stage_skip'; end if;
   begin
    context_hash:=public.ap_material_draft_context_sha256(j.id);
   exception when raise_exception then
    if sqlerrm not in('material_draft_evidence_stale','material_draft_evidence_unresolved',
     'material_draft_evidence_bound_exceeded','material_rule_current_source_required') then raise; end if;
    -- Surface a source exception once. Neither the claim allowance nor an old
    -- lease, packet or approval is renewed by detecting this owner hold.
    update public.ap_material_draft_jobs set state='OWNER_EXCEPTION',error_code='EVIDENCE_STALE',updated_at=clock_timestamp() where id=j.id;
    continue;
   end;
   if p_stage<>'PREPARE' then
    select * into v from public.ap_material_draft_versions where id=j.active_version_id for update;
    if v.id is null or v.job_id<>j.id or v.customer_id<>j.customer_id or v.material_line_id<>j.material_line_id
     or v.invalidated_at is not null or v.release_id is not null
     then raise exception using errcode='P0940',message='material_draft_stage_skip'; end if;
    if v.context_sha256 is distinct from context_hash then
     update public.ap_material_draft_jobs set state='OWNER_EXCEPTION',error_code='EVIDENCE_STALE',updated_at=clock_timestamp() where id=j.id;
     continue;
    end if;
    if not exists(select 1 from public.ap_sensitive_payloads p where p.id=v.packet_encrypted_payload_id
     and p.customer_id=j.customer_id and p.retention_state='ACTIVE' and p.content_sha256=v.packet_sha256)
     then raise exception using errcode='P0940',message='material_draft_stage_skip'; end if;
   end if;
   if p_stage='GENERATE' then
    if v.encrypted_payload_id is not null then raise exception using errcode='P0940',message='material_draft_stage_skip'; end if;
    select * into runtime from public.ap_material_draft_runtime where singleton for update;
    select * into policy from public.ap_material_draft_policies where id=runtime.policy_id;
    if not runtime.enabled or policy.id is null or policy.provider<>'openai'
     or (select count(*) from public.ap_material_draft_attempts where job_id=j.id)>=policy.max_attempts
     then raise exception using errcode='P0940',message='material_draft_stage_skip'; end if;
    -- The current worker reserves exactly these policy caps. This is only a
    -- readiness test; begin_request atomically repeats it and reserves spending.
    reserved:=greatest(1,ceil((policy.max_input_tokens::numeric*policy.input_microusd_per_million
     +policy.max_output_tokens::numeric*policy.output_microusd_per_million)/1000000))::bigint;
    select coalesce(sum(coalesce(receipt.actual_microusd,spend.reserved_microusd)),0) into committed
     from public.ap_material_draft_attempts spend left join public.ap_material_draft_reconciliations receipt on receipt.request_id=spend.id
     where receipt.request_id is null or spend.dispatched_at>clock_timestamp()-interval '24 hours';
    if reserved>policy.max_attempt_microusd or committed+reserved>policy.rolling_day_microusd
     then raise exception using errcode='P0940',message='material_draft_stage_skip'; end if;
   elsif p_stage='RENDER' then
    if exists(select 1 from public.ap_material_lines where id=j.material_line_id and selected_reference_sheet)
     or v.encrypted_payload_id is null or v.claim_review_sha256 is null or v.claim_review_encrypted_payload_id is null
     or v.claims_reviewed_by is null or v.claims_reviewed_at is null or v.claims_reviewed_at>clock_timestamp()
     or jsonb_typeof(v.claim_review_metadata) is distinct from 'array' or jsonb_array_length(v.claim_review_metadata) not between 1 and 250
     or v.member_set_sha256 is not null or exists(select 1 from public.ap_material_draft_members where draft_version_id=v.id)
     or not exists(select 1 from public.ap_sensitive_payloads p where p.id=v.encrypted_payload_id
      and p.customer_id=j.customer_id and p.retention_state='ACTIVE' and p.content_sha256=v.source_sha256)
     or not exists(select 1 from public.ap_sensitive_payloads p where p.id=v.claim_review_encrypted_payload_id
      and p.customer_id=j.customer_id and p.retention_state='ACTIVE' and p.content_sha256=v.claim_review_sha256)
     then raise exception using errcode='P0940',message='material_draft_stage_skip'; end if;
    perform public.ap_require_material_reviewer(v.claims_reviewed_by);
   end if;
   if j.claim_count>=30 then
    update public.ap_material_draft_jobs set state='OWNER_EXCEPTION',error_code='ATTEMPTS_EXHAUSTED',updated_at=clock_timestamp() where id=j.id;
    continue;
   end if;
   update public.ap_material_draft_jobs set state=case p_stage when 'PREPARE' then 'PREPARING' when 'GENERATE' then 'READY' else 'SOURCE_READY' end,
    lease_owner=p_worker_id,lease_token=gen_random_uuid(),lease_generation=lease_generation+1,
    lease_expires_at=least(clock_timestamp()+interval '5 minutes',(select due_at from public.ap_material_line_revisions where id=j.line_revision_id)),
    claim_count=claim_count+1,error_code=null,updated_at=clock_timestamp() where id=j.id returning * into j;
   result:=result||jsonb_build_array(to_jsonb(j));
  exception when sqlstate 'P0940' or lock_not_available then null;
   when raise_exception then
    if sqlerrm not in('material_draft_obligation_not_active','material_draft_restore_locked','authorized_material_reviewer_required') then raise; end if;
  end;
  if jsonb_array_length(result)>=p_limit then exit; end if;
 end loop;
 return result;
end $$;
revoke all on function public.ap_claim_material_draft_stage(uuid,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.ap_claim_material_draft_stage(uuid,text,integer) to service_role;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
 values('202610250094','MATERIAL_DRAFT_STAGE_CLAIMING',0,clock_timestamp());
create function public.ap_material_draft_stage_claiming_schema_installed() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250094' and checkpoint='MATERIAL_DRAFT_STAGE_CLAIMING')
 and to_regprocedure('public.ap_claim_material_draft_stage(uuid,text,integer)') is not null
 and has_function_privilege('service_role','public.ap_claim_material_draft_stage(uuid,text,integer)','EXECUTE')
 and not has_function_privilege('anon','public.ap_claim_material_draft_stage(uuid,text,integer)','EXECUTE')
 and not has_function_privilege('authenticated','public.ap_claim_material_draft_stage(uuid,text,integer)','EXECUTE');
$$;
revoke all on function public.ap_material_draft_stage_claiming_schema_installed() from public,anon,authenticated;
grant execute on function public.ap_material_draft_stage_claiming_schema_installed() to service_role;
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.ap_manual_launch_schema_readiness()'::regprocedure);
 if position('select count(*)=17 as installed' in definition)=0 or position('''requiredSchemaVersion'', ''202610250093''' in definition)=0
  or position('(''202610250093'',''SOURCE_AWARE_DOCUMENT_ACCEPTANCE'')' in definition)=0 or position('''202610250092'',''202610250093''' in definition)=0
  then raise exception 'material_draft_stage_readiness_anchor_missing'; end if;
 definition:=replace(definition,'select count(*)=17 as installed','select count(*)=18 as installed');
 definition:=replace(definition,'(''202610250093'',''SOURCE_AWARE_DOCUMENT_ACCEPTANCE'')','(''202610250093'',''SOURCE_AWARE_DOCUMENT_ACCEPTANCE''),(''202610250094'',''MATERIAL_DRAFT_STAGE_CLAIMING'')');
 definition:=replace(definition,'''requiredSchemaVersion'', ''202610250093''','''requiredSchemaVersion'', ''202610250094''');
 definition:=replace(definition,'''202610250092'',''202610250093''','''202610250092'',''202610250093'',''202610250094''');
 definition:=replace(definition,'public.ap_source_aware_document_schema_installed()','public.ap_source_aware_document_schema_installed() and public.ap_material_draft_stage_claiming_schema_installed()');
 execute definition;
end $$;
commit;

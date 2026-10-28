begin;

-- Connected preparation for confirmed-intake obligations. This migration does
-- not activate a provider, change accepted terms, charge a customer, or deliver
-- anything. Private prose remains in the existing encrypted payload table.
create table public.ap_material_draft_jobs (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references public.profiles(id),
 material_line_id uuid not null references public.ap_material_lines(id),
 line_revision_id uuid not null unique references public.ap_material_line_revisions(id),
 source_snapshot_id uuid not null references public.ap_intake_snapshots(id),
 state text not null default 'EVIDENCE_PENDING' check(state in('EVIDENCE_PENDING','PREPARING','READY','DRAFTING','SOURCE_READY','RENDERING','REVIEW_READY','APPROVED','RELEASED','RESULT_UNKNOWN','OWNER_EXCEPTION','SUPERSEDED','CANCELED')),
 active_version_id uuid,
 lease_owner uuid, lease_token uuid, lease_generation integer not null default 0 check(lease_generation>=0),
 lease_expires_at timestamptz, claim_count integer not null default 0 check(claim_count between 0 and 30),
 error_code text check(error_code in('EVIDENCE_INCOMPLETE','EVIDENCE_STALE','PROVIDER_UNAVAILABLE','PROVIDER_RESULT_UNKNOWN','RENDER_FAILED','ATTEMPTS_EXHAUSTED','OWNER_REJECTED')),
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
create table public.ap_material_draft_versions (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references public.profiles(id),
 material_line_id uuid not null references public.ap_material_lines(id),
 job_id uuid not null references public.ap_material_draft_jobs(id),
 version integer not null check(version>0), supersedes_id uuid references public.ap_material_draft_versions(id),
 packet_encrypted_payload_id uuid not null references public.ap_sensitive_payloads(id),
 packet_sha256 text not null check(packet_sha256 ~ '^[0-9a-f]{64}$'),
 context_sha256 text not null check(context_sha256 ~ '^[0-9a-f]{64}$'),
 encrypted_payload_id uuid references public.ap_sensitive_payloads(id),
 source_sha256 text check(source_sha256 ~ '^[0-9a-f]{64}$'),
 claim_review_encrypted_payload_id uuid references public.ap_sensitive_payloads(id),
 claim_review_sha256 text check(claim_review_sha256 ~ '^[0-9a-f]{64}$'),
 claim_review_metadata jsonb, claims_reviewed_by uuid references public.profiles(id), claims_reviewed_at timestamptz,
 member_set_sha256 text check(member_set_sha256 ~ '^[0-9a-f]{64}$'),
 approval_sha256 text check(approval_sha256 ~ '^[0-9a-f]{64}$'),
 review_checklist jsonb, approved_by uuid references public.profiles(id), approved_at timestamptz,
 invalidated_at timestamptz, release_id uuid unique references public.ap_releases(id),
 created_at timestamptz not null default clock_timestamp(),
 unique(job_id,version),
 check((encrypted_payload_id is null)=(source_sha256 is null)),
 check((claim_review_encrypted_payload_id is null)=(claim_review_sha256 is null)),
 check((approved_at is null)=(approval_sha256 is null))
);
alter table public.ap_material_draft_jobs add foreign key(active_version_id) references public.ap_material_draft_versions(id);
create table public.ap_material_draft_policies (
 id uuid primary key default gen_random_uuid(),
 provider text not null check(provider ~ '^[a-z][a-z0-9_-]{1,39}$'),
 model text not null check(model ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{1,119}$'),
 privacy_reference_sha256 text not null check(privacy_reference_sha256 ~ '^[0-9a-f]{64}$'),
 evaluation_reference_sha256 text not null check(evaluation_reference_sha256 ~ '^[0-9a-f]{64}$'),
 quote_reference_sha256 text not null check(quote_reference_sha256 ~ '^[0-9a-f]{64}$'),
 policy_sha256 text not null unique check(policy_sha256 ~ '^[0-9a-f]{64}$'),
 max_input_tokens integer not null check(max_input_tokens between 1 and 50000),
 max_output_tokens integer not null check(max_output_tokens between 1 and 16000),
 input_microusd_per_million bigint not null check(input_microusd_per_million between 0 and 1000000000),
 output_microusd_per_million bigint not null check(output_microusd_per_million between 0 and 1000000000),
 max_attempt_microusd bigint not null check(max_attempt_microusd between 1 and 10000000),
 rolling_day_microusd bigint not null check(rolling_day_microusd between 1 and 100000000),
 max_attempts integer not null check(max_attempts between 1 and 3),
 approved_by uuid not null references public.profiles(id), approved_at timestamptz not null default clock_timestamp()
);
create table public.ap_material_draft_runtime (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false, policy_id uuid references public.ap_material_draft_policies(id),
 check(not enabled or policy_id is not null)
);
insert into public.ap_material_draft_runtime(singleton) values(true);
create table public.ap_material_draft_attempts (
 id uuid primary key,
 customer_id uuid not null references public.profiles(id),
 material_line_id uuid not null references public.ap_material_lines(id),
 job_id uuid not null references public.ap_material_draft_jobs(id),
 draft_version_id uuid not null references public.ap_material_draft_versions(id),
 policy_id uuid not null references public.ap_material_draft_policies(id),
 lease_generation integer not null,
 state text not null check(state in('DISPATCHED','RESULT_RECORDED','RESULT_UNKNOWN','NO_RESULT_CONFIRMED')),
 input_token_cap integer not null check(input_token_cap>0), output_token_cap integer not null check(output_token_cap>0),
 reserved_microusd bigint not null check(reserved_microusd>0),
 dispatched_at timestamptz not null default clock_timestamp(), completed_at timestamptz
);
create table public.ap_material_draft_members (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references public.profiles(id),
 material_line_id uuid not null references public.ap_material_lines(id),
 draft_version_id uuid not null references public.ap_material_draft_versions(id),
 artifact_type public.ap_artifact_type not null check(artifact_type in('RESUME','COVER_LETTER','REFERENCE_SHEET')),
 artifact_id uuid not null references public.ap_generated_artifacts(id),
 file_version_id uuid not null unique references public.ap_generated_file_versions(id),
 file_sha256 text not null check(file_sha256 ~ '^[0-9a-f]{64}$'),
 preview_sha256 text not null check(preview_sha256 ~ '^[0-9a-f]{64}$'),
 source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
 editable_source_sha256 text not null check(editable_source_sha256 ~ '^[0-9a-f]{64}$'),
 editable_source_path_sha256 text not null check(editable_source_path_sha256 ~ '^[0-9a-f]{64}$'),
 unique(draft_version_id,artifact_type)
);
-- Minimal financial reconciliation remains writable through its scoped RPC
-- after private workflow rows are purged. It contains no document content and
-- cannot reactivate a job. An immutable receipt avoids weakening purge guards.
create table public.ap_material_draft_reconciliations (
 request_id uuid primary key references public.ap_material_draft_attempts(id),
 actual_microusd bigint not null check(actual_microusd between 0 and 100000000),
 no_result boolean not null,
 evidence_sha256 text not null check(evidence_sha256 ~ '^[0-9a-f]{64}$'),
 reviewed_by uuid not null references public.profiles(id),
 reviewed_at timestamptz not null default clock_timestamp()
);
-- Provider observations are minimal accounting evidence. They cannot create
-- prose, approve claims, reactivate work, or release reserved spending.
create table public.ap_material_draft_observations (
 request_id uuid not null references public.ap_material_draft_attempts(id),
 receipt_sha256 text not null check(receipt_sha256 ~ '^[0-9a-f]{64}$'),
 outcome text not null check(outcome in('PROPOSAL_VALIDATED','PROPOSAL_REJECTED','RESULT_UNKNOWN')),
 provider_response_id text check(provider_response_id ~ '^[A-Za-z0-9_-]{1,255}$'),
 response_model text check(response_model ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$'),
 input_tokens bigint, output_tokens bigint, total_tokens bigint,
 observed_at timestamptz not null default clock_timestamp(),
 primary key(request_id,receipt_sha256),
 check((input_tokens is null and output_tokens is null and total_tokens is null) or
  (input_tokens between 0 and 1000000000 and output_tokens between 0 and 1000000000 and total_tokens between 0 and 2000000000
   and input_tokens is not null and output_tokens is not null and total_tokens=input_tokens+output_tokens))
);
-- This table is not writable/readable by the service role. Only nested security
-- definer calls can authorize the old RPCs for this exact transaction and pair.
create table public.ap_material_draft_permits (
 transaction_id xid8 not null, backend_pid integer not null,
 material_line_id uuid not null, draft_version_id uuid not null,
 operation text not null check(operation in('REGISTER','APPROVE','SEND')),
 primary key(transaction_id,backend_pid,material_line_id,operation)
);
create index ap_material_draft_queue on public.ap_material_draft_jobs(state,created_at);
create index ap_material_draft_spend on public.ap_material_draft_attempts(dispatched_at);

do $$ declare t text; begin
 foreach t in array array['ap_material_draft_jobs','ap_material_draft_versions','ap_material_draft_policies','ap_material_draft_runtime','ap_material_draft_attempts','ap_material_draft_members','ap_material_draft_permits','ap_material_draft_reconciliations','ap_material_draft_observations'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  if t<>'ap_material_draft_permits' then execute format('grant select on public.%I to service_role',t); end if;
 end loop;
end $$;

create function public.ap_observe_material_draft_response(p_job_id uuid,p_request_id uuid,p_version_id uuid,p_policy_id uuid,
 p_outcome text,p_provider_response_id text,p_response_model text,p_input_tokens bigint,p_output_tokens bigint,p_total_tokens bigint) returns text
language plpgsql security definer set search_path='' as $$
declare attempt public.ap_material_draft_attempts; receipt text;
begin
 -- This intentionally does not require a live lease, unexpired deadline, active
 -- private payload, or current version: a late receipt must survive interruption.
 -- It authenticates the already-dispatched immutable attempt, never dispatches.
 select * into attempt from public.ap_material_draft_attempts where id=p_request_id for update;
 if attempt.id is null or attempt.job_id is distinct from p_job_id or attempt.draft_version_id is distinct from p_version_id
  or attempt.policy_id is distinct from p_policy_id then raise exception 'material_draft_observation_identity_invalid'; end if;
 if p_outcome is null or p_outcome not in('PROPOSAL_VALIDATED','PROPOSAL_REJECTED','RESULT_UNKNOWN')
  or p_provider_response_id is not null and p_provider_response_id !~ '^[A-Za-z0-9_-]{1,255}$'
  or p_response_model is not null and p_response_model !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$'
  or not ((p_input_tokens is null and p_output_tokens is null and p_total_tokens is null) or
   (p_input_tokens is not null and p_output_tokens is not null and p_total_tokens is not null
    and p_input_tokens between 0 and 1000000000 and p_output_tokens between 0 and 1000000000 and p_total_tokens=p_input_tokens+p_output_tokens))
  then raise exception 'material_draft_observation_invalid'; end if;
 receipt:=encode(extensions.digest(jsonb_build_object('requestId',p_request_id,'jobId',p_job_id,'versionId',p_version_id,'policyId',p_policy_id,
  'outcome',p_outcome,'responseId',p_provider_response_id,'model',p_response_model,'inputTokens',p_input_tokens,'outputTokens',p_output_tokens,'totalTokens',p_total_tokens)::text,'sha256'),'hex');
 if exists(select 1 from public.ap_material_draft_observations where request_id=p_request_id and receipt_sha256=receipt) then return receipt; end if;
 if exists(select 1 from public.ap_material_draft_observations o where o.request_id=p_request_id and
  (o.outcome<>'RESULT_UNKNOWN' or p_outcome='RESULT_UNKNOWN'
   or o.provider_response_id is not null and o.provider_response_id is distinct from p_provider_response_id
   or o.response_model is not null and o.response_model is distinct from p_response_model
   or o.input_tokens is not null and row(o.input_tokens,o.output_tokens,o.total_tokens) is distinct from row(p_input_tokens,p_output_tokens,p_total_tokens)))
  then raise exception 'material_draft_observation_conflict'; end if;
 insert into public.ap_material_draft_observations(request_id,receipt_sha256,outcome,provider_response_id,response_model,input_tokens,output_tokens,total_tokens)
 values(p_request_id,receipt,p_outcome,p_provider_response_id,p_response_model,p_input_tokens,p_output_tokens,p_total_tokens);
 return receipt;
end $$;

create function public.ap_register_material_draft_policy(p_policy jsonb,p_reviewer_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid; digest text;
begin
 perform public.ap_require_material_reviewer(p_reviewer_id);
 if jsonb_typeof(p_policy) is distinct from 'object' or
  (select array_agg(key order by key) from jsonb_object_keys(p_policy) key) is distinct from
  array['evaluationReferenceSha256','inputMicrousdPerMillion','maxAttemptMicrousd','maxAttempts','maxInputTokens','maxOutputTokens','model','outputMicrousdPerMillion','privacyReferenceSha256','provider','quoteReferenceSha256','rollingDayMicrousd']::text[]
  then raise exception 'material_draft_policy_invalid'; end if;
 digest:=encode(extensions.digest(p_policy::text,'sha256'),'hex');
 insert into public.ap_material_draft_policies(provider,model,privacy_reference_sha256,evaluation_reference_sha256,quote_reference_sha256,policy_sha256,
  max_input_tokens,max_output_tokens,input_microusd_per_million,output_microusd_per_million,max_attempt_microusd,rolling_day_microusd,max_attempts,approved_by)
 values(p_policy->>'provider',p_policy->>'model',p_policy->>'privacyReferenceSha256',p_policy->>'evaluationReferenceSha256',p_policy->>'quoteReferenceSha256',digest,
  (p_policy->>'maxInputTokens')::integer,(p_policy->>'maxOutputTokens')::integer,(p_policy->>'inputMicrousdPerMillion')::bigint,
  (p_policy->>'outputMicrousdPerMillion')::bigint,(p_policy->>'maxAttemptMicrousd')::bigint,(p_policy->>'rollingDayMicrousd')::bigint,(p_policy->>'maxAttempts')::integer,p_reviewer_id)
 on conflict(policy_sha256) do nothing;
 select id into result from public.ap_material_draft_policies where policy_sha256=digest;
 return result;
end $$;
create function public.ap_set_material_draft_runtime(p_enabled boolean,p_policy_id uuid,p_reviewer_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.ap_require_material_reviewer(p_reviewer_id);
 if p_enabled is null or p_enabled and not exists(select 1 from public.ap_material_draft_policies where id=p_policy_id)
  then raise exception 'material_draft_policy_required'; end if;
 update public.ap_material_draft_runtime set enabled=p_enabled,policy_id=p_policy_id where singleton;
 insert into public.ap_audit_events(actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
 values(p_reviewer_id,'MATERIAL_DRAFT_PROVIDER_CONFIGURATION','MATERIAL_DRAFT_POLICY',p_policy_id,jsonb_build_object('enabled',p_enabled),'material-draft-pair-v1');
end $$;

create function public.ap_begin_material_draft_request(p_job_id uuid,p_lease_token uuid,p_version_id uuid,p_request_id uuid,p_policy_id uuid,p_input_token_cap integer,p_output_token_cap integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.ap_material_draft_jobs; v public.ap_material_draft_versions; policy public.ap_material_draft_policies;
 runtime public.ap_material_draft_runtime; attempt public.ap_material_draft_attempts; reserved bigint; committed bigint;
begin
 if p_lease_token is null then raise exception 'material_draft_lease_required'; end if;
 j:=public.ap_lock_material_draft_job(p_job_id,p_lease_token);
 select * into v from public.ap_material_draft_versions where id=p_version_id and id=j.active_version_id for update;
 if v.id is null or v.invalidated_at is not null or v.encrypted_payload_id is not null or v.context_sha256 is distinct from public.ap_material_draft_context_sha256(j.id)
  then raise exception 'material_draft_version_stale'; end if;
 select * into attempt from public.ap_material_draft_attempts where id=p_request_id;
 if attempt.id is not null then
  if attempt.job_id=j.id and attempt.draft_version_id=v.id and attempt.policy_id=p_policy_id and attempt.lease_generation=j.lease_generation
   and attempt.input_token_cap=p_input_token_cap and attempt.output_token_cap=p_output_token_cap then
   -- A replay is evidence of an existing dispatch, never permission to call the
   -- provider again after the reservation response was lost.
   return jsonb_build_object('requestId',attempt.id,'dispatchAuthorized',false,'state',attempt.state,'reservedMicrousd',attempt.reserved_microusd);
  end if;
  raise exception 'material_draft_request_identity_conflict';
 end if;
 if j.state<>'READY' or p_request_id is null then raise exception 'material_draft_stage_invalid'; end if;
 select * into runtime from public.ap_material_draft_runtime where singleton for update;
 select * into policy from public.ap_material_draft_policies where id=runtime.policy_id;
 if not runtime.enabled or policy.id is null or policy.id is distinct from p_policy_id then raise exception 'material_draft_provider_disabled'; end if;
 if p_input_token_cap is null or p_output_token_cap is null or p_input_token_cap not between 1 and policy.max_input_tokens
  or p_output_token_cap not between 1 and policy.max_output_tokens then raise exception 'material_draft_token_cap_invalid'; end if;
 if (select count(*) from public.ap_material_draft_attempts where job_id=j.id)>=policy.max_attempts
  or exists(select 1 from public.ap_material_draft_attempts where job_id=j.id and state in('DISPATCHED','RESULT_UNKNOWN'))
  then raise exception 'material_draft_attempt_limit'; end if;
 reserved:=greatest(1,ceil((p_input_token_cap::numeric*policy.input_microusd_per_million+p_output_token_cap::numeric*policy.output_microusd_per_million)/1000000))::bigint;
 -- Unknown spend is reserved indefinitely; confirmed spend remains in the
 -- rolling window. Changing provider policies never resets the shared budget.
 select coalesce(sum(coalesce(receipt.actual_microusd,spend.reserved_microusd)),0) into committed
 from public.ap_material_draft_attempts spend left join public.ap_material_draft_reconciliations receipt on receipt.request_id=spend.id
 where receipt.request_id is null or spend.dispatched_at>clock_timestamp()-interval '24 hours';
 if reserved>policy.max_attempt_microusd or committed+reserved>policy.rolling_day_microusd then raise exception 'material_draft_budget_exhausted'; end if;
 insert into public.ap_material_draft_attempts(id,customer_id,material_line_id,job_id,draft_version_id,policy_id,lease_generation,state,input_token_cap,output_token_cap,reserved_microusd)
 values(p_request_id,j.customer_id,j.material_line_id,j.id,v.id,policy.id,j.lease_generation,'DISPATCHED',p_input_token_cap,p_output_token_cap,reserved);
 update public.ap_material_draft_jobs set state='DRAFTING',updated_at=clock_timestamp() where id=j.id;
 return jsonb_build_object('requestId',p_request_id,'dispatchAuthorized',true,'state','DISPATCHED','reservedMicrousd',reserved,'provider',policy.provider,'model',policy.model,'policySha256',policy.policy_sha256);
end $$;

create function public.ap_record_material_draft_result(p_job_id uuid,p_lease_token uuid,p_request_id uuid,p_source_payload_id uuid,p_source_sha256 text) returns uuid
language plpgsql security definer set search_path='' as $$
declare j public.ap_material_draft_jobs; a public.ap_material_draft_attempts; v public.ap_material_draft_versions;
begin
 if p_lease_token is null then raise exception 'material_draft_lease_required'; end if;
 j:=public.ap_lock_material_draft_job(p_job_id,p_lease_token);
 select * into a from public.ap_material_draft_attempts where id=p_request_id and job_id=j.id for update;
 select * into v from public.ap_material_draft_versions where id=a.draft_version_id and id=j.active_version_id for update;
 if a.id is null or v.id is null or a.lease_generation<>j.lease_generation or a.state not in('DISPATCHED','RESULT_RECORDED') or v.invalidated_at is not null
  then raise exception 'material_draft_result_stale'; end if;
 if v.encrypted_payload_id is not null then
  if v.encrypted_payload_id=p_source_payload_id and v.source_sha256=p_source_sha256 and a.state='RESULT_RECORDED' then return v.id; end if;
  raise exception 'material_draft_result_identity_conflict';
 end if;
 if v.context_sha256 is distinct from public.ap_material_draft_context_sha256(j.id) then raise exception 'material_draft_context_changed'; end if;
 if not exists(select 1 from public.ap_sensitive_payloads where id=p_source_payload_id and customer_id=j.customer_id and retention_state='ACTIVE' and content_sha256=p_source_sha256)
  then raise exception 'material_draft_payload_unavailable'; end if;
 update public.ap_material_draft_versions set encrypted_payload_id=p_source_payload_id,source_sha256=p_source_sha256 where id=v.id;
 update public.ap_material_draft_attempts set state='RESULT_RECORDED',completed_at=clock_timestamp() where id=a.id;
 update public.ap_material_draft_jobs set state='SOURCE_READY',updated_at=clock_timestamp() where id=j.id;
 return v.id;
end $$;

create function public.ap_assert_material_draft_dispatch_current(p_job_id uuid,p_lease_token uuid,p_request_id uuid,p_version_id uuid,p_policy_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare j public.ap_material_draft_jobs; v public.ap_material_draft_versions;
begin
 if p_lease_token is null then raise exception 'material_draft_lease_required'; end if;
 j:=public.ap_lock_material_draft_job(p_job_id,p_lease_token);
 select * into v from public.ap_material_draft_versions where id=p_version_id and id=j.active_version_id for share;
 if j.state<>'DRAFTING' or v.id is null or v.invalidated_at is not null or v.encrypted_payload_id is not null
  or not exists(select 1 from public.ap_material_draft_attempts where id=p_request_id and job_id=j.id and draft_version_id=v.id
    and policy_id=p_policy_id and lease_generation=j.lease_generation and state='DISPATCHED')
  or not exists(select 1 from public.ap_material_draft_runtime where singleton and enabled and policy_id=p_policy_id)
  or v.context_sha256 is distinct from public.ap_material_draft_context_sha256(j.id) then raise exception 'material_draft_dispatch_no_longer_current'; end if;
 return true;
end $$;

create function public.ap_fail_material_draft_job(p_job_id uuid,p_lease_token uuid,p_error_code text) returns text
language plpgsql security definer set search_path='' as $$
declare j public.ap_material_draft_jobs; target text;
begin
 if p_lease_token is null then raise exception 'material_draft_lease_required'; end if;
 j:=public.ap_lock_material_draft_job(p_job_id,p_lease_token);
 if p_error_code is null or p_error_code not in('EVIDENCE_INCOMPLETE','EVIDENCE_STALE','PROVIDER_UNAVAILABLE','RENDER_FAILED') then raise exception 'material_draft_error_code_invalid'; end if;
 if exists(select 1 from public.ap_material_draft_attempts where job_id=j.id and state='DISPATCHED') then
  update public.ap_material_draft_attempts set state='RESULT_UNKNOWN' where job_id=j.id and state='DISPATCHED';
  target:='RESULT_UNKNOWN'; p_error_code:='PROVIDER_RESULT_UNKNOWN';
 elsif p_error_code='RENDER_FAILED' then target:='SOURCE_READY';
 else target:='OWNER_EXCEPTION'; end if;
 update public.ap_material_draft_jobs set state=target,error_code=p_error_code,lease_token=null,lease_expires_at=null,updated_at=clock_timestamp() where id=j.id;
 return target;
end $$;

create function public.ap_reconcile_material_draft_attempt(p_request_id uuid,p_actual_microusd bigint,p_no_result boolean,p_evidence_sha256 text,p_reviewer_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare a public.ap_material_draft_attempts; j public.ap_material_draft_jobs; receipt public.ap_material_draft_reconciliations; retryable boolean:=false;
begin
 perform public.ap_require_material_reviewer(p_reviewer_id);
 select * into a from public.ap_material_draft_attempts where id=p_request_id;
 if a.id is null then raise exception 'material_draft_attempt_missing'; end if;
 -- Spend reconciliation must remain possible after refunds or deadlines.
 perform pg_advisory_xact_lock(hashtextextended('service-retention:'||a.customer_id::text,0));
 perform 1 from public.ap_payment_attempts payment join public.ap_material_lines line on line.payment_attempt_id=payment.id where line.id=a.material_line_id for update of payment;
 perform 1 from public.ap_material_lines where id=a.material_line_id for update;
 select * into j from public.ap_material_draft_jobs where id=a.job_id for update;
 perform 1 from public.ap_material_draft_runtime where singleton for update;
 select * into a from public.ap_material_draft_attempts where id=p_request_id for update;
 if p_actual_microusd is null or p_actual_microusd<0 or p_actual_microusd>100000000 or p_no_result is null or p_evidence_sha256 is null or p_evidence_sha256 !~ '^[0-9a-f]{64}$'
  or a.state not in('RESULT_UNKNOWN','RESULT_RECORDED','NO_RESULT_CONFIRMED','DISPATCHED') or p_no_result and a.state='RESULT_RECORDED'
  or a.state='DISPATCHED' and j.lease_expires_at>clock_timestamp()
  then raise exception 'material_draft_reconciliation_invalid'; end if;
 select * into receipt from public.ap_material_draft_reconciliations where request_id=a.id;
 if receipt.request_id is not null then
  if receipt.actual_microusd=p_actual_microusd and receipt.evidence_sha256=p_evidence_sha256 and receipt.no_result=p_no_result then return; end if;
  raise exception 'material_draft_reconciliation_conflict';
 end if;
 -- Unknown result with confirmed spending is still not retryable unless the
 -- reviewer also established that no reusable response exists.
 insert into public.ap_material_draft_reconciliations(request_id,actual_microusd,no_result,evidence_sha256,reviewed_by)
 values(a.id,p_actual_microusd,p_no_result,p_evidence_sha256,p_reviewer_id);
 if p_no_result and j.state='RESULT_UNKNOWN' and not exists(select 1 from public.ap_retention_row_receipts
   where (table_name='ap_material_draft_jobs' and row_id=j.id::text) or (table_name='ap_material_draft_attempts' and row_id=a.id::text)) then
  begin perform public.ap_lock_material_draft_job(j.id); retryable:=true;
  exception when raise_exception then
   if sqlerrm<>'material_draft_obligation_not_active' then raise; end if;
  end;
 end if;
 if retryable then
  update public.ap_material_draft_attempts set state='NO_RESULT_CONFIRMED',completed_at=coalesce(completed_at,clock_timestamp()) where id=a.id;
  update public.ap_material_draft_jobs set state='READY',lease_token=null,lease_expires_at=null,error_code=null,updated_at=clock_timestamp() where id=j.id;
 end if;
end $$;

create function public.ap_material_draft_enqueue(p_line_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare l public.ap_material_lines; r public.ap_material_line_revisions; customer uuid; result uuid;
begin
 select * into l from public.ap_material_lines where id=p_line_id;
 select * into r from public.ap_material_line_revisions where line_id=l.id and version=l.active_revision and superseded_at is null;
 if l.id is null or r.id is null or l.fulfillment not in('PAID','GENERATING','HUMAN_REVIEW','READY_TO_RELEASE')
  or l.materials_payment_verified_at is null or r.started_at is null or r.due_at is null
  or exists(select 1 from public.ap_releases where material_line_id=l.id)
  or not exists(select 1 from public.ap_intake_snapshots s where s.id=r.source_snapshot_id
   and s.confirmed_review->>'contractVersion'='applypack-confirmed-intake-v1') then return null; end if;
 select customer_id into customer from public.ap_material_purchases where id=l.purchase_id;
 insert into public.ap_material_draft_jobs(customer_id,material_line_id,line_revision_id,source_snapshot_id)
 values(customer,l.id,r.id,r.source_snapshot_id) on conflict(line_revision_id) do nothing;
 select id into result from public.ap_material_draft_jobs where line_revision_id=r.id;
 update public.ap_material_draft_jobs set state='SUPERSEDED',lease_token=null,lease_expires_at=null,updated_at=clock_timestamp()
 where material_line_id=l.id and line_revision_id<>r.id and state not in('RELEASED','SUPERSEDED','CANCELED');
 return result;
end $$;
create function public.ap_enqueue_material_draft_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='ap_material_lines' then perform public.ap_material_draft_enqueue(new.id);
 else perform public.ap_material_draft_enqueue(new.line_id); end if;
 return new;
end $$;
create trigger ap_material_draft_paid_enqueue after insert or update of fulfillment,active_revision,materials_payment_verified_at on public.ap_material_lines
for each row execute function public.ap_enqueue_material_draft_trigger();
create trigger ap_material_draft_revision_enqueue after insert or update of started_at,due_at on public.ap_material_line_revisions
for each row execute function public.ap_enqueue_material_draft_trigger();

-- Consistent lock order, including the existing retention and payment fences.
create function public.ap_lock_material_draft_job(p_job_id uuid,p_lease_token uuid default null)
returns public.ap_material_draft_jobs language plpgsql security definer set search_path='' as $$
declare j public.ap_material_draft_jobs; l public.ap_material_lines; p public.ap_payment_attempts; r public.ap_material_line_revisions;
begin
 select * into j from public.ap_material_draft_jobs where id=p_job_id;
 if j.id is null then raise exception 'material_draft_job_missing'; end if;
 perform 1 from public.ap_retention_restore_lock where singleton for share;
 if exists(select 1 from public.ap_retention_restore_lock where singleton and locked) then raise exception 'material_draft_restore_locked'; end if;
 perform pg_advisory_xact_lock(hashtextextended('service-retention:'||j.customer_id::text,0));
 select payment.* into p from public.ap_payment_attempts payment join public.ap_material_lines line on line.payment_attempt_id=payment.id where line.id=j.material_line_id for update of payment;
 select * into l from public.ap_material_lines where id=j.material_line_id for update;
 select * into r from public.ap_material_line_revisions where id=j.line_revision_id for update;
 select * into j from public.ap_material_draft_jobs where id=p_job_id for update;
 if p.settlement is distinct from 'PAID' or p.customer_id is distinct from j.customer_id or p.dispute in('OPEN','LOST') or p.funds_reversed_at is not null
  or p.immediate_charge_verified is distinct from true or p.payment_verified_at is null
  or not exists(select 1 from public.ap_material_purchases purchase where purchase.id=l.purchase_id and purchase.customer_id=j.customer_id and purchase.payment_attempt_id=p.id
    and purchase.amount_cents=p.amount_cents and purchase.currency=p.currency)
  or l.fulfillment not in('PAID','GENERATING','HUMAN_REVIEW','READY_TO_RELEASE') or r.version is distinct from l.active_revision
  or r.superseded_at is not null or r.source_snapshot_id is distinct from j.source_snapshot_id
  or r.due_at is null or r.due_at<=clock_timestamp() or l.materials_due_at is distinct from r.due_at
  or exists(select 1 from public.ap_refund_operations where material_line_id=l.id and superseded_at is null)
  or exists(select 1 from public.ap_releases where material_line_id=l.id)
  or not public.ap_customer_owns_snapshot(j.customer_id,j.source_snapshot_id)
  then raise exception 'material_draft_obligation_not_active'; end if;
 if p_lease_token is not null and (j.lease_token is distinct from p_lease_token or j.lease_expires_at is null or j.lease_expires_at<=clock_timestamp())
  then raise exception 'material_draft_lease_stale'; end if;
 return j;
end $$;

-- This is a database consistency token, distinct from the canonical encrypted
-- packet content digest. A worker reads it before/after assembling the packet;
-- attachment, publication, approval and send recompute it under the same locks.
create function public.ap_material_draft_context_sha256(p_job_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare j public.ap_material_draft_jobs; r public.ap_material_line_revisions; s public.ap_intake_snapshots;
 rule public.ap_employer_submission_rules; listing public.ap_material_listing_checks; body jsonb;
begin
 j:=public.ap_lock_material_draft_job(p_job_id);
 -- These short DB-only transactions hold no network operation. SHARE locks
 -- include insert phantoms, so a source review/fact cannot change between the
 -- digest check and pair commit. Low launch capacity makes this conservative
 -- fence preferable to silently accepting an unprotected currentness check.
 lock table public.ap_intake_snapshots,public.ap_anonymous_drafts,public.ap_candidate_facts,
  public.ap_fact_review_history,public.ap_document_versions,public.ap_sensitive_payloads,
  public.ap_job_snapshots,public.ap_job_snapshot_invalidations,public.ap_requirement_nodes,
  public.ap_human_review_records,public.ap_employer_submission_rules,public.ap_material_listing_checks,
  public.ap_material_checkout_intents,public.ap_material_checkout_items,public.ap_snapshot_legal_content_receipts,
  public.ap_reference_permissions in share mode;
 lock table public.jobs,public.job_sources,public.job_source_runs,public.ap_source_authorizations,public.ap_source_authorization_heads,
  public.job_source_references,public.job_source_run_listings,public.job_source_listing_projections,
  public.ap_source_verifications,public.ap_manual_source_observations in share mode;
 select * into r from public.ap_material_line_revisions where id=j.line_revision_id;
 select * into s from public.ap_intake_snapshots where id=j.source_snapshot_id for share;
 select * into rule from public.ap_employer_submission_rules where id=r.employer_rule_snapshot_id for share;
 select * into listing from public.ap_material_listing_checks where material_line_id=j.material_line_id and line_revision_id=r.id and phase='BEFORE_GENERATION' order by checked_at desc,id desc limit 1;
 if s.confirmed_review->>'contractVersion' is distinct from 'applypack-confirmed-intake-v1'
  or rule.id is null or not rule.is_current or rule.superseded_at is not null or rule.job_snapshot_id is distinct from r.job_snapshot_id
  or rule.injection_scan_state is distinct from 'CLEAR' or rule.hard_block_reason is not null
  or listing.result is distinct from 'ACTIVE' or listing.submission_rule_id is distinct from rule.id or listing.evidence_sha256 is distinct from rule.content_sha256
  or listing.checked_at<clock_timestamp()-interval '1 hour' or rule.checked_at<clock_timestamp()-interval '1 hour'
  or exists(select 1 from public.ap_job_snapshots where supersedes_job_snapshot_id=r.job_snapshot_id)
  or exists(select 1 from public.ap_job_snapshot_invalidations where job_snapshot_id=r.job_snapshot_id)
  or not exists(select 1 from public.ap_current_source_verifications(r.job_snapshot_id))
  then raise exception 'material_draft_evidence_stale'; end if;
 perform 1 from public.ap_candidate_facts where snapshot_id=s.id order by id for share;
 perform 1 from public.ap_human_review_records where snapshot_id=s.id and job_snapshot_id=r.job_snapshot_id order by id for share;
 perform 1 from public.ap_requirement_nodes where job_snapshot_id=r.job_snapshot_id order by id for share;
 if (select count(*) from public.ap_candidate_facts where snapshot_id=s.id)>500
  or (select count(*) from public.ap_fact_review_history where snapshot_id=s.id)>500
  or (select count(*) from public.ap_document_versions where draft_id=s.draft_id and is_current)>100
  or (select count(*) from public.ap_requirement_nodes where job_snapshot_id=r.job_snapshot_id)>500
  or (select count(*) from public.ap_human_review_records where snapshot_id=s.id and job_snapshot_id=r.job_snapshot_id)>1000
  then raise exception 'material_draft_evidence_bound_exceeded'; end if;
 if exists(select 1 from public.ap_candidate_facts where snapshot_id=s.id and superseded_at is null and verification in('CUSTOMER_REJECTED','DISPUTED'))
  then raise exception 'material_draft_evidence_unresolved'; end if;
 select jsonb_build_object('revision',to_jsonb(r),'snapshot',to_jsonb(s),'rule',to_jsonb(rule),'generationCheck',to_jsonb(listing),
  'job',(select to_jsonb(v) from public.ap_job_snapshots v where id=r.job_snapshot_id),
  'legacyJob',(select to_jsonb(v) from public.jobs v join public.ap_job_snapshots snapshot on snapshot.legacy_job_id=v.id where snapshot.id=r.job_snapshot_id),
  'sourceRun',(select to_jsonb(v) from public.job_source_runs v join public.ap_job_snapshots snapshot on snapshot.source_run_id=v.id where snapshot.id=r.job_snapshot_id),
  'sourceAuthorization',(select to_jsonb(v) from public.ap_source_authorizations v join public.ap_job_snapshots snapshot on snapshot.source_authorization_id=v.id where snapshot.id=r.job_snapshot_id),
  'sourceHead',(select to_jsonb(v) from public.ap_source_authorization_heads v join public.ap_job_snapshots snapshot on snapshot.discovery_source=v.source_id where snapshot.id=r.job_snapshot_id),
  'currentSourceVerifications',(select jsonb_agg(to_jsonb(v) order by to_jsonb(v)::text) from public.ap_current_source_verifications(r.job_snapshot_id) v),
  'facts',(select jsonb_agg(to_jsonb(f) order by f.id) from public.ap_candidate_facts f where snapshot_id=s.id),
  'checkoutContactFact',(select to_jsonb(f) from public.ap_material_lines line join public.ap_material_purchases purchase on purchase.id=line.purchase_id
    join public.ap_material_checkout_intents intent on intent.id=purchase.checkout_intent_id
    join public.ap_candidate_facts f on f.id=intent.contact_payload_id and f.snapshot_id=intent.source_snapshot_id
    where line.id=j.material_line_id and f.customer_id=j.customer_id),
  'sourceDraft',(select jsonb_build_object('id',d.id,'version',d.version,'answers',d.answers,'receipt',d.confirmation_receipt,'retention',d.retention_state,'customer',d.converted_customer_id,'snapshot',d.finalized_snapshot_id) from public.ap_anonymous_drafts d where d.id=s.draft_id),
  'factReviews',(select jsonb_agg(to_jsonb(f) order by f.id) from public.ap_fact_review_history f where snapshot_id=s.id),
  'sourceFacts',(select jsonb_agg(to_jsonb(f) order by f.id) from public.ap_candidate_facts f where f.id in(select fact_id from public.ap_fact_review_history where snapshot_id=s.id)),
  'sourceDocuments',(select jsonb_agg(to_jsonb(d) order by d.id) from public.ap_document_versions d where d.draft_id=s.draft_id and d.is_current),
  'sensitivePayloads',(select jsonb_agg(jsonb_build_object('id',p.id,'hash',p.content_sha256,'retention',p.retention_state,'customer',p.customer_id,'draft',p.draft_id) order by p.id)
    from public.ap_sensitive_payloads p where p.id=s.sensitive_payload_id or p.id in(select i.contact_payload_id from public.ap_material_checkout_intents i join public.ap_material_purchases purchase on purchase.checkout_intent_id=i.id join public.ap_material_lines line on line.purchase_id=purchase.id where line.id=j.material_line_id)),
  'reviews',(select jsonb_agg(to_jsonb(v) order by v.id) from public.ap_human_review_records v where snapshot_id=s.id and job_snapshot_id=r.job_snapshot_id),
  'requirements',(select jsonb_agg(to_jsonb(n) order by n.id) from public.ap_requirement_nodes n where job_snapshot_id=r.job_snapshot_id),
  'intent',(select to_jsonb(i) from public.ap_material_checkout_intents i join public.ap_material_purchases p on p.checkout_intent_id=i.id join public.ap_material_lines l on l.purchase_id=p.id where l.id=j.material_line_id),
  'items',(select jsonb_agg(to_jsonb(i) order by i.id) from public.ap_material_checkout_items i where material_line_id=j.material_line_id),
  'legal',(select jsonb_agg(to_jsonb(a) order by a.id) from public.ap_snapshot_legal_content_receipts a where snapshot_id=s.id),
  'referencePermissions',(select jsonb_agg(to_jsonb(v) order by v.id) from public.ap_reference_permissions v where customer_id=j.customer_id and job_snapshot_id=r.job_snapshot_id)
 ) into body;
 return encode(extensions.digest(body::text,'sha256'),'hex');
end $$;

create function public.ap_claim_material_draft_jobs(p_owner uuid,p_limit integer default 1) returns jsonb
language plpgsql security definer set search_path='' as $$
declare candidate record; j public.ap_material_draft_jobs; result jsonb:='[]';
begin
 if p_owner is null or p_limit is null or p_limit not between 1 and 5 then raise exception 'material_draft_claim_invalid'; end if;
 for candidate in select id from public.ap_material_draft_jobs where state in('EVIDENCE_PENDING','PREPARING','READY','DRAFTING','SOURCE_READY','RENDERING')
  and (lease_expires_at is null or lease_expires_at<=clock_timestamp()) order by created_at,id limit 25 loop
  begin j:=public.ap_lock_material_draft_job(candidate.id); exception when raise_exception then
   if sqlerrm not in('material_draft_obligation_not_active','material_draft_restore_locked') then raise; end if;
   continue;
  end;
  -- The candidate SELECT precedes row locking. A concurrent failure may have
  -- moved it to an owner exception/unknown result while this worker waited.
  if j.state not in('EVIDENCE_PENDING','PREPARING','READY','DRAFTING','SOURCE_READY','RENDERING') then continue; end if;
  if j.lease_expires_at>clock_timestamp() then continue; end if;
  if exists(select 1 from public.ap_material_draft_attempts where job_id=j.id and state='DISPATCHED') then
   update public.ap_material_draft_attempts set state='RESULT_UNKNOWN' where job_id=j.id and state='DISPATCHED';
   update public.ap_material_draft_jobs set state='RESULT_UNKNOWN',error_code='PROVIDER_RESULT_UNKNOWN',lease_token=null,lease_expires_at=null,updated_at=clock_timestamp() where id=j.id;
   continue;
  end if;
  if j.claim_count>=30 then
   update public.ap_material_draft_jobs set state='OWNER_EXCEPTION',error_code='ATTEMPTS_EXHAUSTED',lease_token=null,lease_expires_at=null where id=j.id;
   continue;
  end if;
  update public.ap_material_draft_jobs set state=case when active_version_id is null then 'PREPARING'
    when (select encrypted_payload_id from public.ap_material_draft_versions where id=active_version_id) is null then 'READY' else 'SOURCE_READY' end,
   lease_owner=p_owner,lease_token=gen_random_uuid(),lease_generation=lease_generation+1,
   lease_expires_at=clock_timestamp()+interval '5 minutes',claim_count=claim_count+1,updated_at=clock_timestamp()
   where id=j.id returning * into j;
  result:=result||jsonb_build_array(to_jsonb(j));
  if jsonb_array_length(result)>=p_limit then exit; end if;
 end loop;
 return result;
end $$;

create function public.ap_renew_material_draft_lease(p_job_id uuid,p_lease_token uuid) returns timestamptz
language plpgsql security definer set search_path='' as $$
declare j public.ap_material_draft_jobs; expires timestamptz;
begin
 if p_lease_token is null then raise exception 'material_draft_lease_required'; end if;
 j:=public.ap_lock_material_draft_job(p_job_id,p_lease_token);
 if j.state not in('PREPARING','READY','DRAFTING','SOURCE_READY','RENDERING') then raise exception 'material_draft_stage_invalid'; end if;
 select least(clock_timestamp()+interval '5 minutes',due_at) into expires from public.ap_material_line_revisions where id=j.line_revision_id;
 update public.ap_material_draft_jobs set lease_expires_at=expires,updated_at=clock_timestamp() where id=j.id;
 return expires;
end $$;

create function public.ap_attach_material_draft_packet(p_job_id uuid,p_lease_token uuid,p_payload_id uuid,p_packet_sha256 text,p_context_sha256 text) returns uuid
language plpgsql security definer set search_path='' as $$
declare j public.ap_material_draft_jobs; v public.ap_material_draft_versions;
begin
 if p_lease_token is null then raise exception 'material_draft_lease_required'; end if;
 j:=public.ap_lock_material_draft_job(p_job_id,p_lease_token);
 if p_context_sha256 is distinct from public.ap_material_draft_context_sha256(j.id) then raise exception 'material_draft_context_changed'; end if;
 if not exists(select 1 from public.ap_sensitive_payloads where id=p_payload_id and customer_id=j.customer_id and retention_state='ACTIVE' and content_sha256=p_packet_sha256)
  then raise exception 'material_draft_payload_unavailable'; end if;
 if j.active_version_id is not null then
  select * into v from public.ap_material_draft_versions where id=j.active_version_id;
  if v.packet_encrypted_payload_id=p_payload_id and v.packet_sha256=p_packet_sha256 and v.context_sha256=p_context_sha256 then return v.id; end if;
  raise exception 'material_draft_packet_conflict';
 end if;
 if j.state<>'PREPARING' then raise exception 'material_draft_stage_invalid'; end if;
 insert into public.ap_material_draft_versions(customer_id,material_line_id,job_id,version,packet_encrypted_payload_id,packet_sha256,context_sha256)
 values(j.customer_id,j.material_line_id,j.id,1,p_payload_id,p_packet_sha256,p_context_sha256) returning * into v;
 update public.ap_material_draft_jobs set active_version_id=v.id,state='READY',updated_at=clock_timestamp() where id=j.id;
 return v.id;
end $$;

-- The server invokes this only after fresh administrator MFA. Its service-only
-- RPC also verifies the actual owner identity and exact optimistic concurrency
-- values. Refresh is an explicit new version, never a provider retry authority.
create function public.ap_refresh_material_draft_packet(p_job_id uuid,p_expected_version_id uuid,p_payload_id uuid,p_packet_sha256 text,p_context_sha256 text,p_reviewer_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare j public.ap_material_draft_jobs; v public.ap_material_draft_versions; replacement uuid;
begin
 perform public.ap_require_material_reviewer(p_reviewer_id);
 j:=public.ap_lock_material_draft_job(p_job_id);
 select * into v from public.ap_material_draft_versions where id=j.active_version_id for update;
 if v.id is null or v.invalidated_at is not null then raise exception 'material_draft_version_stale'; end if;
 if v.supersedes_id=p_expected_version_id and v.packet_encrypted_payload_id=p_payload_id and v.packet_sha256=p_packet_sha256 and v.context_sha256=p_context_sha256 then return v.id; end if;
 if v.id is distinct from p_expected_version_id or v.release_id is not null then raise exception 'material_draft_version_stale'; end if;
 if exists(select 1 from public.ap_material_draft_attempts where job_id=j.id and state in('DISPATCHED','RESULT_UNKNOWN')) then raise exception 'material_draft_result_unresolved'; end if;
 if p_context_sha256 is distinct from public.ap_material_draft_context_sha256(j.id) then raise exception 'material_draft_context_changed'; end if;
 if not exists(select 1 from public.ap_sensitive_payloads where id=p_payload_id and customer_id=j.customer_id and retention_state='ACTIVE' and content_sha256=p_packet_sha256)
  then raise exception 'material_draft_payload_unavailable'; end if;
 if v.packet_encrypted_payload_id=p_payload_id and v.packet_sha256=p_packet_sha256 and v.context_sha256=p_context_sha256 then return v.id; end if;
 update public.ap_material_draft_versions set invalidated_at=clock_timestamp() where id=v.id;
 update public.ap_artifact_quality_reviews set invalidated_at=coalesce(invalidated_at,clock_timestamp())
  where file_version_id in(select file_version_id from public.ap_material_draft_members where draft_version_id=v.id);
 insert into public.ap_material_draft_versions(customer_id,material_line_id,job_id,version,supersedes_id,packet_encrypted_payload_id,packet_sha256,context_sha256)
 values(j.customer_id,j.material_line_id,j.id,v.version+1,v.id,p_payload_id,p_packet_sha256,p_context_sha256) returning id into replacement;
 update public.ap_material_draft_jobs set active_version_id=replacement,state='READY',error_code=null,
  lease_owner=null,lease_token=null,lease_expires_at=null,lease_generation=lease_generation+1,updated_at=clock_timestamp() where id=j.id;
 update public.ap_material_lines set fulfillment='GENERATING' where id=j.material_line_id;
 insert into public.ap_audit_events(actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
 values(p_reviewer_id,'MATERIAL_DRAFT_EVIDENCE_REFRESHED','MATERIAL_DRAFT_JOB',j.id,
  jsonb_build_object('priorVersionId',v.id,'versionId',replacement,'packetSha256',p_packet_sha256,'contextSha256',p_context_sha256),'material-draft-pair-v1');
 return replacement;
end $$;

create function public.ap_record_material_draft_claim_review(p_version_id uuid,p_packet_sha256 text,p_source_sha256 text,p_review_payload_id uuid,p_review_sha256 text,p_claims jsonb,p_reviewer_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare j public.ap_material_draft_jobs; v public.ap_material_draft_versions; claim jsonb; ref jsonb; fact public.ap_candidate_facts; field_value jsonb;
begin
 perform public.ap_require_material_reviewer(p_reviewer_id);
 select * into v from public.ap_material_draft_versions where id=p_version_id;
 j:=public.ap_lock_material_draft_job(v.job_id);
 select * into v from public.ap_material_draft_versions where id=p_version_id for update;
 if v.id is distinct from j.active_version_id or v.invalidated_at is not null or v.source_sha256 is distinct from p_source_sha256 or v.packet_sha256 is distinct from p_packet_sha256
  or v.encrypted_payload_id is null or v.member_set_sha256 is not null or v.context_sha256 is distinct from public.ap_material_draft_context_sha256(j.id)
  then raise exception 'material_draft_version_stale'; end if;
 if not exists(select 1 from public.ap_sensitive_payloads where id=p_review_payload_id and customer_id=j.customer_id and retention_state='ACTIVE' and content_sha256=p_review_sha256)
  then raise exception 'material_draft_payload_unavailable'; end if;
 if jsonb_typeof(p_claims) is distinct from 'array' or jsonb_array_length(p_claims) not between 1 and 250 or octet_length(p_claims::text)>200000
  or (select count(distinct c->>'claimId') from jsonb_array_elements(p_claims) c)<>jsonb_array_length(p_claims)
  then raise exception 'material_draft_claim_review_invalid'; end if;
 for claim in select value from jsonb_array_elements(p_claims) loop
  if jsonb_typeof(claim) is distinct from 'object' or
   (select array_agg(key order by key) from jsonb_object_keys(claim) key) is distinct from array['claimId','decision','factRefs','jobEvidenceIds','kind','qualification','referencePermissionIds','wordingSha256']::text[]
   or coalesce(claim->>'claimId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or coalesce(claim->>'wordingSha256','') !~ '^[0-9a-f]{64}$' or claim->>'decision' is distinct from 'APPROVED'
   or coalesce(claim->>'qualification','') not in('EXACT','QUALIFIED_TRANSFER','NONFACTUAL')
   or coalesce(claim->>'kind','') not in('CANDIDATE_FACT','JOB_EVIDENCE','MIXED','NARRATIVE','REFERENCE_PERMISSION')
   or jsonb_typeof(claim->'factRefs') is distinct from 'array' or jsonb_array_length(claim->'factRefs')>40
   or jsonb_typeof(claim->'jobEvidenceIds') is distinct from 'array' or jsonb_array_length(claim->'jobEvidenceIds')>40
   or jsonb_typeof(claim->'referencePermissionIds') is distinct from 'array' or jsonb_array_length(claim->'referencePermissionIds')>3
   then raise exception 'material_draft_claim_review_invalid'; end if;
  if claim->>'kind' in('CANDIDATE_FACT','MIXED') and jsonb_array_length(claim->'factRefs')=0 then raise exception 'material_draft_claim_source_required'; end if;
  if claim->>'kind'='NARRATIVE' and (jsonb_array_length(claim->'factRefs')<>0 or jsonb_array_length(claim->'jobEvidenceIds')<>0
   or jsonb_array_length(claim->'referencePermissionIds')<>0 or claim->>'qualification'<>'NONFACTUAL') then raise exception 'material_draft_narrative_not_factual'; end if;
  if claim->>'kind' in('JOB_EVIDENCE','MIXED') and jsonb_array_length(claim->'jobEvidenceIds')=0
   or claim->>'kind'='REFERENCE_PERMISSION' and jsonb_array_length(claim->'referencePermissionIds')=0
   or exists(select 1 from jsonb_array_elements_text(claim->'jobEvidenceIds') value where not exists(
    select 1 from public.ap_requirement_nodes n join public.ap_material_line_revisions r on r.job_snapshot_id=n.job_snapshot_id where n.id::text=value and r.id=j.line_revision_id))
   or exists(select 1 from jsonb_array_elements_text(claim->'referencePermissionIds') value where not exists(
    select 1 from public.ap_reference_permissions permission join public.ap_material_line_revisions r on r.job_snapshot_id=permission.job_snapshot_id
    where permission.id::text=value and r.id=j.line_revision_id and permission.customer_id=j.customer_id and permission.revoked_at is null and permission.contact_version_changed_at is null))
   then raise exception 'material_draft_claim_source_invalid'; end if;
  for ref in select value from jsonb_array_elements(claim->'factRefs') loop
   if jsonb_typeof(ref) is distinct from 'object' or
    (select array_agg(key order by key) from jsonb_object_keys(ref) key) is distinct from array['attributionFactId','factId','field','valueSha256']::text[]
    or coalesce(ref->>'field','') !~ '^[A-Za-z][A-Za-z0-9_]{0,59}(\.[0-9]{1,3})?$' or coalesce(ref->>'valueSha256','') !~ '^[0-9a-f]{64}$'
    or coalesce(ref->>'factId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or coalesce(ref->>'attributionFactId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then raise exception 'material_draft_claim_source_invalid'; end if;
   select f.* into fact from public.ap_candidate_facts f where f.id=(ref->>'factId')::uuid and f.superseded_at is null
    and (f.customer_id is null or f.customer_id=j.customer_id) and f.verification in('CUSTOMER_CONFIRMED','HUMAN_VERIFIED')
    and (f.snapshot_id=j.source_snapshot_id or f.semantic_key='document_contact.confirmed' and exists(
     select 1 from public.ap_material_lines line join public.ap_material_purchases purchase on purchase.id=line.purchase_id
      join public.ap_material_checkout_intents intent on intent.id=purchase.checkout_intent_id
     where line.id=j.material_line_id and f.id=intent.contact_payload_id and f.snapshot_id=intent.source_snapshot_id and intent.customer_id=j.customer_id)) for share of f;
   field_value:=fact.typed_value#>string_to_array(ref->>'field','.');
   if fact.id is null or field_value is null or jsonb_typeof(field_value) not in('string','number','boolean')
    or encode(extensions.digest(field_value::text,'sha256'),'hex') is distinct from ref->>'valueSha256'
    or (ref->>'attributionFactId')::uuid not in(fact.id,coalesce((fact.typed_value->>'employmentFactId')::uuid,fact.id))
    or fact.capability_status='NOT_DONE'
    or fact.capability_status is not null and fact.capability_status<>'CAN_DO_NOW' and claim->>'qualification'<>'QUALIFIED_TRANSFER'
    or exists(select 1 from jsonb_each(fact.typed_value) f where f.key in('held','hasExperience','canDo','supported','completed','earned','obtained','graduated','certified','licensed') and f.value='false'::jsonb)
    or exists(select 1 from jsonb_each_text(fact.typed_value) f where f.key in('status','capabilityStatus','completionStatus','credentialState')
      and (upper(replace(replace(f.value,' ','_'),'-','_')) in('NOT_DONE','NOT_HELD','FAIL','INCOMPLETE')
       or upper(replace(replace(f.value,' ','_'),'-','_')) in('UNSURE','UNKNOWN','BASIC_EXPOSURE','IN_PROGRESS','PENDING','PLANNED','DONE_BEFORE_NEEDS_REFRESHER') and claim->>'qualification'<>'QUALIFIED_TRANSFER'))
    then raise exception 'material_draft_claim_source_invalid'; end if;
   if fact.typed_value ? 'protectedPayloadId' and (ref->>'field'<>'contentSha256' or not exists(
    select 1 from public.ap_material_lines line join public.ap_material_purchases purchase on purchase.id=line.purchase_id
     join public.ap_material_checkout_intents intent on intent.id=purchase.checkout_intent_id
     join public.ap_sensitive_payloads payload on payload.id=intent.contact_payload_id
    where line.id=j.material_line_id and fact.id=payload.id and fact.snapshot_id=intent.source_snapshot_id and fact.semantic_key='document_contact.confirmed'
     and fact.typed_value->>'protectedPayloadId'=payload.id::text
     and payload.customer_id=j.customer_id and payload.retention_state='ACTIVE' and fact.typed_value->>'contentSha256'=payload.content_sha256))
    then raise exception 'material_draft_contact_source_invalid'; end if;
  end loop;
 end loop;
 if v.claim_review_sha256 is not null then
  if v.claim_review_encrypted_payload_id=p_review_payload_id and v.claim_review_sha256=p_review_sha256 and v.claim_review_metadata=p_claims and v.claims_reviewed_by=p_reviewer_id then return v.claim_review_sha256; end if;
  raise exception 'material_draft_claim_review_immutable';
 end if;
 update public.ap_material_draft_versions set claim_review_encrypted_payload_id=p_review_payload_id,claim_review_sha256=p_review_sha256,
  claim_review_metadata=p_claims,claims_reviewed_by=p_reviewer_id,claims_reviewed_at=clock_timestamp() where id=v.id;
 return p_review_sha256;
end $$;

-- An unchanged listing can be rechecked later without rewriting its earlier
-- evidence. The request/check UUID makes retries idempotent; the old digest
-- uniqueness constraint incorrectly prevented all such fresh observations.
do $$ declare constraint_name text; begin
 select c.conname into constraint_name from pg_constraint c where c.conrelid='public.ap_material_listing_checks'::regclass and c.contype='u'
  and (select array_agg(a.attname::text order by k.position) from unnest(c.conkey) with ordinality k(attnum,position)
   join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum)=array['material_line_id','line_revision_id','phase','evidence_sha256'];
 if constraint_name is null then raise exception 'material_draft_listing_uniqueness_anchor_missing'; end if;
 execute format('alter table public.ap_material_listing_checks drop constraint %I',constraint_name);
end $$;
create index ap_material_listing_evidence_history on public.ap_material_listing_checks(material_line_id,line_revision_id,phase,evidence_sha256,checked_at desc);
create trigger ap_material_listing_history_immutable before update or delete on public.ap_material_listing_checks for each row execute function public.ap_prevent_immutable_mutation();
create function public.ap_record_material_draft_listing_check(p_job_id uuid,p_expected_version_id uuid,p_check_id uuid,p_phase text,p_evidence_sha256 text,p_result text,p_reviewer_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare j public.ap_material_draft_jobs; r public.ap_material_line_revisions; rule public.ap_employer_submission_rules; prior public.ap_material_listing_checks; checked timestamptz:=clock_timestamp();
begin
 perform public.ap_require_material_reviewer(p_reviewer_id);
 j:=public.ap_lock_material_draft_job(p_job_id);
 if j.active_version_id is distinct from p_expected_version_id or p_expected_version_id is null
  or p_check_id is null or p_phase is null or p_phase not in('BEFORE_GENERATION','BEFORE_RELEASE')
  or p_result is null or p_result not in('ACTIVE','CLOSED','INSTRUCTION_BLOCKED')
  or p_evidence_sha256 is null or p_evidence_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'material_draft_listing_check_invalid'; end if;
 select * into r from public.ap_material_line_revisions where id=j.line_revision_id;
 select * into rule from public.ap_employer_submission_rules where id=r.employer_rule_snapshot_id for share;
 if rule.id is null or not rule.is_current or rule.superseded_at is not null or rule.job_snapshot_id is distinct from r.job_snapshot_id
  or rule.content_sha256 is distinct from p_evidence_sha256 then raise exception 'material_draft_listing_rule_changed'; end if;
 select * into prior from public.ap_material_listing_checks where id=p_check_id;
 if prior.id is not null then
  if row(prior.material_line_id,prior.line_revision_id,prior.phase,prior.job_snapshot_id,prior.submission_rule_id,prior.result,prior.checked_by,prior.evidence_sha256)
   is not distinct from row(j.material_line_id,r.id,p_phase,r.job_snapshot_id,rule.id,p_result,p_reviewer_id,p_evidence_sha256) then return prior.id; end if;
  raise exception 'material_draft_listing_check_conflict';
 end if;
 insert into public.ap_material_listing_checks(id,material_line_id,line_revision_id,phase,job_snapshot_id,submission_rule_id,result,checked_by,checked_at,evidence_sha256)
 values(p_check_id,j.material_line_id,r.id,p_phase,r.job_snapshot_id,rule.id,p_result,p_reviewer_id,checked,p_evidence_sha256);
 if p_result<>'ACTIVE' then
  update public.ap_material_lines set substitution='REQUIRED',fulfillment='HUMAN_REVIEW' where id=j.material_line_id;
  update public.ap_generated_file_versions f set superseded_at=coalesce(f.superseded_at,checked),downloads_revoked_at=coalesce(f.downloads_revoked_at,checked)
   from public.ap_generated_artifacts a where f.artifact_id=a.id and a.material_line_id=j.material_line_id and a.source_line_revision_id=r.id;
  update public.ap_artifact_quality_reviews q set invalidated_at=coalesce(q.invalidated_at,checked)
   from public.ap_generated_file_versions f join public.ap_generated_artifacts a on a.id=f.artifact_id
   where q.file_version_id=f.id and a.material_line_id=j.material_line_id and a.source_line_revision_id=r.id;
 end if;
 return p_check_id;
end $$;

create function public.ap_material_draft_has_permit(p_line_id uuid,p_operation text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ap_material_draft_permits p join public.ap_material_draft_jobs j on j.material_line_id=p.material_line_id and j.active_version_id=p.draft_version_id
  where p.transaction_id=pg_current_xact_id() and p.backend_pid=pg_backend_pid() and p.material_line_id=p_line_id and p.operation=p_operation);
$$;
create function public.ap_assert_material_draft_permit(p_line_id uuid,p_operation text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.ap_material_draft_jobs where material_line_id=p_line_id)
  and not public.ap_material_draft_has_permit(p_line_id,p_operation) then raise exception 'material_draft_pair_workflow_required'; end if;
end $$;

create function public.ap_material_draft_member_identity(p_version_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('artifactType',artifact_type,'artifactId',artifact_id,'fileVersionId',file_version_id,
  'fileSha256',file_sha256,'previewSha256',preview_sha256,'sourceSha256',source_sha256,
  'editableSourceSha256',editable_source_sha256,'editableSourcePathSha256',editable_source_path_sha256) order by artifact_type),'[]')
 from public.ap_material_draft_members where draft_version_id=p_version_id;
$$;

create function public.ap_commit_material_draft_pair(p_job_id uuid,p_lease_token uuid,p_version_id uuid,p_packet_sha256 text,p_source_sha256 text,p_registrations jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j public.ap_material_draft_jobs; v public.ap_material_draft_versions; r public.ap_material_line_revisions; l public.ap_material_lines;
 entry jsonb; claim jsonb; args record; receipt jsonb; expected integer; identity jsonb;
begin
 if p_lease_token is null then raise exception 'material_draft_lease_required'; end if;
 j:=public.ap_lock_material_draft_job(p_job_id,p_lease_token);
 select * into v from public.ap_material_draft_versions where id=p_version_id and id=j.active_version_id for update;
 select * into r from public.ap_material_line_revisions where id=j.line_revision_id;
 select * into l from public.ap_material_lines where id=j.material_line_id;
 if v.id is null or v.invalidated_at is not null or v.packet_sha256 is distinct from p_packet_sha256 or v.source_sha256 is distinct from p_source_sha256
  or v.encrypted_payload_id is null or v.claim_review_sha256 is null or v.context_sha256 is distinct from public.ap_material_draft_context_sha256(j.id)
  then raise exception 'material_draft_version_stale'; end if;
 expected:=case when l.selected_reference_sheet then 3 else 2 end;
 if jsonb_typeof(p_registrations) is distinct from 'array' or jsonb_array_length(p_registrations)<>expected or octet_length(p_registrations::text)>2000000
  or (select count(distinct value->>'p_artifact_type') from jsonb_array_elements(p_registrations))<>expected
  or not p_registrations @> '[{"p_artifact_type":"RESUME"},{"p_artifact_type":"COVER_LETTER"}]'::jsonb
  or expected=3 and not p_registrations @> '[{"p_artifact_type":"REFERENCE_SHEET"}]'::jsonb
  then raise exception 'material_draft_pair_incomplete'; end if;
 if v.member_set_sha256 is not null then
  identity:=public.ap_material_draft_member_identity(v.id);
  if exists(select 1 from jsonb_array_elements(p_registrations) value where not exists(select 1 from public.ap_material_draft_members m
   where m.draft_version_id=v.id and m.file_version_id=(value->>'p_file_version_id')::uuid and m.file_sha256=value->>'p_checksum_sha256'
    and m.preview_sha256=value->>'p_render_preview_sha256' and m.source_sha256=v.source_sha256
    and m.editable_source_sha256=value#>>'{p_claim_provenance,editableSource,checksumSha256}'
    and m.editable_source_path_sha256=encode(extensions.digest(jsonb_build_array(value#>>'{p_claim_provenance,editableSource,storageBucket}',value#>>'{p_claim_provenance,editableSource,storagePath}')::text,'sha256'),'hex')
    and m.artifact_id=(value->>'p_artifact_id')::uuid and m.artifact_type::text=value->>'p_artifact_type')) then raise exception 'material_draft_pair_identity_conflict'; end if;
  return jsonb_build_object('draftVersionId',v.id,'memberSetSha256',v.member_set_sha256,'members',identity,'replayed',true);
 end if;
 if j.state not in('SOURCE_READY','RENDERING') then raise exception 'material_draft_stage_invalid'; end if;
 insert into public.ap_material_draft_permits values(pg_current_xact_id(),pg_backend_pid(),l.id,v.id,'REGISTER');
 for entry in select value from jsonb_array_elements(p_registrations) order by value->>'p_artifact_type' loop
  if entry->>'p_material_line_id' is distinct from l.id::text or entry->>'p_source_line_revision_id' is distinct from r.id::text
   or entry->>'p_source_snapshot_id' is distinct from r.source_snapshot_id::text or entry->>'p_job_snapshot_id' is distinct from r.job_snapshot_id::text
   or entry->>'p_binding_sha256' is distinct from r.binding_sha256 or entry->>'p_reference_regeneration_id' is not null or entry->>'p_reviewer_id' is not null
   or entry#>>'{p_claim_provenance,draftPair,versionId}' is distinct from v.id::text
   or entry#>>'{p_claim_provenance,draftPair,packetSha256}' is distinct from v.packet_sha256
   or entry#>>'{p_claim_provenance,draftPair,sourceSha256}' is distinct from v.source_sha256
   or entry#>>'{p_claim_provenance,draftPair,claimReviewSha256}' is distinct from v.claim_review_sha256
   or jsonb_typeof(entry#>'{p_claim_provenance,claims}') is distinct from 'array'
   or jsonb_array_length(entry#>'{p_claim_provenance,claims}') not between 1 and 250
   then raise exception 'material_draft_pair_binding_invalid'; end if;
  for claim in select value from jsonb_array_elements(entry#>'{p_claim_provenance,claims}') loop
   if not exists(select 1 from jsonb_array_elements(v.claim_review_metadata) reviewed
    where reviewed->>'wordingSha256'=claim->>'visibleTextSha256' and reviewed->>'kind'=claim->>'kind'
     and (select coalesce(jsonb_agg(id order by id),'[]') from (select distinct ref->>'factId' id from jsonb_array_elements(reviewed->'factRefs') ref) ids)
       = (select coalesce(jsonb_agg(id order by id),'[]') from (select distinct value id from jsonb_array_elements_text(claim->'candidateFactIds')) ids)
     and (reviewed->'jobEvidenceIds') @> (claim->'jobEvidenceIds') and (claim->'jobEvidenceIds') @> (reviewed->'jobEvidenceIds')
     and (reviewed->'referencePermissionIds') @> (claim->'referencePermissionIds') and (claim->'referencePermissionIds') @> (reviewed->'referencePermissionIds'))
    then raise exception 'material_draft_wording_not_reviewed'; end if;
  end loop;
  select * into args from jsonb_to_record(entry) as x(
   p_artifact_id uuid,p_file_version_id uuid,p_material_line_id uuid,p_reviewer_id uuid,p_artifact_type public.ap_artifact_type,
   p_source_snapshot_id uuid,p_source_line_revision_id uuid,p_job_snapshot_id uuid,p_reference_regeneration_id uuid,p_reference_permission_ids uuid[],
   p_claim_provenance jsonb,p_generator_version text,p_storage_bucket text,p_storage_path text,p_safe_filename text,p_checksum_sha256 text,p_mime_type text,p_size_bytes integer,
   p_binding_sha256 text,p_package_qa_sha256 text,p_structural_checks jsonb,p_provenance_checks jsonb,p_extracted_text_sha256 text,p_rendered_page_count integer,
   p_renderer_identity text,p_arial_font_sha256 text,p_malware_scanner_identity text,p_render_preview_bucket text,p_render_preview_path text,p_render_preview_sha256 text,
   p_rendered_page_sha256 text[],p_arial_resolved boolean);
  receipt:=public.ap_register_material_artifact_version(args.p_artifact_id,args.p_file_version_id,args.p_material_line_id,null,args.p_artifact_type,
   args.p_source_snapshot_id,args.p_source_line_revision_id,args.p_job_snapshot_id,null,args.p_reference_permission_ids,args.p_claim_provenance,args.p_generator_version,
   args.p_storage_bucket,args.p_storage_path,args.p_safe_filename,args.p_checksum_sha256,args.p_mime_type,args.p_size_bytes,args.p_binding_sha256,args.p_package_qa_sha256,
   args.p_structural_checks,args.p_provenance_checks,args.p_extracted_text_sha256,args.p_rendered_page_count,args.p_renderer_identity,args.p_arial_font_sha256,
   args.p_malware_scanner_identity,args.p_render_preview_bucket,args.p_render_preview_path,args.p_render_preview_sha256,args.p_rendered_page_sha256,args.p_arial_resolved);
  if receipt->>'automatedPassed' is distinct from 'true' then raise exception 'material_draft_automated_quality_failed'; end if;
  insert into public.ap_material_draft_members(customer_id,material_line_id,draft_version_id,artifact_type,artifact_id,file_version_id,file_sha256,preview_sha256,source_sha256,editable_source_sha256,editable_source_path_sha256)
  values(j.customer_id,l.id,v.id,args.p_artifact_type,args.p_artifact_id,args.p_file_version_id,args.p_checksum_sha256,args.p_render_preview_sha256,v.source_sha256,
   entry#>>'{p_claim_provenance,editableSource,checksumSha256}',encode(extensions.digest(jsonb_build_array(entry#>>'{p_claim_provenance,editableSource,storageBucket}',entry#>>'{p_claim_provenance,editableSource,storagePath}')::text,'sha256'),'hex'));
 end loop;
 identity:=public.ap_material_draft_member_identity(v.id);
 update public.ap_material_draft_versions set member_set_sha256=encode(extensions.digest(identity::text,'sha256'),'hex') where id=v.id returning * into v;
 update public.ap_material_draft_jobs set state='REVIEW_READY',error_code=null,updated_at=clock_timestamp() where id=j.id;
 delete from public.ap_material_draft_permits where transaction_id=pg_current_xact_id() and backend_pid=pg_backend_pid() and material_line_id=l.id and operation='REGISTER';
 return jsonb_build_object('draftVersionId',v.id,'memberSetSha256',v.member_set_sha256,'members',identity,'replayed',false);
end $$;

create function public.ap_assert_material_draft_members_current(p_version_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v public.ap_material_draft_versions; j public.ap_material_draft_jobs; m public.ap_material_draft_members; a public.ap_generated_artifacts;
 f public.ap_generated_file_versions; q public.ap_artifact_quality_reviews; expected integer;
begin
 select * into v from public.ap_material_draft_versions where id=p_version_id for update;
 select * into j from public.ap_material_draft_jobs where id=v.job_id;
 select case when selected_reference_sheet then 3 else 2 end into expected from public.ap_material_lines where id=j.material_line_id;
 if v.member_set_sha256 is null or v.invalidated_at is not null or v.id is distinct from j.active_version_id
  or v.member_set_sha256 is distinct from encode(extensions.digest(public.ap_material_draft_member_identity(v.id)::text,'sha256'),'hex')
  or (select count(*) from public.ap_material_draft_members where draft_version_id=v.id)<>expected
  then raise exception 'material_draft_pair_incomplete'; end if;
 for m in select * from public.ap_material_draft_members where draft_version_id=v.id order by artifact_id loop
  select * into a from public.ap_generated_artifacts where id=m.artifact_id for update;
  select * into f from public.ap_generated_file_versions where id=m.file_version_id for update;
  select * into q from public.ap_artifact_quality_reviews where file_version_id=f.id for update;
  if a.customer_id is distinct from j.customer_id or a.material_line_id is distinct from j.material_line_id or a.source_line_revision_id is distinct from j.line_revision_id
   or a.current_file_version is distinct from f.version or f.artifact_id is distinct from a.id or a.artifact_type is distinct from m.artifact_type
   or f.checksum_sha256 is distinct from m.file_sha256 or q.render_preview_sha256 is distinct from m.preview_sha256
   or f.superseded_at is not null or f.downloads_revoked_at is not null or q.invalidated_at is not null or q.automated_passed_at is null
   or a.claim_provenance#>>'{draftPair,versionId}' is distinct from v.id::text
   or a.claim_provenance#>>'{draftPair,packetSha256}' is distinct from v.packet_sha256
   or a.claim_provenance#>>'{draftPair,sourceSha256}' is distinct from v.source_sha256
   or a.claim_provenance#>>'{editableSource,checksumSha256}' is distinct from m.editable_source_sha256
   or encode(extensions.digest(jsonb_build_array(a.claim_provenance#>>'{editableSource,storageBucket}',a.claim_provenance#>>'{editableSource,storagePath}')::text,'sha256'),'hex') is distinct from m.editable_source_path_sha256
   then raise exception 'material_draft_pair_changed'; end if;
  perform public.ap_assert_current_artifact_facts(a.id);
 end loop;
end $$;

create function public.ap_approve_material_draft_pair(p_version_id uuid,p_packet_sha256 text,p_source_sha256 text,p_member_set_sha256 text,p_checklist jsonb,p_attestation text,p_reviewer_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare j public.ap_material_draft_jobs; v public.ap_material_draft_versions; m record; approval text;
begin
 perform public.ap_require_material_reviewer(p_reviewer_id);
 select * into v from public.ap_material_draft_versions where id=p_version_id;
 j:=public.ap_lock_material_draft_job(v.job_id);
 select * into v from public.ap_material_draft_versions where id=p_version_id for update;
 if v.id is distinct from j.active_version_id or v.invalidated_at is not null or v.packet_sha256 is distinct from p_packet_sha256 or v.source_sha256 is distinct from p_source_sha256
  or v.member_set_sha256 is null or v.member_set_sha256 is distinct from p_member_set_sha256 or v.context_sha256 is distinct from public.ap_material_draft_context_sha256(j.id)
  then raise exception 'material_draft_version_stale'; end if;
 if jsonb_typeof(p_checklist) is distinct from 'object' or
  (select array_agg(key order by key) from jsonb_object_keys(p_checklist) key) is distinct from
  array['contentReviewed','instructionsReparsed','linksRechecked','listingRechecked','provenanceReviewed','secureFilesConfirmed','visualReviewed']::text[]
  or exists(select 1 from jsonb_each(p_checklist) e where e.value is distinct from 'true'::jsonb)
  or p_attestation is null or length(btrim(p_attestation)) not between 20 and 4000 then raise exception 'material_draft_actual_review_required'; end if;
 perform public.ap_assert_material_draft_members_current(v.id);
 approval:=encode(extensions.digest(jsonb_build_object('versionId',v.id,'packetSha256',v.packet_sha256,'sourceSha256',v.source_sha256,
  'memberSetSha256',v.member_set_sha256,'claimReviewSha256',v.claim_review_sha256,'checklist',p_checklist,'reviewerId',p_reviewer_id)::text,'sha256'),'hex');
 if v.approval_sha256 is not null then
  if v.approval_sha256=approval then return approval; end if;
  raise exception 'material_draft_approval_identity_conflict';
 end if;
 insert into public.ap_material_draft_permits values(pg_current_xact_id(),pg_backend_pid(),j.material_line_id,v.id,'APPROVE');
 for m in select file_version_id from public.ap_material_draft_members where draft_version_id=v.id order by artifact_id loop
  perform public.ap_record_material_human_approval(m.file_version_id,p_reviewer_id,'CONTENT',p_attestation);
  perform public.ap_record_material_human_approval(m.file_version_id,p_reviewer_id,'VISUAL',p_attestation);
 end loop;
 update public.ap_material_draft_versions set review_checklist=p_checklist,approved_by=p_reviewer_id,approved_at=clock_timestamp(),approval_sha256=approval where id=v.id;
 update public.ap_material_draft_jobs set state='APPROVED',lease_token=null,lease_expires_at=null,updated_at=clock_timestamp() where id=j.id;
 delete from public.ap_material_draft_permits where transaction_id=pg_current_xact_id() and backend_pid=pg_backend_pid() and material_line_id=j.material_line_id and operation='APPROVE';
 return approval;
end $$;

create function public.ap_material_draft_release_binding(p_line_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce((select jsonb_build_object('draftPairVersionId',v.id,'packetSha256',v.packet_sha256,'sourceSha256',v.source_sha256,
  'memberSetSha256',v.member_set_sha256,'approvalSha256',v.approval_sha256,'exactFileVersions',public.ap_material_draft_member_identity(v.id))
  from public.ap_material_draft_permits permit join public.ap_material_draft_versions v on v.id=permit.draft_version_id
  where permit.transaction_id=pg_current_xact_id() and permit.backend_pid=pg_backend_pid() and permit.material_line_id=p_line_id and permit.operation='SEND'),'{}'::jsonb);
$$;

create function public.ap_send_material_draft_pair(p_version_id uuid,p_packet_sha256 text,p_source_sha256 text,p_member_set_sha256 text,p_approval_sha256 text,p_reviewer_id uuid,p_release_id uuid,p_outbox_id uuid,p_rationale text) returns uuid
language plpgsql security definer set search_path='' as $$
declare j public.ap_material_draft_jobs; v public.ap_material_draft_versions; result uuid;
begin
 perform public.ap_require_material_reviewer(p_reviewer_id);
 if p_release_id is null or p_outbox_id is null or p_rationale is null or length(btrim(p_rationale)) not between 20 and 4000 then raise exception 'material_draft_send_identity_required'; end if;
 select * into v from public.ap_material_draft_versions where id=p_version_id;
 -- Serialize the replay read with a concurrent first send before checking the
 -- active obligation; a committed send is a receipt, not a second fulfillment.
 perform pg_advisory_xact_lock(hashtextextended('service-retention:'||v.customer_id::text,0));
 select * into v from public.ap_material_draft_versions where id=p_version_id;
 if v.id is null or v.packet_sha256 is distinct from p_packet_sha256 or v.source_sha256 is distinct from p_source_sha256
  or v.member_set_sha256 is distinct from p_member_set_sha256 or v.approval_sha256 is null or v.approval_sha256 is distinct from p_approval_sha256
  then raise exception 'material_draft_expected_approval_required'; end if;
 -- Exact successful-response replay remains possible after the deadline or a
 -- later refund. It cannot issue a different release or a second email.
 if v.release_id is not null then
  if v.release_id=p_release_id then return v.release_id; end if;
  raise exception 'material_draft_release_identity_conflict';
 end if;
 j:=public.ap_lock_material_draft_job(v.job_id);
 select * into v from public.ap_material_draft_versions where id=p_version_id for update;
 if j.state<>'APPROVED' or j.active_version_id is distinct from v.id or v.invalidated_at is not null or v.approval_sha256 is distinct from p_approval_sha256
  or v.context_sha256 is distinct from public.ap_material_draft_context_sha256(j.id)
  then raise exception 'material_draft_expected_approval_required'; end if;
 perform public.ap_assert_material_draft_members_current(v.id);
 insert into public.ap_material_draft_permits values(pg_current_xact_id(),pg_backend_pid(),j.material_line_id,v.id,'SEND');
 result:=public.ap_commit_material_release_v2(j.material_line_id,p_reviewer_id,p_release_id,v.review_checklist,p_rationale,p_outbox_id);
 if result is distinct from p_release_id then raise exception 'material_draft_release_identity_conflict'; end if;
 update public.ap_material_draft_versions set release_id=result where id=v.id;
 update public.ap_material_draft_jobs set state='RELEASED',updated_at=clock_timestamp() where id=j.id;
 delete from public.ap_material_draft_permits where transaction_id=pg_current_xact_id() and backend_pid=pg_backend_pid() and material_line_id=j.material_line_id and operation='SEND';
 return result;
end $$;

-- Historical paid work keeps its original release policy, but the new owner
-- action must bind the review screen to exactly the rows it will send.
create function public.ap_commit_material_release_expected(p_material_line_id uuid,p_reviewer_id uuid,p_release_id uuid,p_expected_binding jsonb,p_review_checklist jsonb,p_reviewer_rationale text,p_outbox_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare line public.ap_material_lines; purchase public.ap_material_purchases; revision public.ap_material_line_revisions;
 rule public.ap_employer_submission_rules; final_check public.ap_material_listing_checks; expected jsonb; actual jsonb; entry jsonb; expected_files jsonb:='[]'; existing uuid; result uuid;
begin
 perform public.ap_require_material_reviewer(p_reviewer_id);
 if p_release_id is null or p_outbox_id is null or jsonb_typeof(p_expected_binding) is distinct from 'object' or octet_length(p_expected_binding::text)>12000
  or (select array_agg(key order by key) from jsonb_object_keys(p_expected_binding) key) is distinct from array['files','releaseCheckAt','releaseCheckId','revisionId','ruleSha256']::text[]
  or jsonb_typeof(p_expected_binding->'files') is distinct from 'array' or jsonb_array_length(p_expected_binding->'files') not between 2 and 3
  or (select count(distinct value->>'fileVersionId') from jsonb_array_elements(p_expected_binding->'files'))<>jsonb_array_length(p_expected_binding->'files')
  then raise exception 'material_release_expected_binding_invalid'; end if;
 for entry in select value from jsonb_array_elements(p_expected_binding->'files') loop
  if jsonb_typeof(entry) is distinct from 'object' or
   (select array_agg(key order by key) from jsonb_object_keys(entry) key) is distinct from array['checksumSha256','contentApprovedAt','contentApprovedBy','fileVersionId','version','visualApprovedAt','visualApprovedBy']::text[]
   or exists(select 1 from jsonb_each(entry) e where e.value='null'::jsonb)
   or coalesce(entry->>'checksumSha256','') !~ '^[0-9a-f]{64}$' or coalesce(entry->>'version','') !~ '^[1-9][0-9]{0,8}$'
   then raise exception 'material_release_expected_binding_invalid'; end if;
  expected_files:=expected_files||jsonb_build_array(jsonb_build_object('fileVersionId',(entry->>'fileVersionId')::uuid,'version',(entry->>'version')::integer,
   'checksumSha256',entry->>'checksumSha256','contentApprovedAt',(entry->>'contentApprovedAt')::timestamptz,'contentApprovedBy',(entry->>'contentApprovedBy')::uuid,
   'visualApprovedAt',(entry->>'visualApprovedAt')::timestamptz,'visualApprovedBy',(entry->>'visualApprovedBy')::uuid));
 end loop;
 if coalesce(p_expected_binding->>'ruleSha256','') !~ '^[0-9a-f]{64}$' or exists(select 1 from jsonb_each(p_expected_binding) e where e.value='null'::jsonb)
  then raise exception 'material_release_expected_binding_invalid'; end if;
 expected:=jsonb_build_object('revisionId',(p_expected_binding->>'revisionId')::uuid,'ruleSha256',p_expected_binding->>'ruleSha256',
  'releaseCheckId',(p_expected_binding->>'releaseCheckId')::uuid,'releaseCheckAt',(p_expected_binding->>'releaseCheckAt')::timestamptz,
  'files',(select jsonb_agg(value order by value->>'fileVersionId') from jsonb_array_elements(expected_files)));
 select * into line from public.ap_material_lines where id=p_material_line_id;
 select * into purchase from public.ap_material_purchases where id=line.purchase_id;
 if line.id is null or purchase.id is null then raise exception 'material_release_expected_binding_changed'; end if;
 perform 1 from public.ap_retention_restore_lock where singleton for share;
 if exists(select 1 from public.ap_retention_restore_lock where singleton and locked) then raise exception 'material_draft_restore_locked'; end if;
 perform pg_advisory_xact_lock(hashtextextended('service-retention:'||purchase.customer_id::text,0));
 perform 1 from public.ap_payment_attempts where id=line.payment_attempt_id for update;
 select * into line from public.ap_material_lines where id=p_material_line_id for update;
 if exists(select 1 from public.ap_material_draft_jobs where material_line_id=line.id) then raise exception 'material_draft_pair_workflow_required'; end if;
 select release.id into existing from public.ap_releases release where release.material_line_id=line.id and release.release_kind in('MATERIAL_PAIR','MATERIAL_TRIPLE');
 if existing is not null then
  if exists(select 1 from public.ap_audit_events where entity_id=existing and action='MATERIAL_EXPECTED_REVIEW_RELEASED' and actor_id=p_reviewer_id and non_sensitive_details->'expectedBinding'=expected) then return existing; end if;
  raise exception 'material_release_expected_binding_changed';
 end if;
 -- Fences include inserts: a new current artifact or a newer final check cannot
 -- slip in after comparing the owner's displayed set and before legacy commit.
 lock table public.ap_material_line_revisions,public.ap_employer_submission_rules,public.ap_material_listing_checks,
  public.ap_generated_artifacts,public.ap_generated_file_versions,public.ap_artifact_quality_reviews,
  public.ap_candidate_facts,public.ap_human_review_records,public.ap_reference_permissions in share mode;
 select * into revision from public.ap_material_line_revisions where line_id=line.id and version=line.active_revision and superseded_at is null for update;
 select * into rule from public.ap_employer_submission_rules where id=revision.employer_rule_snapshot_id and is_current for share;
 select * into final_check from public.ap_material_listing_checks where material_line_id=line.id and line_revision_id=revision.id and phase='BEFORE_RELEASE' order by checked_at desc,id desc limit 1 for share;
 perform 1 from public.ap_generated_artifacts where material_line_id=line.id and source_line_revision_id=revision.id order by id for update;
 perform 1 from public.ap_generated_file_versions f join public.ap_generated_artifacts a on a.id=f.artifact_id where a.material_line_id=line.id and a.source_line_revision_id=revision.id order by f.id for update of f;
 perform 1 from public.ap_artifact_quality_reviews q join public.ap_generated_file_versions f on f.id=q.file_version_id join public.ap_generated_artifacts a on a.id=f.artifact_id
  where a.material_line_id=line.id and a.source_line_revision_id=revision.id order by q.file_version_id for update of q;
 select jsonb_build_object('revisionId',revision.id,'ruleSha256',rule.content_sha256,'releaseCheckId',final_check.id,'releaseCheckAt',final_check.checked_at,
  'files',coalesce(jsonb_agg(jsonb_build_object('fileVersionId',f.id,'version',f.version,'checksumSha256',f.checksum_sha256,
   'contentApprovedAt',q.content_approved_at,'contentApprovedBy',q.content_approved_by,'visualApprovedAt',q.visual_approved_at,'visualApprovedBy',q.visual_approved_by) order by f.id),'[]')) into actual
 from public.ap_generated_artifacts a join public.ap_generated_file_versions f on f.artifact_id=a.id and f.version=a.current_file_version
 join public.ap_artifact_quality_reviews q on q.file_version_id=f.id
 where a.material_line_id=line.id and a.source_line_revision_id=revision.id and a.reference_regeneration_id is null
  and a.source_snapshot_id=revision.source_snapshot_id and a.job_snapshot_id=revision.job_snapshot_id
  and f.superseded_at is null and f.downloads_revoked_at is null and q.invalidated_at is null;
 if actual is distinct from expected then raise exception 'material_release_expected_binding_changed'; end if;
 result:=public.ap_commit_material_release_v2(line.id,p_reviewer_id,p_release_id,p_review_checklist,p_reviewer_rationale,p_outbox_id);
 insert into public.ap_audit_events(customer_id,actor_id,action,entity_type,entity_id,non_sensitive_details,audit_version)
 values(purchase.customer_id,p_reviewer_id,'MATERIAL_EXPECTED_REVIEW_RELEASED','RELEASE',result,jsonb_build_object('expectedBinding',expected),'material-expected-review-v1');
 return result;
end $$;

create function public.ap_revise_material_draft_source(p_version_id uuid,p_expected_source_sha256 text,p_source_payload_id uuid,p_source_sha256 text,p_reviewer_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare j public.ap_material_draft_jobs; v public.ap_material_draft_versions; replacement uuid;
begin
 perform public.ap_require_material_reviewer(p_reviewer_id);
 select * into v from public.ap_material_draft_versions where id=p_version_id;
 j:=public.ap_lock_material_draft_job(v.job_id);
 select * into v from public.ap_material_draft_versions where id=p_version_id for update;
 if j.active_version_id is distinct from v.id or v.invalidated_at is not null or v.encrypted_payload_id is null or v.source_sha256 is distinct from p_expected_source_sha256
  or v.context_sha256 is distinct from public.ap_material_draft_context_sha256(j.id)
  then raise exception 'material_draft_version_stale'; end if;
 if not exists(select 1 from public.ap_sensitive_payloads where id=p_source_payload_id and customer_id=j.customer_id and retention_state='ACTIVE' and content_sha256=p_source_sha256)
  then raise exception 'material_draft_payload_unavailable'; end if;
 if p_source_sha256=v.source_sha256 then return v.id; end if;
 update public.ap_material_draft_versions set invalidated_at=clock_timestamp() where id=v.id;
 update public.ap_artifact_quality_reviews set invalidated_at=coalesce(invalidated_at,clock_timestamp())
 where file_version_id in(select file_version_id from public.ap_material_draft_members where draft_version_id=v.id);
 insert into public.ap_material_draft_versions(customer_id,material_line_id,job_id,version,supersedes_id,packet_encrypted_payload_id,packet_sha256,context_sha256,encrypted_payload_id,source_sha256)
 values(j.customer_id,j.material_line_id,j.id,v.version+1,v.id,v.packet_encrypted_payload_id,v.packet_sha256,v.context_sha256,p_source_payload_id,p_source_sha256) returning id into replacement;
 update public.ap_material_draft_jobs set active_version_id=replacement,state='SOURCE_READY',lease_token=null,lease_expires_at=null,updated_at=clock_timestamp() where id=j.id;
 update public.ap_material_lines set fulfillment='GENERATING' where id=j.material_line_id;
 return replacement;
end $$;

-- Preserve every historical function body and its checks. Managed revisions
-- require the private transaction permit; historical rows have no draft job.
-- Checkout contact is confirmed separately from later factual corrections.
-- This exception is limited to that exact protected receipt; ordinary facts
-- must still belong to the artifact's current immutable source snapshot.
create function public.ap_material_draft_checkout_contact_matches(p_line_id uuid,p_customer_id uuid,p_source_snapshot_id uuid,p_fact_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ap_material_lines line
  join public.ap_material_purchases purchase on purchase.id=line.purchase_id
  join public.ap_material_checkout_intents intent on intent.id=purchase.checkout_intent_id
  join public.ap_candidate_facts fact on fact.id=intent.contact_payload_id and fact.snapshot_id=intent.source_snapshot_id
  join public.ap_sensitive_payloads payload on payload.id=fact.id
  where line.id=p_line_id and purchase.customer_id=p_customer_id and intent.customer_id=p_customer_id
   and intent.purchase_id=purchase.id and intent.payment_attempt_id=line.payment_attempt_id
   and intent.document_contact_confirmed and intent.document_facts_confirmed and intent.state='COMPLETED'
   and fact.id=p_fact_id and fact.customer_id=p_customer_id and payload.customer_id=p_customer_id
   and fact.semantic_key='document_contact.confirmed' and fact.value_kind='PROTECTED_COMPOSITE'
   and fact.verification='CUSTOMER_CONFIRMED' and fact.superseded_at is null and payload.retention_state='ACTIVE'
   and fact.typed_value=jsonb_build_object('protectedPayloadId',payload.id,'contentSha256',payload.content_sha256)
   and public.ap_customer_owns_snapshot(p_customer_id,intent.source_snapshot_id)
   and exists(select 1 from public.ap_material_draft_jobs job where job.material_line_id=line.id
    and job.customer_id=p_customer_id and job.source_snapshot_id=p_source_snapshot_id))
$$;
revoke all on function public.ap_material_draft_checkout_contact_matches(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
do $$ declare definition text; signature regprocedure; anchor text; begin
 signature:='public.ap_register_material_artifact_version(uuid,uuid,uuid,uuid,public.ap_artifact_type,uuid,uuid,uuid,uuid,uuid[],jsonb,text,text,text,text,text,text,integer,text,text,jsonb,jsonb,text,integer,text,text,text,text,text,text,text[],boolean)'::regprocedure;
 definition:=pg_get_functiondef(signature);
 anchor:='  perform public.ap_require_material_reviewer(p_reviewer_id);';
 if position(anchor in definition)=0 then raise exception 'draft_pair_registration_anchor_missing'; end if;
 definition:=replace(definition,anchor,
  '  if p_reference_regeneration_id is null then perform public.ap_assert_material_draft_permit(p_material_line_id,''REGISTER''); end if;'||chr(10)||
  '  if p_reference_regeneration_id is null and public.ap_material_draft_has_permit(p_material_line_id,''REGISTER'') then'||chr(10)||
  '    if p_reviewer_id is not null then raise exception ''material_draft_system_actor_required''; end if;'||chr(10)||
  '  else perform public.ap_require_material_reviewer(p_reviewer_id); end if;');
 anchor:='fact.snapshot_id=p_source_snapshot_id and fact.superseded_at is null';
 if position(anchor in definition)=0 then raise exception 'draft_pair_contact_registration_anchor_missing'; end if;
 definition:=replace(definition,anchor,'(fact.snapshot_id=p_source_snapshot_id or public.ap_material_draft_checkout_contact_matches(p_material_line_id,purchase.customer_id,p_source_snapshot_id,fact.id)) and fact.superseded_at is null');
 execute definition;
 definition:=pg_get_functiondef('public.ap_assert_supported_artifact_facts(uuid)'::regprocedure);
 anchor:='or fact.snapshot_id is distinct from artifact.source_snapshot_id';
 if position(anchor in definition)=0 then raise exception 'draft_pair_contact_supported_anchor_missing'; end if;
 definition:=replace(definition,anchor,'or (fact.snapshot_id is distinct from artifact.source_snapshot_id and not public.ap_material_draft_checkout_contact_matches(artifact.material_line_id,artifact.customer_id,artifact.source_snapshot_id,fact.id))');
 execute definition;
 -- 088 binds the actual file trigger to a retention-aware clone. Preserve its
 -- exact redaction permit branch while applying the same contact-only rule.
 for signature in select p.oid::regprocedure from pg_proc p where p.oid='public.ap_guard_material_file_fact_bindings()'::regprocedure
  or p.oid=(select t.tgfoid from pg_trigger t where t.tgrelid='public.ap_generated_file_versions'::regclass and t.tgname='ap_material_file_fact_binding_guard' and not t.tgisinternal) loop
  definition:=pg_get_functiondef(signature);
  if position(anchor in definition)=0 then raise exception 'draft_pair_contact_file_guard_anchor_missing'; end if;
  definition:=replace(definition,anchor,'or (fact.snapshot_id is distinct from artifact.source_snapshot_id and not public.ap_material_draft_checkout_contact_matches(artifact.material_line_id,artifact.customer_id,artifact.source_snapshot_id,fact.id))');
  execute definition;
 end loop;
 anchor:='  perform public.ap_require_material_reviewer(p_reviewer_id);';
 definition:=pg_get_functiondef('public.ap_record_material_human_approval(uuid,uuid,text,text)'::regprocedure);
 if position(anchor in definition)=0 then raise exception 'draft_pair_approval_anchor_missing'; end if;
 definition:=replace(definition,anchor,anchor||chr(10)||
  '  perform public.ap_assert_material_draft_permit((select a.material_line_id from public.ap_generated_file_versions f join public.ap_generated_artifacts a on a.id=f.artifact_id where f.id=p_file_version_id and a.reference_regeneration_id is null),''APPROVE'');');
 execute definition;
 definition:=pg_get_functiondef('public.ap_commit_material_release_v2(uuid,uuid,uuid,jsonb,text,uuid)'::regprocedure);
 if position(anchor in definition)=0 or position('''reviewChecklist'',p_review_checklist' in definition)=0 then raise exception 'draft_pair_release_anchor_missing'; end if;
 definition:=replace(definition,anchor,anchor||chr(10)||'  perform public.ap_assert_material_draft_permit(p_material_line_id,''SEND'');');
 definition:=replace(definition,'''reviewChecklist'',p_review_checklist','''reviewChecklist'',p_review_checklist,''draftPair'',public.ap_material_draft_release_binding(p_material_line_id)');
 -- The historical routine has a release_kind local variable and an unqualified
 -- column of the same name. Preserve its predicate while resolving ambiguity.
 anchor:='select id into existing_release from public.ap_releases where material_line_id=line_row.id';
 if position(anchor in definition)=0 then raise exception 'draft_pair_release_alias_anchor_missing'; end if;
 definition:=replace(definition,anchor,'select existing.id into existing_release from public.ap_releases existing where existing.material_line_id=line_row.id');
 definition:=replace(definition,'and release_kind in (''MATERIAL_PAIR'',''MATERIAL_TRIPLE'')','and existing.release_kind in (''MATERIAL_PAIR'',''MATERIAL_TRIPLE'')');
 execute definition;
 definition:=pg_get_functiondef('public.ap_commit_release(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz,jsonb,uuid,jsonb)'::regprocedure);
 definition:=regexp_replace(definition,'\mbegin\M',E'begin\n if p_release_kind in (''MATERIAL_PAIR'',''MATERIAL_TRIPLE'') then perform public.ap_assert_material_draft_permit(p_material_line_id,''SEND''); end if;','i');
 execute definition;
end $$;

-- Content-free identifiers/hashes remain as retained shells. The actual packet,
-- source and review prose use existing crypto-shred/restore rules. Explicit
-- ownership keys ensure shared payloads fail closed instead of disappearing.
insert into public.ap_retention_private_tables(table_name,primary_key,redaction_patch) values
 ('ap_material_draft_jobs','id','{}'),('ap_material_draft_versions','id','{}'),
 ('ap_material_draft_attempts','id','{}'),('ap_material_draft_members','id','{}');
do $$ declare definition text; t text; begin
 definition:=pg_get_functiondef('public.ap_retention_row_customers(text,jsonb)'::regprocedure);
 if position('''encrypted_payload_id'',''sensitive_payload_id'',''answer_sensitive_payload_id'',''quarantined_payload_id''' in definition)=0 then raise exception 'draft_pair_retention_owner_anchor_missing'; end if;
 definition:=replace(definition,'''encrypted_payload_id'',''sensitive_payload_id'',''answer_sensitive_payload_id'',''quarantined_payload_id''',
  '''encrypted_payload_id'',''sensitive_payload_id'',''answer_sensitive_payload_id'',''quarantined_payload_id'',''packet_encrypted_payload_id'',''claim_review_encrypted_payload_id''');
 execute definition;
 foreach t in array array['ap_material_draft_jobs','ap_material_draft_versions','ap_material_draft_attempts','ap_material_draft_members'] loop
  execute format('create trigger ap_service_retention_write before insert or update on public.%I for each row execute function public.ap_guard_service_retention_write()',t);
 end loop;
end $$;

create trigger ap_material_draft_policy_immutable before update or delete on public.ap_material_draft_policies for each row execute function public.ap_prevent_immutable_mutation();
create trigger ap_material_draft_member_immutable before update or delete on public.ap_material_draft_members for each row execute function public.ap_prevent_immutable_mutation();
create trigger ap_material_draft_reconciliation_immutable before update or delete on public.ap_material_draft_reconciliations for each row execute function public.ap_prevent_immutable_mutation();
create trigger ap_material_draft_observation_immutable before update or delete on public.ap_material_draft_observations for each row execute function public.ap_prevent_immutable_mutation();

create function public.ap_guard_material_draft_identity() returns trigger
language plpgsql security definer set search_path='' as $$
declare allowed text[]; key text;
begin
 if tg_op='DELETE' then raise exception 'material_draft_history_immutable'; end if;
 if tg_table_name='ap_material_draft_versions' then
  allowed:=array['encrypted_payload_id','source_sha256','claim_review_encrypted_payload_id','claim_review_sha256','claim_review_metadata',
   'claims_reviewed_by','claims_reviewed_at','member_set_sha256','approval_sha256','review_checklist','approved_by','approved_at','invalidated_at','release_id'];
  if to_jsonb(old)-allowed is distinct from to_jsonb(new)-allowed then raise exception 'material_draft_version_identity_immutable'; end if;
  foreach key in array allowed loop
   if to_jsonb(old)->key is distinct from 'null'::jsonb and to_jsonb(old)->key is distinct from to_jsonb(new)->key then
    raise exception 'material_draft_version_write_once';
   end if;
  end loop;
 elsif tg_table_name='ap_material_draft_attempts' then
  if to_jsonb(old)-array['state','completed_at'] is distinct from to_jsonb(new)-array['state','completed_at']
   or old.completed_at is not null and old.completed_at is distinct from new.completed_at
   or old.state is distinct from new.state and not ((old.state='DISPATCHED' and new.state in('RESULT_RECORDED','RESULT_UNKNOWN'))
    or (old.state='RESULT_UNKNOWN' and new.state='NO_RESULT_CONFIRMED')) then raise exception 'material_draft_attempt_identity_immutable'; end if;
 elsif tg_table_name='ap_material_draft_jobs' then
  if row(old.id,old.customer_id,old.material_line_id,old.line_revision_id,old.source_snapshot_id,old.created_at)
   is distinct from row(new.id,new.customer_id,new.material_line_id,new.line_revision_id,new.source_snapshot_id,new.created_at)
   or new.lease_generation<old.lease_generation or new.claim_count<old.claim_count then raise exception 'material_draft_job_identity_immutable'; end if;
 end if;
 return new;
end $$;
create trigger ap_material_draft_version_identity before update or delete on public.ap_material_draft_versions for each row execute function public.ap_guard_material_draft_identity();
create trigger ap_material_draft_attempt_identity before update or delete on public.ap_material_draft_attempts for each row execute function public.ap_guard_material_draft_identity();
create trigger ap_material_draft_job_identity before update or delete on public.ap_material_draft_jobs for each row execute function public.ap_guard_material_draft_identity();

-- Restrict the entire new API, including internal helpers, after creation.
do $$ declare f record; public_names text[]:=array[
 'ap_register_material_draft_policy','ap_set_material_draft_runtime','ap_material_draft_context_sha256','ap_claim_material_draft_jobs',
 'ap_renew_material_draft_lease','ap_attach_material_draft_packet','ap_refresh_material_draft_packet','ap_begin_material_draft_request','ap_record_material_draft_result',
 'ap_fail_material_draft_job','ap_reconcile_material_draft_attempt','ap_observe_material_draft_response','ap_assert_material_draft_dispatch_current','ap_record_material_draft_claim_review','ap_record_material_draft_listing_check','ap_commit_material_draft_pair',
 'ap_approve_material_draft_pair','ap_send_material_draft_pair','ap_revise_material_draft_source'];
begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and (p.proname like 'ap_%material_draft_%' or p.proname='ap_enqueue_material_draft_trigger') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  execute format('alter function %s set lock_timeout = %L',f.signature,'5s');
  if f.proname=any(public_names) then execute format('grant execute on function %s to service_role',f.signature); end if;
 end loop;
end $$;

revoke all on function public.ap_commit_material_release_expected(uuid,uuid,uuid,jsonb,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.ap_commit_material_release_expected(uuid,uuid,uuid,jsonb,jsonb,text,uuid) to service_role;
alter function public.ap_commit_material_release_expected(uuid,uuid,uuid,jsonb,jsonb,text,uuid) set lock_timeout='5s';

select public.ap_material_draft_enqueue(id) from public.ap_material_lines where fulfillment in('PAID','GENERATING','HUMAN_REVIEW','READY_TO_RELEASE');
insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202610250091','MATERIAL_DRAFT_PAIR_WORKFLOW',(select count(*) from public.ap_material_draft_jobs),clock_timestamp());
create function public.ap_material_draft_pair_schema_installed() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ap_migration_checkpoints where migration_id='202610250091' and checkpoint='MATERIAL_DRAFT_PAIR_WORKFLOW')
  and to_regprocedure('public.ap_commit_material_draft_pair(uuid,uuid,uuid,text,text,jsonb)') is not null
  and to_regprocedure('public.ap_send_material_draft_pair(uuid,text,text,text,text,uuid,uuid,uuid,text)') is not null
  and to_regprocedure('public.ap_commit_material_release_expected(uuid,uuid,uuid,jsonb,jsonb,text,uuid)') is not null
  and to_regprocedure('public.ap_material_draft_checkout_contact_matches(uuid,uuid,uuid,uuid)') is not null
  and to_regprocedure('public.ap_refresh_material_draft_packet(uuid,uuid,uuid,text,text,uuid)') is not null
  and to_regprocedure('public.ap_record_material_draft_listing_check(uuid,uuid,uuid,text,text,text,uuid)') is not null
  and to_regprocedure('public.ap_observe_material_draft_response(uuid,uuid,uuid,uuid,text,text,text,bigint,bigint,bigint)') is not null
  and not exists(select 1 from unnest(array['ap_material_draft_jobs','ap_material_draft_versions','ap_material_draft_policies','ap_material_draft_runtime',
   'ap_material_draft_attempts','ap_material_draft_members','ap_material_draft_permits','ap_material_draft_reconciliations','ap_material_draft_observations']) name
   where not exists(select 1 from pg_class c where c.oid=to_regclass('public.'||name) and c.relrowsecurity))
  and (select count(*)=4 from public.ap_retention_private_tables where table_name in('ap_material_draft_jobs','ap_material_draft_versions','ap_material_draft_attempts','ap_material_draft_members'))
  and not exists(select 1 from (values
   ('ap_material_lines','ap_material_draft_paid_enqueue'),('ap_material_line_revisions','ap_material_draft_revision_enqueue'),
   ('ap_material_draft_jobs','ap_service_retention_write'),('ap_material_draft_versions','ap_service_retention_write'),
   ('ap_material_draft_attempts','ap_service_retention_write'),('ap_material_draft_members','ap_service_retention_write'),
   ('ap_material_listing_checks','ap_material_listing_history_immutable'),('ap_material_draft_versions','ap_material_draft_version_identity'),
   ('ap_material_draft_attempts','ap_material_draft_attempt_identity'),('ap_material_draft_jobs','ap_material_draft_job_identity'),
   ('ap_material_draft_members','ap_material_draft_member_immutable'),('ap_material_draft_policies','ap_material_draft_policy_immutable'),
   ('ap_material_draft_reconciliations','ap_material_draft_reconciliation_immutable'),('ap_material_draft_observations','ap_material_draft_observation_immutable')) required(table_name,trigger_name)
   where not exists(select 1 from pg_trigger t where t.tgrelid=to_regclass('public.'||required.table_name) and t.tgname=required.trigger_name and not t.tgisinternal and t.tgenabled='O'));
$$;
revoke all on function public.ap_material_draft_pair_schema_installed() from public,anon,authenticated;
grant execute on function public.ap_material_draft_pair_schema_installed() to service_role;
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.ap_manual_launch_schema_readiness()'::regprocedure);
 if position('select count(*)=14 as installed' in definition)=0 or position('''requiredSchemaVersion'', ''202610250090''' in definition)=0
  or position('(''202610250090'',''MATCHING_EVIDENCE_COMPLETION'')' in definition)=0 or position('''202610250089'',''202610250090''' in definition)=0 then raise exception 'draft_pair_readiness_anchor_missing'; end if;
 definition:=replace(definition,'select count(*)=14 as installed','select count(*)=15 as installed');
 definition:=replace(definition,'(''202610250090'',''MATCHING_EVIDENCE_COMPLETION'')','(''202610250090'',''MATCHING_EVIDENCE_COMPLETION''),(''202610250091'',''MATERIAL_DRAFT_PAIR_WORKFLOW'')');
 definition:=replace(definition,'''requiredSchemaVersion'', ''202610250090''','''requiredSchemaVersion'', ''202610250091''');
 definition:=replace(definition,'''202610250089'',''202610250090''','''202610250089'',''202610250090'',''202610250091''');
 definition:=replace(definition,'public.ap_sandbox_activation_schema_installed()','public.ap_sandbox_activation_schema_installed() and public.ap_material_draft_pair_schema_installed()');
 execute definition;
end $$;
commit;

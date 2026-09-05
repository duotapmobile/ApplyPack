-- Corrected-contract Chunk 3: deterministic research, evaluation, and feasibility.
-- Expand-only. Legacy paid orders/evaluations remain readable and are explicitly marked.

do $$ begin
  create type public.ap_source_authorization_state as enum ('AUTHORIZED_AUTOMATED','AUTHORIZED_MANUAL_ONLY','UNVERIFIED_DISABLED','BLOCKED');
exception when duplicate_object then null; end $$;

create table public.ap_source_authorizations (
  id uuid primary key default gen_random_uuid(),
  source_id text not null,
  source_display_name text not null,
  state public.ap_source_authorization_state not null,
  access_method text not null check (access_method in ('AUTOMATED','MANUAL','NONE')),
  evidence_reference text,
  evidence_sha256 text check (evidence_sha256 is null or evidence_sha256 ~ '^[0-9a-f]{64}$'),
  allowed_hosts text[] not null default '{}',
  allowed_actions text[] not null default '{}',
  rate_and_result_bounds jsonb not null default '{}'::jsonb check (jsonb_typeof(rate_and_result_bounds) = 'object'),
  verified_by_role text,
  verified_at timestamptz,
  authorization_version text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique(source_id,authorization_version),
  check ((state in ('AUTHORIZED_AUTOMATED','AUTHORIZED_MANUAL_ONLY')) = (evidence_reference is not null and verified_by_role is not null and verified_at is not null)),
  check ((state='AUTHORIZED_AUTOMATED') = (access_method='AUTOMATED') or state<>'AUTHORIZED_AUTOMATED'),
  check (state<>'BLOCKED' or access_method='NONE')
);

insert into public.ap_source_authorizations(source_id,source_display_name,state,access_method,evidence_reference,evidence_sha256,verified_by_role,verified_at,authorization_version,content_sha256)
values
  ('manual-reviewed','Manual reviewed source','AUTHORIZED_MANUAL_ONLY','MANUAL','docs/APPLYPACK_PRODUCT_CONTRACT.md','df4e32e2ea0c37abd3f39904c36576c0af3935f9754bb1b81979782dc002d69f','controlling-contract',now(),'source-auth-v1','8f42f78fb5d0fb2503abb7d75c7e31f951ec14a21f2c99d242187f35668ba782'),
  ('liveops','Liveops','BLOCKED','NONE',null,null,null,null,'source-auth-v1','3f7ff5dd7d04e58c07acbd6f1895be6a2f41822a7cc7d0b7f47c7769609a1419'),
  ('indeed','Indeed','UNVERIFIED_DISABLED','NONE',null,null,null,null,'source-auth-v1','829f7ead643c99e3abfe670ba07a204c19328fae47afff91d7eecc8ccd3ace32'),
  ('hiringcafe','HiringCafe','UNVERIFIED_DISABLED','NONE',null,null,null,null,'source-auth-v1','96a5f37a371960221135a12a2fb70d78de0b9607e7fbaf3904aa748a8a12ea71'),
  ('employer-sites','Employer career sites','UNVERIFIED_DISABLED','NONE',null,null,null,null,'source-auth-v1','3aa5c2e7c6aa9e61c512cdd2a07d868692264bc430b8599849251d14806c23ff'),
  ('greenhouse','Greenhouse','UNVERIFIED_DISABLED','NONE',null,null,null,null,'source-auth-v1','a46825a873d9bb05a41454f6c3714be0f92a7c92f0ff0d7bfcbf809b2c251322'),
  ('lever','Lever','UNVERIFIED_DISABLED','NONE',null,null,null,null,'source-auth-v1','0543ac878b259a5b6c4e79ad324483e771984ae8194f6496ec448e41322778bb'),
  ('workday','Workday','UNVERIFIED_DISABLED','NONE',null,null,null,null,'source-auth-v1','45bb1dd9f4332fe65656bda0d6f2dfa60a88804f40dd53c82ce278e765cd96f8'),
  ('ashby','Ashby','UNVERIFIED_DISABLED','NONE',null,null,null,null,'source-auth-v1','e5cc589db815ff8f733a84bb91bd959ad24b824dc8cf1bfdf0becd47c2f694b4')
on conflict(source_id,authorization_version) do nothing;

update public.job_sources set automation_status='pending_verification',updated_at=now()
where automation_status='automated';

create table public.ap_feasibility_source_configurations (
  id uuid primary key default gen_random_uuid(),
  source_authorization_id uuid not null references public.ap_source_authorizations(id),
  config_version text not null,
  pagination_bound integer not null check (pagination_bound > 0),
  lookback_bound interval not null check (lookback_bound > interval '0 seconds'),
  result_bound integer not null check (result_bound > 0),
  release_verification_ttl interval not null check (release_verification_ttl > interval '0 seconds'),
  parser_version text not null,
  cutoff_version text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  approved_by_role text not null,
  approved_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique(source_authorization_id,config_version)
);

alter table public.ap_job_snapshots
  add column if not exists source_authorization_id uuid references public.ap_source_authorizations(id),
  add column if not exists first_seen_at timestamptz,
  add column if not exists canonical_employer_domain text,
  add column if not exists employer_identity_result text,
  add column if not exists application_path_result text,
  add column if not exists listing_activity_result text,
  add column if not exists material_restrictions jsonb not null default '{}'::jsonb,
  add column if not exists fraud_signals text[] not null default '{}',
  add column if not exists legitimacy_result text,
  add column if not exists requirement_completeness integer not null default 0,
  add column if not exists compensation_completeness integer not null default 0,
  add column if not exists canonicalization_version text,
  add column if not exists legacy_compatibility boolean;
update public.ap_job_snapshots set legacy_compatibility=true where legacy_compatibility is null;
alter table public.ap_job_snapshots alter column legacy_compatibility set default false,alter column legacy_compatibility set not null;
alter table public.ap_job_snapshots add constraint ap_job_snapshots_chunk3_new_record_check check (legacy_compatibility or (source_authorization_id is not null and first_seen_at is not null and employer_identity_result is not null and application_path_result is not null and listing_activity_result is not null and legitimacy_result is not null and canonicalization_version is not null));

alter table public.ap_requirement_nodes
  add column if not exists source_excerpt text,
  add column if not exists classification_method text,
  add column if not exists human_correction_history jsonb not null default '[]'::jsonb,
  add column if not exists importance smallint,
  add column if not exists duration_basis text,
  add column if not exists equivalent_review_id uuid references public.ap_human_review_records(id);
alter table public.ap_requirement_nodes add constraint ap_requirement_nodes_chunk3_fields_check check ((importance is null or importance between 1 and 3) and (duration_basis is null or duration_basis in ('CALENDAR','FTE','EMPLOYER_EXPLICIT_OTHER')) and jsonb_typeof(human_correction_history)='array');

alter table public.ap_human_review_records
  alter column customer_id drop not null,
  add column if not exists draft_id uuid references public.ap_anonymous_drafts(id),
  add column if not exists job_snapshot_id uuid references public.ap_job_snapshots(id);
update public.ap_human_review_records review set draft_id=snapshot.draft_id from public.ap_intake_snapshots snapshot where review.snapshot_id=snapshot.id and review.customer_id is null and review.draft_id is null;
alter table public.ap_human_review_records add constraint ap_human_review_records_subject_check check (customer_id is not null or draft_id is not null);

create or replace function public.ap_guard_chunk3_human_review()
returns trigger language plpgsql set search_path='' as $$
declare snapshot public.ap_intake_snapshots;
begin
  select * into snapshot from public.ap_intake_snapshots where id=new.snapshot_id;
  if not found or snapshot.customer_id is distinct from new.customer_id or snapshot.draft_id is distinct from new.draft_id then raise exception 'review_snapshot_subject_mismatch'; end if;
  if new.catalog_version='matching-rules-v1' and (
    new.job_snapshot_id is null
    or new.review_kind not in ('PARSER_CORRECTION','FEASIBILITY_EVIDENCE','ADJACENT_EQUIVALENCE','TOOL_EQUIVALENCE','CATEGORICAL_USEFULNESS')
    or new.decision->>'disposition' not in ('RESOLVED_PASS','RESOLVED_FAIL','REQUIRES_MORE_EVIDENCE')
    or jsonb_typeof(new.decision->'evidenceChanges') is distinct from 'array'
    or jsonb_array_length(new.decision->'evidenceChanges')=0
    or jsonb_typeof(new.decision->'sourceEvidenceNodeIds') is distinct from 'array'
    or jsonb_array_length(new.decision->'sourceEvidenceNodeIds')=0
    or nullif(new.decision->>'rulesVersion','') is null
  ) then raise exception 'chunk3_review_evidence_incomplete'; end if;
  return new;
end; $$;
create trigger ap_chunk3_human_review_guard before insert on public.ap_human_review_records for each row execute function public.ap_guard_chunk3_human_review();

alter table public.ap_match_evaluations
  add column if not exists active_root_keys text[],
  add column if not exists root_results jsonb,
  add column if not exists calculation_input_sha256 text,
  add column if not exists calculation_version text,
  add column if not exists usefulness_result text,
  add column if not exists preference_alignment numeric(7,6),
  add column if not exists confidence_label text,
  add column if not exists base_rank integer,
  add column if not exists selected_rank integer,
  add column if not exists rank_explanation jsonb,
  add column if not exists selector_explanation jsonb,
  add column if not exists legacy_compatibility boolean;
update public.ap_match_evaluations set legacy_compatibility=true where legacy_compatibility is null;
alter table public.ap_match_evaluations alter column legacy_compatibility set default false,alter column legacy_compatibility set not null;
alter table public.ap_match_evaluations add constraint ap_match_evaluations_chunk3_new_record_check check (legacy_compatibility or (cardinality(active_root_keys)>0 and jsonb_typeof(root_results)='array' and calculation_input_sha256 ~ '^[0-9a-f]{64}$' and calculation_version is not null and usefulness_result in ('PASS','FAIL','HUMAN_REVIEW') and (preference_alignment is null or preference_alignment between 0 and 1) and confidence_label in ('HIGH','MEDIUM','LOW') and (base_rank is null or base_rank>0) and (selected_rank is null or selected_rank>0) and jsonb_typeof(rank_explanation)='object' and jsonb_typeof(selector_explanation)='object'));

alter table public.ap_feasibility_coverage_cells
  add column if not exists query_family_id text,
  add column if not exists source_authorization_id uuid references public.ap_source_authorizations(id),
  add column if not exists configuration_id uuid references public.ap_feasibility_source_configurations(id),
  add column if not exists configured_bound_satisfied boolean not null default false,
  add column if not exists normalized_and_deduplicated boolean not null default false,
  add column if not exists manual_checklist_complete boolean not null default false,
  add column if not exists result_changing_error_code text;

create table public.ap_inventory_members (
  id uuid primary key default gen_random_uuid(),
  inventory_version_id uuid not null references public.ap_inventory_versions(id),
  job_snapshot_id uuid not null references public.ap_job_snapshots(id),
  stable_normalized_job_id text not null,
  selected_by_deduplication boolean not null,
  exclusion_reason text,
  created_at timestamptz not null default now(),
  unique(inventory_version_id,job_snapshot_id),
  unique(inventory_version_id,stable_normalized_job_id),
  check (selected_by_deduplication or exclusion_reason is not null)
);

create table public.ap_deduplication_displacements (
  id uuid primary key default gen_random_uuid(),
  inventory_version_id uuid not null references public.ap_inventory_versions(id),
  selected_job_snapshot_id uuid not null references public.ap_job_snapshots(id),
  displaced_job_snapshot_id uuid not null references public.ap_job_snapshots(id),
  edge_reason text not null check (edge_reason in ('external_job_id','canonical_url','fingerprint')),
  comparator_version text not null,
  evidence jsonb not null check (jsonb_typeof(evidence)='object'),
  created_at timestamptz not null default now(),
  unique(inventory_version_id,displaced_job_snapshot_id),
  check (selected_job_snapshot_id<>displaced_job_snapshot_id)
);

create or replace function public.ap_guard_chunk3_job_snapshot()
returns trigger language plpgsql set search_path='' as $$
declare authorization_row record;
begin
  if lower(concat_ws(' ',new.discovery_source,new.company,new.source_url,new.canonical_application_url,new.canonical_employer_listing_url)) ~ 'live[[:space:]]*ops|liveops' then raise exception 'blocked_source_liveops'; end if;
  if not new.legacy_compatibility then
    select * into authorization_row from public.ap_source_authorizations where id=new.source_authorization_id;
    if not found or authorization_row.state not in ('AUTHORIZED_AUTOMATED','AUTHORIZED_MANUAL_ONLY') then raise exception 'source_not_authorized'; end if;
  end if;
  return new;
end; $$;
create trigger ap_chunk3_job_snapshot_guard before insert on public.ap_job_snapshots for each row execute function public.ap_guard_chunk3_job_snapshot();

create or replace function public.ap_guard_chunk3_match_evaluation()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.legacy_compatibility then return new; end if;
  if cardinality(new.active_root_keys)<>(select count(distinct value) from unnest(new.active_root_keys) value) then raise exception 'duplicate_active_root_key'; end if;
  if jsonb_array_length(new.root_results)<>cardinality(new.active_root_keys) then raise exception 'root_set_mismatch'; end if;
  if new.fit_score is not null and (new.eligibility not in ('ELIGIBLE','ELIGIBLE_WITH_ALLOWED_UNKNOWNS') or new.usefulness_result<>'PASS') then raise exception 'fit_without_eligibility_and_usefulness'; end if;
  if new.eligibility in ('ELIGIBLE','ELIGIBLE_WITH_ALLOWED_UNKNOWNS') and new.usefulness_result='PASS' and new.fit_score is null then raise exception 'eligible_useful_fit_required'; end if;
  if new.confidence_label<>(case when new.evidence_confidence>=80 then 'HIGH' when new.evidence_confidence>=60 then 'MEDIUM' else 'LOW' end) then raise exception 'confidence_label_mismatch'; end if;
  if new.evidence_confidence<60 and new.human_review_id is null then raise exception 'low_confidence_requires_review'; end if;
  if exists(select 1 from jsonb_array_elements_text(new.presentation_risk_reasons) reason where reason not in ('CONTACT_DETAIL_CONFIRMATION','FORMAT_REPAIR','CLAIM_WORDING_REVIEW','APPLICATION_QUESTION_REVIEW')) then raise exception 'presentation_risk_reason_not_allowed'; end if;
  return new;
end; $$;
create trigger ap_chunk3_match_evaluation_guard before insert on public.ap_match_evaluations for each row execute function public.ap_guard_chunk3_match_evaluation();

create or replace function public.ap_claim_feasibility_request(p_request_id uuid,p_worker_id text)
returns table(request_id uuid,snapshot_id uuid,draft_id uuid)
language plpgsql security definer set search_path='' as $$
declare claimed public.ap_feasibility_requests;
begin
  if nullif(btrim(p_worker_id),'') is null then raise exception 'worker_id_required'; end if;
  select r.* into claimed from public.ap_feasibility_requests r where r.id=p_request_id and r.state='PENDING' for update skip locked;
  if not found then raise exception 'feasibility_request_not_claimable'; end if;
  if not exists(select 1 from public.ap_anonymous_drafts d where d.id=claimed.draft_id and d.finalized_snapshot_id=claimed.snapshot_id) then
    update public.ap_feasibility_requests set state='STALE',stale_reason='SNAPSHOT_NO_LONGER_ACTIVE',updated_at=now() where id=claimed.id;
    raise exception 'feasibility_request_stale';
  end if;
  update public.ap_feasibility_requests set state='CLAIMED',claimed_by=p_worker_id,claimed_at=now(),updated_at=now() where id=claimed.id;
  return query select claimed.id,claimed.snapshot_id,claimed.draft_id;
end; $$;

create or replace function public.ap_complete_feasibility_request(p_request_id uuid,p_worker_id text,p_assessment_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare claimed public.ap_feasibility_requests; assessment public.ap_feasibility_assessments;
begin
  select * into claimed from public.ap_feasibility_requests where id=p_request_id for update;
  if not found or claimed.state<>'CLAIMED' or claimed.claimed_by<>p_worker_id then raise exception 'feasibility_request_claim_mismatch'; end if;
  select * into assessment from public.ap_feasibility_assessments where id=p_assessment_id and snapshot_id=claimed.snapshot_id and state='COMPLETE' and invalidated_at is null;
  if not found then raise exception 'completed_feasibility_assessment_required'; end if;
  update public.ap_feasibility_requests set state='COMPLETED',completed_assessment_id=assessment.id,claimed_by=null,claimed_at=null,updated_at=now() where id=claimed.id;
  insert into public.ap_audit_events(action,entity_type,entity_id,non_sensitive_details,audit_version) values('FEASIBILITY_COMPLETED','FEASIBILITY_REQUEST',claimed.id,jsonb_build_object('assessmentId',assessment.id,'workerId',p_worker_id),'chunk3-v1');
  return true;
end; $$;

create or replace function public.ap_fail_feasibility_request(p_request_id uuid,p_worker_id text,p_error_code text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if nullif(btrim(p_error_code),'') is null then raise exception 'error_code_required'; end if;
  update public.ap_feasibility_requests set state='ERROR',error_code=p_error_code,claimed_by=null,claimed_at=null,updated_at=now() where id=p_request_id and state='CLAIMED' and claimed_by=p_worker_id;
  if not found then raise exception 'feasibility_request_claim_mismatch'; end if;
  insert into public.ap_audit_events(action,entity_type,entity_id,non_sensitive_details,audit_version) values('FEASIBILITY_ERROR','FEASIBILITY_REQUEST',p_request_id,jsonb_build_object('errorCode',p_error_code,'workerId',p_worker_id),'chunk3-v1');
  return true;
end; $$;

create or replace function public.ap_defer_feasibility_request(p_request_id uuid,p_worker_id text,p_reason text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.ap_feasibility_requests set state='PENDING',error_code=p_reason,claimed_by=null,claimed_at=null,updated_at=now() where id=p_request_id and state='CLAIMED' and claimed_by=p_worker_id;
  if not found then raise exception 'feasibility_request_claim_mismatch'; end if;
  return true;
end; $$;

create or replace function public.ap_stale_feasibility_request(p_request_id uuid,p_worker_id text,p_reason text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.ap_feasibility_requests set state='STALE',stale_reason=p_reason,claimed_by=null,claimed_at=null,updated_at=now() where id=p_request_id and state='CLAIMED' and claimed_by=p_worker_id;
  if not found then raise exception 'feasibility_request_claim_mismatch'; end if;
  return true;
end; $$;

create or replace function public.ap_guard_feasibility_completion()
returns trigger language plpgsql set search_path='' as $$
declare plan public.ap_feasibility_coverage_plans;
begin
  select * into plan from public.ap_feasibility_coverage_plans where id=new.coverage_plan_id;
  if not found or plan.snapshot_id<>new.snapshot_id then raise exception 'feasibility_plan_snapshot_mismatch'; end if;
  if new.state='COMPLETE' and plan.coverage_disposition='REQUIRED' and (
    not exists(select 1 from public.ap_feasibility_coverage_cells where plan_id=plan.id)
    or (plan.plan_version='feasibility-v1' and (
      jsonb_typeof(plan.typed_inputs->'requiredFamilyIds') is distinct from 'array'
      or jsonb_array_length(plan.typed_inputs->'requiredFamilyIds')=0
      or exists(select 1 from jsonb_array_elements_text(plan.typed_inputs->'requiredFamilyIds') family where not exists(select 1 from public.ap_feasibility_coverage_cells c where c.plan_id=plan.id and c.query_family_id=family))
    ))
    or exists(select 1 from public.ap_feasibility_coverage_cells c where c.plan_id=plan.id and (c.terminal_outcome not in ('SUCCEEDED_WITH_RESULTS','SUCCEEDED_EMPTY')
      or (plan.plan_version='feasibility-v1' and (c.query_family_id is null or c.source_authorization_id is null or c.configuration_id is null or not c.normalized_and_deduplicated or (c.execution_path='AUTOMATED' and not c.configured_bound_satisfied) or (c.execution_path='MANUAL' and not c.manual_checklist_complete) or c.result_changing_error_code is not null
        or not exists(select 1 from public.ap_source_authorizations a where a.id=c.source_authorization_id and ((c.execution_path='AUTOMATED' and a.state='AUTHORIZED_AUTOMATED') or (c.execution_path='MANUAL' and a.state in ('AUTHORIZED_AUTOMATED','AUTHORIZED_MANUAL_ONLY'))))
        or not exists(select 1 from public.ap_feasibility_source_configurations config where config.id=c.configuration_id and config.source_authorization_id=c.source_authorization_id)))))
  ) then raise exception 'feasibility_coverage_incomplete'; end if;
  if new.state='COMPLETE' and plan.coverage_disposition='NOT_REQUIRED_CONSTRAINT_COLLISION' and (new.outcome<>'INFEASIBLE' or not ('CONSTRAINT_COLLISION'=any(new.reasons)) or plan.constraint_proof->>'kind'<>'TYPED_CONTRADICTION') then raise exception 'constraint_collision_proof_required'; end if;
  return new;
end; $$;

create trigger ap_source_authorizations_immutable before update or delete on public.ap_source_authorizations for each row execute function public.ap_prevent_immutable_mutation();
create trigger ap_feasibility_source_configurations_immutable before update or delete on public.ap_feasibility_source_configurations for each row execute function public.ap_prevent_immutable_mutation();
create trigger ap_inventory_members_immutable before update or delete on public.ap_inventory_members for each row execute function public.ap_prevent_immutable_mutation();
create trigger ap_deduplication_displacements_immutable before update or delete on public.ap_deduplication_displacements for each row execute function public.ap_prevent_immutable_mutation();

alter table public.ap_source_authorizations enable row level security;
alter table public.ap_feasibility_source_configurations enable row level security;
alter table public.ap_inventory_members enable row level security;
alter table public.ap_deduplication_displacements enable row level security;
revoke all on public.ap_source_authorizations,public.ap_feasibility_source_configurations,public.ap_inventory_members,public.ap_deduplication_displacements from public,anon,authenticated;
grant all privileges on public.ap_source_authorizations,public.ap_feasibility_source_configurations,public.ap_inventory_members,public.ap_deduplication_displacements to service_role;

revoke all on function public.ap_claim_feasibility_request(uuid,text),public.ap_complete_feasibility_request(uuid,text,uuid),public.ap_fail_feasibility_request(uuid,text,text),public.ap_defer_feasibility_request(uuid,text,text),public.ap_stale_feasibility_request(uuid,text,text) from public,anon,authenticated;
grant execute on function public.ap_claim_feasibility_request(uuid,text),public.ap_complete_feasibility_request(uuid,text,uuid),public.ap_fail_feasibility_request(uuid,text,text),public.ap_defer_feasibility_request(uuid,text,text),public.ap_stale_feasibility_request(uuid,text,text) to service_role;

insert into public.ap_migration_checkpoints(migration_id,checkpoint,rows_processed,completed_at)
values('202609040025','CHUNK3_MATCHING_ENGINE_EXPAND',0,now()) on conflict(migration_id,checkpoint) do nothing;

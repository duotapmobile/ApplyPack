# ApplyPack deployment runbook

Status: Chunk 2 repository implementation is complete locally. No production migration, deployment, provider call, source activation, Checkout, or feature enablement is authorized. Production remains blocked on the approvals and configuration listed below.

## Owners and stop conditions

| Owner | Responsibility |
| --- | --- |
| Release owner | Exact commit, change window, go/no-go, traffic rollback |
| Database owner | Backup, migrations `202609040022`, `202609040023`, and `202609040024`, backfill checkpoints, validation, database recovery |
| Application owner | Compatibility deploy, server feature flags, cutover |
| Payments owner | Stripe tax/price/webhook/refund/dispute reconciliation |
| Security/privacy owner | KMS, private storage, malware scanner, sandbox parser, reference isolation, retention/privacy approval |
| Operations owner | Capacity/staffing versions, worker leases, outbox, monitoring |

Stop before production writes if the repository/remote/commit is wrong; any migration or validation query fails; a required owner is absent; any existing paid order would be changed or lost; or an approval/configuration value is missing. Never record secrets or customer payloads in evidence.

## 1. Preflight and backup

Run from the authorized release worktree in PowerShell:

```powershell
$repo = 'C:\path\to\authorized\ApplyPack-worktree'
git -C $repo rev-parse --show-toplevel
git -C $repo remote get-url origin
git -C $repo status --short --branch
git -C $repo rev-parse HEAD
supabase --workdir $repo migration list
```

The release owner records the authorized commit, target project reference, backup/PITR evidence, row counts for `orders`, `payments`, `refunds`, `apply_pack_carts`, and `apply_pack_items`, and a non-sensitive schema hash. The database owner confirms the target project separately. A local `supabase db reset` is disposable-only and must never target production.

## 2. Expand

Migration order is fixed:

1. Apply all existing migrations through `202609030021_nonrecursive_job_read_policies.sql`.
2. Apply additive migration `202609040022_corrected_chunk1_foundation.sql`.
3. Apply additive migration `202609040023_chunk2_four_step_intake.sql`.
4. Apply additive remediation migration `202609040024_chunk2_remediation.sql`.
5. Do not drop or rewrite legacy tables, columns, paid orders, provider history, or audit history.
6. Keep `CUSTOMER_SUPPLIED_INGESTION`, corrected file processing, retention cleanup, and Checkout disabled.
7. Regenerate types and compare them to `src/lib/database.types.ts`.

Disposable rehearsal commands:

```powershell
supabase db reset
npm.cmd run test:database
npm.cmd run test:legacy-backfill
npm.cmd run types:database:check
```

Production application is owned by the database owner and uses the already-linked, independently verified Supabase project. The exact approved `supabase db push` invocation and project identity must be recorded in the release ticket before use; this repository runbook does not authorize it.

## 3. Compatibility and checkpointed backfill

The migration writes checkpoint `202609040022 / LEGACY_ORDERS_V1`. Its backfill is idempotent:

- legacy payment rows map to `ap_payment_attempts` by unique `legacy_payment_id`;
- legacy orders map to `ap_search_services` by unique `legacy_order_id`;
- refunded legacy payments remain represented as paid settlement plus refund history in the legacy compatibility boundary;
- no legacy row is updated or deleted;
- new corrected records do not require deprecated intake blobs or catch-all statuses;
- `ap_legacy_order_compatibility` keeps old records readable during compatibility deployment.

Before resuming a failed backfill, inspect the durable checkpoint and rejected invariant without editing historical data. Correct code or configuration, reapply the idempotent migration, and compare counts to the preflight baseline. Never synthesize missing facts, payment IDs, or customer ownership.

Validation queries (run under a read-only operational role where possible):

```sql
select migration_id, checkpoint, rows_processed, completed_at
from public.ap_migration_checkpoints
where migration_id = '202609040022';

select count(*) as legacy_paid_orders
from public.orders where status in ('paid','in_fulfillment','delivered','refunded');

select count(*) as compatible_orders
from public.ap_legacy_order_compatibility
where status in ('paid','in_fulfillment','delivered','refunded');

select count(*) as missing_compatibility_rows
from public.orders o left join public.ap_search_services s on s.legacy_order_id = o.id
where o.status in ('paid','in_fulfillment','delivered','refunded') and s.id is null;

select flag, enabled, approval_reference
from public.ap_feature_flags;

select checkout_enabled, tax_configuration_approved, tax_approval_reference
from public.ap_commerce_configuration;

select cleanup_enabled, approved, unpaid_draft_seconds, unpaid_file_seconds,
       privacy_policy_approval_reference
from public.ap_retention_configuration;
```

Required result: missing compatibility rows `0`; flags off unless separately approved; Checkout false until approved Stripe tax-inclusive configuration exists; cleanup false until approved durations and Privacy Policy version exist.

## 4. Required verification

Run on the exact candidate commit:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
npm.cmd run test:integration
npm.cmd run test:database
npm.cmd run test:legacy-backfill
npm.cmd run types:database:check
git diff --check
```

The real private malware-scanner integration requires its external test service. When absent, the scanner integration is `NOT_APPLICABLE_LOCAL`, not a pass; the deterministic secure-pipeline suite must pass and `APP_FILE_PROCESSING_ENABLED=false` must keep processing fail-closed. Test migration rollback separately only in a newly reset disposable database. The rollback command now resets all migrations itself and verifies the final foundation table, function, and migration ledger before returning success:

```powershell
supabase db reset
npm.cmd run test:rollback
npm.cmd run test:database
npm.cmd run test:legacy-backfill
npm.cmd run types:database:check
```

Also verify RLS/cross-customer denial, capability-only anonymous access, optimistic conflicts, private/versioned files, stale-result suppression, immutable snapshots/quotes/audits, revision-scoped invalidation, capacity held-plus-spent math, entitlement locking, provider/outbox idempotency, refund aggregation, scheduler lease uniqueness, and legacy count parity.

## 5. Configuration and cutover

No corrected Checkout or processing cutover occurs until all of these have owner-approved versioned values:

- Stripe tax-inclusive prices and tax configuration;
- anonymous draft/file retention durations and matching Privacy Policy language;
- production KMS identity/version/rotation policy, `APP_SENSITIVE_PAYLOAD_ENCRYPTION_ENABLED=true`, encryption-context version, adapter credentials, access policy, and live wrap/unwrap/tamper proof;
- malware scanner identity, sandboxed local parser identity and resource limits, leak policy, and permitted-model policy;
- capacity pools, buckets, units, and staffing version;
- scheduler worker identity, monitoring, paging, and dead-letter ownership;
- authenticated staff roles and protected human-review procedures.

Then deploy compatibility code first, observe legacy reads/writes and provider reconciliation, configure capacity, enable the smallest approved server slice, and monitor. `CUSTOMER_SUPPLIED_INGESTION` remains off unless a separate approval reference is stored. Chunk 1 does not authorize a public customer-supplied-job intake or price.

## 6. Failure recovery and rollback

Normal rollback:

1. Disable affected feature flags and stop new affected Checkouts.
2. Revert application traffic/code to the last compatible release.
3. Leave the additive schema in place.
4. Reconcile Stripe commands/events, settlements, disputes, refunds, capacity debits, entitlements, outbox messages, and scheduled leases.
5. Preserve paid orders, immutable snapshots, audit events, artifacts, and reference permissions.

The compensating script `supabase/rollback/202609040022_corrected_chunk1_foundation.rollback.sql` is only for an unactivated, disposable or proved-empty deployment. It refuses to run when operational Chunk 1 data exists. It never drops legacy tables. Use it only after backup verification, database-owner approval, and a recorded zero-operational-row proof. If an invariant fails or customer/payment/reference data may be affected, stop and escalate; do not prune, rewrite, or force a rollback.

## Release blockers remaining after Chunk 2

- approved retention durations and matching Privacy Policy language;
- production KMS/encryption and key-rotation configuration;
- production malware scanner, sandbox parser/OCR decision and limits, leak scan, and permitted-model configuration;
- Stripe tax-inclusive configuration and provider credentials/reconciliation evidence;
- capacity/staffing values, workers, leases, monitoring, and staff access roles;
- later authorized Chunks 3-7, including matching, payments, artifacts, copy/legal review, and release audit.


## 7. Chunk 2 intake expansion and activation gate

Owner: application owner for route/feature traffic; database owner for migration and validation; security/privacy owner for KMS, document processing, retention, and Privacy Policy approval.

Apply `202609040023_chunk2_four_step_intake.sql` only after `202609040022_corrected_chunk1_foundation.sql`, then apply `202609040024_chunk2_remediation.sql`. Regenerate and compare database types before deploying compatibility code. The migration is additive and does not rewrite legacy paid orders. The four-step UI may be deployed only with anonymous capability persistence available; final submission remains fail closed unless the exact production KMS configuration and secure file-processing gates are approved.

Required non-secret server settings for production finalization:

```text
APP_SENSITIVE_PAYLOAD_ENCRYPTION_ENABLED=true
APP_KMS_KEY_IDENTITY=<approved exact identity>
APP_KMS_KEY_VERSION=<approved exact version>
APP_KMS_WRAP_URL=https://<approved-host>/<wrap-path>
APP_KMS_UNWRAP_URL=https://<approved-host>/<unwrap-path>
APP_KMS_BEARER_TOKEN=<secret manager reference>
APP_KMS_TIMEOUT_MS=<approved bounded integer>
```

Never place the bearer token in logs, evidence, client payloads, or deployment tickets. The wrap service must authenticate the request, bind the supplied encryption context, and return the configured key identity and version exactly. A missing/mismatched response or timeout must keep finalization disabled.

Disposable verification and ordering:

```powershell
supabase db reset
npm.cmd run test:database
npm.cmd run test:legacy-backfill
npm.cmd run types:database:check
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
```

Checkpoint and validation queries:

```sql
select count(*) as four_step_drafts
from public.ap_anonymous_drafts
where flow_version = 'FOUR_STEP_RESPONSIBILITY_V1' and current_step between 0 and 3;

select state, count(*)
from public.ap_feasibility_requests
group by state order by state;

select count(*) as finalized_without_snapshot
from public.ap_anonymous_drafts d
where d.state = 'COMPLETE' and d.finalized_snapshot_id is null;

select count(*) as unsafe_pending_requests
from public.ap_feasibility_requests r
left join public.ap_intake_snapshots s on s.id = r.snapshot_id
where r.state = 'PENDING' and s.id is null;

select event_day, event_name, step, count
from public.ap_intake_event_counts
order by event_day, event_name, step;
select count(*) as invalid_preferred_work_mode
from public.ap_intake_snapshots
where preferred_work_mode is not null and not (work_modes ? preferred_work_mode);

select count(*) as invalid_preferred_employment_type
from public.ap_intake_snapshots
where preferred_employment_type is not null and not (employment_types ? preferred_employment_type);

select count(*) as neither_with_current_prior_cover
from public.ap_anonymous_drafts d
join public.ap_intake_snapshots s on s.id = d.finalized_snapshot_id
join public.ap_document_versions v on v.draft_id = d.id
where s.prior_cover_letter_use = 'NEITHER'
  and v.kind = 'PRIOR_COVER_LETTER'
  and v.is_current;
```

Required results: no completed draft lacks a finalized snapshot; no pending feasibility request lacks its immutable snapshot; all three remediation queries return zero; selected preferences and their criterion-specific unknown policies remain present in the snapshot; structured corrections retain their category-specific JSON shape; event rows contain only the allowlisted event name and numbered step; capability-only functions are not executable by `anon` or `authenticated`; protected staff visibility is role checked; and the UI creates no Checkout, payment, quote, capacity reservation, or feasibility outcome.

Failure recovery:

1. Disable Chunk 2 application traffic and keep finalization/KMS processing off.
2. Revert application traffic to the last compatible commit.
3. Leave migrations `202609040022`, `202609040023`, and `202609040024` in place; all three are additive.
4. Preserve drafts, document versions, immutable snapshots, fact review history, sensitive payloads, pending requests, and audit events.
5. Reconcile any pending request with its exact snapshot/content hash before retrying; never synthesize a success, quote, or capacity allocation.
6. Use a compensating migration only after the database owner proves the affected tables have no operational/customer data and obtains separate approval. Do not drop or rewrite legacy data.

Before any production cutover, the release ticket must record the exact application/database commits, target project identity, KMS approval/version, file-processing adapter approvals, retention/privacy approval, validation-query results, staff role proof, monitoring owner, rollback decision, and an explicit go/no-go. Chunk 2 completion alone does not authorize production deployment or Chunk 3.

## Chunk 3 additive matching and feasibility sequence

Owner: database/platform owner for schema and rollback; product/legal owner for source authorization; operations owner for manual coverage and human review; security owner for worker credentials and monitoring. Chunk 3 authorization covers repository implementation only and does not authorize these owners to deploy or activate production.

Order:

1. Record target project identity, current application/database commit, and a restorable backup checkpoint. Stop on mismatch.
2. Keep `APP_JOB_SOURCE_SYNC_ENABLED=false`, payment/Checkout disabled, and feasibility workers stopped.
3. Apply `202609040025_chunk3_matching_engine.sql`, `202609050026_chunk3_audit_remediation.sql`, `202609050027_chunk3_persisted_evidence_remediation.sql`, and `202609050028_chunk3_contract_completion.sql` in order after migrations `022`, `023`, and `024`. All four are expand-only.
4. Regenerate database types from that exact 28-migration schema and deploy compatibility code. Existing rows remain explicitly `legacy_compatibility=true`; new strict rows default false.
5. Verify all four Chunk 3 checkpoints, table/RPC privileges, default-deny source states, and zero unexpected automated sources.
6. Separately obtain documentary business/legal authorization before inserting any `AUTHORIZED_AUTOMATED` record. Then separately approve positive source bounds and release TTL. No permissive defaults exist.
7. Populate immutable inventory, requirement/evaluation, coverage, review, and displacement evidence through protected service-role workflows. Do not accept caller totals.
8. Start the feasibility worker only after required coverage configuration, staff roles, monitoring, retry/dead-letter procedures, and TTL are approved. Run a synthetic canary first. A pending/error run creates no outcome or Checkout.
9. A separate later authorization is required for any payment, Checkout, customer release, production source access, or Chunk 4 cutover.

Repository/disposable verification commands:

```powershell
npm.cmd exec -- supabase db reset --local
npm.cmd run test:database
npm.cmd run test:legacy-backfill
npm.cmd run test:rollback
npm.cmd run types:database:check
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
npm.cmd run test:integration
git diff --check
```

Production validation queries (read-only):

```sql
select migration_id, checkpoint, completed_at
from public.ap_migration_checkpoints
where migration_id = '202609040025';

select source_id, state, access_method, authorization_version,
       evidence_reference is not null as has_evidence,
       verified_by_role is not null as has_owner
from public.ap_source_authorizations
order by source_id, authorization_version;

select count(*) as unexpected_automated_sources
from public.ap_source_authorizations
where state = 'AUTHORIZED_AUTOMATED';

select r.state, count(*)
from public.ap_feasibility_requests r
group by r.state order by r.state;

select count(*) as strict_complete_with_incomplete_coverage
from public.ap_feasibility_assessments a
join public.ap_feasibility_coverage_plans p on p.id = a.coverage_plan_id
where a.state = 'COMPLETE' and p.plan_version = 'feasibility-v1'
  and (
    jsonb_typeof(p.typed_inputs->'requiredFamilyIds') is distinct from 'array'
    or jsonb_array_length(p.typed_inputs->'requiredFamilyIds') = 0
    or exists (
      select 1 from jsonb_array_elements_text(p.typed_inputs->'requiredFamilyIds') family
      where not exists (
        select 1 from public.ap_feasibility_coverage_cells c
        where c.plan_id = p.id and c.query_family_id = family
          and c.terminal_outcome in ('SUCCEEDED_WITH_RESULTS','SUCCEEDED_EMPTY')
          and c.normalized_and_deduplicated and c.result_changing_error_code is null
      )
    )
  );

select count(*) as strict_job_without_authorization
from public.ap_job_snapshots j
left join public.ap_source_authorizations a on a.id = j.source_authorization_id
where not j.legacy_compatibility
  and (a.id is null or a.state not in ('AUTHORIZED_AUTOMATED','AUTHORIZED_MANUAL_ONLY'));

select count(*) as liveops_boundary_failure
from public.ap_job_snapshots
where lower(concat_ws(' ', discovery_source, company, source_url, canonical_application_url, canonical_employer_listing_url)) ~ 'live[[:space:]]*ops|liveops';

select count(*) as invalid_scored_evaluation
from public.ap_match_evaluations
where not legacy_compatibility and fit_score is not null
  and (eligibility not in ('ELIGIBLE','ELIGIBLE_WITH_ALLOWED_UNKNOWNS') or usefulness_result <> 'PASS');

select count(*) as low_confidence_without_review
from public.ap_match_evaluations
where not legacy_compatibility and evidence_confidence < 60 and human_review_id is null;
```

Required results before even considering worker activation: one completed checkpoint; the authorized-source list exactly matches the signed approval record; `unexpected_automated_sources` is zero until separately approved; and every anomaly query is zero. Confirm service-role-only access to authorization, inventory membership, displacement, and worker RPCs. Confirm request claim/defer/stale/error/completion audit behavior with synthetic noncustomer data.

Failure recovery:

1. Stop feasibility workers and keep source sync, Checkout, and payment disabled.
2. Revert application traffic to the preceding compatible commit. Leave migrations `202609040025` through `202609050028` and immutable evidence in place.
3. Do not delete authorization, source configuration, coverage, inventory, evaluation, review, displacement, request, assessment, or audit rows.
4. Move a retryable claimed request back through the guarded defer path; mark stale only when its snapshot is no longer active; mark result-changing configuration/retrieval/parser defects `ERROR`. Never convert an incomplete run to `LIMITED` or `INFEASIBLE`.
5. Reconcile each request to its exact snapshot hash, coverage plan, inventory version, rules version, and assessment before retry. Never create a replacement success with a new caller total.
6. Use a forward compensating migration only after the database owner proves it safe and receives separate approval. Destructive rollback or legacy rewrites are prohibited.

Release blockers remain: documentary source authorization; approved required source/query matrix and positive bounds; release-verification TTL; staff roles/training; production worker identity and monitoring; KMS/file/OCR/parser/reference-isolation/leak/model controls; retention/privacy approvals; Stripe/tax; and staffing/capacity. The repository fixtures are not production proof.

## Chunk 3 audit-remediation addendum

Migration `202609050026_chunk3_audit_remediation.sql` is an additive correction after `202609040025`. It adds exact inventory-member/version provenance to each strict evaluation, links operator candidates to immutable evaluation IDs, enforces equality (not just cardinality) between active root keys and stored root results, and binds adjacent-equivalence review records to the exact criterion, job snapshot, fact versions, reviewer evidence, and rules version. It also makes the service role read-only on feasibility assessments and exposes a security-definer function that derives counts from current persisted inventory members and evaluations.

Migration `202609050027_chunk3_persisted_evidence_remediation.sql` is the additive second correction. It stores five-section explanation evidence on evaluations, adds immutable selection runs/members for both ranking stages, strengthens exact review/fact/criterion guards, rejects incomplete parses and non-current source authorizations at evaluation insert, and exposes only the service-role `ap_persist_match_selection` idempotent function. It does not rewrite an existing evaluation, paid order, or legacy match.

Migration `202609050028_chunk3_contract_completion.sql` is the additive third correction. It persists minimum-across-material-source quality, makes matching review subjects unique and atomically superseding, records parser-correction job lineage, rejects evaluations of superseded job snapshots, and replaces strict evaluation persistence with `matching-rules-v3` guards. Parser corrections create a new immutable job snapshot, requirement tree, inventory version/member, and coverage lineage; they invalidate the old snapshot's evaluations and never mutate the old parse.

Deployment order:

1. Keep job-source synchronization, feasibility scheduling, Checkout, payment, and customer release disabled. Record the target database project, application commit, database migration head, and backup/restore checkpoint.
2. Apply migrations through `202609050028` in order. Do not mark `025`, `026`, `027`, or `028` applied without executing them. Verify all four checkpoint rows.
3. Regenerate database types from the migrated target. Deploy code that uses `matching-rules-v3`, current exact-subject reviews, `ap_match_evaluations`, and immutable `ap_match_selection_runs/members`, never `rankLegacyJobs`, in search, operator listing, delivery, and replacement paths.
4. Populate a synthetic authorized-manual inventory member, complete parsed requirement tree, exact candidate facts, criterion-bound match reviews, a five-section usefulness review, every applicable customer hard gate and soft preference, and a server-derived evaluation. Confirm an incomplete parse, wrong evidence-to-criterion link, zero-fact hard pass, wrong root-key set, sparse adjacent review, stale review ID, superseded job snapshot, non-current authorization, noncontiguous selection ranks, and direct service-role insert to `ap_feasibility_assessments` all fail closed.
5. Configure `APP_FEASIBILITY_WORKER_ID` only after the production worker identity, lease/monitoring owner, retry alerting, required manual coverage plan, immutable inventory, and evaluations are present. An unset value intentionally returns `disabled`; it is not a permissive default.
6. Configure `APP_RELEASE_VERIFICATION_TTL_SECONDS` only from the separately approved release record. Until then, search delivery and replacements fail closed. No repository fixture approves a production TTL.
7. Run a synthetic feasibility request. Verify the database-derived assessment references the request snapshot and latest coverage plan, has exactly a 60-minute expiration, and its three counts equal the current selected inventory classification. Reconcile the audit event before enabling any customer traffic.

Read-only production validation:

```sql
select migration_id, checkpoint, completed_at
from public.ap_migration_checkpoints
where (migration_id, checkpoint) in (
  ('202609040025','CHUNK3_MATCHING_ENGINE_EXPAND'),
  ('202609050026','CHUNK3_AUDIT_REMEDIATION_EXPAND'),
  ('202609050027','CHUNK3_PERSISTED_EVIDENCE_EXPAND'),
  ('202609050028','CHUNK3_CONTRACT_COMPLETION_EXPAND')
)
order by migration_id;

select count(*) as strict_evaluation_without_inventory_provenance
from public.ap_match_evaluations e
left join public.ap_inventory_members m on m.id=e.inventory_member_id
where not e.legacy_compatibility and (
  m.id is null or e.inventory_version_id<>m.inventory_version_id
  or e.job_snapshot_id<>m.job_snapshot_id or not m.selected_by_deduplication
);

select count(*) as strict_v3_evaluation_without_selection_storage_pointer
from public.ap_match_evaluations
where not legacy_compatibility and calculation_version='matching-rules-v3'
  and (
    rank_explanation->>'storage' is distinct from 'ap_match_selection_members'
    or selector_explanation->>'storage' is distinct from 'ap_match_selection_members'
  );

select count(*) as selection_rank_anomaly
from public.ap_match_selection_runs run
where (
  select count(*) from public.ap_match_selection_members member
  where member.selection_run_id=run.id and member.selected_rank is not null
) <> least(run.requested_count, (
  select count(*) from public.ap_match_selection_members member
  where member.selection_run_id=run.id
));

select count(*) as evaluation_with_superseded_source_authorization
from public.ap_match_evaluations evaluation
join public.ap_job_snapshots job on job.id=evaluation.job_snapshot_id
join public.ap_source_authorizations linked on linked.id=job.source_authorization_id
where not evaluation.legacy_compatibility and linked.id is distinct from (
  select current_authorization.id
  from public.ap_source_authorizations current_authorization
  where current_authorization.source_id=linked.source_id
  order by current_authorization.created_at desc,current_authorization.authorization_version desc
  limit 1
);

select count(*) as multiple_current_reviews_for_subject
from (
  select snapshot_id, job_snapshot_id, review_subject_key
  from public.ap_matching_human_reviews
  where invalidated_at is null and review_subject_key is not null
  group by snapshot_id, job_snapshot_id, review_subject_key
  having count(*) > 1
) duplicate_subjects;

select count(*) as current_evaluation_for_superseded_job
from public.ap_match_evaluations evaluation
where evaluation.invalidated_at is null and exists (
  select 1 from public.ap_job_snapshots successor
  where successor.supersedes_job_snapshot_id = evaluation.job_snapshot_id
);

select count(*) as root_set_mismatch
from public.ap_match_evaluations e
where not e.legacy_compatibility and exists (
  select 1 from (
    (select unnest(e.active_root_keys) except select item->>'rootKey' from jsonb_array_elements(e.root_results) item)
    union all
    (select item->>'rootKey' from jsonb_array_elements(e.root_results) item except select unnest(e.active_root_keys))
  ) difference
);

select has_table_privilege('service_role','public.ap_feasibility_assessments','insert') as service_role_can_insert,
       has_function_privilege('service_role','public.ap_persist_derived_feasibility_assessment(uuid,text,text)','execute') as service_role_can_derive;

select a.id,a.snapshot_id,a.preliminarily_deliverable_count,a.reviewable_count,a.excluded_count,
       a.outcome,a.resolution_blocker,a.expires_at,a.created_at
from public.ap_feasibility_assessments a
where a.rules_version='feasibility-worker-v1' and a.invalidated_at is null
order by a.created_at desc;

select count(*) as proposed_candidate_without_evaluation
from public.search_candidates
where review_status='proposed' and evaluation_id is null;
```

Required results: all four checkpoints exist once; every anomaly count and `proposed_candidate_without_evaluation` is zero for corrected-contract work; `service_role_can_insert` is false; `service_role_can_derive` is true; every current assessment reconciles to its inventory and expires exactly 60 minutes after creation. Legacy compatibility rows may retain null provenance but cannot enter the corrected runtime selector or release path.

Failure recovery leaves all four additive migrations in place. Stop the feasibility worker, unset its worker identity and release TTL, disable application traffic to the new endpoints, and revert code/traffic to the previous compatible build. Preserve inventory, evaluations, reviews, parser-correction lineage, selection runs, assessments, requests, and audit events. Repair forward with another additive migration after database-owner review; do not edit migration history, fabricate counts, drop evidence, or rewrite legacy paid data.

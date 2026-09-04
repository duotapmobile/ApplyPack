# ApplyPack deployment runbook

Status: Chunk 2 repository implementation is complete locally. No production migration, deployment, provider call, source activation, Checkout, or feature enablement is authorized. Production remains blocked on the approvals and configuration listed below.

## Owners and stop conditions

| Owner | Responsibility |
| --- | --- |
| Release owner | Exact commit, change window, go/no-go, traffic rollback |
| Database owner | Backup, migrations `202609040022` and `202609040023`, backfill checkpoints, validation, database recovery |
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
4. Do not drop or rewrite legacy tables, columns, paid orders, provider history, or audit history.
5. Keep `CUSTOMER_SUPPLIED_INGESTION`, corrected file processing, retention cleanup, and Checkout disabled.
6. Regenerate types and compare them to `src/lib/database.types.ts`.

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

The real private malware-scanner integration requires its external test service. When absent, the scanner integration is `NOT_APPLICABLE_LOCAL`, not a pass; the deterministic secure-pipeline suite must pass and `APP_FILE_PROCESSING_ENABLED=false` must keep processing fail-closed. Test migration rollback separately only in a newly reset disposable database:

```powershell
supabase db reset
npm.cmd run test:rollback
supabase db reset
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

Apply `202609040023_chunk2_four_step_intake.sql` only after `202609040022_corrected_chunk1_foundation.sql`. Regenerate and compare database types before deploying compatibility code. The migration is additive and does not rewrite legacy paid orders. The four-step UI may be deployed only with anonymous capability persistence available; final submission remains fail closed unless the exact production KMS configuration and secure file-processing gates are approved.

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
```

Required results: no completed draft lacks a finalized snapshot; no pending feasibility request lacks its immutable snapshot; event rows contain only the allowlisted event name and numbered step; capability-only functions are not executable by `anon` or `authenticated`; protected staff visibility is role checked; and the UI creates no Checkout, payment, quote, capacity reservation, or feasibility outcome.

Failure recovery:

1. Disable Chunk 2 application traffic and keep finalization/KMS processing off.
2. Revert application traffic to the last compatible commit.
3. Leave migrations `202609040022` and `202609040023` in place; both are additive.
4. Preserve drafts, document versions, immutable snapshots, fact review history, sensitive payloads, pending requests, and audit events.
5. Reconcile any pending request with its exact snapshot/content hash before retrying; never synthesize a success, quote, or capacity allocation.
6. Use a compensating migration only after the database owner proves the affected tables have no operational/customer data and obtains separate approval. Do not drop or rewrite legacy data.

Before any production cutover, the release ticket must record the exact application/database commits, target project identity, KMS approval/version, file-processing adapter approvals, retention/privacy approval, validation-query results, staff role proof, monitoring owner, rollback decision, and an explicit go/no-go. Chunk 2 completion alone does not authorize production deployment or Chunk 3.

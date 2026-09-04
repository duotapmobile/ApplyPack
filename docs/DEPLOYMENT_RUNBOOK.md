# ApplyPack deployment runbook

Status: Phase 0 skeleton only. No production operation is authorized. Owners must replace placeholders with rehearsed commands and evidence in the owning chunk.

## Roles and gates

| Role | Responsibility |
| --- | --- |
| Release owner | Exact commit, window, go/no-go, rollback |
| Database owner | Expand/backfill/validation/compensating migration |
| Application owner | Compatibility deploy, feature flags, cutover |
| Payments owner | Stripe, reconciliation, refund readiness |
| Security/privacy owner | Storage, encryption, deletion, access, scans |
| Operations owner | Workers, scheduler leases, queues, outbox, monitoring |

No cutover proceeds with an `UNSET_BLOCKING`, failed/blocked required check, unverified source automation, absent rollback evidence, or dirty/incorrect release worktree.

## 1. Expand

1. Confirm authorized release commit and clean worktree.
2. Back up and record non-sensitive schema/version evidence.
3. Apply additive tables, columns, indexes, constraints, policies, functions, queues, and disabled feature flags.
4. Regenerate database types and fail on drift.
5. Validate legacy reads/writes.

Rollback: revert application traffic/code to the last compatible release and leave additive compatible schema in place. A compensating migration requires proof that it preserves paid orders, audit, financial history, and customer data.

## 2. Compatibility

Deploy compatibility reads/writes, preserve legacy paid orders, ensure new-order validation does not require deprecated fields, and prove new flags default off and unauthorized paths fail closed. Record row counts and deterministic fixture results without PII.

## 3. Backfill

Run an idempotent, checkpointed, bounded backfill. Record counts, rejects, retries, and checkpoints. Stop on invariant, authorization, payment, ownership, or provenance conflict. Never synthesize customer facts or rewrite provider/audit history. Resume only from a durable checkpoint after repairing the cause.

## 4. Validate

Validate schema/type drift, RLS/cross-customer denial, lifecycle guards, integer financial math, provider idempotency, exact-ten, entitlement uniqueness, capacity math, file/reference isolation, outbox deduplication, retention/deletion, legacy compatibility, routes/accessibility, DOCX structure/render/font, and secret/dependency/security scans. Exact commands, queries, and hashes are added in owning chunks. Use synthetic data.

## 5. Cutover

1. Confirm legal/config/source authorization gates.
2. Confirm production settings without recording secrets.
3. Confirm workers, scheduler leases, callbacks, allowlists, email, monitoring, and staffed capacity.
4. Enable the smallest slice, observe health/reconciliation, then advance.
5. Keep `CUSTOMER_SUPPLIED` and unverified automated sources disabled.

Go/no-go evidence includes release commit, migration IDs, config versions, test-manifest hash, monitoring owner, rollback owner, and time-bounded approval.

## 6. Rollback and recovery

- Disable affected features and stop new affected checkouts.
- Preserve provider events, paid orders, refunds, disputes, entitlements, audit, outbox, and artifacts.
- Revert code/traffic to the last compatible version.
- Leave additive schema unless a reviewed compensating migration is safe.
- Reconcile Stripe, email, storage, queue, capacity, and scheduled jobs before reopening.
- Escalate any data, payment, privacy, or authorization incident.

## External readiness checklist

- [ ] Supabase policies/storage/backups and disposable rehearsal target.
- [ ] Stripe prices/webhook/tax/refund/dispute/reconciliation.
- [ ] Resend domain/senders/local capture/dead-letter alerts.
- [ ] KMS, malware scanner, parser/OCR, model boundary, signed downloads.
- [ ] Scheduler leases, workers, health, monitoring, paging.
- [ ] Staff roles, review coverage, capacity pools, staffing version.
- [ ] Arial-capable DOCX rendering and inspection evidence.
- [ ] Terms, Privacy, consent versions, retention, deletion, legal approval.
- [ ] Documentary source approvals; all others disabled; Liveops blocked.

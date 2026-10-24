# Job-source operations

Last updated: September 20, 2026

## Operating boundary

Employer-first collection is disabled by default. It records what an authorized official employer endpoint returned. An independently disabled projection can create hidden, unverified research jobs from complete runs. Neither step creates verified matching inventory, admits a job to the paid board, selects a Top 10 result, or applies on a customer's behalf.

The code registry supplies adapter identity and parsing capability. It is not runtime authorization. A source can run only when all of the following agree:

- an immutable employer-specific `ap_source_authorizations` record is current in `ap_source_authorization_heads`;
- the authorization permits `AUTOMATED` `ENUMERATE_JOBS`, contains exact allowed hosts, and contains all rate/result bounds;
- a `job_source_schedules` row pins that authorization, head revision, source scope hash, closure policy, and limits;
- the schedule is explicitly enabled and unpaused;
- `APP_JOB_SOURCE_SYNC_ENABLED=true` in that environment.

No schedule or authorization is seeded or enabled by migration `202609150037_employer_first_job_aggregation.sql`. Version 1 is deliberately restricted to one globally leased source run at a time and zero metered quota units. A paid or quota-charging provider requires a reviewed quota reservation/settlement migration before it can be scheduled.

## Before any activation

1. Confirm migrations through `202609200040_board_contact_and_current_download.sql` were reviewed and applied in the intended nonproduction environment.
2. Confirm the source's legal/permission evidence, exact ATS tenant, endpoint host, allowed action, and bounded access policy.
3. Record a new immutable authorization; move its head with `ap_set_source_authorization_head` under an operator/admin identity and an expected revision.
4. Create or update the disabled schedule with its exact scope hash. A schedule is invalid if its bounds exceed the authorization.
5. Verify the adapter-owned endpoint only. Never turn a discovered candidate URL into a fetch target.
6. Run synthetic and nonproduction canary checks. Review run evidence and error metadata before enabling a recurring schedule.
7. Enable the schedule and environment flag only under a separately reviewed activation change.

Recommended cadence tiers are A every 4-6 hours, B daily, C weekly, and discovery weekly. These are operating targets, not preapproved activations.

## Worker and queue

Source collection is separate from customer order processing, commerce, and general maintenance. A dedicated authenticated `POST /api/cron/job-sources` invocation calls the source worker, which:

1. enqueues due schedules with a monotonically increasing generation;
2. claims only `JOB_SOURCE` jobs with a fenced owner, lease epoch, and expiration;
3. renews and revalidates the authorization head, schedule, generation, scope, host allowlist, and every bound before each request;
4. retries only transient failures with backoff, honors provider `Retry-After` up to the seven-day review ceiling, and immediately dead-letters nonretryable partial/schema/authorization failures;
5. records a successful completion only after an immutable complete-run ledger is finalized.

Only one live source job may exist per schedule, and the database claim lock permits only one active source lease globally in this version. A dead-letter increments the schedule revision, records an audit event, disables the schedule, and pauses it for operator review.

## Admin endpoints

Both routes require an authenticated admin with MFA:

```text
GET  /api/admin/job-sources
POST /api/admin/job-sources
```

Health request:

```json
{ "sourceId": "vipdesk-connect", "action": "health" }
```

Queue request (requires an `Idempotency-Key` header):

```json
{ "sourceId": "vipdesk-connect", "action": "sync" }
```

The sync route returns `202` with a scheduled job ID. It does not fetch or persist postings inline. Health checks also require a current employer-specific authorization and schedule; a code-registry entry alone is insufficient.

## Evidence review

For each run, inspect:

- source, schedule, authorization ID/head revision, generation, scope hash, attempt, and adapter version;
- completion classification and checkpoint;
- requested/completed pages and received/mapped/rejected counts;
- response classification, retry metadata, and sanitized error codes;
- the immutable `job_source_run_listings` ledger.

A run is authoritative only when enumeration is complete, every received listing has a one-to-one valid ledger entry, nothing was rejected, the lease and authorization remain current, and all configured bounds were respected. Partial, failed, rate-limited, stale-lease, superseded-authorization, and out-of-order runs cannot close listings.

Checkpoints are diagnostic evidence in this observation-only version. A bounded partial is not resumed or composed with another run because that would create a purportedly complete snapshot across different collection times. It is nonretryable and pauses the schedule for an operator to review the approved bounds.

The current collector deliberately leaves `job_id`, `source_reference_id`, and `job_snapshot_id` empty. Migration 039 adds a separate immutable `job_source_listing_projections` ledger. With `APP_JOB_SOURCE_PROJECTION_ENABLED=true`, the worker may project a complete run into hidden, inactive, unverified jobs while preserving original restrictions. Conflicting job identities fail for review. The projection cannot assign successful verification or create a matching snapshot. Finalist verification, immutable snapshot promotion and customer evaluation orchestration remain unfinished; source observations and pending jobs are not matching inventory.

## Missing and removed postings

Observation-only runs are reconciled without changing canonical source references or jobs. Absence closure becomes eligible only after a future reviewed projection marks the run `complete`, links every ledger entry to its canonical job, source reference, and immutable job snapshot, and proves persisted/verified counts equal fetched counts.

Once that projection exists, closure is allowed only after the schedule's repeated-complete-miss threshold and visibility window. Misses must come from complete cycles separated by at least the configured cadence; immediate admin-triggered generations cannot manufacture consecutive misses. References without a stable external ID or normalized source URL are quarantined from absence closure. The closure transaction requires the current authorization head, exact generation/scope, active fenced lease, and complete immutable listing ledger. It is one-time and rejects replay or out-of-order generations.

Only references previously closed for `REPEATED_COMPLETE_ENUMERATION_ABSENCE` may reopen automatically. Legacy, manual, rejected, or otherwise closed references remain closed. A job closes only when it has no active source reference.

Time-based maintenance still calls `mark_stale_jobs_inactive(APP_JOB_STALE_AFTER_HOURS)` independently. Do not represent staleness as employer-confirmed removal.

## Discovery inputs

Latmay and JobsPipe are discovery-only candidates. Discovery records require content/license/provenance evidence and cannot become runtime fetch targets or inventory automatically. No discovery importer or automatic source admission is implemented in this change.

## Incident response and rollback

- On authorization, tenant, scope, or hostname mismatch: pause the schedule and create a new immutable authorization if policy changed.
- On rate limits: honor `Retry-After`; do not blind-retry or increase limits.
- On partial or invalid payloads: preserve evidence, close nothing, and investigate the adapter contract.
- On lease loss or superseded authorization: treat the attempt as non-authoritative.
- Liveops must produce zero active jobs and zero results. Stop delivery and investigate any violation.

Rollback is operational: set `APP_JOB_SOURCE_SYNC_ENABLED=false`, disable/pause schedules, preserve run/listing evidence, and roll application code back if needed. Do not drop audit tables or erase observations. Repair schema through a reviewed forward migration or an approved provider restore.

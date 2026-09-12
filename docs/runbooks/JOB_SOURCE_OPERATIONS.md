# Job-source operations

## Before a source run

There are currently no authorized automated sources. Do not start a source run.

Before a future run can be considered:

1. Confirm migrations `202609020003_job_source_expansion.sql`, `202609040025_chunk3_matching_engine.sql`, and `202609080022_job_source_audit_and_requested_batch.sql` are deployed in the intended environment.
2. Confirm an immutable `AUTHORIZED_AUTOMATED` record with documentary evidence, an approved positive-bound `ap_feasibility_source_configurations` row, a configured release-verification TTL, and the exact allowed hosts/actions.
3. Confirm the selected source is active and configured as automated. Recurring workflow sync additionally requires `schedule_enabled=true` in reviewed code/configuration.
4. Confirm `APP_JOB_SOURCE_SYNC_ENABLED=true` only in the intended environment and that no rate-limit or availability incident is open. The feature flag alone is never authorization.
5. Never add credentials for public adapters or bypass authentication, robots/access controls, CAPTCHAs, redirects, paywalls, or rate limits.

## Health and sync endpoints

Both routes require an authenticated admin with MFA:

```text
GET  /api/admin/job-sources
POST /api/admin/job-sources
```

Health request:

```json
{ "sourceId": "vipdesk-connect", "action": "health" }
```

Sync request:

```json
{ "sourceId": "vipdesk-connect", "action": "sync" }
```

No source ID is presently valid for automated access. Configured connector IDs are `vipdesk-connect`, `five-star-call-centers`, `duolingo`, `ultimate-medical-academy`, `brightwheel`, `outschool`, `stripe`, `block`, and `coinbase`; all are `UNVERIFIED_DISABLED` and unscheduled. Configuration does not establish authorization or a successful run. Unauthorized health checks report disabled without a network request, and sync returns a conflict. Official-link-only sources intentionally return zero fetched jobs. A 429 or other ambiguous result is recorded and never blindly retried.

## Adding a batch

1. Fill `config/job-source-batches/next-batch.csv`; keep `schedule_enabled=false`.
2. Run `npm run jobs:sources:export` and `npm run jobs:sources:validate -- config/job-source-batches/next-batch.csv`.
3. Resolve every validation error and manually verify the official page, exact ATS tenant, permission evidence, and paid-display status.
4. Existing Lever, Greenhouse, and Ashby tenants require registry configuration only. Unsupported ATS platforms, licensed feeds, and blocked pages require a separate adapter/access/approval review.
5. Add a forward migration, deploy to nonproduction, perform one bounded sync, inspect `job_source_runs` plus accepted/rejected and duplicate results, and only then request scheduled activation.

## Review after a run

1. Inspect the matching `job_source_runs` row and source health timestamps.
2. Review normalized postings before including them in an exact-10 delivery.
3. Confirm state/country/timezone eligibility from the actual posting.
4. Confirm contractor/staffing, benefits, pay model, equipment responsibility, and any disclosed applicant cost.
5. Confirm sales, marketing, commission, and phone-intensity labels.
6. Confirm the preferred URL is the official application URL and source references retain any aggregator copy.
7. Confirm no `rejected` or inactive record is returned by the search API.

## Stale and removed postings

Corrected-contract candidates require a final live activity and actionable-path check within the configured `release_verification_ttl`. Missing TTL blocks release. Do not apply a universal 24-hour, 48-hour, one-week, or two-week cutoff. The old maintenance labels and `APP_JOB_STALE_AFTER_HOURS` remain legacy compatibility behavior only; a failed, partial, unauthorized, or rate-limited run cannot deactivate prior evidence or become an infeasible outcome.

## Liveops incident check

Liveops must produce zero active jobs and zero results. If an attempted insert reports `prohibited job source`, the fail-closed trigger worked. If any historical row is discovered, stop delivery, mark it rejected/inactive, remove its URLs, and investigate how it bypassed the normalization and database boundaries.

## Source changes

- Add or change an automated adapter only after the accountable business/legal owner records documentary authorization and bounded production configuration. Codex does not decide legality.
- Add a hostname to the official allowlist only with evidence that the employer controls or officially uses it.
- For Blue Cross Blue Shield or AAA, register the exact affiliate as the employer; never use the federation name.
- If a page is protected, ambiguous, or unsupported, keep it link-only or pending. Do not add a scraper as a workaround.

## Rollback

Do not reverse this migration by dropping audit/source, coverage, inventory, evaluation, or displacement tables in production. Disable synchronization and feasibility workers, preserve immutable evidence/history, roll application traffic back, and use a reviewed forward compensating migration only when proved safe. No production migration, source activation, or deployment is authorized by Chunk 3.

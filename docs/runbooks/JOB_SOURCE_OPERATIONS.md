# Job-source operations

## Before a source run

1. Confirm migration `202609020003_job_source_expansion.sql` is deployed in the intended environment.
2. Confirm `APP_JOB_SOURCE_SYNC_ENABLED=true` only in that environment.
3. Confirm the selected `job_sources` record is active and `automation_status=automated`.
4. Confirm no rate-limit or availability incident is open.
5. Never add credentials for public adapters and never bypass authentication, robots controls, CAPTCHAs, redirects, or rate limits.

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

Valid automated source IDs are `vipdesk-connect` and `five-star-call-centers`. Official-link-only sources intentionally return zero fetched jobs. A 429 is recorded and not blindly retried.

## Review after a run

1. Inspect the matching `job_source_runs` row and source health timestamps.
2. Review normalized postings before including them in an exact-10 delivery.
3. Confirm state/country/timezone eligibility from the actual posting.
4. Confirm contractor/staffing, benefits, pay model, equipment responsibility, and any disclosed applicant cost.
5. Confirm sales, marketing, commission, and phone-intensity labels.
6. Confirm the preferred URL is the official application URL and source references retain any aggregator copy.
7. Confirm no `rejected` or inactive record is returned by the search API.

## Stale and removed postings

The maintenance route invokes `mark_stale_jobs_inactive(APP_JOB_STALE_AFTER_HOURS)`. A successful complete source sync also deactivates source references missing from the latest source response. If a job has no active references, it is closed and excluded from search and checkout. A failed or rate-limited run does not deactivate prior jobs.

## Liveops incident check

Liveops must produce zero active jobs and zero results. If an attempted insert reports `prohibited job source`, the fail-closed trigger worked. If any historical row is discovered, stop delivery, mark it rejected/inactive, remove its URLs, and investigate how it bypassed the normalization and database boundaries.

## Source changes

- Add or change an automated adapter only after verifying an official supported endpoint and its terms.
- Add a hostname to the official allowlist only with evidence that the employer controls or officially uses it.
- For Blue Cross Blue Shield or AAA, register the exact affiliate as the employer; never use the federation name.
- If a page is protected, ambiguous, or unsupported, keep it link-only or pending. Do not add a scraper as a workaround.

## Rollback

Do not reverse this migration by dropping audit/source tables in production. Disable synchronization, preserve job and source-reference history, roll the application back to the prior deploy, and use the provider restore point if data restoration is necessary. Follow with a reviewed forward migration for schema corrections.

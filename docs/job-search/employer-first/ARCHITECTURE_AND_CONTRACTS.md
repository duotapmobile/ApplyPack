# Employer-first architecture and contracts

Status: disabled foundation; projection and canary pending
Last updated: September 15, 2026

## System boundary

The source subsystem observes authorized official employer endpoints on its own schedule. Customer order workflows consume only existing reviewed matching evaluations. Collection, matching admission, paid-board admission, Top 10 selection, materials, and application submission are separate decisions.

```text
code registry + immutable authorization head + disabled schedule
                              |
                              v
              isolated JOB_SOURCE queue and fenced lease
                              |
                              v
        bounded adapter enumeration + immutable run/listing ledger
                              |
                    observation-only gate (current)
                              X
          future human-reviewed projection to ap_job_snapshots
                              |
                              v
            matching evaluation -> human exact-10 release
```

The `X` is deliberate: current observations cannot enter inventory or apply absence closure.

## Authoritative records

| Record | Purpose | Mutability |
| --- | --- | --- |
| `src/lib/jobs/source-registry.ts` | Code identity, official URL hints, adapter kind/tenant | Versioned code; not runtime permission |
| `ap_source_authorizations` | Employer-specific hosts, actions, bounds, evidence/version | Immutable |
| `ap_source_authorization_heads` | Monotonic current authorization pointer | Reviewed optimistic update |
| `job_source_schedules` | Tier, cadence/jitter, bounds, closure policy, enable/pause state | Mutable operational state with revision |
| `ap_scheduled_jobs` | Due generation, source worker pool, owner, lease epoch | Fenced queue state |
| `job_source_runs` | Trigger, adapter, auth/scope/generation, completeness, counts, errors | Terminal evidence immutable except one closure reconciliation stamp |
| `job_source_run_listings` | Every retrieved listing key and captured observation | Insert-only while run is open |
| `job_source_discovery_snapshots` | Dataset/provider version, checksum, license, attribution, importer evidence | Quarantined evidence |
| `job_source_candidates` | Untrusted discovery leads | Cannot admit unless separately verified; never a fetch target |
| `jobs` / `job_source_references` | Legacy mutable canonical projection; separates observed/verified time, lifecycle, path status, and content revision | Not written by current collector |
| `ap_job_snapshots` / `ap_inventory_members` | Immutable matching inventory | Future reviewed projection target |

## Authorization and activation contract

Network enumeration requires exact agreement among code source identity, database source identity/ATS tenant, current authorization ID/head revision, authorization version, allowed `ENUMERATE_JOBS` action, exact allowed hosts, schedule scope hash, every operational bound, enabled/unpaused state, source generation, and current fenced lease.

Authorization is rechecked at enqueue, claim, before each request, before observation persistence, and finalization. Changing the authorization head disables and pauses the schedule. Resume is an optimistic, audited operation and fails if current authorization no longer covers the schedule.

## Adapter result contract

`enumerateJobs` returns:

- source and adapter version;
- `complete`, `partial`, or `failed` completion;
- response classification;
- checkpoint cursor and stop reason;
- requested/completed page counts;
- received/mapped/rejected listing counts;
- normalized raw postings and structured error metadata.

Complete means the source was exhausted within result/page/request/byte/total-duration limits and every received listing was represented one-to-one. Bounded exhaustion, malformed schema, rejected mapping, timeout, rate limit, 401/403/5xx, redirect, lease loss, or authorization change cannot be authoritative.

## Network boundary

Fetch targets are constructed by adapter code from grammar-validated tenant/source identity. Requests require HTTPS, exact allowed host, no credentials in URLs, no custom port, no IP literal, no localhost/local/internal name, no redirect, paced requests, response-size bounds, and deadline-aware timeouts. Candidate or admin-supplied URLs never enter fetch code.

Arbitrary-domain discovery verification is not implemented. Before any such future feature, it needs post-DNS private/reserved-address rejection and connection pinning/revalidation; the current design avoids that risk by never fetching candidates.

## Queue and lease contract

- Commerce claims only `COMMERCE`; source workers claim only `JOB_SOURCE`.
- One live source job is allowed per schedule.
- Each claim increments a lease epoch and attempt count.
- Renew, retry, complete, request, persistence, and finalization require matching job, schedule, owner, epoch, generation, and unexpired lease.
- Retry uses bounded exponential backoff and `Retry-After`; repeated failure dead-letters the job and disables the schedule.
- Due jobs use schedule generation in their idempotency key; admin refresh requires an explicit idempotency key.

## Observation and projection contract

Current successful runs use `projection_status='observation_only'`, write no canonical job/reference/snapshot IDs, record persisted/verified counts as zero, and reconcile without canonical closure.

The future projection is a separate server-only, human-reviewed transaction. It must lock and re-read the observation, current authorization/head, source reference, job content hash, coverage inventory, and reviewer evidence; populate immutable snapshot and inventory lineage; be idempotent; and return review-required on incomplete parsing. It must not create evaluations, board admissions, Top 10 selections, or applications automatically.

## Closure contract

Closure code is dormant for observation-only runs. A future `projection_status='complete'` run must prove every ledger row links to a canonical job, source reference, and immutable job snapshot, with persisted and verified counts equal to fetched count. Only then may repeated complete absence plus the run-captured visibility window close a reference. Replay and out-of-order generation fail. Only references closed for repeated complete absence may reopen automatically. Jobs close only when no active references remain.

## Rollback

Set the environment kill switch false, pause schedules, stop source claims, preserve queued/run/listing evidence, and roll back application code if required. Schema changes are repaired through forward migration or an approved restore. Evidence tables are never dropped as a routine rollback.

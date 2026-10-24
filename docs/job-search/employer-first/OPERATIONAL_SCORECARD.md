# Employer-first operational scorecard

Snapshot: September 15, 2026 local implementation
Production claim: none

## Count ladder

| Measure | Local code/migration evidence | Authorized staging | Production |
| --- | ---: | --- | --- |
| Named employer sources configured | 75 | Not queried | Not queried |
| Structured employer adapter identities configured | 9 | Not queried | Not queried |
| Initial adapter kinds implemented | 5 | Not queried | Not queried |
| Employer-specific automated authorizations created by this change | 0 | Not queried | Not queried |
| Schedules seeded by this change | 0 | Not queried | Not queried |
| Schedules enabled by this change | 0 | Not queried | Not queried |
| Source runs attempted by this change | 0 live | Not queried | Not queried |
| Parsed / persisted / active-verified / searchable | 0 live proof | Not queried | Not queried |
| Customer-eligible / human-approved | 0 live proof | Not queried | Not queried |

Configured does not mean authorized; authorized does not mean scheduled; scheduled does not mean attempted; parsed does not mean persisted; persisted does not mean verified/searchable/customer-eligible; and none of those means human-approved.

## Current technical evidence

| Metric | Result |
| --- | --- |
| Customer-order source polling | Removed |
| Admin inline sync | Replaced with idempotent `202` queue |
| Worker isolation | `JOB_SOURCE` separated from `COMMERCE` |
| Schedule default | Disabled |
| Authorization currentness | Revisioned head, rechecked across lifecycle |
| Network bounds | Exact hosts, HTTPS, no redirect/IP/custom port/local host, streaming byte cutoff, pacing, pages, requests, total duration |
| Concurrency / quota | One globally leased source run; zero metered quota units until a reviewed quota ledger exists |
| Run evidence | Structured result plus immutable listing ledger |
| Canonical persistence | Observation-only; zero automatic writes |
| Absence closure | Gated off until complete verified projection |
| Discovery | Evidence tables only; no importer/admission/fetch path |
| Operator controls | Policy/health/status/history plus audited queue/pause/resume |

## Verification

| Check | Current result |
| --- | --- |
| Focused aggregation unit tests | 35 passed |
| Repository unit suite | 54 files, 361 tests passed on the final local tree |
| TypeScript | Passed on the final local tree |
| Lint | Passed on the final local tree |
| Production build | Passed on the final local tree; `/api/cron/job-sources` included |
| Local Supabase migration execution/lint | Blocked: local Postgres at `127.0.0.1:54322` was unavailable; startup did not complete |
| Staging canary | Not run; no authorized staging evidence supplied |
| Production | Untouched |

## Yield, quality, quota, and cost

Unique yield, duplicate rate, verification rate, quota use, cost per usable job, closure accuracy, and source latency are `NOT_MEASURED` because no live source was authorized or run. These must be calculated from database run/projection evidence, never inferred from fixtures or registry counts.

## Blockers

1. No human-reviewed source-run-to-immutable-matching-inventory projection.
2. No local/staging database execution of migration 037 or concurrency/upgrade tests.
3. No employer-specific authorization/schedule activation packet.
4. No live permitted adapter canary or multi-cycle evidence.
5. Paid-board product authority remains unresolved and is outside this source path.

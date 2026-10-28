# Employer-first execution backlog

Last updated: September 15, 2026

Status values: `DONE_LOCAL`, `PARTIAL`, `BLOCKED_EVIDENCE`, `NOT_STARTED`, `SEPARATE_APPROVAL`.

## Checkpoints

| ID | Status | Scope and acceptance | Evidence / rollback | Not included |
| --- | --- | --- | --- | --- |
| EF-00 | DONE_LOCAL | Verify canonical repo/remote; branch exactly from `f7081ecc64e79d262c1d0385c238f27323c86f6b`; preserve user files and protected checkout | Git identity/status; abandon task branch to roll back | Push, merge |
| EF-01 | DONE_LOCAL | Reconcile tracked source docs; create charter, decision register, architecture, backlog, scorecard | Tracked Markdown review | Product-authority rewrite |
| EF-02 | DONE_LOCAL | DB-backed current auth head, disabled schedules, tiers/jitter, all bounds, isolated queue, generations, leases, retry/dead-letter, audited pause/resume | Migration static invariants and TypeScript tests | Applying any environment migration |
| EF-03 | DONE_LOCAL | Structured enumeration results; harden Greenhouse/Lever/Ashby; add Recruitee JSON and Teamtailor RSS; host/redirect/IP/port/size/deadline controls | Adapter fixtures, pagination/request-bound and XML declaration tests | SmartRecruiters, Workable, BambooHR, Workday |
| EF-04 | DONE_LOCAL | Remove source polling from customer workflow; queue admin refreshes; source worker pool; immutable observation ledger | Workflow isolation and worker tests | Customer gap-request queue |
| EF-05 | DONE_LOCAL | Fail-closed closure machinery; observation-only runs cannot mutate canonical jobs; replay/order/auth/lease checks | Migration invariants | Activating closure before projection |
| EF-06 | PARTIAL | Admin shows policy vs health, schedules, runs, counts, quota units, discovery summary; audited run/pause/resume | Admin API/component, lint/build | Schedule/authorization creation UI, alert delivery |
| EF-07 | BLOCKED_EVIDENCE | Implement evidence-bound observation-to-`ap_job_snapshots`/inventory projection, canonical re-verification, neutral-board eligibility and matching consumption; use automated policy checks plus exception review | Requires behavioral DB tests, immutable lineage and current product authority; Top 10 remains human-ranked | Unreviewed Top 10 release, document release, production activation |
| EF-08 | NOT_STARTED | Reproducible Latmay import with snapshot/checksum/schema/license/attribution and candidate quarantine | Import fixture tests | Runtime fetch or inventory admission |
| EF-09 | NOT_STARTED | JobsPipe REST discovery-only pilot after terms review, capped at 250 returned jobs with quota ledger | Provider evidence and pilot scorecard | MCP installation, customer PII, production use |
| EF-10 | BLOCKED_EVIDENCE | Isolated local/staging migration tests: legacy upgrade, auth supersession, queue races/crash recovery, pause/kill, closure replay/order, zero/partial/schema drift; regenerate database types | Local Supabase was unavailable in this run; transactional fixture added but not executed | Production database |
| EF-11 | BLOCKED_EVIDENCE | Smaller authorized staging canary, then 30-employer cohort; one live permitted run/adapter and three cycles | Live run evidence, no unauthorized traffic/false closure | Production activation |
| EF-12 | SEPARATE_APPROVAL | Security/privacy, operations/accessibility, product/workflow, adversarial ship reviews and production packet | Signed gate packet | Migrate, enable, purchase, merge, push, deploy |

## Immediate next gate

EF-07 and EF-10 must complete before any real employer source is enabled. A source authorization/schedule activation review must then select a small first canary; the 30-employer cohort is a later scale gate, not the starting point.

## Acceptance evidence still required

- database-executed upgrade tests with legacy terminal runs and inactive references;
- current-head supersession during enqueue, lease, request, persistence, and finalization;
- two-worker duplicate-claim and stale-owner fencing tests;
- empty-board, partial, repeated cursor, schema drift, 401/403/429/5xx, timeout, and response-limit cases;
- verified projection with exact job/reference/snapshot lineage and content hash;
- direct application URL reverification and synthetic-customer evaluation followed by human release;
- real cadence evidence, quota/cost accounting, alerts, and operational rollback exercise.

# ApplyPack employer-first job aggregation

Last updated: September 15, 2026

## Decision and product boundary

Employer-first aggregation is collection infrastructure for human-reviewed job research. It does not change the tracked product authority: an admin still reviews and delivers exactly 10 matches, ApplyPack does not auto-apply, and resume and cover-letter work remains human-reviewed. Source observations do not feed the separate paid-board implementation.

An employer's presence in the registry is not proof of an opening, remote eligibility, permission to automate access, or permission to display a listing commercially. Posting facts remain unknown when the source is silent.

## Current registry

The code registry contains 75 named employer sources plus three compatibility/import identities:

- 30 core direct employers;
- 35 selective broad employers;
- 3 remote-first employers;
- 7 contractor, staffing, freelance, or flexible-work employers;
- `manual-reviewed`, `indeed`, and `hiringcafe` compatibility/import identities.

Blue Cross Blue Shield and AAA remain affiliate directories, not generic employers. A local affiliate can be registered only after its exact employer identity and official source are verified.

Nine existing employer entries have structured adapter identities in code (Greenhouse, Ashby, or Lever). They remain `UNVERIFIED_DISABLED` at runtime unless a current employer-specific database authorization and disabled-by-default schedule are separately reviewed and activated. Recruitee JSON and Teamtailor RSS are new adapter capabilities only; this change does not register or activate an employer on either platform.

Unsupported official pages remain `official_link_only`; uncertain pages remain pending. Protected or ambiguous pages are not scraped as a workaround.

## Exclusions and aliases

Liveops and its names and URLs are rejected in normalization, database writes, and result/checkout filtering. Held sources remain outside the source registry and are neither fetched nor shown.

Canonical redirects include Sitel, Sitel Group, and SYKES to Foundever; Teleperformance to TP; Aetna to CVS Health; TurboTax to Intuit; and Discover to Capital One. Aliases cannot create a second employer or bypass deduplication.

## Collection architecture

Customer search-order processing reads persisted, reviewed evaluations only. It no longer polls job sources. Source collection uses its own `JOB_SOURCE` queue and worker pool, with independent schedules and failure handling.

Runtime truth is database-backed:

- immutable authorization versions and a revisioned current head;
- per-source schedule tier, cadence, jitter, activation state, and closure policy;
- result, page, request, response-byte, duration, and concurrency bounds;
- fenced lease owner/epoch and monotonic schedule generation;
- structured complete/partial/failed adapter results and checkpoints;
- immutable per-run listing observations;
- repeated-complete-absence closure evidence.

The source registry remains a code-level identity and adapter capability map. It cannot self-authorize network access.

## Adapter contract

Greenhouse, Lever, Ashby, Recruitee, and Teamtailor adapters return a structured enumeration result containing adapter version, completeness, response classification, checkpoint/stop reason, page and listing counts, mapped postings, and structured errors.

Requests are HTTPS-only, exact-host allowlisted, redirect-denied, paced, timed out, and response-size bounded. Userinfo, custom ports, IP literals, localhost, and local/internal hostnames are rejected. Adapter endpoints are derived from reviewed source identity; discovery candidate URLs are never fetched. A source authorization must allow every endpoint host.

Lever and Teamtailor enforce result, page, and request bounds while paginating. Single-response adapters downgrade to partial when their payload exceeds the result bound. Any partial, rejected, malformed, or failed observation closes nothing.

## Observation and projection boundary

Successful complete collection writes `job_source_runs` and an immutable `job_source_run_listings` ledger. It intentionally does not create or update canonical `jobs`, source references, or `ap_job_snapshots`. Observation-only runs reconcile their generation without applying absence closure.

A future projection must require the exact observation, source authorization/head revision, current content hash, and human verification before it creates immutable matching inventory. It must not auto-evaluate, auto-admit to a board, auto-select Top 10, or auto-apply. The current manual reviewed-job path remains the only implemented promotion path.

## Closure and freshness

Missing-listing closure is implemented but remains inactive for observation-only runs. Once an evidence-bound projection is reviewed and implemented, closure remains fail-closed:

- only a successful, authoritative, complete enumeration is eligible;
- the immutable ledger count must equal the fetched count;
- current authorization, exact scope, fenced lease, and generation are rechecked transactionally;
- closure requires repeated complete misses and an expired visibility window;
- replay and out-of-order generations are rejected;
- a job closes only when no active source reference remains.

Fresh/aging/stale classification remains time-based and separate from employer-confirmed absence. Scheduled maintenance may mark old jobs stale; it must not describe that as a complete source enumeration.

## Discovery-only datasets and services

Latmay and JobsPipe can inform source discovery after license, provenance, attribution, version, and importer evidence is recorded. Their candidates remain quarantined from collection and inventory. No importer or automatic admission path is implemented here, and MCP connectivity is not production-runtime ingestion authority.

## Admin and operations

`GET /api/admin/job-sources` reports registry sources, database schedules, health, and recent run evidence. `POST /api/admin/job-sources` performs an authorized health check or queues an idempotent refresh and returns `202`; it does not run collection inline.

See `docs/runbooks/JOB_SOURCE_OPERATIONS.md` for activation, canary, monitoring, incident, and rollback controls.

## Migrations

- `202609020003_job_source_expansion.sql` adds normalized job/source identity and compatibility fields.
- `202609150037_employer_first_job_aggregation.sql` adds revisioned authorization heads, disabled schedules, isolated source jobs, immutable run evidence, discovery quarantine, and guarded closure.

The September 15 migration has not been applied to production by this implementation work. Rollback must preserve evidence and use a reviewed forward fix or approved provider restore; dropping source/audit tables is not an acceptable automatic rollback.

## Environment

```text
APP_JOB_FRESHNESS_HOURS=24
APP_JOB_STALE_AFTER_HOURS=72
APP_JOB_SOURCE_SYNC_ENABLED=false
APP_JOB_SOURCE_WORKER_ID=
APP_JOB_SOURCE_TIMEOUT_MS=10000
APP_JOB_SOURCE_MIN_INTERVAL_MS=1500
APP_JOB_SOURCE_MAX_POSTINGS=
APP_JOB_SOURCE_USER_AGENT=ApplyPackSourceMonitor/1.0 (+https://applypack.work/contact)
```

Scheduled collection takes its operational limits from the reviewed database schedule and authorization. `APP_JOB_SOURCE_TIMEOUT_MS` is the default for health checks. `APP_JOB_SOURCE_MAX_POSTINGS` is retained only for deprecated/manual adapter compatibility and must not be treated as authorization.

## Local verification

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npm run build
supabase start
supabase db reset --local
supabase db lint --local --level error --fail-on error
```

Use only an isolated local or nonproduction database for reset/migration verification. Never reset a linked production project.

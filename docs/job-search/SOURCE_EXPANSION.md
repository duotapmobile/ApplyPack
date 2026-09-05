# ApplyPack job-source expansion

Last updated: September 5, 2026

## Decision and operating boundary

The corrected product contract supersedes the September 2 source assumptions. Source access is default deny. A source name, official-looking URL, or public endpoint is not authorization. Every automated path requires an immutable `ap_source_authorizations` record in `AUTHORIZED_AUTOMATED`, documentary evidence, an approved bounded `ap_feasibility_source_configurations` row, and the server feature flag. No source currently meets those conditions, so automated retrieval is disabled. Codex has not decided legality.

An employer's presence in the registry is not a claim that it currently has remote work. Work mode, location restrictions, schedule, employment relationship, benefits, pay, equipment, language, and costs are stored per posting and remain unknown when the posting does not disclose them.

## Registered sources

The registry contains 66 named employer sources in four separate categories, plus three compatibility/import sources. `official_link_only` means the official page is recorded for human research but is not scraped. `pending_verification` means there is no verified current careers endpoint and no job is fetched.

### Core direct employers (30)

Concentrix, Foundever, TP, Alorica, Conduent, TTEC, CVS Health, UnitedHealth Group, Humana, Cigna and Evernorth, Progressive, GEICO, Liberty Mutual, Allstate, State Farm, BroadPath, Sedgwick, American Express, Capital One, Chewy, Pearson, Stride Inc., Transcom, Asurion, Carenet Health, Quest Diagnostics, Fidelity Investments, First Citizens Bank, ABC Legal Services, and Labcorp.

All are `official_link_only`. Their official URLs are in `src/lib/jobs/source-registry.ts` and the migration seed.

### Remote-first employers (3)

GitLab, Zapier, and Automattic are `official_link_only`, lower-priority than core sources, and labeled as potentially specialized and competitive. The category does not cause any posting to be classified globally remote.

### Selective broad employers (26)

Amazon, Apple, Dell Technologies, HP, Salesforce, HubSpot, Wells Fargo, U.S. Bank, PNC Bank, Xerox, Wayfair, Nordstrom, Williams-Sonoma, Intuit, IQVIA, Wipro, VF Corporation, Whirlpool, CBRE, Driven Brands, Agero, U-Haul, Momentus Technologies, Encoura, notifyMD, and Amerit Fleet Solutions.

Twenty-five are `official_link_only`. notifyMD is `pending_verification`: the employer is identifiable, but no current official careers page or supported ATS endpoint was verified.

### Contractor, staffing, freelance, or flexible work (7)

NexRep, ModSquad, Working Solutions, VIPdesk Connect, Kelly Services, TEKsystems, and Five Star Call Centers are always stored in `contractor_staffing_flexible`. NexRep, ModSquad, and Working Solutions default to contractor metadata; Kelly Services and TEKsystems default to staffing metadata. Unknown fields remain unknown.

VIPdesk Connect and Five Star Call Centers retain legacy Lever adapter metadata, but their authorization state is `UNVERIFIED_DISABLED`. The adapter rechecks documentary authorization and configured bounds and therefore cannot run. Any later authorization is a separate business/legal decision and must be recorded before the feature flag can have effect.

### Compatibility/import sources

- `manual-reviewed` retains the existing admin delivery workflow.
- `indeed` and `hiringcafe` retain explicit third-party import identities and old payload compatibility. No unsupported scraper was introduced.
- A direct-employer posting is preferred over an Indeed or HiringCafe duplicate, while every source reference remains auditable.

### Affiliate directories

Blue Cross Blue Shield and AAA are stored only as `affiliate_source_directories` with `is_employer = false`. A local affiliate may be added only after its exact legal/employer identity and official career source are verified. The generic federation names cannot be normalized as employers.

## Exclusions and aliases

Liveops and its names and URLs are permanently rejected in three layers: normalization, database insert/update triggers, and result/checkout filtering. Historical matching rows are sanitized and made inactive by the migration.

Held sources are Dice, Demand.com, Sunrun, Jerry, Centerfield, Datalot, Healthcare Business Services, Destination Knot, and NoGigiddy. They are not source records and are not fetched or shown.

Canonical redirects are:

| Alias | Canonical employer |
| --- | --- |
| Sitel | Foundever |
| Sitel Group | Foundever |
| SYKES | Foundever |
| Teleperformance | TP |
| Aetna | CVS Health |
| TurboTax | Intuit |
| Discover | Capital One |

Aliases remain searchable and auditable but cannot create a second employer or bypass deduplication.

## Normalization contract

The normalized `jobs` row adds canonical employer/source identity, official and source URLs, external job ID, raw and normalized titles, description/department, work and employment classifications, restrictions, structured pay, phone/sales/marketing indicators, qualifications, equipment and cost disclosures, timestamps, hashes, activity/review state, and rejection reason. Null is used when the source is silent.

Only HTTPS URLs on the configured official source host (or an explicitly configured alternate official host) receive official-source attribution. A company name alone never makes an unverified URL official.

Remote classification is posting-specific:

- `remote_us_nationwide`
- `remote_us_state_limited`
- `remote_us_timezone_limited`
- `remote_country_limited`
- `remote_global`
- `hybrid`
- `onsite`
- `unknown`

The word "remote" alone produces `unknown`. A named city/state makes the result location-limited unless explicit nationwide language is present. Required office visits or in-person training produce `hybrid`. Restriction text, states, countries, timezone, equipment, and language requirements are preserved.

Phone intensity is `none_or_unknown`, `low`, `mixed`, or `high`; phone work is classified and ranked, not deleted. Sales, commission, and marketing flags inspect title and description. Contractor/staffing status, benefits, pay model, equipment responsibility, and disclosed applicant cost remain visible in the portal.

## Deduplication and preferred source

Corrected-contract duplicate edges are evaluated as null-safe OR conditions in this order:

1. canonical employer plus external ATS job ID;
2. canonical employer plus canonical employer-listing URL, otherwise canonical application URL;
3. only when at least one record lacks both stronger reliable identifiers, canonical employer plus normalized title/location fingerprint.

The predicate can be non-transitive. The corrected engine builds the full undirected conflict graph, applies the strict quality comparator, then selects a deterministic greedy maximal independent set and records every displacement. Connected components and input-order clustering are prohibited. A final pairwise check is mandatory. The earlier `job_source_references` behavior remains a legacy compatibility path.

## Default filtering and ranking

For corrected-contract evaluations, soft defaults never filter inventory. Only confirmed hard restrictions exclude a job. The prior weighted filter/rank functions remain explicitly named `rankLegacyJob(s)` and exist only so historical paid records and their admin workflow stay readable.

New evaluations use the evidence-backed `matching-rules-v1` engine: hard gates, categorical usefulness, 35/25/20/10/10 fit, exact-fit-only equal-weight preferences, evidence confidence, stable freshness, and bounded diversity. Caller-assigned totals and title/search-breadth score points are rejected. The protected legacy search API does not create corrected-contract evaluations.

## Freshness and health

- Corrected-contract release validity uses required `release_verification_ttl` configuration. It has no permissive default; an unset or expired TTL blocks release.
- Employer-posted date, when known, is used for ranking; otherwise ApplyPack first-seen date is used. `last_live_verified_at` controls validity and never makes an old listing rank as new.
- The old 24/72-hour labels remain legacy compatibility metadata only and are not universal corrected-contract gates.
- A successful automated source run deactivates source references no longer returned and closes a job when no active source reference remains.
- Scheduled maintenance calls `mark_stale_jobs_inactive`.
- Unauthorized sources report disabled state without a network request. Live smoke tests can begin only after documentary authorization and production bounds exist; recorded fixtures remain separate evidence.

## API compatibility

`POST /api/admin/search-orders/[id]/deliver` keeps the existing required fields and `{ "ok": true }` response. The extended posting fields are optional, so current admin clients continue to work. The route still requires exactly 10 reviewed matches and a current `checkedAt`; it now rejects hard-excluded jobs and exact duplicates before delivery.

`GET /api/admin/jobs` is the historical protected compatibility view. `GET|POST /api/admin/job-sources` lists authorization state and performs no network request for an unauthorized source. `APP_JOB_SOURCE_SYNC_ENABLED=true` alone authorizes nothing.

## Migration policy

`202609020003_job_source_expansion.sql` is an additive, forward-only migration following the repository policy. It was applied after the first two migrations to an isolated local Supabase/Postgres instance and passed `supabase db lint`. Production rollback should restore a provider backup or deploy a reviewed forward migration; dropping the added columns and audit tables would destroy source history and is not an acceptable automatic rollback.

## Environment

```text
APP_JOB_FRESHNESS_HOURS=24
APP_JOB_STALE_AFTER_HOURS=72
APP_JOB_SOURCE_SYNC_ENABLED=false
APP_JOB_SOURCE_TIMEOUT_MS=10000
APP_JOB_SOURCE_MIN_INTERVAL_MS=1500
APP_JOB_SOURCE_MAX_POSTINGS=250
APP_JOB_SOURCE_USER_AGENT=ApplyPackSourceMonitor/1.0 (+https://applypack.work/contact)
```

Keep synchronization disabled until the migration is deployed and an operator authorizes a run. These adapters require no source credentials. Never put provider or Supabase secrets in source control.

## Local verification

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
supabase start
supabase db reset --local
supabase db lint --local --level error --fail-on error
npm run dev
```

Use a local or nonproduction Supabase database for `db reset`. Do not run destructive reset commands against the linked production project.

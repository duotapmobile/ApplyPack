# ApplyPack sourcing audit before pipeline expansion

Audit date: September 8, 2026  
Canonical checkout: `C:\Users\mskir\Desktop\Apply_Pack\applypack-production-v2`  
Branch and commit: `codex/why-apply-pack-live` at `aa60adf85d0a1ae7c42769ac4171e2ff8eea18e8`

## Executive finding

ApplyPack is not successfully searching any job board or employer today. At audit time, both the staging and production databases contained 69 configured source rows but zero `job_source_runs`, zero `jobs`, and zero `job_source_references`. Production has no source cron. Staging has an hourly maintenance cron, but staging sets `APP_JOB_SOURCE_SYNC_ENABLED=false`; the application default is also false. Configuration, an implemented ATS adapter, and a reachable endpoint therefore must not be described as active ingestion.

Before this change, the code contained 66 named employers and three compatibility/import sources. Only VIPdesk Connect and Five Star Call Centers had structured adapters, both through Lever. The other employer entries were official career links for human research. Indeed and HiringCafe were import identities, not API or scraper integrations. No recurring CSV workflow or source-specific scheduled task was found.

This change expands the reviewable registry to 75 named employers and four board/import entries, adds Greenhouse and Ashby configuration-driven adapters, records permission and scheduling metadata, and adds the requested employer batch. Every new source remains `schedule_enabled=false`. No source was enabled or persisted into staging or production by this audit.

The complete per-source inventory, including exact URL, ATS tenant, access, configuration, operational timestamps/counts, permissions, and restrictions, is in:

- `docs/audits/JOB_SOURCE_INVENTORY_2026-09-08.md`
- `docs/audits/JOB_SOURCE_INVENTORY_2026-09-08.csv`

Counts are source-attributable database counts, not sums of public endpoint postings. Overlapping sources are not added together.

## Evidence inspected

- Canonical registry: `src/lib/jobs/source-registry.ts`
- Adapter factory and implementations: `src/lib/jobs/adapters/`
- Database seeds and run schema: `supabase/migrations/202609020003_job_source_expansion.sql`
- New audit/source metadata migration: `supabase/migrations/202609080022_job_source_audit_and_requested_batch.sql`
- Admin manual sync: `src/app/api/admin/job-sources/route.ts`
- Workflow-triggered sync and maintenance: `src/lib/workflow/process.ts`, `src/app/api/cron/maintenance/route.ts`, `railway.toml`
- Environment configuration in Railway staging and production
- Live staging and production database counts and source-run records
- Repository CSV/config searches and supporting workspace research
- Bounded, read-only checks against the configured public Lever, Greenhouse, and Ashby endpoints
- Official employer career pages and EdTech.com's page, robots file, and terms

## Inventory 1: job boards, aggregators, and licensed feeds

| Name | Exact source URL | Access and configuration | Status | Last attempt / success | Schedule | Current attributable jobs / verified remote | Permission and restrictions |
|---|---|---|---|---|---|---|---|
| Manual reviewed source | unknown | Human-reviewed payload; `src/lib/jobs/source-registry.ts` | Manual batch identity | Never / never | None | 0 / 0 | Source-specific permission must be recorded by the operator; this identity is not a board. |
| Indeed | https://www.indeed.com/ | Existing import identity; `src/lib/jobs/source-registry.ts` | Manual batch | Never / never | None | 0 / 0 | Permission unverified. No API, scraper, license, scheduled task, or batch file was found. |
| HiringCafe | https://hiring.cafe/ | Existing import identity; `src/lib/jobs/source-registry.ts` | Manual batch | Never / never | None | 0 / 0 | Permission unverified. No API, scraper, license, scheduled task, or batch file was found. |
| EdTech.com Fully Remote Jobs | https://www.edtech.com/jobs/fully-remote-jobs | Blocked registry row; migration `202609080022...sql` | Blocked | Never / never | None | 0 / 0 | Audit client received HTTP 403. No ingestion or paid-board display license was established. Written permission or a licensed feed is required. |

Blue Cross Blue Shield and AAA are reference directories, not job boards or generic employers. Their directory URLs are listed in the complete inventory, but they cannot generate jobs until the exact affiliate employer and career source are registered.

No licensed job feed is configured. The separate list of research-only boards that were never added is `docs/audits/REQUESTED_SOURCES_NOT_ADDED_2026-09-08.csv`. It includes SecretRemote, Welcome to the Jungle/Otta, We Work Remotely, FlexJobs, Remote OK, Wellfound, Himalayas, Rat Race Rebellion, SkipTheDrive, and Virtual Vocations. Their appearance in supporting research is not authority, configuration, permission, or evidence of ingestion.

## Inventory 2: direct employers and configured ATS tenants

The complete list contains 75 employers. Seventy-five rows do not mean 75 employers are searched automatically:

- 9 have an implemented structured adapter: 6 Greenhouse, 1 Ashby, and 2 Lever, with Stride counted separately as link-only; specifically Duolingo, Ultimate Medical Academy, Brightwheel, Outschool, Stripe, Block, Coinbase, VIPdesk Connect, and Five Star Call Centers.
- 65 are official-link-only or pending manual research. Stride and Capella have identified Workday tenants, but no Workday adapter exists. ClassDojo has no verified supported ATS tenant. notifyMD still lacks a verified current careers endpoint.
- 0 have scheduled activation in the application registry.
- 0 have a successful ingestion run in either live database.

The same bounded endpoint check observed 2 published postings for VIPdesk Connect and 81 for Five Star Call Centers. Those are endpoint observations only; neither source has an ingestion attempt, successful run, attributable job, or verified remote-job count in the live databases.

### Reconciliation of the requested employer batch

The endpoint counts below are bounded read-only observations from September 8, 2026. They are not ingestion runs, are not remote-job counts, and were not persisted or summed.

| Requested employer | Exact careers/source URL | ATS tenant | Current state | Bounded endpoint observation | Ingestion evidence |
|---|---|---|---|---:|---|
| Duolingo | https://careers.duolingo.com/ | Greenhouse `duolingo` | Configured, adapter implemented, unscheduled | 89 postings | No attempt; no success; 0 attributable active jobs |
| Ultimate Medical Academy | https://workatuma.com/ | Greenhouse `umaeducationinc` | Configured, adapter implemented, unscheduled | 8 postings | No attempt; no success; 0 attributable active jobs |
| Stride K12 / Stride Inc. | https://www.stridelearning.com/careers/ | Workday `strideinc/SK` | Configured official link; adapter missing | Not run | No attempt; no success; 0 attributable active jobs |
| Brightwheel | https://mybrightwheel.com/careers/ | Ashby `brightwheel` | Configured, adapter implemented, unscheduled | 19 postings | No attempt; no success; 0 attributable active jobs |
| ClassDojo | https://www.classdojo.com/jobs/ | Unknown | Configured official link; supported ATS tenant unverified | Not run | No attempt; no success; 0 attributable active jobs |
| Capella University | https://www.capella.edu/careers/ | Workday `strayer/CU_Careers` | Configured official link; adapter missing | Not run | No attempt; no success; 0 attributable active jobs |
| Outschool | https://outschool.com/careers | Greenhouse `outschool` | Configured, adapter implemented, unscheduled | 4 postings | No attempt; no success; 0 attributable active jobs |
| Stripe | https://stripe.com/careers/search | Greenhouse `stripe` | Configured, adapter implemented, unscheduled; relevance filter required | 619 postings | No attempt; no success; 0 attributable active jobs |
| Block | https://block.xyz/careers/jobs | Greenhouse `block` | Configured, adapter implemented, unscheduled; relevance filter required | 206 postings | No attempt; no success; 0 attributable active jobs |
| Coinbase | https://www.coinbase.com/careers/positions?location=all | Greenhouse `coinbase` | Configured, adapter implemented, unscheduled; relevance filter required | 206 postings | No attempt; no success; 0 attributable active jobs |

The current verified remote-job count is 0 for every source because there are no database jobs. Public endpoint postings were not counted as verified remote without running the application's posting-level normalization and human eligibility review.

## Inventory 3: tools, adapters, and reference repositories

| Component | Location | What it actually does | Status and boundary |
|---|---|---|---|
| Lever adapter | `src/lib/jobs/adapters/lever.ts` | Fetches one explicitly configured Lever tenant | Implemented; two employers configured; neither scheduled or run |
| Greenhouse adapter | `src/lib/jobs/adapters/greenhouse.ts` | Fetches one explicitly configured Greenhouse board token | Implemented in this change; seven employers configured; none scheduled or persisted |
| Ashby adapter | `src/lib/jobs/adapters/ashby.ts` | Fetches one explicitly configured Ashby board name | Implemented in this change; Brightwheel configured; not scheduled or persisted |
| Official-link adapter | `src/lib/jobs/adapters/official-link.ts` | Reports link-only/pending health and fetches no jobs | Implemented; it is not a scraper |
| Existing-import compatibility | Registry entries `manual-reviewed`, `indeed`, `hiringcafe` | Preserves source identity for manual reviewed payloads | Manual only; no discovered batch CSV or recurring importer |
| Workday | No adapter | Identified for Stride and Capella only | Unsupported; identifying tenants does not imply Workday-wide coverage |
| JobSpy or similar scraper libraries | Not present in dependencies or source | Nothing | Not installed or used |
| Master software-reference inventory | `C:\Users\mskir\Desktop\Repos` | Read-only software reference material | Not the job-source registry; no source coverage may be inferred from it |
| Remote board recommendations | `APPLYPACK_CODEX_IMPLEMENTATION_BUNDLE/sources/Remote Job Board Recommendations.md` | Supporting research | Evidence only; listed boards are not configured unless separately present in the canonical registry |

An adapter is reusable code. A tenant entry is a deliberate source configuration. Supporting Greenhouse, Lever, Ashby, or a future Workday adapter never means ApplyPack searches every employer on that ATS.

## Automatic versus manual coverage

- Automatically running now: none.
- Configured for structured access but deliberately unscheduled: the nine employers listed above with Lever, Greenhouse, or Ashby adapters.
- Manual batch identities: Manual reviewed source, Indeed, and HiringCafe. No recurring batch CSV or run record was found.
- Manual official-page research: all official-link-only employers, including Stride, ClassDojo, and Capella.
- Disabled/blocked: EdTech.com Fully Remote Jobs.
- Scheduled infrastructure: staging maintenance runs hourly, but source sync is disabled and no source has `scheduleEnabled=true`; production has no source cron.

## Expansion backlog

1. Ultimate Medical Academy, Brightwheel, and Outschool: highest first bounded-ingestion candidates because they are relevant, small enough for complete human QA, use documented public structured endpoints, and require no custom adapter code.
2. Duolingo: technically ready and modest in size, but likely lower unique fit for ApplyPack's broad entry-level audience; measure relevant unique yield before activation.
3. Stride and Capella: high education relevance, but require one reviewed Workday adapter and an access/terms decision. Implement once, then configure exact tenants; do not crawl arbitrary Workday tenants.
4. ClassDojo: keep manual until an official structured source is verified. Do not guess a Greenhouse or Lever tenant.
5. Stripe, Block, and Coinbase: technically ready but high-volume and specialized. First prove that filtering produces enough relevant unique remote inventory without costly noise or overlap.
6. EdTech.com: potentially high relevance, but blocked until written ingestion and paid-display permission or a licensed feed is obtained. Do not scrape around HTTP 403.
7. Third-party boards: evaluate unique incremental yield against direct-employer overlap. Prioritize only sources with a documented API/feed and explicit commercial-display permission. FlexJobs and Virtual Vocations require a license decision before technical work.

## Exact process for adding a source batch

The canonical runtime registry remains `src/lib/jobs/source-registry.ts`; it is separate from the master software-reference inventory. Reusable intake uses `config/job-source-batches/next-batch.csv`.

1. Add one row per exact employer or board. Provide the official source URL, ATS platform and exact tenant, access method, permission states, permission evidence URL, priority, and notes. New rows must set `schedule_enabled=false`.
2. Run `npm run jobs:sources:export` to refresh the canonical comparison inventory.
3. Run `npm run jobs:sources:validate -- config/job-source-batches/next-batch.csv`. This rejects malformed/duplicate source IDs, normalized URLs, and ATS tenants; rejects unsupported adapter kinds; requires permission evidence for structured adapters; and refuses scheduled activation.
4. Verify the official careers page and tenant ownership. Unknown values stay unknown. Do not infer an ATS tenant from a company name.
5. If `adapter_kind` is `lever`, `greenhouse`, or `ashby`, add the validated configuration to the canonical registry without writing a new adapter. Workday, custom sites, licensed feeds, and blocked pages require an adapter/access/approval work item instead.
6. Add a reviewed forward migration/upsert for the database registry. Never reset a live database.
7. Run health plus one bounded fetch in a local or nonproduction environment. Review response size, normalization rejections, duplicates, source attribution, remote classification, and permission evidence. Record the run even when it fails.
8. Only after review, set a specific source's refresh schedule and `scheduleEnabled=true`, deploy the migration/application, and explicitly enable `APP_JOB_SOURCE_SYNC_ENABLED` in the intended environment. A failed or rate-limited run must not deactivate prior jobs.

## Required answers

1. **Which boards and employers are actually searching successfully today?** None. Both live databases have zero source runs and zero jobs.
2. **Which run automatically, and which require a manual batch?** None run automatically. Manual reviewed, Indeed, and HiringCafe are manual import identities; the official-link employers require manual research. Nine employers now have structured adapter configuration but remain unscheduled and unrun.
3. **Which requested sources are missing or broken?** The ten named employers are now reconciled in code, but Stride and Capella lack a Workday adapter, ClassDojo lacks a verified supported ATS tenant, and none has a successful ingestion. EdTech.com is configured only as disabled/blocked pending permission and access. The research-only board list remains unadded.
4. **What should be added next, and why?** Validate and nonproduction-test UMA, Brightwheel, and Outschool first: relevant, low-volume, public structured endpoints, and low maintenance. Then Duolingo. Build Workday only after access review for Stride and Capella. Defer high-volume tech sources until relevance yield is measured, and defer EdTech.com/paywalled boards until licensing is explicit.
5. **What exact file or process accepts another batch without rebuilding the pipeline?** Put rows in `config/job-source-batches/next-batch.csv`, run the export and validator commands above, then add validated tenants to the canonical registry. Existing Lever, Greenhouse, and Ashby tenants use configuration only; a new adapter is required only for a genuinely unsupported platform or access method.

## Activation boundary

This audit implements registry metadata, adapters, tests, batch validation, run logging, and a forward migration. It does not deploy the migration, enable any schedule, ingest jobs, or claim production readiness. Permission restrictions remain fail-closed, and disabled or license-required sources normalize as rejected if presented to the ingestion path.

Local verification completed: the full 22-migration chain reset successfully in isolated local Supabase, the database linter reported no schema errors, the resulting registry contained 79 source rows with 9 structured and 0 scheduled, ESLint and TypeScript passed, all 121 unit tests passed, and the production build completed. The final adapter checks also enforce configured-host URL attribution and safely upgrade an employer-owned HTTP link returned by Greenhouse to HTTPS.

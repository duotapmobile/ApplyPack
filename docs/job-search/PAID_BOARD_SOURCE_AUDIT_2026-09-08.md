# Paid board source audit — 2026-09-08

## Result

No automated source is authorized and enabled in the repository today. There is no historical evidence of a successful authorized production ingestion run, no verified live inventory count, and no basis for a public freshness or volume claim. `manual-reviewed` is the only authorized source record, and it is manual-only. Indeed and HiringCafe remain human-assisted inputs and their content must not enter the paid board without rights.

The paid board remains fail-closed until an owner records source-specific permission evidence, scope, retention/display rights, rate limits, and an expiry/review date in `ap_source_authorizations`, then explicitly enables that source. Public reachability is not authorization.

## Implemented pipeline

| Area | Current evidence | Status / gap |
| --- | --- | --- |
| Registry | `src/lib/jobs/source-registry.ts` | 66 direct-employer candidates; all automated candidates default `UNVERIFIED_DISABLED`. |
| Adapter dispatch | `src/lib/jobs/adapters/index.ts` | Reuses the existing pipeline; Lever and official-link adapters only. |
| Lever | `src/lib/jobs/adapters/lever.ts` | Documented JSON postings endpoint. One bounded request only; pagination, checkpoint/resume, and retry/backoff are absent. Must not be treated as a complete sync. |
| Official links | `src/lib/jobs/adapters/official-link.ts` | Link/health evidence only; it intentionally ingests zero jobs. |
| HTTP policy | `src/lib/jobs/adapters/fetch-policy.ts` | HTTPS host allowlist, redirect refusal, timeout, 5 MB response bound, no-store, and per-origin pacing. No retry/resume. |
| Normalization | `src/lib/jobs/normalize.ts` | Normalizes work/pay/source fields and provenance. Missing timestamps can become current time in legacy normalization; paid-board admission must not present that as an upstream posting date. |
| Deduplication | `src/lib/jobs/deduplicate.ts` | Graph-based external-ID, canonical-URL, and content-fingerprint deduplication with displacement evidence. |
| Persistence | `src/lib/jobs/persistence.ts` | Upserts normalized records and source references. A bounded partial page must never trigger global missing-record expiration. |
| Freshness / liveness | `src/lib/jobs/normalize.ts`, `docs/MATCHING_POLICY.md` | Legacy 24/72-hour classification exists. Corrected releases require stronger verification; no production run evidence is present. |
| Apply links | normalized `official_application_url` / `source_job_url` | Direct links are modeled, but source attribution and active-state verification remain mandatory before display. |
| Tests | `tests/unit/job-pipeline.test.ts`, route/static tests | Unit coverage exists; there is no authorized live-source integration proof. |

## Source decision matrix

| Source | Upstream method | Paid display/storage/redistribution decision | Implementation | Configuration / blocker |
| --- | --- | --- | --- | --- |
| Lever | Documented postings JSON, employer site key, `limit`/`skip` | Employer-by-employer authorization required; API availability alone does not grant cross-employer paid redistribution | Adapter implemented, disabled | Evidence ID, allowed hosts/site key, scope, review/expiry, bound; pagination/retry still incomplete |
| Workable | Documented XML job feed; full feed updated by provider | Candidate only where a partner/employer arrangement permits paid display, storage, refresh, and links | Planned, no adapter | Written rights record and feed identity |
| SmartRecruiters | Public Posting API; company identifier, `limit`/`offset` | Employer-by-employer authorization required for this use | Planned, no adapter | Written rights record, company ID, bounds/rate policy |
| Remote OK | Documented JSON/RSS with required credit and original-post link | Conditional; do not enable until the exact commercial usage/attribution record is approved | Planned, no adapter | Approved rights record and required attribution/link behavior |
| We Work Remotely | Published API/RSS | **Blocked for the paid board** by published API terms barring use to build a job-advertising/job-search service, absent a separate written agreement | No adapter | Written permission would require fresh review |
| Himalayas | Public API documentation | **Permission required**: API attribution guidance conflicts with general terms restricting commercial/public display and automated extraction | No adapter | Written commercial permission and conflict resolution |
| Authorized employer pages | Official page or documented ATS | Per-employer authorization and documented access only | Official-link checks; two disabled Lever candidates | Source-specific evidence and adapter validation |
| Licensed provider | Contracted API/feed | Only the licensed fields, purposes, retention, display, and redistribution scope | None | Executed agreement and technical contract |
| Indeed | Human-assisted only | No automation or paid-board import absent rights | Disabled compatibility record | Rights and explicit authorization |
| HiringCafe | Human-assisted only | No automation or paid-board import absent rights | Disabled compatibility record | Rights and explicit authorization |

## Inventory readiness

Eligible, deduplicated, fresh paid-board inventory cannot currently be established. Raw source-registry size is not inventory. Readiness must be computed only from authorized sources after deduplication, liveness checks, expiration enforcement, the candidate's confirmed filters, and the inclusion-only capability admission check. Sparse results must be shown honestly; filters are never silently relaxed.

## CareerOps conclusion

CareerOps was audited at `career-ops-hq/career-ops` commit `719d1a4c64735fec4eb6f5f4b1616db4d181476c` (former `santifer/career-ops` alias). It remains reference-only and is not installed, imported, or executed. General fail-closed and golden-test ideas informed first-party controls; its browsing and scoring implementation is not ApplyPack runtime code.

# ApplyPack final integration and staging-launch status

Status: **NOT READY**

Evidence date: September 9, 2026 (America/New_York)

This is the current evidence ledger for `codex/applypack-final-integration-2026-09-09`. The exact release SHA and Railway deployment ID are recorded from provider output at deployment time; do not infer readiness from branch names or local test success.

## Working staging target

- Railway workspace: DuoTap LLC's Projects
- Project: Apply Pack (`fb5a58c4-8ccb-4205-82f9-8b8738c84e56`)
- Environment: `staging` (`6633e585-5bcd-4729-b167-2a99628daf86`)
- Service: `ApplyPack-staging` (`3d379eca-87ac-48ba-9f95-9d69c806a5db`)
- URL: `https://applypack-staging-staging.up.railway.app`
- Supabase: ApplyPack Staging (`fmugizadzdnqfckujqlw`), not the separate production project

The staging URL is an integration target, not a launch-ready claim. `/api/live` is process liveness; `/api/health` remains the stricter provider and policy readiness gate.

## Authority amendments implemented

- One versioned four-step adaptive profile feeds the board, Top 10, and document preparation.
- The filtered board is $6.99 weekly, $19.99 monthly, or $44.99 every three calendar months, with no trial.
- The board filters but never ranks, scores, tiers, or behaviorally reorders jobs.
- The standalone $20 Top 10 remains subscription-independent and requires private human review/ranking of exactly 10 eligible jobs.
- The $8 truthful resume-and-cover-letter package accepts an eligible owned board job or an owned delivered Top 10 job.
- Human review remains mandatory for ranked Top 10 delivery, generated documents, and policy-routed exceptions; board copy does not claim every listing was individually reviewed.
- Synthetic staging inventory is explicitly labeled and cannot satisfy real-source readiness.

## Dirty-to-integrated change ledger

1. The canonical source-work state descended from `aa60adf85d0a1ae7c42769ac4171e2ff8eea18e8` and is preserved on `codex/applypack-source-integration-2026-09-08` at `ae24b9a`.
2. The final integration branch was based on the clean paid-board checkpoint `5f47d0c357673f7a950e0635c1aaf74adeb0fd53`.
3. Source implementation and audit changes were selectively integrated as `909a78f` and `c2acc36`; source authorization stayed fail closed.
4. Corrected document-generation work was selectively ported as `1074e29`; the original corrected-build worktree at `fb5703a` was not modified and untracked archives were not imported.
5. The five exact historical migrations already recorded in staging were restored byte-for-byte from Git history before new migrations were applied. Their verified Git blob IDs are recorded in the migration section below.
6. Final integration adds durable board recomputation, immutable profile claims, board-origin material lineage, refund/dispute correlation, all five Stripe test-price definitions, customer board/detail/application flows, synthetic staging support, provider readiness reporting, deployment runtime packages, and current product documentation.
7. The protected `site` checkout was not edited, reset, cleaned, merged, or used as a source.

## Route map

Public and access routes:

- `/`, `/why-apply-pack`, `/how-it-works`, `/job-search-help`, `/experience-connections`, `/before-and-after`, `/resume-screening`, `/not-just-ai`, `/pricing`, `/faq`, `/about`, `/contact`, `/accessibility`, `/privacy`, `/terms`
- `/get-started`, `/sign-in`, `/checkout/return`, `/job-board`
- `/my-applypack`, `/my-applypack/job-board`, `/my-applypack/job-board/[id]`
- `/staging/synthetic-application` exists only when the staging synthetic flag is enabled and payments are not live.

Protected service surfaces:

- Shared-profile and secure-document intake APIs under `/api/intake/*`
- Server-owned Top 10, materials, and board checkout APIs under `/api/checkout/*`
- Entitlement-protected board list, detail, and application-link APIs under `/api/customer/job-board/*`
- Billing portal at `/api/customer/billing/portal`
- Protected staff review, generation, release, source, matching, conflict, correction, refund, and capacity routes under `/api/admin/*`
- Signed Stripe webhook at `/api/stripe/webhook`; authenticated maintenance at `/api/cron/maintenance`

## Migration and rollback evidence

- Local clean reset: passed all 39 migrations in filename order.
- SQL contract suite: 6 fixtures passed, including final integration.
- Legacy backfill: `LEGACY_BACKFILL_OK`, replayed twice.
- Rollback rehearsal: `ROLLBACK_OK`; full forward restore: `RESTORE_OK`.
- Type drift: generated database types match the fully migrated local schema.
- Hosted preflight: schema-only snapshot SHA-256 `0d85eb82abc4ac3397fc9df79cc9090391a8df1407961cc1db18988af1337184`; two profile rows and zero intakes, documents, orders, payments, jobs, matches, or source runs before migration.
- Restored historical blobs: `8f24829d...`, `113e3b0b...`, `e38747e7...`, `be4483e6...`, and `77222b6b...`; every restored file matched its original full Git blob ID during verification.
- Hosted forward migration: 14 migrations applied without a reset, ending at `202609090033_final_integration_board_runtime.sql`.
- Hosted postcondition: all 39 local and remote versions match; dry run reports `Remote database is up to date`; the two prior profile rows remain.

## Test matrix

| Layer | Result | Evidence classification |
|---|---|---|
| Clean install | `npm ci --offline` passed; 499 packages audited, 0 vulnerabilities | Local locked dependency evidence |
| Complete code gate | lint, typecheck, 49 test files / 330 tests, and production build of 57 pages/routes passed | Local unit/property/build evidence |
| Database | clean reset and 6 SQL fixtures passed | Local real Postgres/Supabase evidence |
| Upgrade/backfill/rollback | `LEGACY_BACKFILL_OK`, `ROLLBACK_OK`, `RESTORE_OK` | Local migration compatibility evidence |
| Database types | exact drift check passed | Local generated-schema evidence |
| Browser journeys | 75 passed, 5 project/platform skips, 0 failed across desktop and mobile | Local browser fixture evidence, not provider evidence |
| Responsive/accessibility | 320, 360, 390, 430, 768, 1024, 1440 px; keyboard; visible errors/focus; 200% reflow; reduced motion; forced colors; axe checks passed where automated | Local browser evidence, not accessibility certification |
| Document rendering | 3 synthetic scenarios, 7 DOCX/PDF artifacts, 8 pages; searchable text, structure, font checks, and page images passed | Local Windows LibreOffice 26.8.0.3 / Poppler 25.07.0 evidence |
| Source batch validation | empty next-batch template passed structural validation | Local mock/config evidence only |
| Ingestion | two idempotent synthetic staging runs; no real run | Provider staging synthetic evidence only |
| Integration scanners | 3 tests skipped because no approved live scanner is configured | Honest blocked provider/security evidence |
| Stripe | code/unit coverage only; no test credentials, prices, webhook, checkout, or lifecycle exercise | Not run / blocker |
| Email/access | Resend and cron secrets exist; no allowlisted end-to-end receipt/OTP/delivery exercise | Configuration presence only / blocker |
| Manual assistive technology | not performed | Not run / blocker |

## Job-source evidence

Readiness snapshot at `2026-09-09T06:52:24.081Z`:

- 80 registry rows including the synthetic staging identity.
- 0 scheduled sources.
- 0 automated real sources with both ingestion and paid-display permission.
- 0 real source runs.
- 0 real active jobs.
- Synthetic run `059d0c7c-47dc-484e-ada7-feaf54326740`: 12 fetched, 12 accepted, 0 rejected.
- Idempotent replay `22dd8622-735f-445c-8b98-842368a99e18`: 12 fetched, 12 accepted, 0 rejected; 0 new and 12 updated at the seeder boundary.
- Both runs carry `SYNTHETIC_STAGING_ONLY` and `realSourceEvidence:false`.

No public ATS endpoint, registry entry, configuration count, or fixture is represented as permission or real inventory.

## Filtering expected-versus-actual cases

| Case | Expected | Actual evidence |
|---|---|---|
| Confirmed W-2 requirement versus confirmed contractor job | Exclude | Unit and SQL admission tests exclude |
| Required fact unknown at employer | Admit only under warning policy | Emits an explicit unknown warning |
| Confirmed or truthful transferable capability connection | Inclusion without a score | Admission stores connection codes and no score/rank/tier |
| No evidence-supported capability connection | Fail closed | Not admitted |
| Newest-first with stable tie breaker | Neutral order | Unit tests pass |
| Salary sort with undisclosed pay | Factual salary order; missing salary last | Unit tests pass |
| Profile/job/source/policy change | Idempotent recomputation | Durable queue/triggers/RPC and SQL tests pass |
| Synthetic source in non-live staging | Interface admission allowed and labeled | Seeder/recompute path enabled only behind exact staging flags |
| Synthetic or unauthorized source in real-source gate | Never counts as launch evidence | Readiness report returns 0 real authorized sources/jobs |

## Document evidence

`evidence/final-integration/document-render/` contains the generated DOCX, PDF, expected text, render report, and every page PNG for three synthetic scenarios. The renderer test verified searchable text and structure; all eight page images were manually inspected during integration. This is development evidence using synthetic content, not customer-document approval and not proof that the Railway runtime has a licensed Arial installation.

## Founder staging test script after provider gates are configured

1. Open the staging URL. Confirm staging protection/noindex and that no production hostname or live-payment language appears.
2. Use an allowlisted synthetic customer email. Complete all four intake steps, upload synthetic documents, reject or correct one extracted fact, go back/edit, refresh, and return to the saved draft. Expected: one versioned profile, no private intake content in browser storage, one Terms/Privacy acceptance.
3. Buy weekly, monthly, and three-month board plans with Stripe test cards in separate synthetic accounts. Expected: no access on return alone; access only after verified invoice events; correct interval and amount in Stripe and the portal.
4. Browse newest-first jobs, change to disclosed-salary sorting, paginate, open details, inspect attribution/unknown warnings, and follow a synthetic application link. Expected: no rank, fit score, tier, best-match label, or personalized ordering.
5. Edit the profile and expire/change a synthetic job, then run maintenance. Expected: idempotent board recomputation removes or updates the admission.
6. Exercise cancel-at-period-end, cancellation reversal, failed invoice, successful recovery invoice, final cancellation/expiration, full refund, and dispute. Expected: board access follows provider-verified paid-period state and no event replay duplicates work.
7. Buy the standalone $20 Top 10 without a board subscription. Staff must release exactly 10 synthetic, fresh, evidence-supported jobs. Expected: the customer receives exactly 10 and no internal scores leak.
8. Buy one $8 package from a board job and another from the delivered Top 10. Complete staff evidence, generation, rendered-page review, and release. Expected: both current resume and cover letter are approved before download.
9. Expire the board subscription. Expected: purchased document history and downloads remain accessible.
10. Repeat access attempts as a second customer. Expected: every first-customer profile, board, order, and file request is denied.

## Remaining blockers

| Blocker | Customer impact | Current evidence | Accountable owner | Exact next action |
|---|---|---|---|---|
| Documentary source permission and fresh inventory | Board and Top 10 cannot be fulfilled from proven permitted real listings | 0 approved automated paid-display sources, 0 real runs, 0 real jobs | DuoTap product/legal/source owner | Obtain and archive source-specific ingestion and paid-display authorization; approve exact bounded source configs; run them; record run IDs, counts, provenance, expiry, and errors |
| Stripe test configuration | No subscription, $20, or $8 purchase can complete on staging | All Stripe variables absent; payment mode and both checkout switches disabled | DuoTap Stripe administrator | Supply a restricted test key; run the five-price setup; create the exact webhook event set; store five price IDs and signing secret; enable only test checkout; execute lifecycle matrix |
| Legal, tax, and policy versions | Renewal/cancellation/payment promises cannot be approved for launch | No recorded counsel/tax approval or final version IDs | Founder plus qualified counsel/tax adviser | Approve tax treatment, subscription/automatic-renewal and cancellation disclosures, Terms/Privacy/retention versions, and customer jurisdictions |
| Renderer/font and secure document pipeline | Staff cannot safely create and release promised files in staging | Local renderer passes; Railway lacks pinned executable hashes and a licensed Arial file; scanner/parser/KMS/model gates absent | DuoTap security/operations owner | Deploy runtime packages; install licensed Arial with approval; pin hashes/identities; configure scanner, sandboxed parser, KMS, leak controls, and permitted-model policy; rerun hostile-file and rendered-page exercises |
| Email and access delivery | Customers may not receive OTPs, receipts, status, or delivery notices | Resend key present, but no allowlisted recipient exercise or final mailbox/DNS proof | DuoTap email administrator | Confirm allowlisted test recipient and monitored inbox; verify Supabase SMTP and Resend sender; run OTP/receipt/delivery/support tests and record SPF/DKIM/DMARC results |
| Human staffing and capacity | Top 10 and document deadlines cannot be promised safely | No approved staffing roster/capacity evidence | Founder/operations | Name trained reviewers, approve rolling capacities, rehearse queue ownership/deadlines/refunds, and sign the operational capacity gate |
| Manual accessibility and provider-backed isolation | Automated checks alone cannot establish usable staging journeys | Local automated browser tests pass; provider/manual exercises absent | Founder plus qualified accessibility tester | Complete screen-reader/manual AT checks and the two-customer provider-backed isolation/file tests; record expected-versus-actual evidence |

## Production actions in strict order

1. Resolve documentary source permission and archive it.
2. Resolve legal, tax, privacy, retention, and subscription disclosure approvals with exact versions.
3. Configure and prove security, KMS, parser/model, scanner, licensed-font, and document-rendering controls.
4. Approve staffing and capacity; keep production capacity disabled until then.
5. Configure Stripe test products/prices/webhook and complete every test-mode lifecycle journey.
6. Complete staging email, OTP, mailbox, DNS-authentication, and allowlist exercises.
7. Complete provider-backed two-customer isolation and manual accessibility exercises.
8. Obtain founder final launch approval based on the complete evidence packet.
9. Only under a separate production authorization: configure production providers and migrations, deploy the approved SHA, perform bounded live smoke tests, and verify post-deployment health.

Do not merge `main`, deploy Railway production, change `applypack.work`, use live Stripe keys, activate production ingestion schedules, or accept a live charge under this staging authorization.

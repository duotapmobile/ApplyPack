# ApplyPack production implementation and soft-opening report

**September 22, 2026 — PRIVATE LOCAL EVIDENCE. Customer launch: NOT READY.** This report distinguishes implementation, automated tests, hosted evidence and human release approval. The full 95-section directive is not complete. The companion [requirement matrix](SOFT_OPENING_REQUIREMENTS_2026-09-22.md) assigns an owner, acceptance condition, evidence and status to every requirement.

Merged [PR 4](https://github.com/duotapmobile/ApplyPack/pull/4) at 08:20 UTC. Canonical desktop HEAD, its GitHub branch and origin/main now agree at **9cf14454425ff9b4b924c9ad6aeb9010f5ebcb31**. The merge tree exactly matches tested source cabd271958d36a619850f52e1abe2f848744b0aa. All eight [main CI jobs](https://github.com/duotapmobile/ApplyPack/actions/runs/35704228424) passed. Production and staging are deployed at that same merged revision; checkout and source activation remain disabled. Existing private documentation changes remain in the working tree.

## A. Architecture before

The existing Next.js 16 / React / TypeScript application already used Supabase Auth, PostgreSQL, private Storage, Stripe Checkout, Resend, leased database work, five ATS adapters, human review and DOCX/PDF generation. It also contained legacy order/download paths and several disconnected evidence and readiness checks.

The work preserves that infrastructure. The connected path is employer authorization → bounded source collection → immutable raw/provenance records → canonical inventory → current official verification → customer criteria and confirmed candidate facts → evidence matching/coverage → payment and capacity-controlled fulfillment → exact-ten human approval → selected materials → evidence-bound rendering → human review → private current-version access. Anonymous feasibility is distinct from paid fulfillment. The neutral subscription board remains distinct from curated matches.

## B. Problems found

- Partial retrieval and current-source transitions needed stronger lifecycle, checkpoint and verification guarantees.
- Draft evaluations lacked safe ownership claims; source facts, requirement reviews and prepared documents could lose their bindings.
- Historical downloads and stale approvals needed current ownership, entitlement, authentication and evidence checks.
- The approved scanner-v2 policy was inconsistent across processing/readiness; native extraction, font runtime and unattended worker execution were incomplete.
- The maintenance service had an invalid root/start configuration. Staging parsing is now diagnosed precisely: Railway denies the required Linux namespace isolation.
- Cross-browser checks found a Firefox input hit-area problem, local HTTP CSP/Safari hydration problems and Safari focus behavior.
- Provider inventory has zero admitted real verified jobs and no enabled employer schedules. KMS access and complete payment-to-delivery proof are absent.

## C. Changes implemented

Eight additive migrations, applied to both hosted databases:

| Migration | Purpose |
|---|---|
| 202609220044_source_pipeline_completion.sql | Independent source inventory, raw/provenance/checkpoints, safe complete enumeration and lifecycle |
| 202609220045_matching_fulfillment_completion.sql | Immutable draft ownership, candidate/matching/research contracts |
| 202609220046_document_safety_policy.sql | V1 structural policy, document evidence and Liberation Sans transition |
| 202609220047_capacity_retry_safety.sql | Stable capacity retry and ownership behavior |
| 202609220048_manual_research_completion.sql | Clarification, typed candidate facts and manual research |
| 202609220049_manual_source_inventory.sql | Audited manual source observations and explicit lifecycle review |
| 202609220050_current_verified_source_readiness.sql | Current authorization/content/application/verification checks across admission and release |
| 202609220051_unpaid_source_retention.sql | Dedicated leased unpaid-source cleanup with holds/payment lineage protection |

Key implementation files:

- Sources: src/lib/jobs/source-collection.ts, source-checkpoint.ts, field-evidence.ts, verified-source-inventory.ts and manual-source-inventory.ts; protected source observation/verification/reconciliation APIs.
- Matching: src/lib/matching/evidence-derived.ts, coverage-authority.ts, research.ts and supabase-feasibility-store.ts; src/lib/intake/source-annotation.ts; src/components/admin/matching-guided-controls.tsx and matching-workbench.tsx.
- Upload/security: src/lib/files/isolated-extraction.ts, isolated-extract.py, secure-pipeline.ts and unpaid-retention.ts; src/lib/security/aws-kms.ts and kms-health.ts.
- Documents/access: src/lib/documents/draft-preparation.ts, generate.ts, requirements.ts, renderer.ts and pdf-bounds.ts; src/lib/materials/server.ts; current artifact download and legacy delivery routes.
- Operations/UI: src/app/api/cron/maintenance/route.ts; src/lib/operations/; scripts/run-maintenance-once.mjs and configure-renderer-runtime.mjs; src/components/layout/site-header.tsx; src/app/get-started/wizard-v3.tsx; src/app/globals.css.
- Reproducible verification: .github/workflows/ci.yml, playwright.config.ts, playwright.hosted.config.ts, scripts/test-database-native.ps1, test-capacity-pressure.py, generate-soft-opening-fixtures.mjs, hosted-auth-smoke.mjs, hosted-upload-smoke.mjs and hosted-pressure.mjs. Generated schema types: src/lib/database.types.ts.

Existing private documentation changes remain preserved and excluded from the public repository. No protected sibling checkout was edited.

## D. Search and sourcing status

Provider read at 07:59 UTC; active/status refinement at 08:07 UTC:

| Measure | Staging | Production |
|---|---:|---:|
| Registered source rows | 80 | 79 |
| Distinct configured employers | 76 | 75 |
| Active source flags | 79 | 78 |
| Employers with an active source flag | 76 | 75 |
| Employers with an enabled schedule | 0 | 0 |
| Jobs | 12 synthetic, all stale | 0 |
| Real admitted verified inventory | 0 | 0 |
| Source verifications | 0 | 0 |
| Source schedules / enabled schedules | 0 / 0 | 0 / 0 |
| Queued scheduled commerce jobs | 0 | 0 |

Five structured ATS adapters remain: Greenhouse, Lever, Ashby, Recruitee and Teamtailor, plus a manual official-link fallback. Each environment has 65 rows classified official_link_only by automation status, and 67 using the official-link-only adapter. Active flags and configured automation metadata do not establish effective authorization. All current source-readiness predicates remain false.

A permitted private Lever pilot used the actual adapter: one API request retrieved two postings, both normalized with preserved raw payloads/hashes; zero parser/source failures. Two bounded application-page GETs brought the total to three HTTP requests. The actual VIPdesk Technical Customer Service Representative (Remote) application returned 200 with matching title and form. The other posting was a general application, not counted as a suitable vacancy. No application was submitted.

This proves live retrieval and a direct application path, not customer fit, database ingestion, recurring operation or paid republication rights. No new integration was activated. Primary evidence and immutable receipts remain private under evidence/soft-opening/private/vipdesk-*/ and vipdesk-technical-application-*/.

## E. Matching status

Typed hard gates preserve PASS/FAIL/UNKNOWN and genuine NOT_APPLICABLE. Confirmed failure vetoes relevance. Matching and generation now bind the same confirmed fact/review versions. Transferable responsibilities remain distinct from unsupported SQL, tools, credentials and domain claims. Required and preferred evidence remain separate.

Coverage bootstrap, responsibility-based expansion, targeted clarification and manual research are connected. Review packets expose facts, requirements, uncertainties, gates and source evidence. Exact-ten database fixtures reject 0, 9 and 11 members and exercise ten-member release; shortages cannot complete by padding. Neutral board sorting is preserved.

Human/operator usability and actual paid intake-to-ten-match delivery remain unproved. Advanced evidence entry still uses structured JSON in parts of the workbench. It needs an operator rehearsal, not an assertion that every admin control works.

## F. Document status

One supported generation path binds candidate facts, job snapshots, persisted requirement decisions and matching evidence. Post-edit truth validation, current-source checks and stale-release checks remain active. Historical access no longer bypasses current authorization. Fresh authentication uses verified AMR evidence rather than token refresh time.

Liberation Sans flows through templates/runtime/approval records; historical Arial evidence is retained. Filenames are centralized; real DOCX structure/native bullets and selectable PDF text, reading order, pagination, font and bounding checks are exercised. Marissa's one-page override remains; appropriate two-page cases render.

Seven real Linux artifacts spanning eight pages passed automated rendering checks and independent assistant visual inspection. This is synthetic QA, not customer human-content/page approval. Six fictional customer PDF/DOCX input pairs and expected facts were generated.

Hosted upload acceptance is verified, but extraction-to-confirmed-facts is blocked by parser isolation and KMS. Malware status remains NOT_SCANNED under v1. No CLEAN scan is invented. New signed downloads enforce current revocation/version rules; an already issued URL remains usable for its existing 15-minute expiry window.

## G. Test results and limits

| Exact command / scope | Result |
|---|---|
| npm run lint; npm run typecheck; npm test; npm run build — CI 35703666387; repeated successfully on merged-main CI 35704228424 | PASS; 84 unit files / 587 tests; production build generated 63 pages |
| node --test scripts/test-maintenance-runner.test.mjs scripts/test-renderer-runtime.test.mjs | 9 PASS |
| supabase start; supabase db reset --local --no-seed; npm run test:database | PASS, 9 contract fixtures; separate checkout-concurrency, RLS/financial and intake/delivery SQL checks passed |
| CI preserved-data reset to 202609020002, historical fixture, supabase migration up --local, historical assertions | PASS |
| pwsh -NoProfile -File scripts/test-database-native.ps1 -EvidenceDirectory evidence/soft-opening/native-final-051-2 -RetainClusterData | PASS: 56 migrations / 9 fixtures |
| Same native harness -EvidenceDirectory evidence/soft-opening/native-preserved-051 -LegacyBackfill -RetainClusterData | PASS: 56 migrations / 2 preservation fixtures |
| Same harness -EvidenceDirectory evidence/soft-opening/native-combined-20260922-9 -RetainClusterData -CapacityPressure | PASS: 10 rounds × 20 independent requests / 3 slots; each 3 accepted and 17 rejected; existing/new-key and ownership replays checked |
| tests/integration/chunk4-commerce-release.sql in final CI | 50 duplicate events produce one payment, one spent capacity unit, one fulfillment and one queued notification; reordered/late sequences also exercised |
| npm run test:e2e -- --project=desktop/firefox/webkit/mobile-webkit/mobile, as separate CI jobs | Desktop: 58 passed / 1 skipped; Firefox: 53 / 6; mobile WebKit: 53 / 6; mobile Chromium: 54 / 5; desktop WebKit: 53 / 6. Total: 271 passed, 24 intentional skips, no retries |
| Linux configured renderer then vitest run --config vitest.render.config.mts | Real render test PASS, 7 artifacts/8 pages; 1 optional package-only export test skipped |
| npm run test:integration | 1 PASS, 2 provider-environment SKIPs; not a complete integration pass |
| npm run test:hosted -- --workers=1 --retries=0 with ephemeral anonymous state | 8/8 hosted public checks, 18 routes, 4 engines at 80e1f76 |
| npm run test:hosted -- public-controls.spec.ts --workers=1 --retries=0 | 12/12 hosted controls, 4 engines at baa8870; zero retries |
| node node_modules/@playwright/test/cli.js test --config playwright.hosted.config.ts public-actions.spec.ts --project=chromium --workers=1 --retries=0 --output=evidence/soft-opening/hosted-final-artifacts --reporter=json | Merged revision 9cf1445: 2/2 hosted public/intake checks passed across 18 routes, zero skips or retries, 208.8 seconds; retained route-action-inventory-final.json |
| APPLYPACK_PRESSURE_CONFIRM=staging-synthetic APPLYPACK_PRESSURE_DRAFTS=3 APPLYPACK_PRESSURE_DURATION_MS=600000 node scripts/hosted-pressure.mjs | 2,322 requests, 10 contexts/3 own drafts, 600.5 seconds, maximum 4 RPS, zero unexpected errors, p95 587.17 ms |
| Hosted email-code and upload smoke scripts | Actual OTP request/verify 200 and portal session; 8 valid quarantined uploads, 4 malformed uploads returned 400, rate limit returned 429; public object/admin-source denials |

Browser skips are deliberate duplicate evidence/Chromium-specific touch or zoom cases; they are not cross-engine passes. Physical device, actual screen reader and mobile Safari touch scrolling are not demonstrated. Hosted traffic exercised own-draft reads, not paid processing/queue stability.

Upload fixtures were superseded/soft-deleted afterward; physical deletion is not claimed. These checks do not establish 20-file parsing pressure, two simultaneous maximum files, three signed-in cross-customer exchanges, ten stale-release races, or provider failure-injection/recovery. Those remain blocked acceptance work.

Evidence: evidence/soft-opening/ci-final*.log/json, native-*/RESULT.txt, hosted-pressure/result.json, hosted-browser-scope.json and private receipts. Earlier 8/8 hosted output was observed in the execution console; its HTML report was overwritten by the later 12/12 run. Do not infer retained traces for every success. Failed intermediate runs remain recorded, not counted as passes.

## H. Deployment status

Both hosted Supabase projects have all 56 migrations through 202609220051, with matching file/ledger receipts. Generated types match that schema.

Staging maintenance deployment 286290bb-ac9d-4868-b1ea-876ccf5c2803 runs merged revision 9cf14454425ff9b4b924c9ad6aeb9010f5ebcb31. Its natural 08:30:24 UTC execution reported BLOCKED / HTTP 503 for rendering, encryption, file-safety and payment-integrity readiness; all action counts were zero. The one-shot runner exits normally for that known hold, avoiding false crash/restart loops; it does not record a successful heartbeat. Evidence: evidence/soft-opening/private/maintenance-9cf1445-cron.log.

Production deployment **bf2d101f-6d4a-4427-90f4-46e2470c56cb** and staging deployment **0ba54c6b-9690-4139-bee4-d21218a49b7a** are SUCCESS on **9cf14454425ff9b4b924c9ad6aeb9010f5ebcb31**. Production was rechecked at 08:34 UTC: homepage, pricing, sign-in and /api/live return 200; /api/health returns 503 with truthful dependency holds. Anonymous admin and valid-parameter artifact requests return 401. Malformed Stripe signatures return 400. Search/materials requests without valid origin return 403; board checkout returns 503 while disabled.

Production had APP_PAYMENT_MODE=disabled despite configured test credentials. It was corrected to test and redeployed; webhook reconciliation is independent of the closed checkout flags. All five activation flags were read back false in both environments. No live charging or production source activation occurred. Production still has no maintenance service instance. Runtime/anonymous smoke evidence: evidence/soft-opening/production-final-rollout.json and staging-final-rollout.json.

Stripe's five active test prices match $20, $8, $6.99 weekly, $19.99 monthly and $44.99 every three calendar months. These facts and invalid-signature rejection do not prove genuine Checkout fulfillment. One actual resend of an existing test price.created event was accepted by Stripe but did not produce a staging ledger record; that event is outside the endpoint's subscription scope. Receipt is not proven, and the subscriptions were not broadened merely to make the check pass.

A real rehearsal email reached the allowed mailbox with SPF/DKIM/DMARC pass, and hosted OTP succeeded. A subsequent Resend test sent two identical requests with one idempotency key: both returned message 01a0c82e-6270-765b-83cb-ded4b7d76df5, and exactly one matching mailbox message was observed. That message landed in **Spam** despite passing SPF/DKIM/DMARC. This proves duplicate suppression and receipt, not inbox placement or the application's outbox lifecycle. The sending-only key correctly refused provider message-read access. No mailbox labels were changed. Private receipt: evidence/soft-opening/email-replay-proof.json.

Independent source/product/security reviews found no additional reproducible blocker for a disabled rollout. The skeptical launch review remains NOT READY.

## I. Remaining blockers

| Cause | Prepared work | Exact next action | Launch impact |
|---|---|---|---|
| Existing AWS KMS identity/key access missing | SDK adapter, context binding, limits and real round-trip probe | Configure the existing approved key ARN/region and narrow workload identity securely using the click guide; run encrypt/decrypt. No new key or spending without approval. | Blocks sensitive intake/processing |
| Railway denies parser namespace isolation | Bounded structural parser, cleanup and sanitized diagnostics | Supply an existing approved isolated runtime, or approve a specific priced runtime, then connect and run the actual extraction/limit/concurrency suite. Do not bypass isolation. | Blocks safe extraction and complete intake |
| No admitted useful verified real inventory / no active rotation | Five adapters, manual observation/verification, lifecycle and coverage contracts; real private pilot | Complete truthful employer/source authority evidence, admit current verified jobs through the operator workflow, then separately approve recurring activation and demonstrate sufficient customer-specific supply. Do not infer paid rights from public API access. | Blocks paid matches and board |
| Required commerce approvals false | Exact price/entitlement/atomic-capacity/replay guards and actual rendering | Review tax configuration; complete renderer/human review and provider-idempotent application outbox and inbox-placement evidence (one rehearsal landed in Spam), then record the corresponding approvals with real references. | Blocks checkout; approvals cannot be fabricated |
| No production scheduled worker | Existing staging service and tested one-shot runner | Prepare the existing service's production instance with reviewed usage/cost, production URL/secret, 15-minute cadence; verify an actual scheduled execution and heartbeat. | Blocks reliable fulfillment |
| Full hosted fulfillment and failure/recovery programme not executed; production remains in Stripe TEST mode | Synthetic profiles, golden jobs, contract/race/browser/pressure harnesses | After dependencies work, run genuine test $20 checkout→ten-match review/delivery, two-job $16 materials purchase→human review→downloads; all subscription intervals/cancellation/refunds; 3-customer isolation, stale races and provider failure recovery. Only after acceptance, configure approved live Stripe keys/prices/webhook and explicitly activate purchasing. | Blocks launch verdict |
| Remaining human and device acceptance | Public keyboard/reflow/axe/browser evidence, operator controls | Perform operator content/page approval, remaining admin controls, actual screen-reader/device and recovery checks; rerun complete hosted journey. | Blocks full acceptance |

Detailed provider clicks: [LAUNCH_UNBLOCK_CLICKS.md](../runbooks/LAUNCH_UNBLOCK_CLICKS.md). The existing AWS/access question remains pending; no secrets should be pasted into chat. No new recurring Codex follow-up is configured.

Rollback: disable new checkout/live purchasing and source sync/projection, stop new capacity admission, preserve paid obligations, webhooks, reconciliation and history. Use a reviewed schema-compatible application revision; do not reverse additive migrations blindly.

## J. Launch verdict by subsystem

| Subsystem | Verdict | What prevents READY |
|---|---|---|
| Sourcing | BLOCKED | Zero real admitted verified inventory, no authorized active rotation; only bounded private retrieval demonstrated |
| Matching | PARTIAL | Implemented/tested contracts, but actual confirmed-intake and customer-specific paid fulfillment not demonstrated |
| Documents | PARTIAL | Real rendering verified; hosted intake/KMS, human approval and private release chain unproved |
| Payments/Entitlements | PARTIAL | Catalog and database contracts verified; actual provider lifecycle and required commerce approvals missing |
| Admin Review | PARTIAL | Guided/persisted actions exist; complete operator workflow and every admin control not rehearsed |
| Security | BLOCKED | KMS access and parser isolation unavailable; authenticated isolation/stale-race hosted proof outstanding |
| Deployment | PARTIAL | Exact merged revision deployed and smoke-checked; production worker/readiness and end-to-end operation incomplete |

The 95-section implementation and customer soft opening remain incomplete. Code publication, database upgrades, live pages and green CI are separate from authorization to accept customer payment.

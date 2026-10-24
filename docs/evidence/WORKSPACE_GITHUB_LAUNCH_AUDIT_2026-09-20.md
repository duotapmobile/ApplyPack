# ApplyPack desktop, GitHub, and launch audit

Date: September 20, 2026

Status: **NOT READY**. The desktop, GitHub review branch, staging deployment, and production deployment are connected to the intended project but do not represent one synchronized release candidate. Intentionally disabled payments are not a crash defect.

This is a local audit artifact. Do not publish it through the production-code-only branch or copy it to another system without the applicable publication instruction. No production configuration, payment setting, source activation, migration, merge, or deployment was changed during this audit.

## Verified versions

| Surface | Verified state |
| --- | --- |
| Canonical checkout | `C:/Users/mskir/Desktop/Apply_Pack/applypack-production-v2` |
| Origin | `https://github.com/duotapmobile/ApplyPack.git`; GitHub repository is public |
| Desktop branch | `codex/employer-first-aggregation-2026-09-15` |
| Desktop committed HEAD | `f7081ecc64e79d262c1d0385c238f27323c86f6b` |
| Matching published code branch | `origin/codex/production-code-sync-2026-09-14`, same full HEAD |
| GitHub main | `aa60adf85d0a1ae7c42769ac4171e2ff8eea18e8` |
| Open integration PR | [PR 1](https://github.com/duotapmobile/ApplyPack/pull/1), head `4f8df64d7e3c186f954b5eeda769b74c8101a9db` |
| Integration CI | verify, browser, and database passed for that integration head; [run](https://github.com/duotapmobile/ApplyPack/actions/runs/34662334593) |
| Railway staging | `ApplyPack-staging`, deployment `9ed7faf1-3084-4618-a714-8e387a4fee7f`, SUCCESS, September 12; upload label `ApplyPack observability gate 203d989` |
| Staging source attribution | Deployment has no provider `commitHash`; prior deployed source inspection and operational records identify `203d989923cea7f21db6f7b75c8fb90fc05d99e9`. Do not claim a provider-attested source SHA for the uploaded image. |
| Railway production | `ApplyPack`, deployment `fef00052-bb2c-41de-ac73-0116e598271d`, SUCCESS, exact commit `aa60adf85d0a1ae7c42769ac4171e2ff8eea18e8`, September 4 |

`git fetch origin` completed. The committed desktop code is two commits ahead of main, but the integration branch has a different history: 39 commits unique to integration and two unique to desktop. Commit counts alone do not establish which implementation is more complete.

## Desktop and GitHub findings

1. The current desktop branch has no upstream. Its committed base exists on GitHub under a different branch name, but the current employer-first work is uncommitted and not backed by matching GitHub CI.
2. The initial checkout contained 21 modified tracked paths and 18 untracked files, including employer-source code, migration 0037, and private requirements/evidence documents. Browser tests subsequently generated additional synthetic screenshots under `evidence/`; this report is also new. These must not be added and pushed indiscriminately. The source requirement register explicitly separates runtime publication from internal research/evidence.
3. Git's worktree registration points this checkout back to an older `.codex/visualizations/.../applypack-release/.git` path. `git worktree list` consequently shows an incorrect/duplicate release location. Canonical `rev-parse --show-toplevel` is correct and normal Git access works, but desktop/worktree routing metadata needs repair before relocation or automated checkout management. The administrative metadata lives under the explicitly protected `site` checkout; no repair was performed in this audit.
4. The desktop is not a superset of the reviewed integration release. It lacks `src/lib/operations/summary.ts`, `src/lib/operations/maintenance-observability.ts`, `/api/admin/operations/summary`, and four related unit-test files. Its maintenance and readiness routes also differ. Those omissions need a deliberate reconciliation, not a wholesale replacement of either tree.
5. Conversely, desktop includes newer document standards, `/why-customize`, bounded-sync false-closure protection, and disabled employer-first foundation changes that the older integration release does not fully contain.

## Existing product authority recovered

The approved September 9 product amendment is present in GitHub integration history at:

`origin/codex/applypack-final-integration-2026-09-09:docs/applypack/11_SEPTEMBER_9_FINAL_PRODUCT_AMENDMENT.md`

It explicitly supersedes earlier no-subscription/manual-discovery restrictions and approves the filtered subscription board, standalone $20 Top 10, and $8 materials from an eligible board or delivered Top 10 job. The owner does not need to repeat that decision.

The amendment was missing from the desktop at initial audit. Following the requested cross-chat review, it was restored locally from the integration history, and the employer-first charter/EF-07 were corrected to include the neutral board and exception-based review. These are unpublished documentation changes. See `CHAT_REQUIREMENTS_RECONCILIATION_2026-09-20.md` for recovered source instructions and original attachments. SRC-001's missing-artifact blocker is retired; exhaustive traceability remains open. Runtime projection and deployment gaps remain unresolved.

## Current hosted checks

| Check | Result |
| --- | --- |
| Staging `/api/live` | HTTP 200, process responding |
| Staging `/api/health` | HTTP 503: payments, file safety, maintenance, source registration and authorized inventory false; database, Supabase configuration, email and origin true |
| Production Railway domain `/api/live` | HTTP 200, process responding |
| Production Railway domain `/api/health` | HTTP 503: payments, database and source registration false |
| Public `applypack.work` | Local DNS resolves apex to `198.54.117.242`; HTTPS request was refused. Public reachability was not established. `www` CNAME lookup did not return a CNAME. Final domain routing and HTTPS remain unverified. |
| Staging maintenance schedule | `cronSchedule=null`; the earlier authorized pause remains in effect. The last crash record is historical, not evidence of a newly scheduled run. |

The old production health response is not proof that current file-processing protections are ready. Current source also has a readiness defect: `/api/health` uses `fileScan.ready`, which can accept structural `document_validation`; that mode deliberately returns `pending/malware_scan_required` for artifacts. Production readiness must distinguish actual malware-scanner readiness (`liveReady`) from structural validation. This finding does not establish a file-quarantine bypass.

## Source and provider blockers verified now

- Read-only staging queries returned **zero real active open jobs** and **zero real source runs**, excluding the synthetic source. Registered authorization records do not substitute for executed runs or usable inventory.
- The employer-first foundation is observation-only. Its EF-07 reviewed projection and EF-10 database behavior gates are incomplete in the local execution backlog. Shipping the newest adapters does not make those observations customer-searchable.
- Staging REST probes for the new `job_source_schedules`, `job_source_run_listings`, and `ap_source_authorization_heads` tables returned 404. The new foundation schema is not exposed in staging. A verified migration ledger is still required; an API-schema probe is not a replacement for migration verification.
- Staging payment mode is intentionally `disabled`; checkout is false and no deployable Stripe secret was listed. Leave live purchasing disabled during consolidation.
- Staging variable checks found no configured renderer identity, malware-scanner identity, sandboxed-parser identity, permitted-model policy, or KMS identity/endpoints/token. Values were not printed. These are setup/proof gaps, not reasons to bypass the relevant guards.
- Production's database readiness check is false. The exact underlying production database condition needs provider verification before any migration or restoration action; this audit did not reactivate or modify it.
- No current complete two-customer/provider-backed purchase, entitlement, review, delivery, refund/replay, and privacy-isolation evidence was produced. Browser fixture success must remain separate.

## Validation in this audit

- `npm run check`: **passed** — lint, TypeScript, 54 unit-test files / 361 tests, and optimized build with 58 generated static pages.
- `git diff --check`: **passed**; line-ending warnings are not test failures.
- `npm audit --omit=dev --json` and full `npm audit --json`: **zero reported vulnerabilities**, including development dependencies in the full audit. This is not an exhaustive security assessment or a reason to upgrade every package.
- `npm run test:document-render`: **blocked/failed at renderer configuration** — one failed, one skipped, no rendering performed. The current approved tool/font configuration is absent.
- Database verification: **blocked locally** — Docker Linux engine pipe unavailable. A bounded `docker desktop start --timeout 45` attempt did not complete and was stopped; a fresh Docker version check still reported the missing engine pipe. No database reset, migration, type regeneration, or restore was attempted against an unknown or production target.
- `npm run test:e2e`: **passed** — 106 passed, six intentional platform-specific skips, 20.3 minutes. Desktop and mobile Chromium emulation covered intake, order/document fixture states, public pages, keyboard/touch, automated accessibility, reflow, reduced motion, security headers, and the comparison page. These are local synthetic interface tests, not real-provider or physical-device evidence.
- Visual spot-check: current synthetic 390px intake and delivered-material screenshots were inspected. This limited check is not real document rendering or a manual assistive-technology sign-off.

The GitHub CI workflow does not run real document rendering or all dedicated recovery/type/provider commands. Its green status covers the selected workflow and exact integration head, not the newer dirty desktop tree or a complete launch rehearsal.

## Consolidation and launch sequence

1. Preserve the current uncommitted code and private documents; repair only the canonical worktree registration through an explicitly scoped recovery action. Do not reset, clean, or merge the protected sibling checkout.
2. Assemble one reviewed candidate containing the current document/page/source-safety improvements and recovered operations safeguards. Reconcile the existing September 9 authority locally. Keep incomplete employer-source behavior disabled and its remaining projection/database work explicit.
3. Fix the production file-safety readiness mismatch, then run the combined candidate's unit, browser, database/type, preservation/rollback, and real renderer checks. Publish only the authorized runtime/test scope to a review branch and obtain CI for its exact SHA.
4. Deploy that exact candidate to staging with payments still disabled until secure test-provider setup is ready. Complete source projection and permitted real-source canaries; verify freshness, provenance, supply, and pause/recovery behavior.
5. Configure and verify the real private file-processing/rendering path, then perform the complete test-mode customer/admin journeys. Finish legal/capacity, manual accessibility, privacy, email, and backup/restore evidence against that candidate.
6. Only after the staging evidence is complete, prepare the exact production migration/deployment/domain change packet. Main merge, production activation, and live payments remain separate release actions. Restore required maintenance with successful execution evidence before accepting customer work.

This sequence is the path to a release candidate; it is not a claim that the synchronization or launch blockers have been repaired.

## Audit completion

The audit is complete. GitHub remote references were refreshed, live states were read, local code/browser/security-package checks were run, and this report plus synthetic test screenshots were produced. Existing application edits were preserved. No application code was rewritten, no branch was published or merged, and no production service or payment configuration was activated. The local checks establish a usable baseline for consolidation; they do not establish a synchronized or launch-ready release.

## Independent review

Three real read-only reviewers covered product/workflows, security/privacy/payments, and accessibility/SEO/operations with a skeptical launch check. Their concrete findings are incorporated above. Root rechecked the recovered amendment to correct an initial apparent product conflict: approval already exists; the problem is omitted local authority.

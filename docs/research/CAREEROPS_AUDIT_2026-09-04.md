# CareerOps correction audit and selective-adaptation record

Audit date: 2026-09-04
ApplyPack start commit: `6256250693adefe2762a5f921c81fbfbcc305c75`
Scope: code-level donor audit required by the CareerOps correction addendum; no production crawl, provider enablement, customer data, or CareerOps runtime integration.

## Pinned identity and maintenance

- Canonical repository: https://github.com/career-ops-hq/career-ops
- Former alias: https://github.com/santifer/career-ops
- Default branch: `main`
- Audited commit: `719d1a4c64735fec4eb6f5f4b1616db4d181476c`
- Commit timestamp: `2026-09-04T15:30:19-07:00`
- Commit subject: `fix(doctor): detect project-scoped Playwright MCP plugin installs (#3711)`
- Latest observed project tag: `career-ops-v1.32.0` at `e58eb6529e080910b3874299b2ccf025fbabe4b5`; the audited commit is newer.
- License: MIT, Copyright 2026 Santiago Fernández de Valderrama.
- Trademark: code rights do not grant commercial naming, logo, endorsement, domain, or certification rights. ApplyPack uses the name only for factual audit provenance.
- Governance: one lead maintainer has merge/release and final architecture authority; one reviewer and one area owner are named. This is not three interchangeable maintainers.
- Activity snapshot: 1,845 commits reachable; 706 in the preceding 30 days and 1,624 in 90 days at audit time. Activity is high but not evidence of hosted-service suitability.

## Disposition

CareerOps is `REFERENCE` and a pinned benchmark, not a dependency or architectural foundation. No source was copied. ApplyPack already had stronger hosted multi-tenant, hard-gate, database, approval, and private-artifact boundaries. In-scope adaptations are limited to explicit fail-closed packet validation and golden-test patterns. Discovery/provider concepts are `DEFER` to Chunk 3 under the corrected source policy.

Its global 1-to-5 recommendation cannot determine eligibility. Confirmed dealbreakers remain `FAIL`; permitted unknowns remain explicit; only human-approved jobs may be rendered.

## File-by-file adoption matrix

| CareerOps path | Actual role, inputs/outputs, assumptions, failures/tests | ApplyPack disposition and target |
| --- | --- | --- |
| `README.md` | Product claims and setup guide for a local single-user Markdown/YAML/TSV workflow; advertises scanning, Playwright PDFs, and scoring. Claims are not proof. | `REFERENCE`; this audit only. |
| `AGENTS.md` | Large agent instruction surface that routes local workflows and writable user files. Prompt logic, not a service authorization layer. | `REJECT` as runtime instruction; ApplyPack contract remains authoritative. |
| `.agents/skills/career-ops/SKILL.md` | Natural-language mode router that loads profile/custom prompt files and may delegate scans/apply. User text can influence procedural prompts. | `REJECT`; no second agent command center in ApplyPack. |
| `package.json` | Node >=18; four direct dependencies. `postinstall` runs `npx playwright install chromium --with-deps` twice on fallback. | `REFERENCE`; audited with scripts disabled. Never import package/scripts. |
| root lockfiles | No root lockfile at the pinned commit, so three direct ranges resolve over time. | `REJECT` for production dependency reproducibility. |
| `LICENSE` | MIT grant and notice condition. | `REFERENCE`; notice needed only for copied/derived code. |
| `LEGAL_DISCLAIMER.md` | Declares local processing, user-selected AI providers, platform-ToS responsibility, and manual verification. It is not ApplyPack legal language. | `REJECT` for customer copy; legal counsel controls ApplyPack. |
| `TRADEMARK.md` | Reserves commercial use of the name/brand and endorsement-like wording. | `REFERENCE`; no brand use or implied affiliation. |
| `scan.mjs` | HTTP-first provider registry, filtering, bounded concurrency, atomic local file writes, scan history, dedup snapshots, liveness option, and failure receipts. Reads YAML; emits Markdown/TSV. Local single-user persistence and partial-run semantics do not provide tenant isolation. | `DEFER` clean-room concepts to Chunk 3 source adapters/history. No code port. |
| `scan-ats-full.mjs` | Broad ATS directory scan with caches/checkpoints, providers including undocumented Workday routes, and high concurrency. Uses external dataset inventory. | `REJECT` broad crawl; `REFERENCE` only for checkpoint/completeness tests. |
| `browser-extract.mjs` | Browser/JD extractor with text caps, empty-content guard, SSRF helpers, and Workday CXS replay. Outputs compact JSON; browser fallback may encounter challenge pages. | `REJECT` Playwright and Workday replay. `REFERENCE` empty/challenge failure shape. |
| `check-liveness.mjs` | ATS API first, then headless/headed Playwright, challenge fallback and optional jitter. Uncertain results exit nonzero. | `REIMPLEMENT` HTTP-only liveness concepts in future Chunk 3; reject browser/headed fallback. |
| `validate-portals.mjs` | YAML structure validator for portal/provider/parser fields. It validates syntax, not commercial permission. | `REFERENCE`; future source-policy schema must be database-backed and admin-controlled. |
| `verify-portals.mjs` | Provider probes, bounded request budget, owner/title checks, and partial/empty distinctions. | `REIMPLEMENT` completeness/error concepts in future adapter contract. |
| `verify-cv-facts.mjs` | Deterministic heuristic gate for unsupported metrics, employers, titles, tools, and delegated-authorship laundering. Reads source/target text; fails nonzero. Heuristics can miss semantic fabrication. | `REFERENCE`; packet schema tests adopt the fail-closed evidence-ID pattern. Resume fact generation remains existing Word pipeline work. |
| `verify-ats.mjs` | Scores generated HTML for text, fonts, contacts, columns, headings, and keywords. Advisory weighted score; self-tests embedded. | `REJECT` as eligibility or PDF proof. `REFERENCE` text-layer assertions only. |
| `eval-golden.mjs` | Replays ten labeled evaluation fixtures, checks score tolerance/archetype agreement, optionally spawns external model runs. Environment and model outputs are not deterministic in live mode. | `REFERENCE`; ApplyPack keeps deterministic synthetic fixtures and no global eligibility score. |
| `dedup-tracker.mjs` | Local Markdown tracker dedup with backup, fuzzy role matching, status ranking, and time windows. | `DEFER`; database uniqueness and versioned identity are already preferred. |
| `detect-reposts.mjs` | Parses scan-history TSV, normalizes company/title, groups changed URLs within a configurable window, emits JSON/summary. | `DEFER` clean-room model to Chunk 3 history tables. |
| `reconcile-pipeline.mjs` | Reconciles local pending Markdown against batch state/reports; now guards paths inside the repository. | `REJECT`; ApplyPack database is source of truth. |
| `archive-posting.mjs` | Playwright page-to-PDF archive with egress guard and project paths. Writes local JDs/PDFs. | `REJECT`; browser archiving and local customer data conflict with the hosted boundary. |
| `modes/scan.md` | Prompt procedure around scanners, extraction, verification, and fallback. | `DEFER`; only source-policy-approved compiled adapters may run. |
| `modes/oferta.md` | Two-pass JD-first then candidate-evidence analysis; distinguishes requirement importance source and includes work-auth/location checks, but ends in a holistic score. | `REIMPLEMENT` evidence mapping concepts in future matching work; reject global score as gate. |
| `modes/_shared.md` | Shared prompt/scoring/safety rules. Prompt text is mutable policy and not sufficient enforcement. | `REJECT`; ApplyPack uses typed hard gates plus human approval. |
| `modes/intake.md` | Local conversational profile collection. | `REJECT`; ApplyPack's completed four-step intake stays authoritative. |
| `modes/triage.md` | Compact prompt triage with conservative disqualifiers and no writes. | `REFERENCE`; not customer-facing or an eligibility authority. |
| `modes/calibrate.md` | Reads local outcomes and explicitly avoids auto-tuning with small samples. | `REFERENCE`; possible later analytics, no current code. |
| `modes/patterns.md` | Outcome/channel analysis with sample floors and causal-humility instructions. Reads sensitive local history. | `DEFER`; any hosted analytics needs privacy approval and tenant isolation. |
| `modes/pdf.md` | Generates ATS resume HTML/PDF with self-hosted fonts and Playwright, plus Canva option. It can create a second independent resume layout. | `REJECT`; ApplyPack resumes/letters remain Word-first. Text-layer and no-fabrication tests are `REFERENCE`. |
| `templates/portals.example.yml` | 2,651-line mutable catalog covering many sources; permits explicit provider selection and a local parser command/script contract. Technical presence does not establish permission. | `REJECT` import. Future registry is compiled/admin-controlled and source-policy gated. |
| `docs/AUTOMATION.md` | Local cron/launchd/Task Scheduler recipes. Assumes a trusted personal checkout. | `REJECT`; hosted queue/lease operations require ApplyPack controls. |
| `providers/local-parser.mjs` | Uses `execFile`, in-repo path checks, and interpreter rules, but YAML still chooses an executable/parser path. | `REJECT`; customer or mutable config never selects executable code. |
| relevant tests/fixtures | Extensive Node tests for providers, SSRF, timeout, liveness, fact gates, dedup, reposts, Windows, and PDF; some files use internal logging without throwing. | `REFERENCE`; translate only applicable invariants into first-party tests. |
| `.github/workflows/test.yml` | Quick matrix on Ubuntu/macOS/Windows plus visual CV and upgrade gates; scripts disabled for install. | `REFERENCE`; cross-platform and visual separation are useful. |
| `.github/workflows/codeql.yml` | JavaScript/TypeScript and Go CodeQL. | `REFERENCE`. |
| `.github/workflows/dependency-review.yml` | High-severity dependency review is configured but `continue-on-error: true`; it is not a blocking gate. | `REFERENCE`; do not overstate security maturity. |
| `.github/workflows/sbom.yml` | Generates an SPDX SBOM on release. | `REFERENCE`. |
| `SECURITY.md` and issue #132 | Coordinated-disclosure policy. Public issue #132 documented prior injection, SSRF, path traversal, and data-backup exposure; current code includes several mitigations. | `REFERENCE`; local-tool mitigations do not prove hosted safety. |

## Observed tests and supply chain

Commands run in a disposable detached clone with synthetic repository fixtures only:

- `npm install --ignore-scripts --package-lock=false`: 6 packages added; 0 npm advisories; Chromium postinstall did not run.
- `npm run lint`: interrupted after more than 60 seconds on Windows while spawning `node --check` for every MJS file; no verdict.
- `node test-all.mjs --quick`: not reached because the combined command remained in the syntax scan and was interrupted.
- Targeted `node --test` across liveness, extraction, fact gates, reposts, dedup, reconciliation, timeout, and SSRF: outer harness 28/28 subtests passed in 158 seconds.

The targeted run also printed two internal red-cross assertions (`check-liveness --help exits before file read` and `detect-reposts --self-test exits 0`) while the containing Node test files still reported success. This is a test-quality warning: internal assertion logging does not always fail the outer harness.

Direct packages at the pinned commit: `@google/generative-ai ^0.24.1`, `dotenv ^17.0.0`, `js-yaml ^5.3.0`, and `playwright 1.62.1`. Risks are the absent root lockfile, three floating ranges, browser download postinstall, large provider/network surface, optional agent/model processes, and local config-driven parser execution. No CareerOps package is added to ApplyPack.

The material targeted files were named and inspected individually:

- liveness/extraction: `tests/check-liveness.test.mjs`, `tests/liveness-core.test.mjs`, `tests/browser-extract.test.mjs`, and `tests/browser-extract-flags.test.mjs`;
- fact gates: `tests/cover-fact-gate.test.mjs`, `tests/nonmetric-fact-gate.test.mjs`, and `tests/fact-gate-language-coverage.test.mjs`;
- freshness/dedup/reconciliation: `tests/detect-reposts.test.mjs`, `tests/scan-url-dedup.test.mjs`, `tests/scan-company-role-dedup.test.mjs`, `tests/scan-dedup-snapshot.test.mjs`, `tests/merge-tracker-url-dedup.test.mjs`, and `tests/reconcile-pipeline-flags.test.mjs`;
- failure/security: `tests/providers/http-timeout.test.mjs`, `tests/tracker-busy-timeout.test.mjs`, `tests/providers/ats-ssrf-hardening.test.mjs`, and `tests/run-failure-diagnostics.test.mjs`;
- PDF/Windows evidence reviewed separately: `tests/generate-pdf-page-budget.test.mjs`, `tests/generate-pdf-workspace-root.test.mjs`, `tests/cv-section-order.test.mjs`, `tests/rename-contention-family.test.mjs`, and `tests/pipeline-lock-mkdir-eperm.test.mjs`.

## Relevant issue and pull-request survey

The issue/PR survey was refreshed on 2026-09-04. Items opened after the pinned code commit are operational evidence, not claims about the exact pinned tree.

| Area | Public evidence | Audit consequence |
| --- | --- | --- |
| stale data | issue [#163](https://github.com/career-ops-hq/career-ops/issues/163) documented expired/cached postings escaping batch freshness checks | Retain explicit verification timestamps and fail closed; do not treat liveness silence as freshness. |
| security | issue [#132](https://github.com/career-ops-hq/career-ops/issues/132) documented injection, SSRF, path traversal, and permission defects | Treat job text/URLs as hostile and reimplement bounded egress and validation; never import the local execution surface. |
| matching | open issue [#3639](https://github.com/career-ops-hq/career-ops/issues/3639) reports ordinary prose misclassified by the fact gate; PR [#3656](https://github.com/career-ops-hq/career-ops/pull/3656) narrows another false positive | Heuristic fact checks require evidence-linked output plus human review; they cannot independently establish truth. |
| dedup | open issue [#3750](https://github.com/career-ops-hq/career-ops/issues/3750) reports company/title dedup dropping location variants; PR [#3446](https://github.com/career-ops-hq/career-ops/pull/3446) addressed multi-URL requisitions | Preserve location and source identity in dedup keys; prove lossless variant handling with fixtures. |
| PDF | issue [#3640](https://github.com/career-ops-hq/career-ops/issues/3640) exposed conflicting section-order authorities; PRs [#3642](https://github.com/career-ops-hq/career-ops/pull/3642) and [#3647](https://github.com/career-ops-hq/career-ops/pull/3647) corrected ordering and fact-gate sequencing | ApplyPack keeps one Word authority for resumes/letters and a separate reviewed packet template; no independent resume PDF layout. |
| scan receipts | PR [#3532](https://github.com/career-ops-hq/career-ops/pull/3532) added machine-readable scan receipts; PR [#3589](https://github.com/career-ops-hq/career-ops/pull/3589) pinned writer/reader agreement | Future adapters need versioned receipts and reader/writer contract tests, not console-only success. |
| Windows | open issues [#3788](https://github.com/career-ops-hq/career-ops/issues/3788) and [#3809](https://github.com/career-ops-hq/career-ops/issues/3809) document native-process crashes and empty-output false health | Child-process success, empty output, and cross-platform behavior need explicit test or error states; this is another reason to reject browser scanning. |
| path safety | PR [#3511](https://github.com/career-ops-hq/career-ops/pull/3511) fixed scanner state resolving against cwd; PR [#3418](https://github.com/career-ops-hq/career-ops/pull/3418) fixed quoted/renamed Git paths | ApplyPack state remains database-owned and path handling must use canonical, typed boundaries. |

## Source-access correction

Technical feasibility and paid commercial permission are separate. This addendum supersedes the earlier broad contract phrase that included Himalayas among approved sources.

| Source | Technical state | Commercial policy state | ApplyPack state |
| --- | --- | --- | --- |
| Lever Postings API | Public structured API | Approved only under recorded source policy and tests | Production candidate; existing enabled employers remain bounded |
| Workable XML | Structured feed | Requires attribution/terms record | Production candidate after implementation/tests |
| SmartRecruiters public Posting API | Public structured API | Requires source policy evidence | Production candidate after implementation/tests |
| We Work Remotely RSS | RSS | Attribution and link-back required | Production candidate after implementation/tests |
| Remote OK API | Public API | Attribution, sanitization, geography and destination verification required | Production candidate after implementation/tests |
| Greenhouse public board | Technically feasible | Written permission/legal determination missing for paid display | Disabled policy gate only |
| Ashby public postings | Technically feasible | Written permission/legal determination missing for paid display | Disabled policy gate only |
| Himalayas | Technically feasible | General terms prohibit commercial use/automated extraction without written approval | Permission pending; not approved |
| TheirStack | Vendor/API feasible | Contract must cover paid display, retention, evidence, exclusions, links and termination | Permission pending |
| Indeed and HiringCafe | Human discovery leads | Automated collection not approved | Human-assisted only; resolve to permitted official record |
| Workday CXS, Playwright scanning, stealth/CAPTCHA/proxy bypass | Technically possible | Undocumented or prohibited/high-risk | Rejected initially |
| Liveops aliases, redirects, employers | Irrelevant | Explicit contract exclusion | Blocked on every path |

A future source-policy record must include provider, access class, environment, permission evidence, terms review, commercial/display rights, attribution, retention, evidence, link semantics, rate/completeness budgets, parser version, kill switch, owner, and review date. A compiled adapter must expose pagination/completeness, provenance, validation, liveness/direct-link verification, dedup identity, retries, rate limits, safe removal, metrics, and structured errors. None of this discovery work is implemented on the pdfcn branch.

## Bounded repository gap audit

Seven materially distinct or potentially relevant candidates were pinned. Superficial clones were not counted twice.

| Repository and pinned commit | License/activity/relevant files | Maturity, security/permission posture | Disposition |
| --- | --- | --- | --- |
| `poferraz/career-ops@c1641ac5340956be4418fe39323daaac9c843474` | MIT; last commit 2026-03-23; 38 files; agent skill and references; no test paths | Prompt/reference project, not a hosted service | `REFERENCE` only |
| `Malik1942/job-agent@b859ab6aadb7ecbc61d79bbd54dc1c33f060e25f` | No root license; last commit 2026-07-30; Python ATS sources and form filler; test scripts | Strong hold/review ideas but explicit auto-submit/browser paths; no reuse rights established | `REJECT` code reuse and auto-apply; `REFERENCE` hold concepts |
| `bonus414/job-scanner@292e530e843b13524c28e4ca5bdeb2d44ba58ca2` | MIT; one 2026-05-04 commit; 11 files; `scan.py`, `sources.py`, SQLite dedup; no tests | Small personal scanner; no tenant/completeness/permission system | `REFERENCE` minimal HTTP separation |
| `jordanmilner-lgtm/strategic-copilot@0906fced57740441003532d550a7dca7c4c27a1a` | No license; last commit 2026-08-04; 15 files; GitHub Actions, Google Sheets, Anthropic scorer; no tests | Cloud secrets and single-sheet workflow; no reuse rights | `REJECT` |
| `narendranathe/tailor-resume@15f0e2d93a4374f2f070c0755d02f86eb4379df0` | Root Apache-2.0 (README says MIT, a conflict); last commit 2026-08-14; 189 files, 60 test/fixture paths | Deterministic parsing/gaps and visible-failure ideas; separate LaTeX resume path conflicts with Word-first | `REFERENCE`; no renderer import |
| `KaustubhTrivedi/rendure-v2@e4195b0409ef762c946eee821965a579dda16b7f` | Apache-2.0; last commit 2026-07-07; 301 files, 36 test paths; Postgres versions/events and QA | Useful immutable review/version concepts; shared browser-exposed API key and Jina/OpenRouter paths are not multi-tenant controls | `REFERENCE`; existing ApplyPack artifact model is stricter |
| `moshehbenavraham/jobhunt@f1caa83125136a7e52e601c4bb9af72f11346893` | MIT; release commit 2026-07-29; 751 files; TypeScript API/operator surfaces and PDF tools | Material CareerOps derivative; relevant review UI but not independent source evidence | `REFERENCE` only; excluded from architecture count as derivative |

## Phased plan and exact boundaries

- Current pdfcn/document pilot: `src/lib/documents/job-match-packet/**`, `src/lib/documents/pdfcn/**`, the protected routes, migration `202609040024_pdfcn_job_match_packet.sql`, and their unit/integration/rendering evidence only. No CareerOps code, provider, crawl, or source-policy runtime is present.
- Future Chunk 3 only after a separate authorization:
  - add a new forward migration named for job-source access policy, with `ap_source_access_policies`, immutable scan receipts/history/provenance, admin-only policy mutation, and Greenhouse/Ashby disabled by default;
  - add `src/lib/jobs/source-access-policy.ts`; extend `src/lib/jobs/adapters/types.ts`, `fetch-policy.ts`, `index.ts`, and `source-registry.ts`; add separate compiled adapters for Workable, SmartRecruiters, We Work Remotely, and Remote OK;
  - add `tests/unit/source-access-policy.test.ts`, extend `tests/unit/source-adapters.test.ts` and `source-registry.test.ts`, and add `tests/integration/job-source-access-policy.sql` for permission evidence, pagination completeness, link provenance, rate/timeout failures, disabled providers, dedup variants, and kill switches;
  - use database policy rows as the environment-scoped enable/disable control. The rollback boundary is a reviewed forward migration that disables all new providers first and preserves receipts/audit history; it must not drop evidence after production use.
- Future matching work only after its own approval: extend `src/lib/jobs/types.ts`, `schemas.ts`, `filter.ts`, and `rank.ts` with JD-first requirement/evidence mapping; add deterministic golden inputs under `tests/fixtures/matching-evidence` and assertions in `tests/unit/evaluation-contract.test.ts`. Global scores remain post-gate ranking signals only.
- Future document work: keep `src/lib/documents/generate.ts` Word-first for resumes/letters; reuse only deterministic fact-gate test concepts. Any new artifact enters through `DocumentRenderer` and a separately versioned, reviewed template.
- Explicit exclusions from every future phase: CareerOps package/scripts, Playwright or Chromium scanning, CAPTCHA/stealth/proxy bypass, model-authored policy, browser-held customer data, and an independent resume/cover-letter PDF layout.

## Evidence classification

Implemented facts are in source/tests/migration and the pdfcn evidence record. CareerOps and comparison findings are research evidence. Source permissions are policy decisions from the binding addendum, not inferred from code. Repository activity and licenses were recorded from pinned Git/GitHub data. README statements are labeled claims unless corroborated by code or tests.

Independent skeptical review is required before this branch is accepted; its verdict is appended to the implementation evidence, not self-issued here.

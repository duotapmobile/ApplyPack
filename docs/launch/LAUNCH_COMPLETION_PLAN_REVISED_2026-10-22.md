# ApplyPack Launch Completion Plan — Revised

Date: October 22, 2026  
Status: proposed execution plan; NOT READY remains the launch verdict.  
Purpose: replace the supplied plan's execution sequence and clarify its acceptance criteria. This document does not authorize implementation, provider changes, payments, migration application, or public activation.

## 1. Verified starting point and authority

Read-only verification found:

- Canonical root: `C:\Users\mskir\Desktop\Apply_Pack\applypack-production-v2`.
- Origin: `https://github.com/duotapmobile/ApplyPack.git`.
- Branch: `codex/manual-launch-hardening-2026-10-02`.
- HEAD: `a3de4a447d499fb7d416e1a1d167e281372903b2`.
- Working tree: four modified files and thirteen untracked entries; some entries are directories. Record their actual file inventory and hashes when execution begins. Do not treat “17 entries” as an enduring file count.
- Latest local migration: `202610190084_legacy_board_terminal_event_ordering.sql`. The hosted ledger was not queried during this review.

The supplied audit findings are inputs to this plan, not new provider verification. Do not claim “no P0,” a successful backup, deployed schema, provider identity, or passing test without its evidence. Reverify drift-prone facts at execution time. A new reviewed release candidate is required; the current SHA is the baseline, not the approved launch candidate.

Authority remains repository `AGENTS.md`, then amendments 16, 14, and 12 for their respective subjects. Historical subscription/pricing material does not override the manual launch. This plan adds no CPA/tax-opinion gate and makes no tax-law determination.

Preserve the protected `site` checkout and all pre-existing changes. Record any overlap and prepare a separate patch for review; do not overwrite, stage, stash, reset, or clean user-owned work. Existing authorization should be honored without asking twice. Deploy only reviewed committed source, never the dirty directory.

## 2. Fixed customer contract

- Job Match Search: $18.99 total, exactly ten distinct, current, permitted, human-reviewed opportunities, within 24 clock hours of successful payment. Complete and confirm the required intake before inviting payment.
- Apply Pack: $7.99 per eligible selected delivered job, one truthful tailored resume and one cover letter, within 24 clock hours after successful payment and completion of required job-specific inputs.
- One search and two Apply Packs per rolling 24 hours. A refund does not automatically erase consumed capacity.
- Invitation-only search checkout. No subscription, public job board, automatic application, ranking guarantee, or automated employer-source schedule.
- USD one-time charges; fixed totals; Stripe automatic tax disabled; no added fees or tax. Historical $20/$8 records remain immutable and reconciliation-only.
- PDF is normal delivery. Genuine DOCX requires an approved exception and immutable provenance under amendment 14; an applicant preference cannot override an employer prohibition.
- Liberation Sans 2.1.5, all four byte-pinned faces, no substitution; current renderer approval must be re-established after migration 081.
- Exact-ten failure, corrections, conflicts, replacements, retention, and historical downloads retain their existing approved remedies and boundaries.

## 3. Execution register and approval boundaries

Before execution, create one register. Every item needs an ID, accountable owner, prerequisites, action, expected observable result, evidence location, blocking severity, and status: NOT STARTED / RUNNING / PASS / FAIL / BLOCKED / ACCEPTED LIMITATION. A blocked test is never a pass. Record actual people against the Engineering, Operations, Security, Product, Accessibility, and Release Owner roles below.

Use one consolidated preflight for genuinely unresolved access, business decisions, and external actions. Record already-granted authorization and its scope. Credential entry, MFA, live card entry, human document approval, physical-device testing, and acceptance of residual risks remain human checkpoints.

| Boundary | Work allowed before approval | Work requiring scoped approval |
| --- | --- | --- |
| Staging migration | Code, SQL review, disposable database replay, backup/restore tooling | Apply the new migration to the named staging project; prior 081–084 permission does not cover 085 |
| AWS workload identity | Policy/template review and local tests | Create trust/profile/role/certificate, change operator permissions, provision billable resources |
| Production preparation | Build and test tools; prepare exact change sets, rollback package, cost estimate, target identifiers | Production AWS, database, Railway, live Stripe, secret, and DNS mutations |
| Production canary | Assemble verified eligibility evidence | Enable named-customer live purchasing and make the two authorized charges/refunds |
| Public activation | Assemble final evidence and fresh capacity check | Enable public invitation checkout |

Production authorization must precede production provisioning and live Stripe configuration. Present a concrete reviewed change set first. Approval for a locked deployment does not silently authorize live charges or public unlock.

## 4. Explicit checkout states

Implement and test this target contract before relying on it. Only one checkout mode can be active. Board checkout and automated source schedules stay false in every state.

| State | Environment / payment mode | Public | Canary | Rehearsal | Live permission | Allowed session creation |
| --- | --- | --- | --- | --- | --- | --- |
| Locked staging | staging / test | false | false | false | false | None |
| Staging rehearsal | staging / test | false | false | true | false | Exact authorized customer, product, and resource |
| Staging canary | staging / test | false | true | false | false | Exact CANARY activation and separate product authorization |
| Locked production | production / live | false | false | false | false | None |
| Production canary | production / live | false | true | false | true | Exact approved canary customer and product |
| Public invitation checkout | production / live | true | false | false | true | Invited search or eligible delivered-job purchase |

Separate provider configuration, infrastructure readiness, live-charge permission, and session authorization. Today `commerceConfigured` depends on live permission in `src/lib/stripe/mode.ts`; that must be resolved explicitly so locked production can be healthy before live purchasing is authorized. Read-only Stripe verification and reconciliation must work while new checkout is locked. Every live session-creation path must still require live permission.

`/api/live` proves process liveness. `/api/health` proves dependencies and exact deployed identity. `acceptingOrders` should be explicitly defined as public order acceptance; a separate canary/rehearsal status and negative purchase probes must show restricted modes. A false public-acceptance field alone does not prove that no checkout is possible.

Transitions go through locked state: disable the previous mode, expire/reconcile outstanding sessions, close unused authorizations, verify all deployed instances, then enable the next authorized mode. Test old/new instance overlap during redeployment. All unknown, missing, mixed, wrong-host, wrong-environment, wrong-SHA, and wrong-Stripe-mode combinations fail closed.

## 5. Build the candidate and remove bootstrap dependencies

Engineering owns these deliverables; Security and Operations review the relevant changes.

1. Add a forward-only staging rehearsal migration, provisionally 085. Recheck the migration inventory first; never collide with another migration or rewrite published 081–084. Update runtime schema readiness, generated types, tests, migration runners, and rollback compatibility together. Add a separately reviewed schema-084 backup/restore path and exact-hash single-085 staging runner: the existing safeguard expects schema 080 with 081–084 absent, and the existing runner permits only 081–084. Preserve that historical path rather than weakening its binding checks.
2. Add private service-only rehearsal records and admin create/revoke endpoints with fresh TOTP, same-origin protection, auditable actor, exact customer/product/resource/SHA binding, expiry no longer than 30 minutes, and durable usage history. No browser role may read or write these records.
3. Permit rehearsal only on the approved staging hostname/project, with test Stripe credentials, fixed 1899/799-cent prices, live permission false, and public/canary false. It must not create a launch activation or approve sales. Rehearsal bypasses only the final activation-evidence dependency; it still requires real file safety, KMS, renderer, capacity, consent, inventory, payment, and authorization controls.
4. Implement a durable checkout attempt across database and Stripe. Persist the unique attempt, resource binding, reservation, and idempotency key before calling Stripe. Bind exactly one provider Session. On a lost response, reconcile or retry that same attempt/key; never create a second intent merely because the client timed out. Verify webhook-before-response, crash-after-session-create, revoke/create races, and simultaneous retries.
5. Separate authorization-to-initiate expiry from the provider Session deadline. Define how reservation, invitation, authorization, and Session lifetimes interact. Expiry or revocation blocks new attempts; it must also trigger bounded expiration/reconciliation of an already-created Session. A paid-in-the-meantime event must remain accounted for and fulfill or refund under the approved policy. Do not drop a valid payment event because the initiating authorization has since expired.
6. Repair public/canary/rehearsal Stripe access without a general checkout bypass. Prefer one shared purchase path with a narrow mode-specific authorization decision.
7. Extend Railway IaC, validation, rollback receipts, environment examples, and tests with every active launch variable: all mode flags, expected SHA, AWS region/KMS context, worker version ARN/environment, image and four-face font identities, renderer/parser identity, preflight/probe/network hashes, temporary bucket/prefix, email verification time, manual scope, capacity, and maintenance settings.
8. Replace obsolete test-mode instructions with the canonical checkout, current fixed prices, manual inventory, and restricted rehearsal. Remove executable directions to use the protected `site` checkout, old prices, public checkout, or automated source discovery. Resolve README and duplicate maintenance-config drift; select and verify the actual configuration used by each service.
9. Add current readiness reporting; preserve `/api/health` plus provider receipts as the operational evidence. Fix truthful sitemap modification dates, retired board route behavior, and private/staging indexing without changing the design or reviving historical products.
10. Build and review the production backup/migration runner, bound to exact project/host/CA, credential target, release, expected ledger, and migration hashes. Reject staging and unknown states. Test its engine against fixtures and isolated recovery targets without bypassing the production target guard or using production credentials.

Stripe supports idempotent retries, but the application's attempt state must still reconcile database/provider disagreement. See [Stripe idempotency](https://docs.stripe.com/api/idempotent_requests).

Stripe's Session expiration must be 30 minutes to 24 hours after Session creation. Copying a 30-minute authorization expiry into `expires_at` after a delay is therefore invalid. Test that delayed initiation explicitly and retain the separate authorization/session/reservation rules above. See [Stripe Session creation](https://docs.stripe.com/api/checkout/sessions/create).

## 6. Validate, freeze, and identify the release

Run the supplied local gates with their actual prerequisites documented: `npm ci`, lint, typecheck, unit tests, integration, database, document render, rollback, database-type drift, build, browser tests, and production dependency audit. Include Railway IaC validation/tests and AWS worker template validation. Verify zero skipped required tests as well as zero failed tests; zero critical/high production dependency and image findings.

From the canonical checkout, after documenting Node/npm, Docker/Supabase, browser, pinned rendering-tool, and rollback-target prerequisites:

```powershell
npm.cmd ci
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:integration
npm.cmd run test:database
npm.cmd run test:document-render
npm.cmd run test:rollback
npm.cmd run types:database:check
npm.cmd run build
npm.cmd run test:e2e
npm.cmd audit --omit=dev --audit-level=high
npm.cmd run validate:aws-document-worker
```

These are planned commands, not results from this plan review. Run hosted tests separately after staging is ready; fixture-mode browser tests cannot satisfy the provider-backed acceptance matrix.

Add missing required jobs to clean CI. The current workflow runs on pull requests and pushes to `main`; pushing only the named release branch does not trigger it. Use a pull request or a reviewed release-branch/manual trigger. Record the tested commit, including whether CI ran a synthetic merge commit, and prove the actual deployment candidate received the required checks.

Database coverage: clean replay through the new migration; upgrades from 080, 081, 082, 083, and 084; existing historical-preservation and 074–076 consent cases; atomic inventory identity; delayed refund/dispute ordering; service-only grants/RLS; no invalid indexes. Run destructive local reset/replay jobs serially against disposable databases, never a hosted environment.

Freeze one candidate after fixes pass. Record an immutable release manifest containing:

- Full Git SHA, CI URLs, lockfile/build identity, worker image digest/version ARN.
- Migration identifiers and hashes; legal-content/consent versions and hashes.
- Font manifest, renderer/parser identity, network/probe/approval receipts.
- Environment and provider account/project/service identities.
- Sanitized configuration digest and explicit allowed phase transitions.
- A tested compatible rollback SHA or a reviewed forward-recovery-only strategy.

Keep execution evidence in a versioned evidence bundle referencing the candidate. Do not embed the candidate's own final hash into its source or continually commit proof files into the deployment candidate, creating an endless SHA/review cycle. Phase flag changes receive their own configuration/deployment receipts; they do not masquerade as unchanged deployments.

Define evidence invalidation: a code/schema/worker/font/legal/identity change invalidates affected proof and requires a new reviewed manifest. Reuse unaffected evidence only with a documented dependency assessment. Expired operational proof must be refreshed even when the SHA is unchanged.

## 7. Prepare staging in parallel, then deploy in dependency order

After local/CI acceptance, approved database work, AWS provisioning, provider setup, and manual inventory preparation may proceed in parallel. No journey runs until their dependencies converge.

### Database and recovery

Read the hosted ledger; do not assume 081–084 were applied because they exist locally. If the expected predecessor differs, stop for a state-specific plan. After approval, quiesce all relevant writers, create the governed encrypted backup, perform the isolated restore drill, then apply only the authorized missing migration. Keep writers stopped through schema verification and preserve sanitized receipts.

A lost connection or missing receipt after migration starts is an unknown outcome. Inspect the ledger/checkpoints read-only before any retry. No migration repair, historical rewrite, destructive rollback, or blind rerun.

The recovery plan must cover database rows **and actual private file objects**, object versions/hashes, application envelope keys, protected configuration, auth dependencies, and the ability of the recovery operator to decrypt. Supabase database backups contain Storage metadata, not the objects themselves. See [Supabase backup scope](https://supabase.com/docs/guides/platform/backups).

Use two explicit recovery tests: an isolated structural database restore; then an authorized protected recovery environment proving customer access, valid document download, wrong-user denial, and key access. Disable outgoing mail, live payment calls, external callbacks, and scheduled writers in the recovery environment. Record backup age, completeness, restore duration, and numeric accepted recovery-time/data-loss targets. Confirm the backup remains recoverable if the original machine or operator credential is unavailable. Restore drills must respect retention/deletion obligations.

### AWS workload and document worker

Reverify the intended account `838445019912`, `us-east-1`, foundation stack, KMS key, and budget controls from provider evidence before mutation; these identifiers are targets, not proof of current access.

Use the supplied IAM Roles Anywhere design with an offline CA, separate staging/production trust and workload identities, pinned signing helper, sealed leaf material, restrictive ephemeral files, one-hour sessions, and leaf rotation at least every 30 days. Add explicit certificate issuance/rotation/revocation ownership, expiry alerts, helper failure tests, and runtime identity verification. Prove credential refresh across session expiry and failure closed after revocation; measure any existing-session lifetime rather than promising instantaneous revocation. The CA private key stays offline. See [AWS credential helper](https://docs.aws.amazon.com/rolesanywhere/latest/userguide/credential-helper.html).

Separate the Railway caller role, Lambda execution role, and provisioning operator role. Grant each only its needed exact key/context, temporary prefix, and versioned function access. Prove production-resource and unqualified-function denials safely. Replace broad human provisioning permissions only after scoped replacement/recovery access is proven.

Build from the frozen candidate; scan and pin the image, parser, renderer, and four fonts. Deploy the versioned worker in private subnets with no public/default internet egress, S3 endpoint-only data access, private temporary storage, and one-day lifecycle defense. Start from the proposed 512 MB/30-second/1 GB/concurrency-two limits; prove the maximum supported document succeeds within them before accepting those limits. Fail oversized/hostile inputs safely.

Prove extraction/rendering, KMS round trip and wrong-context denial, network isolation, success/failure/timeout cleanup, and durable cleanup after process loss. A one-day lifecycle rule is not proof of immediate cleanup. Human-review both document outputs and record fresh post-081 approval against the final manifest.

### Providers and manual inventory

- Stripe: separate test resources, current one-time USD prices, automatic tax off, signed webhook, historical prices inactive for new sales, wrong mode/amount/product/quantity/signature denial.
- Email: verified sender and reply-to; SPF/DKIM/DMARC; allowlisted staging recipients; OTP, receipt, started, delivery, refund, bounce/failure and retry proof; fresh verification time.
- Admin: actual Supabase TOTP enrollment/recovery; non-admin, AAL1, stale-factor denial and fresh-factor success. Do not place MFA or recovery material in evidence.
- Inventory: ten suitable permitted real opportunities for the actual test profile, documented authorization/source basis, immutable minimal snapshots, human review, immediate prerelease reverification, and duplicate-history checks. Synthetic listings support UI tests only.
- Operations: configure the 15-minute schedule, external alert destination, retry/lease limits, cleanup dead-letter handling, and deadline monitoring. Explicitly choose and test the heartbeat-age threshold; current runtime defaults to 90 minutes, so changing the schedule alone does not tighten outage detection. Record a named responder and recovery instructions.

### Deployment order

1. Deploy locked web from the reviewed Git source and exact candidate; set expected SHA and verify all lock flags and target identities.
2. Require `/api/live` 200. A dependency-related `/api/health` 503 is acceptable only during this controlled bootstrap.
3. Deploy/start same-candidate maintenance after the correct web version is available. Prove a successful run, then two scheduled 15-minute cycles, heartbeat freshness, and delivered stale/failure alert. Confirm that deadline/refund/cleanup processing continues during a checkout hold.
4. Verify every dependency, legal binding, capacity pool, inventory, and renderer approval. Require `/api/health` 200, exact candidate identity, `commerceConfigured=true`, and public acceptance false.
5. Prove direct checkout returns the locked response with no Session, ledger intent, or reservation created. Capture Railway deployment IDs and allowlisted non-secret values (flags, mode, SHA); record secrets by name/presence/version reference only. Names alone cannot prove a flag is false.

## 8. Staging acceptance, then pre-canary review

Use three isolated synthetic customer accounts, safe synthetic resumes, real permitted job evidence, and allowlisted email recipients. Create separate just-in-time authorizations for SEARCH and MATERIALS. Keep public/canary/live false during rehearsal.

Schedule the one-pack and two-pack purchase scenarios across legitimate rolling capacity windows or separately authorized staging environments; together they require three units against the two-per-24-hour limit. Separate customer accounts do not create extra global capacity. Plan the repeated-search and canary scenarios the same way. Do not raise launch limits, delete paid history, or promise an overnight completion schedule to bypass these constraints.

The hosted suite must prove observable UI, database, and provider results for:

| Area | Required acceptance |
| --- | --- |
| Search | Four-step intake, safe extraction, factual confirmation, exact consent receipt, feasibility, atomic reservation, one invitation, 1899-cent payment, webhook-only activation, immutable deadline, ten current distinct matches, human release, portal/email delivery |
| Apply Packs | One-pack purchase and two-pack cart at 1598 cents; server-validated distinct eligible jobs; all-or-nothing capacity admission; two independent orders/documents/deadlines where applicable; incomplete inputs handled under the approved clock rule |
| Corrections and conflicts | One factual-correction round within the approved three-calendar-day window; ineligible/late denial; “Not for Me” without automatic replacement; verified non-negotiable conflict and eligible no-charge replacement; original delivery history preserved |
| Exact-ten history | Cross-field URL/requisition/fingerprint duplicates; jobs already delivered to that same account excluded from later searches, including replaced originals; concurrent search/replacement admission remains safe; no quota filler; full service-failure refund when ten cannot be delivered |
| Documents | Human factual/content/rendered-page approval; normal PDF and all approved genuine-DOCX exception paths; immutable applicant request and employer-rule precedence; precise released file version; approved font manifest; extracted text/order, headings/lists, metadata, filenames and applicant/job binding; usable historical files |
| Isolation and links | Owner succeeds; wrong user/version, absent version, expired session, stale reauthentication, revoked/superseded version and expired link fail as specified. Distinguish new-link authorization from an already-issued signed URL; prove its expiry/revocation behavior rather than assuming instant revocation |
| Payments and races | Serial/concurrent webhook replay; duplicate requests; out-of-order refunds/disputes; provider/database crash boundaries; cancelled/expired Session; price/mode/quantity tampering; expiration/revocation races; no duplicate charge/order/capacity/deadline/email |
| Failure recovery | Worker timeout/retry, crash cleanup, email bounce/retry, stale claims, missed heartbeat/deadline, refund reconciliation, retention deletion and failed-deletion alerts, restored pending paid work; no sensitive content in logs/traces/evidence |

Prove deadlines from provider payment time and the later required-input completion time where applicable, including delayed/replayed webhooks and daylight-saving display changes. Test job closure before purchase and after payment. Distinguish ordinary service-failure/unfinished-work refund rules from the special completed-delivery canary refund; the canary mechanism must not become a general refund bypass.

Run keyboard-only public/customer/admin flows, NVDA/Chrome, VoiceOver/mobile Safari on a physical iPhone, Stripe handoff/return, 320 CSS-pixel reflow, 200% text and 400% browser zoom, forced colors, reduced motion, focus, labels/errors/status announcements, contrast, touch targets, and generated-document visual review. Record device/browser versions and scenario results. Browser emulation does not satisfy the iPhone requirement.

Verify public metadata/canonicals/schema; no JobPosting; public sitemap only with truthful dates; retired board purchase/CTA/routes stay retired while legitimate immutable historical access remains protected; private pages noindex; staging globally noindex.

Disable rehearsal after testing, block new attempts, reconcile/expire unused Sessions, close unused authorizations, and account for every reservation. Do not erase paid history to free capacity.

**Before creating the first staging CANARY activation**, complete accessibility and recovery evidence plus four phase-specific reports: product/workflow/commerce; security/privacy/payments/isolation; accessibility/SEO/operations/recovery; independent tenth-man challenge. Each receives the supplied plan's two independent supervisor reviews, with no self-review. Their conclusion is “eligible for restricted canary,” not “production canary passed.”

The current activation requires these references for CANARY as well as PUBLIC. A CANARY reconciliation reference must truthfully identify the pending/test-only phase; it must not assert production refunds. Zero unresolved P0/P1; every accepted P2 has an owner, deadline, mitigation, and written acceptance.

## 9. Exercise the actual staging canary path

1. Wait for legitimate rolling capacity to be available; a completed/refunded rehearsal may still occupy the search slot for 24 hours. Do not reset paid allocations or alter production time. Local clock-controlled tests may cover boundary behavior separately.
2. Record exact-candidate staging CANARY activation using the completed pre-canary evidence.
3. Keep public/rehearsal/live false. Enable only canary.
4. Authorize SEARCH for the named customer and exact completed draft. Complete its test payment and full delivery.
5. Separately authorize MATERIALS for that customer and the eligible delivered job. Complete its test payment and full delivery.
6. Reconcile the two full test refunds. Test evidence cannot substitute for production refunds.
7. Disable canary; close unused authorizations and Sessions. Preserve successful designations and refund records. The current revocation RPC rejects already-bound successful authorizations, so prove consumed authorizations cannot initiate a second purchase or add a reviewed non-destructive closed state. Do not supersede successful designations needed by PUBLIC reconciliation.
8. Append canary results to the four reports and obtain the required reviews of changed reports. Remain locked.

## 10. Production, after scoped authorization

### A. Locked production preparation and deployment

Present the reviewed target identities, change sets, expected costs, database plan, rollback strategy, and exact release manifest. After authorization, provision separate production AWS/identity/resources, configure live Stripe and signed webhook, confirm email/DNS, and protect production secrets. Keep all checkout modes and live charge permission false.

Inspect the production ledger and data read-only before planning exact missing migrations. Test that observed upgrade path using a protected restore. Record existing paid obligations. Quiesce relevant writers and capture a final consistent backup/checkpoint; preserve/recover webhook events received during the migration window. Apply only reviewed forward migrations, inspect outcomes, and verify counts, ledger, RLS/grants/triggers/storage, legal receipts, fixed prices, and no invalid indexes.

Deploy the reviewed candidate with the actual production configuration; start same-candidate maintenance after web readiness permits. Prove production KMS/worker/renderer, email, Stripe configuration, inventory/capacity, external alerts, and backup recovery. Require `/api/live` and `/api/health` 200 at the exact SHA, with public acceptance false and no authorized session-creation path. Obtain production-delta reviews before canary.

### B. Authorized real canary

Create the production CANARY activation and obtain scoped canary approval. Enable canary and live permission only, keeping public/rehearsal false. The human enters card details for one real $18.99 search and one real $7.99 Apply Pack using separate product authorizations for the same approved customer. Complete both real deliveries, notifications, portal access, and downloads.

Issue full refunds and require successful provider refund records plus application reconciliation totaling exactly 2698 cents. Pending, failed, canceled, or unresolved refunds do not pass. Record charge/payment/refund IDs and currency, not card or customer details. Plan for refund funding and asynchronous completion; do not promise immediate card-statement settlement. See [Stripe refund behavior](https://docs.stripe.com/refunds).

Disable canary, prevent authorization reuse, and preserve the evidence rows. Append results and obtain both independent reviews of each changed report. Recheck capacity; a delivered canary may defer public opening until its rolling allocation expires.

### C. Public invitation checkout

Immediately before requesting the final unlock, verify the exact deployed release/configuration, zero P0/P1, accepted P2 register, four reports/eight reviews, reconciled live refunds, tested recovery, fresh maintenance/alerts, current inventory, renderer/KMS evidence, legacy retirement proof, available capacity, and a named operator able to fulfill the next paid deadlines.

After approval, record PUBLIC activation while checkout remains locked. Keep canary/rehearsal false; enable public and live permission in the approved configuration; deploy and verify all instances. Require healthy dependencies and `acceptingOrders=true` only while capacity and current activation permit it. Run a no-charge public intake/invitation smoke test; do not consume a scarce capacity reservation without recording its cleanup.

## 11. Stop, recovery, and first-day operations

Lock new public/canary/rehearsal sessions first; stop new invitations/reservations/intake. Expire pending provider Sessions and reconcile any payment racing with the stop. Preserve valid payment processing, refunds, retained customer access/downloads, maintenance, pending paid obligations, and audit records. Restrict a compromised file or path specifically when an incident requires it.

Stop for isolation failure, duplicate charge/job, wrong or missing document, unapproved renderer, wrong release/configuration, failed heartbeat, expired evidence, or unreconciled refund. Capture sanitized evidence and owner; no blind retry. Never reverse published migrations or delete/repurpose customer-data KMS keys.

Before migration, identify and test an actual schema-compatible rollback candidate. If none exists, label the recovery strategy accurately: locked service plus reviewed forward fix and protected data recovery. “Rollback to a compatible SHA” without a named tested SHA is not a recovery plan.

For the first 24 hours after opening, assign primary/backup responders and monitor on every maintenance cycle: paid orders and due times, reservations, exact-ten inventory, document approvals, webhook/refund backlog, failed email, worker failures, cleanup, and dependency readiness. Prove the external alert reaches its responder. Recheck before each invitation that the operator can fulfill the commitment. At 24 hours, record actual incidents and outstanding paid obligations; continue heightened monitoring if any remain unresolved.

## 12. Evidence and final verdict

Sanitized evidence bundles contain exact code/configuration/deployment identity, test counts and CI links, migration/backup/restore receipts, provider IDs, AWS role/resource/worker/network receipts, fixed-price/refund proof, email/DNS results, inventory/source/human-review receipts, browser/device/accessibility reports, review signatures, accepted limitations, and actionable recovery instructions.

Every evidence item records environment, observation time, issuer/collector, manifest reference, artifact hash, expiry/freshness rule, and what changes invalidate it. Keep a separate restricted store for encrypted backups and necessary private source artifacts. Do not put customer documents, PII, secrets, database URLs, OTP/MFA material, invitation tokens, signed URLs, raw provider errors, browser auth state, or card data in the release bundle. Scrub screenshots and traces before publication.

Report local checks, clean CI, hosted staging, production deployment, live canary/refunds, human/device acceptance, and public activation separately. Final status is exactly READY TO SHIP, READY WITH ACCEPTED LIMITATIONS, or NOT READY, with evidence and remaining owner actions. A completed plan or a green build is not a ship declaration.

## Review basis

This revision was checked against the current checkout, amendments 12/14/16, product/workflow/document authority, current release and security runbooks, payment configuration, activation migration 082, canary authorization behavior, test configuration, and CI triggers. Three parallel read-only reviewers examined plan sequencing, product acceptance, and operational recovery. No launch tests or provider-state verification were performed while preparing this document.

# Operations, accessibility, and access review — 2026-10-23

**Result: source remediation reviewed; launch acceptance remains pending.** This record does not authorize public purchasing or claim hosted, device, or recovery proof.

## Source and review boundary

- Canonical repository: `C:\Users\mskir\Desktop\Apply_Pack\applypack-production-v2`; remote `https://github.com/duotapmobile/ApplyPack.git`.
- Branch: `codex/manual-launch-hardening-2026-10-02`; base HEAD: `a3de4a447d499fb7d416e1a1d167e281372903b2`. This review concerns the preserved, uncommitted candidate working tree, not a frozen release SHA.
- Governing amendment: [October 23 sandbox validation launch amendment](../applypack/17_OCTOBER_23_SANDBOX_VALIDATION_LAUNCH_AMENDMENT.md).
- The database implementation agent independently reviewed release tooling, access/runtime changes, and operator UI authored by other agents. Its own migration 086 and database fixtures are excluded from this independent review.
- After identifying maintenance issues, this reviewer implemented the authorized fixes. The release-tooling agent separately reviewed those fixes and independently reran the 11 maintenance-runner tests. The new manual-source observation form was implemented by this reviewer; its independent UI/integration review is assigned to the release-tooling agent.
- No provider configuration, credentials, hosted data, Git commit, or publication was changed by this review.

## Confirmed findings and remediation

| Severity | Finding | Remediation and verification |
| --- | --- | --- |
| P2 | The maintenance runner accepted either allowed hostname without binding the requested environment or frozen release. A misconfigured production maintenance service could call staging or an older release. | `scripts/run-maintenance-once.mjs` now requires the exact environment-to-origin mapping and a full lowercase SHA, checks `/api/health` without credentials before POST, and verifies the same-run response identity. `src/app/api/cron/maintenance/route.ts` checks authenticated expected-environment/SHA headers against configured and actual deployment identity **before database access or diagnostic writes**. The preflight rejects an older route that cannot enforce the new headers; the route check protects against a deployment between preflight and POST. Healthy and dependency-held responses carry the captured identity. Wrong/missing environment, SHA, preflight version, and response identity are covered by tests. |
| P2 | The maintenance runner required every action to succeed, while a healthy route intentionally skipped retired board work. It could label healthy maintenance as failed. | The route explicitly reports its approved skipped actions. The runner permits only `STRIPE_RECONCILIATION` and `BOARD_RECOMPUTATION`, and only when explicitly approved in that response. Other skipped/failed actions and queue failures remain failures. Recognized dependency holds remain blocked and never report readiness. |
| P2 | Historical document links with stale authentication navigated to a raw API error without a usable sign-in return path. | Runtime remediation redirects browser downloads to the configured-origin sign-in page with a safe portal/document anchor; JSON/history requests retain a controlled 401 with a safe sign-in path. The portal offers a sign-in-again action. Review traced the route, portal, actual email-code sign-in form, and destination validator; the return anchor is preserved and a fresh code is requested. |

The reviewed remediated paths have no remaining critical/high finding. This is a scoped source conclusion, not a whole-system launch certification.

## Confirmed source behavior

### Operations and recovery

- `.railway/production.ts` defines a separate production profile, validates project/environment identity and a full source revision, requires scoped provisioning/cost-approval references, and holds purchasing flags closed. Matching web and maintenance configuration carries the expected revision. These source guards are not evidence that provider triggers, costs, resources, or production service identity have actually been approved or configured.
- Launch maintenance is configured for `*/15 * * * *` with a 45-minute freshness threshold. Runtime action diagnostics, success heartbeat conditions, failures, and recovery alerts are implemented. Two scheduled hosted cycles, failure/staleness notification delivery, and an independent response to a stopped scheduler remain unproven here.
- `scripts/check-launch-recovery-strategy.mjs`, `scripts/lib/ProductionDatabaseGuard.ps1`, and production migration/safeguard tooling separate structural validation from hosted recovery approval. Approved recovery metadata must satisfy the 240-minute restoration and 15-minute loss/reconciliation targets and bind the candidate evidence. A structurally valid manifest cannot establish measured off-machine restoration of database, private files, encryption keys, authentication, and configuration.
- The sandbox receipt verifier is exposed through `npm run verify:sandbox-launch`. Reviewed code binds read-only provider/database checks to the staging target, exact release, two prescribed purchase/delivery/full-refund graphs, and the evidence bundle. The receipt remains reviewed evidence rather than a Stripe attestation. No hosted receipt was generated by this audit.

### Customer access and operator workflow

- Historical download access requires fresh verified authentication, customer ownership of the order/item, an eligible delivered item, a reviewed historical revision, and exact historical owner/order/item paths. It bounds document size, validates the DOCX container, uses isolated structural extraction, and issues a short-lived private link. This is **structural validation, not antivirus scanning**. Existing historical records are preserved; legacy write routes remain retired.
- The invitation queue filters current completed, unconverted intakes to current eligible assessments, excludes invalidated/expired or blocked assessments, and displays active invitations. Issuance still passes the existing same-origin, fresh administrator-MFA, server-side capacity, and snapshot/assessment RPC checks. UI state is not the purchasing authorization boundary.
- The exact-ten search release UI now derives IDs from the current persisted selection, starts all five review affirmations false, requires a meaningful note, refuses invalid/non-ten/duplicate selections, and resets approval when the selected set changes. The server independently recomputes and validates the release selection and current evidence.
- The new guided manual-source observation form uses approved source choices, human-readable fields, four false-by-default live checks, and a readable final-review summary. It records the check time when all confirmations are affirmed, requires renewed checks after 15 minutes or any edit, and retains the same observation identity/time for an identical retry. Optional employer facts remain unknown when omitted. Its parent workbench integration and final independent review belong to the release-tooling agent.

### Public copy, indexing, and accessibility

- Candidate source copy uses $18.99 for exactly ten reviewed jobs and $7.99 per selected job, without new subscription offers. Production indexing is bound to the canonical production origin; nonproduction robots/sitemaps remain excluded. This does not prove the current public deployment serves that source.
- Existing browser-test sources include keyboard completion and error-focus/description checks for the intake flow, navigation focus handling, public axe checks, narrow-screen reflow, and retired-route checks. These are useful fixture-driven coverage, not a substitute for the actual hosted purchase/delivery journey.
- Some older document-flow evidence tests check only one Tab press, visible focus, or a zoomed screenshot. They do not establish complete keyboard or screen-reader usability of selection, payment, approval, reauthentication, and private downloads.

## Validation performed for this remediation

- Maintenance runner: **11/11 Node tests passed**, also independently rerun by the release-tooling agent.
- Maintenance route security: **31/31 focused tests passed**. They exercise the real release-identity helper while mocking external dependencies and prove rejection before database/alert work.
- Guided manual-source observation form: **8/8 focused tests passed**, including the final event-time freshness implementation.
- Focused ESLint checks passed for the maintenance runner/route/tests/image fixture and new guided form/tests. Focused Git whitespace checks passed; the generated database-types terminal newline was normalized without changing declarations.
- Operator exact-ten review and historical access remediations were reviewed from source and their focused test coverage. Their authors own the broader test execution record. Root owns the migration upgrade, concurrency, generated-types, image, build, and complete candidate checks.

## Launch acceptance still required

1. Freeze and validate the actual committed main SHA, hold automatic deployment triggers, deploy that exact revision with environment-specific configuration, and smoke-test live public pricing/indexing and private routing.
2. Complete the hosted sandbox journey at the prescribed prices, including sign-in/email, intake, operator invitation, exactly ten reviewed jobs, optional pack, document approval/download, full refunds, failure/retry ordering, and historical access. Refresh sandbox evidence within 24 hours of activation.
3. Observe one manual maintenance run and two real 15-minute scheduled cycles on matching source/environment; deliver and observe failure and staleness alerts and transactional messages.
4. Demonstrate measured restoration after loss of the original machine or credentials, including private files, encryption keys, authentication and configuration. Meet the 240/15 targets and reconcile every paid transaction with Stripe.
5. Have the operator review actual delivered jobs and generated documents, complete essential workflows without technical data editing, and perform full keyboard, screen-reader, and physical-phone acceptance. The first real customer's delivery requires review before invitations expand.
6. Obtain the consolidated incremental-cost approval before new paid resources, complete any unavailable provider login/MFA securely, and record the user's final go-live approval. No code-level pass substitutes for these checkpoints.

# ApplyPack Job Source Requirement and Status Register

Last updated: September 20, 2026

This is the single controlling register for the source-expansion program. Reorganization does not weaken or archive a requirement. Each requirement must end in implemented and verified, explicitly deferred with owner and reason, or conflict requiring an owner decision. Operational counts must be generated from the database and linked here rather than maintained as competing status documents.

The reviewer explicitly stated that the pasted plan's repository and staging claims were not independently confirmed. All baseline, staging, and provider claims below therefore begin unverified and require current evidence.

## Status values

- IMPLEMENTED_LOCAL: production code and focused tests exist locally.
- VERIFIED_LOCAL: applicable local validation passed.
- PENDING_BASELINE: target depends on a measured baseline.
- PENDING_STAGING: requires current staging evidence.
- PENDING_IMPLEMENTATION: accepted requirement not yet implemented.
- RECOVERED_PENDING_TRACEABILITY: original text recovered; full instruction-by-instruction implementation mapping remains open.
- DECISION_REQUIRED: a material conflict requires owner direction.

## Requirement register

| ID | Binding requirement | Implementation or evidence mapping | Test or measurement | Status |
|---|---|---|---|---|
| SRC-001 | Preserve every original instruction through a requirement traceability table; never demote instructions to a nonbinding archive. | Original 21-section sourcing assignment recovered from the attachment to Organize ApplyPack execution plan. See CHAT_REQUIREMENTS_RECONCILIATION_2026-09-20.md for exact provenance and requirement crosswalk. Missing-artifact blocker retired; exhaustive clause-level mapping remains unfinished. | Every row must resolve to implementation, verification, explicit deferral, or decision. | RECOVERED_PENDING_TRACEABILITY |
| SRC-002 | Fix false closures before inventory expansion and protect manual refresh plus legacy order-driven collection. | Current Greenhouse, Lever, and Ashby responses are bounded and are never treated as authoritative absence evidence. Manual sync no longer deactivates unseen jobs. Legacy collection records the same no-closure decision. Published as commit `f7081ecc64e79d262c1d0385c238f27323c86f6b` on `codex/production-code-sync-2026-09-14`. | `tests/unit/job-source-lifecycle.test.ts`; source-route and workflow regression checks; full suite passed: 53 files, 347 tests, lint, typecheck, and production build. | VERIFIED_LOCAL |
| SRC-003 | Reuse approval at adapter/dataset scope where valid and reserve employer/listing review for exceptions. | Adapter scope: transport, schema, pagination/completeness, rate-limit, host, failure semantics. Employer scope: identity, tenant, permission and paid-display authority, application host. Listing scope: activity, relevance, location, pay, worker relationship, costs, and hard exclusions. | Measure automatic-pass and exception-review rates without relaxing criteria. | PENDING_IMPLEMENTATION |
| SRC-004 | Start the canary with hardened Greenhouse, Lever, and Ashby; add Recruitee and Teamtailor independently; do not let one adapter block another. | Independent adapter feature flags, health, run state, and rollback boundaries. Further adapters prioritized by measured inventory gaps. | Per-adapter contract, bounded fetch, failure isolation, and rollback tests. | PENDING_IMPLEMENTATION |
| SRC-005 | Define three scheduled cycles without accidentally waiting three weeks. | Simulated clock must execute three lifecycle transitions for every tier, including weekly Tier C. Real canary observation is bounded to 72 elapsed hours for enabled daily sources; weekly sources require one real scheduled run plus simulated later cycles. Simulated and elapsed evidence must be reported separately. | Virtual-time schedule tests and timestamped staging run records. | PENDING_IMPLEMENTATION |
| SRC-006 | Add relevance gates and set targets only after baseline measurement. | Baseline: unique eligible jobs across representative profiles, role-family and sector coverage, hard-fail reasons, unknown-field rates, freshness, discovery-to-searchability, and incremental inventory. | Publish baseline distributions first; then set targets. Never relax hard criteria to hit a target. | PENDING_BASELINE |
| SRC-007 | Preserve approved existing board feeds while preferring employer-first verification. | Existing feeds remain enabled when current documented terms authorize intended use. Employer-first controls source preference and verification, not automatic deletion. | Per-source authority and incremental-value comparison. | PENDING_STAGING |
| SRC-008 | Define freshness, failed verification, and post-purchase closure behavior. | Fresh through 24h; aging from 24h through 72h; hidden as stale after 72h without successful verification. A failed or bounded run never marks closed. Closure requires definitive provider evidence or repeated authoritative complete misses after the visibility window. Reverify before checkout and before document work, never on ordinary card open. If a job closes before paid writing begins, offer transfer or refund; after work begins, route to operator review and preserve the immutable purchased snapshot. | Simulated-time tests, failed-run tests, checkout/generation transition tests, and operator workflow evidence. | PENDING_IMPLEMENTATION |
| SRC-009 | Treat JobsPipe five jobs from three employers as an experiment, not lasting-value proof. | Also measure role relevance, verification effort, overlap with comparable direct sources, freshness, and incremental eligible inventory. | Time-boxed experiment report against the direct-source baseline. | PENDING_BASELINE |
| SRC-010 | Avoid five competing status artifacts. | Keep this register as the sole requirement/status record. Database queries generate operational counts and evidence attachments link back to register rows. | Reconcile generated counts to database state. | IMPLEMENTED_LOCAL |
| SRC-011 | First milestone is real employer jobs flowing through the scheduler into searchable inventory with safe closure and correct customer filtering. | Sequence: closure checkpoint; live baseline; independent three-adapter canary; searchable-inventory verification; customer-profile relevance measurement; only then broader discovery/adapters. | At least one permitted real employer source completes scheduled collection and yields searchable, correctly filtered inventory; synthetic data does not count. | PENDING_STAGING |

## False-closure checkpoint

Current adapters cap result sets and do not prove complete provider inventory. Therefore absence from a run is not evidence that a listing closed. Failed, rate-limited, malformed, and bounded successful runs retain unseen references. The existing freshness worker may hide records as stale after the configured window, but it must not relabel absence as confirmed closure.

A future adapter may set authoritative completeness only after pagination and provider semantics are demonstrated. Confirmed closure then requires the visibility window to expire and at least two complete misses, unless the provider returns explicit closed/unpublished evidence.

## Publication boundary

Runtime implementation and tests may be committed to GitHub. This register and research/measurement evidence stay outside the production-code-only GitHub branch unless the owner later changes that instruction. The Drive mirror is the visibility location for this register and dated evidence.

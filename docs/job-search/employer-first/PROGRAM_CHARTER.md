# Employer-first aggregation program charter

Status: implementation foundation, disabled
Owner: DuoTap LLC / ApplyPack
Last updated: September 20, 2026

## Authority

This charter organizes the approved employer-first plan. The recovered September 9 final product amendment supersedes older no-subscription/manual-discovery restrictions. See `docs/applypack/11_SEPTEMBER_9_FINAL_PRODUCT_AMENDMENT.md` and the September 20 chat reconciliation. The original sourcing assignment remains requirements input, with later explicit owner corrections controlling conflicts.

## Objective

Build a reliable, permission-aware supply of current verified employer jobs feeding both the neutral filtered subscription board and the human-ranked exact-10 service. Observation-only collection is an incomplete foundation milestone. Improve coverage and freshness without turning public endpoints, datasets, or aggregators into implicit permission and without coupling network collection to a customer's order. Preserve existing feeds when documented terms authorize their intended use.

## Three source layers

1. Direct employer retrieval: reviewed employer-specific ATS endpoints with immutable authorization, exact hosts, bounded schedules, and run evidence.
2. Discovery candidates: licensed datasets or provider results retained as quarantined leads until employer identity, official relationship, tenant, policy, and technical behavior are verified.
3. Manual research/import: human-reviewed sources and compatibility identities that never inherit automated permission.

## Product and customer boundaries

- The approved products include the neutral subscription board, standalone human-ranked exact-10 delivery, and reviewed $8 materials. No padding or automatic application submission is authorized.
- Current source collection does not yet admit jobs to the board or matching inventory; completing that verified connection is required program work.
- A public endpoint is not permission. An adapter is not authorization. A healthy endpoint is not a verified job.
- No customer PII, intake data, resume data, or application data is sent to job-source providers.
- Candidate and listing URLs are never accepted from an admin run request.
- Customer eligibility requires evidence-bound projection, current authority, freshness and profile gates. Human review is mandatory for ranked Top 10 delivery, documents and policy exceptions; it is not mandatory for every board listing. Reuse adapter/dataset approvals where valid and route exceptions for review.

## Non-goals for the foundation

- production migration, activation, merge, push, or deployment;
- source authorization or recurring schedule seeds;
- Latmay import or JobsPipe pilot traffic;
- SmartRecruiters, Workable, BambooHR, or Workday adapters;
- automatic projection into matching inventory, ranking, Top 10, paid board, or materials;
- auto-apply, application submission, or customer-data transmission;
- claims of staging, canary, or production proof.

## Definition of done

The full program is done only when all of the following are evidenced separately:

1. governance: current product authority and per-source permission decisions are approved and traceable;
2. architecture: authorization heads, schedules, isolated worker leases, adapter completeness, immutable run evidence, projection, and closure invariants pass database tests;
3. source coverage: independently roll out Greenhouse, Lever and Ashby first; Recruitee and Teamtailor do not block them. Preserve SRC-005's bounded real canary and simulated weekly cycles, reporting these separately;
4. inventory: real employer observations project through current authorization, exact provenance, immutable job snapshots, direct verification, automated policy checks and exception review;
5. customer: permitted real jobs reach searchable, correctly filtered inventory for representative synthetic profiles; the board remains neutrally sorted and Top 10 requires human comparative ranking and release;
6. operations: admin policy/health/history/quarantine/quota controls, alerts, pause/kill switch, and rollback are exercised;
7. activation: a reviewed production packet receives a separate owner approval.

The current implementation completes only the disabled foundation and operator visibility portion. The execution backlog and scorecard identify remaining gates.

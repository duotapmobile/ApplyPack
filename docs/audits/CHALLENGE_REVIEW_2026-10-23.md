# Separate launch challenge review — October 23, 2026

Status: **NOT READY.** This pass attempted to disprove operator usability and launch readiness separately from the security/payment source review. It did not perform provider writes, spending, or production activation.

Reviewer: release-tooling agent. Canonical source basis: `codex/manual-launch-hardening-2026-10-02` at `a3de4a447d499fb7d416e1a1d167e281372903b2` plus the pending launch changes. The reviewer repaired the two operator findings below after reporting them; independent database/runtime agents then reviewed those repairs. The final committed SHA must be captured by release execution.

## Findings and disposition

| Finding | Severity | Disposition |
| --- | --- | --- |
| Final search delivery required the owner to edit a JSON review checklist. The earlier suggestion query could also produce up to 30 candidates for an exactly-ten API. | P2: blocks ordinary owner operation | Repaired in `src/components/admin/admin-operations.tsx` and `src/app/admin/page.tsx`. The screen now uses the same persisted selection logic as release, displays exactly ten jobs, and requires five unchecked human affirmations plus a review note. IDs come from the displayed saved selection. |
| Essential manual source capture, requirement review, and match evaluation still required raw JSON/UUID handling in the matching workbench. | P2: blocks ordinary owner operation | Repaired in `matching-workbench.tsx`, `matching-guided-controls.tsx`, `matching-review-form.tsx`, and `manual-source-observation.tsx`. Existing server schemas and APIs remain authoritative. |
| A refreshed invitation assessment could retain an earlier local checkbox affirmation. | P2: stale human decision | Reported to the runtime author; repaired by keying state to draft, intake snapshot, and assessment. A rerender reset test covers the change. |
| A maintenance invocation could target a wrong environment/revision, and intentional retired-board skips were classified as failures. | Existing operations review finding, independently rechecked here | Database agent repaired the runner and route identity binding and narrowed dormant action handling. Independent runner checks passed 11/11. |

The separate product review also found and repaired the missing invitation queue and unconditional historical-download refusal. See `PRODUCT_WORKFLOW_REVIEW_2026-10-23.md`. This challenge pass rechecked their authorization and approval-state boundaries without treating local tests as hosted customer proof.

## Resulting owner workflow

1. Choose a saved intake and load its current evidence. Select an approved source configuration and the justified research round.
2. Record an official listing through labeled fields. Manually affirm the current employer, application, open-status, and legitimacy checks. Only a source with current manual-review permission is offered. Unchanged retries preserve the observation reference.
3. Select the newly recorded listing and its saved research round to admit it to the inventory. Record and admit it before leaving the page; the server retains the observation, while the convenience selection is local to this visit.
4. Choose the saved job and the needed review: employer requirement/candidate evidence, usefulness with five evidence-backed explanations, customer requirement, compensation, equivalent experience, listing-text correction, or a candidate question. Select exact current evidence; missing information remains unresolved. Human findings are never pre-approved.
5. Explicitly select completed reviews to calculate the match. The server computes eligibility and scoring. Complete the bounded manual research checklist through its existing form.
6. Each prepared operation freezes its inputs and requires a separate confirmation before recording. Successful writes reload the current packet and clear prior approvals. An uncertain non-idempotent write requires a reload before another operation. Final customer release remains a separate exact-ten human review.

Focused regression coverage checks schema-compatible payloads, current customer/fact isolation, no implicit approval, changed-evidence reset, exact saved review IDs, separate write confirmation, and uncertain-response handling. The existing browser tests contained no old matching-workbench JSON locators to remove; required browser coverage was not skipped. Real operator completion and assistive-technology/device acceptance remain pending.

## Reasons the service still cannot be declared launched

- A source build or local test run is not the final committed SHA, successful CI/image evidence, frozen `main`, or a matching hosted deployment. Hosted purchase/delivery/refund evidence must be produced after that freeze and refreshed within the activation window.
- Production dependency access and identity must be verified. AWS browser access and scoped inventory were subsequently verified; this does not prove production provisioning permission or runtime encryption. Production Supabase remains inactive without a usable database credential, and the connector exposes only sandbox Stripe access. Missing access does not establish that suitable paid resources do not already exist.
- The completed consolidated infrastructure quote now includes protected recovery: $160.78/month additional forecast, a $165/month planning budget and up to $10 for one drill. It remains unapproved; no paid provisioning may precede that approval. The earlier draft component estimate is superseded.
- Locked forward recovery is the selected strategy, but the four-hour recovery and 15-minute data/reconciliation targets require a measured protected recovery exercise and continuing coverage. Source-level structural recovery cannot prove either operational target.
- Sandbox receipt import is an administrator operation with fresh MFA and actual verified evidence. A fabricated payload or unchecked release flag cannot substitute for it. Final purchasing approval and the genuine first customer pilot remain pending.
- The owner must judge real documents, complete keyboard/screen-reader/physical-phone acceptance, and make the final go-live decision. No remaining limitation has been silently accepted by this review.

The release agent owns implementation, provider verification, deployment/evidence collection, and fixing failures. The human owner owns the explicitly agreed cost, document/device, and final activation decisions. These pending gates are not waived by the repaired source findings.

## Follow-up challenge: continuous recovery

The implementation review exposed a concrete operational gap: a structural database recovery check did not provide protected ongoing private-file copies. A separate capability-limited copy service, version/checksum archive transport, source inventory and signed completion, locked restore core, and readiness/alert gates are now implemented locally. A second challenge found private preview files lacked artifact-retention linkage and provider reads lacked hard wait bounds; both source defects were repaired and tested.

The protected file archive still cannot satisfy the intended deletion policy through a read-only report alone. Automatic approval review rejected adding irreversible exact-version pruning without explicit user authorization. The report preserves every archive version; historical reference/deletion/hold mapping and a verified replacement checkpoint are required before it can safely propose removing any object or manifest. There is no authorized deletion executor or successful retention cycle. Purchasing remains locked; neither 264 passing offline recovery tests nor a template with disabled profiles substitutes for this gate.

The original-machine/credential-loss exercise still needs independent provider access, actual database/PITR restoration, private-file versions, application encryption keys, auth/configuration custody and a timed restored customer download. The current restore core intentionally requires a fresh, complete source inventory; it does not claim to handle total loss of the source provider. Final committed-SHA CI, the frozen main revision and all hosted/human acceptance remain separate requirements.

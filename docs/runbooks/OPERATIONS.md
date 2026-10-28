# ApplyPack operations

Current prospective authority: [amendment 19](../applypack/19_OCTOBER_25_CONFIRMED_INTAKE_AND_SERVICE_ERROR_AMENDMENT.md) and [intake review and service-error corrections](INTAKE_REVIEW_AND_SERVICE_ERROR_CORRECTIONS.md). The workflow below is required before launch, not a claim that the current application implements it. The existing post-delivery correction path is incomplete; purchasing remains locked until implementation and acceptance pass. Earlier orders retain the rights in their accepted terms.

## Daily opening

1. Sign in with the admin account and complete MFA.
2. Review provider failures, open orders, and capacity reservations.
3. Confirm human capacity before changing either limit.
4. Work the earliest deadline first.

## Recovery status before new business

Require current file, authenticated database and verified archive-retention proofs for the exact production release/project/schema. The application warns when their source watermark is ten minutes old and holds new intake and checkout at twelve minutes, against the fifteen-minute recovery-point target. Missing or unverified proof is a hold, even when a worker reports that an upload finished. Check the independent monitor and delivered alert evidence as well as application status.

The prepared database design uses bounded protected snapshot exports paired to file checkpoints. PITR is optional only if included in the selected, approved recovery arrangement; a daily dump alone does not meet the target. Recovery still needs independent access to keys, authentication and configuration, a measured restore within four hours, and reconciliation of every paid Stripe transaction. See [protected recovery](PROTECTED_RECOVERY.md) and [database recovery](DATABASE_RECOVERY_WORKER.md).

Local archive-lifecycle code and fictional tests are approved, but hosted deletion/resources remain gated. A live maintenance fence gives affected ownership/hold/payment mutations a retryable failure and preserves verified event intake for reconciliation; do not discard an event or reset a paid deadline to clear it. Unknown archive dispatch remains locked until exact reconciliation. Never retry irreversible deletion blindly or clear the fence manually because a timer expired.

## Intake before payment

1. Accept either a source resume or guided, sufficiently complete factual answers at the existing price. A resume is optional; adequate confirmed facts are not.
2. Reuse safe extracted information to reduce repeated entry, but visibly ask the customer to resolve missing or conflicting facts. Never infer experience or turn an unknown into a claim.
3. Show a readable review of the facts, preferences, non-negotiables and document inputs that will be used. Permit edits before explicit confirmation; material changes require renewed confirmation.
4. Bind the confirmed snapshot, versioned policy and exact accepted legal receipt to the invitation and subsequent order. Do not issue an invitation until completeness and service feasibility pass.
5. Keep the confirmed baseline immutable. Operator review may identify a question for the customer; it must not silently rewrite the customer's facts.

## Job Match Search

1. Read the confirmed intake and any supplied source resume.
2. Review candidates found by the service through permitted sources, with current employer-controlled listings and traceable source evidence. Route shortages or source failures to a visible exception; routine manual research is not the target workflow.
3. Recheck each direct URL within the freshness window.
4. Record fit, requirements, concerns, location, salary when listed, and checked time.
5. Deliver only when exactly 10 complete matches pass human review.
6. Never loosen a non-negotiable without customer approval.
7. Follow `docs/runbooks/JOB_SOURCE_OPERATIONS.md` for source health, approved syncs, classification review, staleness, and Liveops verification.

## Apply Pack

1. Recheck the selected listing.
2. Prepare service-generated drafts from the confirmed factual baseline and selected job. Compare every claim with its supporting customer fact; a missing fact blocks that claim.
3. Keep genuine gaps visible.
4. Review and, where needed, edit the draft through a readable owner workflow. The customer and owner must not need to author raw JSON to complete the service.
5. Approve the content and actual rendered resume and cover letter before customer delivery. PDF is normal delivery; genuine DOCX requires the approved exception and provenance under amendment 14.
6. Release the reviewed pair atomically through the protected delivery flow, with version history, a private download and a single status notification. Generation alone never authorizes delivery.

## Correction and conflict queues

- For new orders explicitly bound to `service-error-only-v1`, accept one grouped report of an eligible ApplyPack error within the existing three-calendar-day window. Compare the reported defect with the confirmed intake, selected job, approved content and delivered version.
- Repair an attributable service error through the same case: readable report review, eligibility decision, corrected service-generated draft, owner review, private redelivery and verified resolution. If the repair is unsuccessful, keep that case open; do not charge another request or silently mark it complete.
- Customer mistakes or omissions in confirmed information, later facts, changed preferences, a new target or a new strategy are not included service-error repairs. Give a clear explanation and do not regenerate documents or create a correction entitlement for that denied request.
- Investigate ambiguous discrepancies, including parsing errors, before deciding who introduced them. A report alone does not revoke valid downloads or trigger regeneration. For a confirmed common service defect, review every actually affected artifact without rewriting unaffected packs.
- Preserve the broader factual-correction rights of historical accepted contracts. Deployment, a later login or re-consent must not narrow them.
- Criteria conflicts are decided against the criteria version captured with the request.
- A confirmed material conflict receives a replacement at no charge.
- Not for Me is a preference record, not an automatic replacement or refund.

## Never do

- Do not email resumes or finished documents as attachments.
- Do not paste private resume content into logs, tickets, or analytics.
- Do not manually mark an unpaid order paid.
- Do not bypass capacity, MFA, quality confirmation, or webhook verification.
- Do not treat this policy update as implemented cleanup, permission to delete customer/archive data, or proof of a working correction-redelivery path.

# Ship checklist

Use [amendment 19](../applypack/19_OCTOBER_25_CONFIRMED_INTAKE_AND_SERVICE_ERROR_AMENDMENT.md), the [complete launch plan](../launch/END_TO_END_COMPLETION_PLAN_2026-10-25.md), and [intake/correction operations](INTAKE_REVIEW_AND_SERVICE_ERROR_CORRECTIONS.md). The new confirmed-intake and service-error-only contract is a required, unimplemented launch change. Checking this document into Git is not acceptance evidence; historical accepted rights remain intact.

## Local evidence

- npm run check passes.
- npm run test:e2e passes in desktop and mobile projects.
- Home, every public route, intake, sign-in, portal setup state, and 404 render.
- 320px, tablet, and desktop screenshots reviewed against DESIGN.md.
- Keyboard navigation, mobile focus trap, reduced motion, zoom, and forced colors reviewed.
- Forward schema, versioned policy/receipt binding, generated types, readiness and migration tooling agree on the new prospective contract; migration identifiers and final legal hashes are verified, not guessed. Reserved `confirmed-intake-v1`, `service-error-only-v1`, Terms `manual-launch-terms-2026-10-25-v4` and Privacy `privacy-2026-10-25-v4` are not yet active contracts.
- Actual route-to-database tests exercise intake confirmation, invitation, payment, drafting, review, release and repair. Seeded eligible database rows alone do not prove that runtime matching evaluations can be approved and released.

## Provider evidence

- Production migration applied without error.
- RLS negative tests prove one customer cannot read another customer's records or files.
- Every source, delivery, operator-draft and render-preview Storage bucket reports private.
- Accepted and hostile PDF/DOCX fixtures prove the configured document-safety allowlist, active-content rejection, private hold, and release flow. Evidence does not call this malware scanning.
- The approved recovery arrangement protects records, private files/versions, keys, authentication and configuration; a protected drill meets 240 minutes/15 minutes after loss of the original machine or credentials. A local database restore alone is insufficient.
- One manual maintenance run and two actual 15-minute cycles pass, with delivered failure/staleness alerts and independent monitoring able to detect a stopped scheduler.
- Admin without AAL2 is rejected.
- Stripe purchase creates one order, deadline, payment, capacity commitment, and receipt.
- Replayed Stripe events create no duplicate work or email.
- Cancelled and expired sessions create no paid work.
- Apply Pack checkout cannot exceed 10 items, delivered-search eligibility, or current measured capacity.
- Capacity-full checkout makes no charge.
- Resend domain is verified and an external receipt passes SPF, DKIM, and DMARC.
- help@, orders@, and admin@ reach the securely confirmed monitored business inbox using the minimum aliases/mailboxes.
- Partial and full refunds reconcile correctly between Stripe, payment, cart, and per-job order records.

## Fulfillment evidence

- Resume-upload and no-resume intake both reach a complete, readable factual review before payment at the same price. Missing/conflicting answers remain visible, edits preserve progress, and material edits require renewed confirmation.
- The exact confirmed snapshot, policy version and accepted legal-content receipt bind the paid order; stale or mismatched confirmation cannot authorize payment, generation or release. Earlier receipts and order rights are unchanged.
- System research produces permitted, traceable candidates for owner review and exactly 10 matches are required. Shortages, stale sources and failed research remain visible; manual fixture seeding does not prove the intended research workflow.
- Stale listings are rejected.
- Customer can mark Not for Me.
- Criteria conflict creates one review record against the preserved criteria version.
- Signed delivery URLs expire and cross-account requests fail.
- Service-generated drafts use only confirmed facts and the selected job, then pass readable owner content review and actual document review before atomic private release. PDF is normal delivery; an approved genuine-DOCX exception preserves its required provenance.
- A qualifying ApplyPack error reported within three calendar days completes report-read, eligibility, regeneration, owner approval, redelivery and resolution. One grouped request is preserved; a failed repair remains the same open case.
- A customer mistake/omission in confirmed information, a later fact, changed preference or new target is declined under the new contract without regeneration, a new entitlement or unintended change to existing access. Separate late/second-request and historical-rights cases pass.
- Ambiguous discrepancies receive owner investigation rather than automatic denial. A report alone neither revokes otherwise valid downloads nor rewrites documents; a confirmed shared defect is checked across affected artifacts, preserving unaffected packs.
- Replay, double submission, stale document approval, wrong customer/version, worker failure, delivery failure and lost response do not duplicate a repair, release or email or falsely resolve the case.
- Open paid or qualifying repair obligations protect necessary private data; rejected requests do not grant indefinite retention. Shared historical obligations and current holds survive cleanup/restore. Unavailable cleanup/sanitization executors remain blocking, not mocked successful.
- Run the complete hosted sandbox sequence with those branches: confirmed intake, invitation, search payment and ten approved jobs, optional pack payment, service-generated drafts, owner approval, private delivery, qualifying repair, denied customer-change request and ordinary refunds. Keep human document, keyboard, screen-reader and physical-phone acceptance separate from fixture tests.

## Production boundary

Do not call the service live until all provider evidence is recorded, the fixed $18.99/$7.99 tax-inclusive no-added-tax contract is verified, both capacities are deliberately enabled, and the exact release SHA is captured. A separate CPA or Department of Revenue approval is not a launch gate. A local build proves code integrity, not live payment, email, DNS, antivirus scanning, backups, storage, or delivery behavior.

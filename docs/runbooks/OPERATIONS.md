# ApplyPack operations

## Daily opening

1. Sign in with the admin account and complete MFA.
2. Review provider failures, open orders, and capacity reservations.
3. Confirm human capacity before changing either limit.
4. Work the earliest deadline first.

## Job Match Search

1. Read the approved intake and source resume.
2. Research current employer-controlled listings.
3. Recheck each direct URL within the freshness window.
4. Record fit, requirements, concerns, location, salary when listed, and checked time.
5. Deliver only when exactly 10 complete matches pass human review.
6. Never loosen a non-negotiable without customer approval.
7. Follow `docs/runbooks/JOB_SOURCE_OPERATIONS.md` for source health, approved syncs, classification review, staleness, and Liveops verification.

## Apply Pack

1. Recheck the selected listing.
2. Compare every claim with customer-provided source material.
3. Keep genuine gaps visible.
4. Generate each document through the shared evidence-bound service. The resume uses the current versioned single-column, stacked template and native Word lists.
5. Review the editable DOCX sources and the searchable, tagged PDF previews.
6. Complete separate factual/content and rendered-page quality checks.
7. Deliver the resume PDF and cover-letter PDF when the employer accepts PDF. Deliver DOCX only when the employer requires it, the portal rejects PDF, or the customer asks for Word.
8. Keep the direct employer apply link with the application record. ApplyPack never submits the application.
9. Editable DOCX sources remain private, require MFA-protected operator access, and generate a PII-free access audit. Revoked or superseded sources enter the bounded storage-cleanup queue.

## Correction and conflict queues

- Factual corrections are limited to one included request within three calendar days.
- New strategy, experience, or target work is not a factual correction.
- Criteria conflicts are decided against the criteria version captured with the request.
- A confirmed material conflict receives a replacement at no charge.
- Not for Me is a preference record, not an automatic replacement or refund.

## Never do

- Do not email resumes or finished documents as attachments.
- Do not paste private resume content into logs, tickets, or analytics.
- Do not manually mark an unpaid order paid.
- Do not bypass capacity, MFA, quality confirmation, or webhook verification.

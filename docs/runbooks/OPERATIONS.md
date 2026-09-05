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
4. Produce one editable resume and cover letter for each selected job.
5. Complete the human quality check.
6. Upload both DOCX files through the protected admin delivery route.

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

## Ten-job packet preview and release

1. Complete the existing human review of exactly ten job records. Stage them for packet review; do not release them to the customer yet. Generation never approves a job.
2. In the admin order view, inspect the ten rendered record summaries and every unknown warning.
3. Generate the current snapshot. Confirm schema, template, renderer, content identity, and checksum.
4. Open the 60-second private preview and inspect every page, link, warning, and page number.
5. Approve only the checksum shown for that exact preview. Approval atomically binds the current artifact and releases those same ten staged matches.
6. If an approved correction changes content, regenerate; the new identity does not mutate the prior artifact.
7. The customer downloads only the currently approved artifact through the authenticated owner route.

Never upload a partial renderer result or rename a packet manually. A failed render remains non-deliverable. Follow `docs/DOCUMENT_GENERATION.md` for QA, upgrade, and rollback.

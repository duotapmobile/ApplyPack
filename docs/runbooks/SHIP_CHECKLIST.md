# Ship checklist

## Local evidence

- npm run check passes.
- npm run test:e2e passes in desktop and mobile projects.
- Home, every public route, intake, sign-in, portal setup state, and 404 render.
- 320px, tablet, and desktop screenshots reviewed against DESIGN.md.
- Keyboard navigation, mobile focus trap, reduced motion, zoom, and forced colors reviewed.

## Provider evidence

- Production migration applied without error.
- RLS negative tests prove one customer cannot read another customer's records or files.
- Both Storage buckets report private.
- Accepted and hostile PDF/DOCX fixtures prove the configured document-safety allowlist, active-content rejection, private hold, and release flow. Evidence does not call this malware scanning.
- Supabase backup retention is enabled and a non-production restore drill has passed.
- Hourly maintenance and independent uptime monitoring have both produced successful evidence.
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

- Exactly 10 matches are required.
- Stale listings are rejected.
- Customer can mark Not for Me.
- Criteria conflict creates one review record against the preserved criteria version.
- Signed delivery URLs expire and cross-account requests fail.
- Apply Pack delivery requires reviewed DOCX and PDF versions of both documents, four successful safety checks, complete job-specific human-review evidence, an operator note, and atomic release.
- One factual correction inside three days succeeds; a second or late request fails.

## Production boundary

Do not call the service live until all provider evidence is recorded, the tax classification is resolved, both capacities are deliberately enabled, and the exact release SHA is captured. A local build proves code integrity, not live payment, email, DNS, antivirus scanning, backups, storage, or delivery behavior.

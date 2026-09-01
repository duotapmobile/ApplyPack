# ApplyPack Test Plan and Ship Checklist

Last updated: September 1, 2026

## Completion standard

A screen render is not completion.

The site is ready to ship only when the full customer and admin workflows work with real provider integrations in their proper environments, security and accessibility controls are verified, payment fulfillment is idempotent, private files are protected, deadlines are correct, and production evidence is recorded.

## Required evidence folder

Create in the repository:

```text
docs/evidence/
```

Recommended files:

```text
IMPLEMENTATION_DECISIONS.md
ARCHITECTURE.md
DATA_MODEL.md
MIGRATION_REPORT.md
TEST_REPORT.md
SECURITY_REPORT.md
ACCESSIBILITY_REPORT.md
SEO_REPORT.md
PAYMENT_REPORT.md
EMAIL_AND_DNS_REPORT.md
PRODUCTION_SMOKE_REPORT.md
KNOWN_LIMITATIONS.md
SHIP_READINESS.md
```

Do not place secrets, customer resumes, real email codes, private signed URLs, or payment card information in evidence.

# Phase 1: Repository and authority inspection

Required checks:

- Confirm exact repository path.
- Confirm Git remote and current branch.
- Record current HEAD.
- Check working tree status.
- Inspect nested `.git` directories, submodules, gitlinks, and worktrees.
- Read all applicable guidance.
- Read every file in `Chat docs`.
- Read `DESIGN.md` when present.
- Inspect package manager and lockfile.
- Inspect current hosting and deployment configuration.
- Inspect current routes and public copy.
- Inspect existing auth, database, storage, payment, email, analytics, and monitoring code.
- Inventory `C:\Users\mskir\Desktop\Repos` in read-only mode for reusable patterns.
- Record what will be reused and why.
- Confirm implementation and external-action authorization from the initial preflight.

Required artifact:

```text
docs/evidence/IMPLEMENTATION_DECISIONS.md
```

# Phase 2: Static quality gates

Run the repository's existing equivalents of:

```text
format check
lint
type check
unit tests
build
```

Before changes, record baseline results. Do not attribute pre-existing failures to new work.

After changes, all new and affected code must pass.

Required negative checks:

- No secrets in Git diff.
- No `.env` file added.
- No production identifiers hardcoded into source when configuration belongs in environment variables.
- No duplicate package manager lockfiles.
- No accidental generated build output committed unless repository policy requires it.
- No unresolved placeholders in public copy except expressly approved legal placeholders before production.

# Phase 3: Database and migration tests

Test every migration against a nonproduction database.

Required:

- Fresh database migration succeeds.
- Existing baseline to new schema succeeds.
- Seed data succeeds.
- Duplicate migration execution fails safely or is idempotent as appropriate.
- Required indexes and unique constraints exist.
- Foreign keys enforce ownership relationships.
- Approved criteria cannot be silently updated in place.
- Price fields cannot be altered by a customer path.
- Due timestamps use timezone-aware types.
- Capacity reservations enforce atomic behavior.
- Webhook event IDs are unique.
- One paid job does not create duplicate Apply Pack orders.
- Storage metadata points only to private objects.
- Rollback or restore procedure is documented and tested where practical.

# Phase 4: Unit tests

## Pricing

- Search price is exactly 2000 cents USD.
- Apply Pack unit price is exactly 800 cents USD.
- One selected job totals 800 cents.
- Three selected jobs total 2400 cents.
- Ten selected jobs total 8000 cents.
- Client-supplied altered price is ignored or rejected.
- Duplicate selected job does not increase quantity.

## Deadlines

- Search due time equals work-ready time plus 24 hours.
- Apply Pack due time equals work-ready time plus 24 hours.
- Timestamps remain correct across daylight-saving transitions.
- Database stores UTC.
- UI displays confirmed timezone accurately.
- A later page reload does not recalculate and move the contractual deadline.
- A status change does not move due time.
- Customer criteria changes after payment follow the approved policy.

## Capacity

- Available capacity subtracts paid unfinished units.
- Available capacity subtracts active reservations.
- Expired reservations no longer consume capacity.
- Concurrent checkout attempts cannot oversell.
- A successful payment converts one reservation once.
- A failed or expired checkout releases capacity.
- Quantity greater than available is rejected before payment.
- Admin capacity setting changes are authorized and audited.

## Search criteria

- Required and preferred values remain distinct.
- Hard and soft exclusions remain distinct.
- Rendered approval summary matches stored fields.
- Approved criteria create an immutable version.
- A new edit creates a new version.
- Conflict requests reference the original order's exact approved version.

## State transitions

- Valid transitions succeed.
- Invalid transitions fail.
- Customer cannot set internal statuses.
- Delivered order cannot return to unpaid.
- Paid order cannot be fulfilled twice.
- Correction request does not overwrite the original deliverable.
- Replacement keeps the original match record and audit history.

## File names

- Customer-facing file names are descriptive.
- Unsafe characters are removed.
- Storage keys do not contain customer names or emails.
- Resume and cover-letter document types cannot be swapped accidentally.

# Phase 5: Authentication and authorization tests

## Customer OTP

- Valid email can request a code.
- Response does not reveal whether the email already exists.
- Code can be pasted.
- Valid code creates a session.
- Code is single-use.
- Expired code fails clearly.
- Incorrect code is rate-limited.
- Repeated requests are rate-limited.
- Sign-out revokes the active session as designed.

## Customer isolation

Create Customer A and Customer B.

Verify Customer A cannot:

- Read B's profile.
- Read B's intake.
- Read B's approved criteria.
- Read B's source documents.
- Read B's search order.
- Read B's job matches.
- Add B's job to a cart.
- Purchase B's job.
- Read B's Apply Pack order.
- Download B's deliverables.
- Submit a correction for B's order.

Repeat in reverse.

Test direct API access, modified URLs, modified request bodies, and copied UUIDs.

## Admin authorization

- Customer cannot access admin routes.
- Inactive admin cannot access admin routes.
- Each admin role receives only intended permissions.
- Admin access is checked server-side.
- MFA policy is enforced for production admins.
- Service-role credentials never appear in browser bundles or network responses.

# Phase 6: File-upload and storage tests

Allowed:

- Valid DOCX within limit.
- Valid text-based PDF within limit.

Rejected:

- Executable renamed `.pdf`.
- ZIP archive.
- Macro-enabled Word document.
- Password-protected PDF.
- Oversized file.
- More than allowed file count.
- Disallowed image.
- Empty file.
- Corrupt DOCX container.
- MIME and extension mismatch.

Verify:

- Upload requires authenticated ownership.
- File is private.
- Direct object URL does not work publicly.
- Signed URL expires.
- Customer cannot sign a URL for another customer's file.
- Filename is safe.
- Hash is stored.
- Replacing a source file does not orphan public access.
- Scheduled deletion removes eligible active objects.
- Deletion failure creates an alert.
- Logs do not contain file content.

If malware scanning is implemented:

- Clean file moves from quarantine to accepted.
- Detected file remains inaccessible and is rejected.
- Scanner timeout fails safely.
- Customer receives a clear nontechnical message.

# Phase 7: Stripe integration tests

Use Stripe test mode first.

## Search purchase

- Authenticated customer with complete approved intake can create checkout.
- Incomplete intake cannot create checkout.
- Unapproved criteria cannot create checkout.
- Capacity unavailable blocks checkout.
- Price is $20.
- Successful payment creates one paid search order.
- Due time is set once.
- Confirmation email is queued once.
- Customer return without webhook does not fulfill.
- Webhook without browser return fulfills.
- Cancelled checkout leaves no paid order and releases reservation.
- Expired checkout releases reservation.

## Apply Pack purchase

- Only delivered owned matches can be selected.
- One selected job charges $8.
- Multiple selected jobs charge exact quantity times $8.
- Already purchased job cannot be charged twice accidentally.
- Closed or ineligible job is blocked according to policy.
- Capacity insufficient for the whole cart blocks checkout.
- Successful payment creates one order per selected job.
- Every order receives the same payment confirmation reference and correct due time.
- Match state updates correctly.
- Confirmation email is sent once.

## Webhooks

- Valid signature accepted.
- Invalid signature rejected.
- Wrong environment secret rejected.
- Duplicate event ID does not duplicate work.
- Replayed completed event is idempotent.
- Events arriving out of order converge safely.
- Processing exception records failure and retries.
- Webhook endpoint does not expose internal error detail.
- Full payload is not retained indefinitely without reason.

## Refunds

- Authorized admin can initiate approved refund.
- Unauthorized user cannot.
- Local state updates after provider response.
- Provider failure leaves local state truthful.
- Duplicate refund request does not over-refund.
- Partial and full refunds are represented correctly if supported.
- Customer email reflects actual provider-confirmed status.

# Phase 8: Email tests

For every template:

- Correct recipient.
- Correct first name when used.
- Correct order and deadline.
- Correct canonical portal link.
- Plain-text version.
- Accessible HTML structure.
- No sensitive subject line.
- No private document attachment.
- Reply-To reaches monitored support inbox.
- Idempotency prevents duplicate send.

Provider tests:

- SPF passes.
- DKIM passes.
- DMARC aligns.
- Gmail delivery tested.
- Outlook delivery tested when an account is available.
- Bounce event updates status.
- Complaint event updates status and alerts.
- Temporary failure retries.
- Permanent failure alerts admin.
- Open and click tracking remain disabled when that is the policy.

# Phase 9: End-to-end customer tests

Use synthetic customer data only.

## Happy path, one Apply Pack

1. Visit homepage.
2. Start intake.
3. Verify email.
4. Upload valid resume and optional cover letter.
5. Complete all criteria steps.
6. Review and change one section.
7. Approve criteria.
8. Pay $20 in Stripe test mode.
9. Confirm exact due time.
10. Admin creates exactly 10 matches.
11. Admin completes quality check and delivers.
12. Customer receives email.
13. Customer opens private results.
14. Customer opens employer link.
15. Customer selects one job.
16. Customer enters optional emphasis note.
17. Customer pays $8.
18. Admin prepares and uploads two deliverables.
19. Admin completes quality check and delivers.
20. Customer downloads both files.
21. Customer confirms accuracy.

## Happy path, multiple Apply Packs

Repeat with three selected jobs and verify:

- One $24 checkout.
- Three orders.
- Three correct job associations.
- No file cross-assignment.
- Capacity consumption of three units.
- One confirmation summary and accurate per-order views.

## All ten Apply Packs

When authorized capacity permits:

- Select all ten.
- Verify $80 total.
- Verify ten separate orders.
- Verify exact shared deadline policy.
- Verify admin queue remains usable.

## Not for Me

- Customer marks a job Not for Me.
- Optional reason saves.
- No replacement is automatically promised.
- Other jobs remain available.

## Criteria conflict

- Customer reports a real hard-exclusion conflict.
- Admin compares exact approved criteria version.
- Admin accepts and replaces.
- Replacement appears without changing original audit history.
- Customer is notified.

Test a rejected subjective conflict as well.

## Correction

- Customer submits one factual correction within the allowed window.
- Admin uploads corrected version.
- Original version remains in audit history but is not the default download.
- Customer receives corrected notification.
- Second included correction is blocked or routed for admin exception.
- Out-of-scope rewrite request is handled clearly.

## Return visits

- Customer can leave and resume intake.
- Customer can return to delivered jobs.
- Customer can return to an open cart before expiration.
- Customer can access past Apply Packs according to retention policy.
- Expired authentication session returns safely to login.

# Phase 10: Negative and failure-path tests

- Payment succeeds but confirmation email fails.
- Payment succeeds but browser closes immediately.
- Stripe webhook is delayed.
- Stripe webhook is replayed.
- Database write fails during fulfillment.
- Capacity reservation exists but payment never completes.
- Customer opens two checkout tabs.
- Customer modifies selected job IDs in a request.
- Employer URL becomes unavailable before Apply Pack purchase.
- Employer URL closes after purchase.
- Admin uploads resume under cover-letter slot.
- Admin tries to deliver with one missing file.
- Admin tries to deliver fewer or more than 10 search matches.
- Admin tries to deliver without quality checks.
- Signed download URL is shared after expiration.
- Source file deletion job fails.
- Email provider is unavailable.
- Database is temporarily unavailable.
- User refreshes every checkout return and confirmation page repeatedly.
- Customer enters HTML or script in free text.
- Customer uploads a misleading file extension.
- Customer requests OTP repeatedly.
- Customer attempts to enumerate accounts.

Every failure must leave truthful state and a recoverable admin path.

# Phase 11: Accessibility tests

Automated:

- Axe tests on every public route.
- Axe tests on each intake step.
- Axe tests on customer portal views.
- Axe tests on admin critical views.
- Lighthouse accessibility audit.
- Color-contrast check.

Manual keyboard:

- Skip link.
- Header and mobile menu.
- Homepage CTAs.
- Accordion and tabs.
- OTP.
- All intake steps.
- File upload.
- Criteria review.
- Checkout initiation.
- Job cards.
- Sticky Apply Pack cart.
- Conflict form.
- Apply Pack cart.
- Downloads.
- Correction form.
- Admin queues and upload.

Manual screen reader:

- NVDA plus Chrome or Firefox on Windows.
- VoiceOver plus Safari on iPhone or Mac when available.

Zoom and reflow:

- 200 percent text zoom.
- 400 percent browser zoom.
- 320 CSS pixel viewport equivalent.
- No critical horizontal scrolling.
- No focus hidden behind sticky content.

Motion:

- Reduced-motion preference produces static comprehensible visual states.
- No looping homepage simulations.
- No flashing.

Forms:

- Every field has a visible label.
- Required state is spoken and visible.
- Fieldsets and legends are correct.
- Errors are announced and linked.
- Data remains after correction.
- Review step can be edited before payment.

Third party:

- Stripe Checkout tested with keyboard, zoom, mobile, and screen reader where possible.

Record all results and unresolved third-party limitations.

# Phase 12: Security tests

Required:

- Authorization and IDOR tests.
- RLS policy tests when using Supabase.
- CSRF review.
- XSS payload tests in every free-text field.
- Unsafe URL scheme tests.
- SSRF controls for any server-side URL checker.
- File-upload negative tests.
- Rate-limit tests.
- Secret scan.
- Dependency audit.
- CSP and security-header verification.
- Cookie flag verification.
- Open redirect tests.
- Webhook signature and replay tests.
- Customer-data log review.
- Admin role escalation attempt.
- Signed URL expiration and ownership tests.

No known critical or high-severity security issue may remain at launch.

# Phase 13: SEO and performance tests

SEO:

- Every public page has unique title and description.
- Exactly one clear H1.
- Canonical correct.
- Open Graph correct.
- Public internal links crawlable.
- Sitemap contains public canonical pages only.
- robots.txt correct.
- Private pages authenticated and noindex.
- No JobPosting markup.
- No fake reviews or ratings.
- Structured data validates.
- Illustrative examples are labeled.
- No broken links.
- No placeholder legal entity in production.

Performance:

- Production build optimized.
- Primary hero loads quickly.
- Images have dimensions.
- Below-fold images lazy-load.
- No unnecessary third-party scripts.
- No giant animation library for simple effects.
- LCP target at or below 2.5 seconds.
- INP target below 200 milliseconds.
- CLS target below 0.1.

Test mobile and desktop.

# Phase 14: DNS, domain, and email verification

- Exported pre-change DNS inventory exists.
- Apex resolves.
- `www` behavior correct.
- HTTP redirects to HTTPS.
- Certificate valid.
- Canonical host correct.
- Existing unrelated DNS records preserved.
- Support email receives external mail.
- Accessibility email receives external mail.
- Privacy email receives external mail.
- Transactional sender verified.
- SPF pass recorded.
- DKIM pass recorded.
- DMARC alignment recorded.
- Reply-To tested.
- Provider ownership and MFA confirmed.

# Phase 15: Production smoke tests

Only perform live payment tests when explicitly authorized in the initial preflight.

Minimum production smoke without a real charge:

- Public pages load over canonical HTTPS.
- Get Started works.
- Email verification works.
- Synthetic upload works.
- Intake persists.
- Criteria approval works.
- Live checkout session can be created up to, but not through, payment when the user does not authorize a real charge.
- Private portal authorization works.
- Admin login and MFA work.
- Transactional email sends from production domain.
- Monitoring and alerts receive a safe test event.

When a live charge and refund are authorized:

1. Complete one $20 search purchase.
2. Verify webhook and due time.
3. Deliver synthetic 10-job results.
4. Complete one $8 Apply Pack purchase.
5. Deliver synthetic files.
6. Download them as the customer.
7. Refund the authorized test charges.
8. Verify Stripe and local refund state.
9. Delete synthetic private data according to the runbook.

Record provider IDs in redacted form.

# Independent audits

Before final ship declaration, run three independent reviews when the environment supports subagents. When it does not, perform three separate review passes and label them as sequential reviews, not independent agents.

## Auditor 1: Product and workflow

Review:

- Pricing.
- 24-hour deadlines.
- Search criteria.
- 10-job delivery.
- Job selection.
- $8 quantity checkout.
- Disclaimers.
- Replacement policy.
- Corrections.
- Copy consistency.

## Auditor 2: Security, privacy, and payments

Review:

- Authentication.
- Authorization.
- Storage.
- Uploads.
- Webhooks.
- Price integrity.
- PII exposure.
- Retention.
- Admin access.
- Refund integrity.

## Auditor 3: Accessibility, SEO, and operations

Review:

- WCAG 2.2 Level AA.
- Forms.
- Keyboard and screen reader.
- Search indexing.
- DNS.
- Email deliverability.
- Performance.
- Monitoring.
- Runbooks.

## 10th-man review

The 10th-man reviewer must assume the current consensus is wrong and attempt to prove the site should not ship.

Questions:

- Can a customer obtain another customer's private data?
- Can a user pay the wrong amount?
- Can one checkout create duplicate orders?
- Can capacity be oversold?
- Can the site miss 24 hours while still accepting work?
- Can a customer reasonably misunderstand the $20 as a satisfaction guarantee?
- Can a customer reasonably think ApplyPack guarantees employment?
- Can a stale or closed job still be sold?
- Can an admin deliver the wrong files?
- Can the customer fail to access the site with keyboard or screen reader?
- Can private pages be indexed?
- Can a provider failure silently lose an order?
- Can retention promises be false because backups or objects remain?
- Can the user lose control of the domain, Stripe, database, email, or hosting account?

Every credible finding must be fixed or explicitly accepted by the user before ship declaration.

# Final ship checklist

## Product

- Prices are exactly $20 and $8.
- Search promise is exactly 10 jobs.
- 24-hour promise has exact start and deadline behavior.
- Capacity blocks impossible orders.
- Current resume requirement matches public copy.
- Cover letter requirement matches public copy.
- No outcome guarantee.
- Match Promise matches Terms and UI.
- Not for Me and criteria conflict are distinct.
- Customer selects jobs through the portal.
- Multiple-job checkout works.
- One factual-correction policy is consistent.

## Customer

- Email can be verified.
- Intake saves and resumes.
- Uploads work securely.
- Criteria can be reviewed and corrected.
- Payment succeeds.
- Deadline is visible.
- Results are private.
- Ten jobs display correctly.
- Employer links work.
- Apply Packs can be selected and purchased.
- Files can be downloaded.
- Correction can be requested.
- Support and accessibility contact work.

## Admin

- MFA enabled.
- Queues sorted by due time.
- Job-match builder works.
- Exactly 10-match delivery enforced.
- Criteria validation works.
- Apply Pack files cannot be swapped silently.
- Quality checklist enforced.
- Replacement and correction queues work.
- Capacity can be configured.
- Refund path works when authorized.
- Audit log records safe events.

## Technical

- Build passes.
- Tests pass.
- Migrations pass.
- Webhooks verified and idempotent.
- RLS or equivalent access control passes.
- Storage private.
- Signed URLs expire.
- Email authenticated.
- DNS stable.
- Monitoring active.
- Backups and restore documented.
- Cleanup jobs active.
- No secret exposure.
- No critical or high security finding.

## Accessibility

- WCAG 2.2 AA review complete.
- Keyboard complete.
- Screen-reader critical flow complete.
- Reflow complete.
- Reduced motion complete.
- Form errors complete.
- Stripe checkout reviewed.
- Accessibility statement accurate.

## Search and performance

- Public metadata complete.
- Private routes noindex and authenticated.
- Sitemap submitted when authorized.
- Structured data valid.
- Core Web Vitals targets reviewed.
- No broken public links.

## Ownership

- User owns domain account.
- User owns hosting project.
- User owns GitHub repository.
- User owns Stripe account.
- User owns database project.
- User owns email provider account.
- MFA and recovery methods confirmed.
- Billing and renewal ownership confirmed.

# Final report format

The executing agent must end with:

```text
APPLYPACK SHIP STATUS

Status:
READY TO SHIP | READY WITH ACCEPTED LIMITATIONS | NOT READY

Production URL:

Repository:

Deployed commit:

What was completed:

Provider configuration completed:

Test evidence:

Accessibility evidence:

Security evidence:

Payment evidence:

Email and DNS evidence:

Known limitations:

Outstanding user-owned actions:

Rollback instructions:

Exact recommendation:
```

Do not declare READY TO SHIP while a required credential, DNS record, live provider verification, critical test, or production deployment is still missing.

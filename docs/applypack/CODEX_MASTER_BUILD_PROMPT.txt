# CODEX MASTER BUILD PROMPT, APPLYPACK PRODUCTION BACKEND

Copy everything below into a new Codex conversation.

---

You are the principal engineer, security lead, accessibility lead, payment-integration lead, deployment owner, and final release auditor for ApplyPack.

Your assignment is to inspect the existing ApplyPack website and complete the entire production system behind it. This is not a planning-only task. After one consolidated preflight question set and the user's answers, continue until the site is implemented, tested, deployed, configured, verified, documented, and ready to ship, or until you can prove a true external blocker that cannot be resolved without a user-owned action.

Do not stop after writing a plan. Do not stop after scaffolding. Do not stop after a preview render. Do not stop after creating Stripe buttons. Do not say the backend is complete while customer data, payments, email, DNS, private delivery, admin operations, accessibility, or production verification remain mocked or unfinished.

## 1. Exact local sources you must read first

The complete ApplyPack handoff is located at:

```text
C:\Users\mskir\Desktop\Apply_Pack\Chat docs
```

The user's reusable repository and skill library is located at:

```text
C:\Users\mskir\Desktop\Repos
```

The user will also create a design authority file named:

```text
DESIGN.md
```

The exact ApplyPack website repository path and GitHub remote must be confirmed in your first preflight. Do not guess which repository is authoritative.

Before asking questions, you may perform read-only discovery to identify likely ApplyPack repositories and the current site stack. Do not edit anything yet.

Read every file in `C:\Users\mskir\Desktop\Apply_Pack\Chat docs` completely. At minimum, read:

```text
00_START_HERE.md
01_PRODUCT_SOURCE_OF_TRUTH.md
02_SITE_COPY_AND_PAGE_MAP.md
03_CUSTOMER_AND_ADMIN_WORKFLOWS.md
04_BACKEND_ARCHITECTURE_AND_DATA_MODEL.md
05_PAYMENTS_EMAIL_DNS_AND_OPERATIONS.md
06_SECURITY_PRIVACY_ACCESSIBILITY_SEO.md
07_TEST_PLAN_AND_SHIP_CHECKLIST.md
08_PREFLIGHT_QUESTIONS_AND_CREDENTIALS.md
09_ENVIRONMENT_VARIABLES_TEMPLATE.md
10_DESIGN_MD_HANDOFF.md
AGENTS.md
CODEX_MASTER_BUILD_PROMPT.md
```

After the repository is confirmed, read every repository-local instruction that applies, including:

```text
AGENTS.md
README.md
START_HERE.md
PROJECT_MAP.md
PROJECT_STATUS.md
RECOVERY.md
DESIGN.md
.agent-guidance/
package manifests
lockfiles
deployment files
environment examples
migration files
test configuration
CI configuration
```

If multiple `AGENTS.md` files exist, obey the most specific applicable file while preserving stricter higher-level safety rules.

## 2. Authority order

When instructions conflict, use this order:

1. The user's latest direct instruction in this Codex conversation
2. The user's `DESIGN.md`, for visual and responsive design only
3. `01_PRODUCT_SOURCE_OF_TRUTH.md`, for prices, promises, product scope, customer rights, and public claims
4. `02_SITE_COPY_AND_PAGE_MAP.md`, for approved copy, routes, information hierarchy, and calls to action
5. `03_CUSTOMER_AND_ADMIN_WORKFLOWS.md`, for behavior and workflow
6. `04_BACKEND_ARCHITECTURE_AND_DATA_MODEL.md`, for backend requirements and recommended defaults
7. `05_PAYMENTS_EMAIL_DNS_AND_OPERATIONS.md`, for provider and operational requirements
8. `06_SECURITY_PRIVACY_ACCESSIBILITY_SEO.md`, for nonfunctional requirements
9. `07_TEST_PLAN_AND_SHIP_CHECKLIST.md`, for proof and release criteria
10. Existing code where it remains compatible

Do not silently resolve a material conflict. Record the conflict, the controlling source, and the chosen implementation in:

```text
docs/evidence/IMPLEMENTATION_DECISIONS.md
```

## 3. Product truth you must preserve

ApplyPack is not only a job-search tool and not only a resume-writing service.

It performs three connected functions:

```text
Searching
ApplyPack finds 10 current job opportunities selected around the customer's approved experience, priorities, preferences, and non-negotiables.

Connecting
ApplyPack identifies the honest connection between what the customer has already done and what a different employer needs.

Writing
For each customer-selected job, ApplyPack prepares a resume and cover letter tailored to that job and employer.
```

Primary public promise:

```text
We find the jobs. We get you ready to apply.
```

Turnaround promise:

```text
Your search in 24 hours. Your application in the next 24.
```

Locked prices:

```text
Job Match Search:
$20
Exactly 10 matched job opportunities
Delivered within 24 hours
Paid before research begins

Apply Pack:
$8 per selected job
One tailored resume and one tailored cover letter
Delivered within 24 hours
Paid after the customer sees and selects jobs
```

There is no subscription.

The customer may select one, several, all 10, or none of the jobs for Apply Packs.

ApplyPack does not submit applications.

ApplyPack does not guarantee employer review, interviews, offers, compensation, or employment.

ApplyPack does not invent experience, employers, dates, titles, tools, certifications, metrics, revenue, results, or qualifications.

ApplyPack does not promise to beat or bypass an applicant tracking system.

The initial operating model should remain manual-first unless the user expressly authorizes automation:

- The ApplyPack admin manually researches the jobs.
- The admin enters and quality-checks the 10 matches.
- The admin manually prepares the resumes and cover letters.
- The admin uploads completed DOCX files.
- The backend controls identity, intake, payment, deadlines, customer selection, private delivery, correction requests, replacement review, and records.

Do not build an automated scraper or unsupervised AI writer merely because it is possible.

## 4. Your first response must be one consolidated preflight

Your first response, after reading the handoff and any read-only repository discovery you can perform, must contain all remaining access, login, authorization, and product questions in one organized block.

Do not send a plan first.

Do not ask two questions now and five more later.

Do not ask the user to paste passwords, secret keys, recovery codes, authentication codes, card information, or private API credentials into chat.

Ask the user to authenticate directly through provider dashboards, approved CLI login flows, or local secret stores. Explain exactly which account or dashboard needs to be opened and why.

Use `08_PREFLIGHT_QUESTIONS_AND_CREDENTIALS.md` as the detailed checklist. Pre-fill facts already established and ask only for confirmation where necessary.

Your single preflight must cover these categories:

### Repository and change authority

- Exact local repository path
- Exact GitHub URL
- Current and target branch
- Permission to create a branch
- Permission to commit
- Permission to push
- Permission to open and merge a pull request
- Permission to deploy preview
- Permission to deploy production
- Protected branches and files
- Current public URL
- Current preview URL
- Location and readiness of `DESIGN.md`

### Current site and hosting

- Current framework and host, verified by inspection
- Existing backend, database, auth, storage, functions, analytics, monitoring, and provider projects
- Hosting project identity
- Whether the user is already logged in
- Permission to create a backend project if none exists
- Preview and production environment expectations

### Domain and DNS

- Confirmation that the user owns `applypack.work`
- Registrar
- Authoritative DNS provider
- Permission to edit nameservers and records
- Existing records that must be preserved
- Canonical apex versus `www`
- DNSSEC decision

### Business identity and legal display

- Whether DuoTap LLC is the seller and operator
- Legal business name and address required by providers
- Support contact
- Customer-facing statement descriptor
- Whether the service is United States only
- Status of legal review for Terms, Privacy, refunds, and accessibility statement

### Stripe

- Existing Stripe account and live verification
- Login status
- Permission to create test and live products, prices, webhooks, restricted keys, and settings
- Permission to perform a real live payment and refund smoke test
- Confirmation of $20 and $8 prices
- Immediate payment methods only for the 24-hour clock
- Tax handling and Stripe Tax decision
- Exact refund, job-closure, replacement, and missed-deadline rules
- Permission for admin-triggered refunds

### Email

- Destination inbox for customer replies
- Confirmation of `support@applypack.work`, `accessibility@applypack.work`, and `privacy@applypack.work`
- Transactional sender and Reply-To
- Mailbox provider versus forwarding
- Existing Resend account or permission to create one
- Permission to add MX, SPF, DKIM, and DMARC records
- Whether open and click tracking remain disabled, recommended yes

### Backend and authentication

- Permission to use Supabase as the fallback when no compatible backend exists
- Customer auth choice, recommended email one-time code
- Admin email addresses
- Admin MFA
- Permission to create migrations, storage buckets, RLS policies, scheduled jobs, and server functions

### Product and operations

- Whether 24 hours means actual clock hours including weekends and holidays
- Contractual display timezone, recommended America/New_York while storing UTC
- Search capacity per rolling 24 hours
- Apply Pack unit capacity per rolling 24 hours
- Whether a customer can purchase all 10 Apply Packs at once when capacity permits
- Current resume requirement
- Optional cover letter rule
- Resume-from-scratch handling
- Allowed file types and sizes
- Source-document retention
- Customer workspace and deliverable retention
- Factual-correction count and request window
- Match Promise and Not for Me distinction
- Closed-job policy before and after Apply Pack payment
- Confirmation that job search and writing are manual-first
- Confirmation that results are delivered through the private portal

### File security, monitoring, and backups

- Malware scanning provider or accepted residual-risk decision
- Error-monitoring provider
- Alert recipient
- Permission to create monitoring projects
- Backup and restore expectations

### Analytics and search ownership

- Approved analytics provider
- Prohibition on session replay and heatmaps in private flows
- Permission to configure Google Search Console, Bing Webmaster Tools, sitemap submission, and IndexNow
- Approved public social profiles

### Production verification

- Permission to use synthetic test customers and documents
- Permission for complete Stripe test-mode transactions
- Permission for one live $20 charge and one live $8 charge followed by refund
- Final release approver

End the preflight with a compact response template the user can fill in quickly.

## 5. After the user answers, do not stop

After receiving the preflight answers:

1. Write every confirmed decision to `docs/evidence/IMPLEMENTATION_DECISIONS.md`.
2. Record any safe default used and why.
3. Record unresolved legal-review items as implementation drafts, not completed legal advice.
4. Create a concise implementation plan with dependencies and rollback points.
5. Immediately continue into implementation in the same workstream.

Do not ask for confirmation of the plan when the preflight already granted implementation authority.

Do not pause after each phase for permission.

Ask another question only when:

- It could not reasonably have been included in the initial preflight.
- No safe reversible default exists.
- Guessing could cause data loss, financial loss, security failure, legal misrepresentation, or an external action the user did not authorize.

Otherwise choose the safest reversible option consistent with the handoff, record it, and continue.

## 6. Repository safety and baseline

Before edits:

- Confirm repository path and remote.
- Record current branch and HEAD.
- Check working tree status and diffs.
- Inspect worktrees, nested `.git`, submodules, and gitlinks.
- Read all guidance.
- Identify the package manager from the lockfile.
- Run baseline format, lint, type-check, tests, and build where possible.
- Record pre-existing failures without hiding them.
- Identify current public routes, design components, hosting, environment configuration, and deployment state.
- Search for existing auth, database, upload, payment, email, analytics, monitoring, and admin patterns.

Create or update:

```text
docs/evidence/BASELINE_REPORT.md
```

Do not mutate unrelated user work.

If the working tree contains user changes, preserve them. Do not reset, discard, or overwrite them.

## 7. Inspect the repository library safely

Inventory:

```text
C:\Users\mskir\Desktop\Repos
```

This is read-only reference material.

Search for compatible examples of:

- Authentication
- Supabase or other database setup
- RLS or authorization tests
- Stripe Checkout Sessions
- Stripe webhook idempotency
- Resend email
- Private file storage
- Signed downloads
- Admin queues
- Accessible multi-step forms
- Accessibility tests
- SEO metadata
- Provider deployment
- Runbooks

Before using a pattern, read that repository's guidance and license.

Do not edit other repositories.

Do not copy secrets, environment files, customer content, generated keys, or private data.

Do not import an entire subsystem when a smaller adaptation is safer.

Record reused patterns and source repositories in:

```text
docs/evidence/REUSED_PATTERNS.md
```

## 8. Preserve the existing site and design

The user already has a site.

Do not replace it with a generic dashboard template or rewrite it into another framework without a proven need and direct authorization.

Read `DESIGN.md` before changing visual presentation.

`DESIGN.md` controls:

- Colors
- Typography
- Spacing
- Components
- Illustration style
- Homepage simulations
- Responsive design
- Logo use
- Visual motion

The product documents control:

- Prices
- Turnaround
- Customer workflow
- Legal disclaimers
- Security
- Accessibility
- Payment behavior
- Backend state

When design and accessibility conflict, preserve the design intent through an accessible equivalent and document the resolution.

## 9. Choose the smallest compatible production architecture

First inspect what exists.

If the current site already has a secure compatible backend, extend it.

If no suitable backend exists and the user approves the fallback, use:

```text
Supabase Postgres
Supabase passwordless Auth
Supabase private Storage
Row Level Security
Existing site framework for server endpoints
Stripe hosted Checkout Sessions
Resend transactional email
Current hosting platform
Current DNS provider
```

Do not add multiple overlapping providers.

Support local and production, and preview or staging when the approved host and budget permit.

Use test Stripe credentials outside production.

Store timestamps in UTC.

Display the confirmed contractual timezone clearly.

Create:

```text
docs/evidence/ARCHITECTURE.md
docs/evidence/DATA_MODEL.md
```

## 10. Implement customer authentication

Recommended approved flow unless the user chooses otherwise:

1. Customer enters name and email.
2. Customer receives an email one-time code.
3. Customer verifies the code.
4. A secure session is created.
5. The customer may upload private documents and complete intake.
6. The same identity opens My ApplyPack later.

Requirements:

- Generic response that does not reveal whether an account exists.
- Rate-limited code requests.
- Bounded attempts.
- Single-use codes.
- Clear expiration.
- Accessible copy and paste.
- Secure session cookies or provider-recommended equivalent.
- Sign-out.
- No code or token logging.
- No unsafe redirect wildcard.

Admin authentication is separate.

Require MFA for admin accounts.

Admin status cannot be set by the customer.

## 11. Implement the data model and migrations

Use `04_BACKEND_ARCHITECTURE_AND_DATA_MODEL.md` as the functional contract.

At minimum implement durable records for:

- Customer profile
- Admin roles
- Intake and step progress
- Approved immutable criteria versions
- Source documents
- Search orders
- Job matches
- Job decisions
- Criteria conflict requests
- Capacity settings
- Capacity reservations
- Apply Pack carts and items
- Apply Pack orders
- Deliverables
- Quality checks
- Correction requests
- Payments
- Refunds
- Provider webhook events
- Transactional email state
- Audit log

Use version-controlled migrations.

Test fresh migration and upgrade migration.

Do not make production-only schema edits outside migrations.

Create rollback or restore instructions.

## 12. Implement row-level security or equivalent authorization

Customers can access only their own records.

Customers cannot:

- Read another customer's profile, intake, files, jobs, orders, payments, or deliverables.
- Read internal admin notes.
- Set prices.
- Set payment status.
- Set due times.
- Set internal order status.
- Grant admin access.
- Upload operator deliverables.
- Create a paid order without verified payment.
- Alter an approved criteria version in place.

Admins access protected operations only through server-authorized routes.

Service-role or privileged credentials remain server-side.

Write automated cross-customer isolation tests.

## 13. Implement secure file upload and private storage

Initial product requirement, subject to confirmed preflight:

```text
One current resume, required
One current cover letter, optional
DOCX or text-based PDF
10 MB maximum each
```

Requirements:

- Verify authenticated ownership before upload.
- Validate extension, MIME, file signature, and document container.
- Reject macro-enabled files.
- Reject password-protected or encrypted files unless explicitly supported.
- Reject executables, archives, scripts, images, and corrupt files.
- Generate random private storage keys.
- Never use name or email in object keys.
- Hash files.
- Quarantine until validation and approved malware-scan handling completes.
- Store in private buckets.
- Generate short-lived signed download access only after server authorization.
- Provide safe descriptive download names.
- Implement replacement and deletion.
- Implement retention cleanup.
- Never render an unsafe document directly in the browser.

Do not claim malware scanning unless it actually occurs.

## 14. Implement the seven-step intake

Use the exact workflow and copy in `03_CUSTOMER_AND_ADMIN_WORKFLOWS.md`.

The seven customer steps are:

```text
1. Your account
2. Upload what you have
3. Your background
4. What needs to stay
5. What needs to go
6. Where should we look?
7. Review your search
```

Requirements:

- Save progress after every step.
- Permit return and resume.
- Preserve data after validation errors.
- Persistent visible labels.
- Fieldsets and legends.
- Required and preferred values remain distinct.
- Hard and soft exclusions remain distinct.
- Salary and benefit unknown policies captured.
- Work authorization and geographic restrictions captured.
- No prohibited irrelevant demographic questions.
- Customer can change sections before approval.
- Final criteria summary is plain language.
- Final approved criteria create an immutable version.
- Payment is unavailable until intake is complete and approved.

## 15. Implement capacity and exact 24-hour deadlines

The site must not accept more work than the operator can deliver.

Implement configurable limits for:

```text
new Job Match Searches per rolling 24 hours
Apply Pack units per rolling 24 hours
```

A search consumes one search unit.

Each selected job consumes one Apply Pack unit.

Capacity checks must be atomic.

During checkout creation:

- Expire stale reservations.
- Count paid unfinished units.
- Count active reservations.
- Reject quantity above available capacity.
- Create a short reservation.
- Release it on cancel, failure, or expiration.
- Convert it once on verified payment.

Exact due times:

```text
search_due_at = search_work_ready_at + 24 hours
apply_pack_due_at = apply_pack_work_ready_at + 24 hours
```

Never recalculate a paid deadline on page refresh.

Never move a deadline because an internal status changed.

Show the exact deadline before payment as an estimate based on immediate successful payment, then show the fixed due time after verified payment.

When full, display the approved capacity message and disable checkout.

Create scheduled alerts at the confirmed thresholds, recommended 12 hours, 6 hours, 2 hours, and overdue.

## 16. Implement the $20 Job Match Search payment

Use Stripe hosted Checkout Sessions unless the existing stack has an approved equivalent.

Server must validate:

- Authenticated verified customer.
- Complete intake.
- Approved criteria.
- No disallowed duplicate active search.
- Available capacity.
- Exact $20 price.

Create a Stripe product and one-time price in test mode first, then live mode when authorized.

Use internal order ID only in metadata.

Do not send customer PII or criteria to Stripe metadata.

Use verified `checkout.session.completed` fulfillment.

The success page does not create the order.

On successful verified payment:

- Convert capacity reservation.
- Create or update the payment record.
- Mark search paid.
- Set work-ready and due timestamps once.
- Move the order to Ready for Research.
- Queue one confirmation email.
- Audit safely.

Webhook processing must be idempotent.

Handle checkout expiration and refund state.

## 17. Implement the admin search queue and match builder

Admin dashboard must show:

- Customer
- Order
- Paid time
- Due time
- Time remaining
- Status
- Assigned admin
- Match count
- Blocking issue

Admin search workflow:

```text
Ready for Research
Researching
Selecting Matches
Quality Review
Ready to Deliver
Delivered
Completed
```

Match builder fields must include:

- Job title
- Company
- Direct employer URL
- Location
- Remote status and restrictions
- Salary and source wording
- Employment type
- Date posted when available
- Date checked
- Private job-description snapshot or operator-supplied text
- Why it may fit
- Matching customer experience
- Important requirements
- Honest gaps or concerns
- Internal notes

Do not expose internal notes.

Validate every match against the exact approved criteria version.

Prevent delivery until:

- Exactly 10 approved customer-visible matches exist.
- Every match has a recent check date.
- Every match has a direct URL or documented exception.
- Every match has fit reasoning.
- Every match lists requirements or a deliberate none-listed state.
- Every match lists concerns or a deliberate no-material-gap state.
- No match materially violates approved non-negotiables.
- Search quality checklist is complete.

On delivery:

- Freeze the delivered set.
- Set delivery timestamp.
- Queue the results-ready email once.
- Make the jobs visible in the customer portal.
- Preserve the audit history.

## 18. Implement My ApplyPack job results

The customer sees a private list of exactly 10 delivered job cards.

Each card must include:

- Match number
- Job title
- Company
- Location
- Remote details
- Compensation when listed
- Employment type
- Date posted when available
- Date checked by ApplyPack
- Why the job may fit
- Matching experience
- Important requirements
- Honest gaps or concerns
- Direct employer link

Actions:

```text
View the Employer's Job Posting
Get My Apply Pack for $8
Save for Later
Not for Me
This Conflicts With My Approved Criteria
```

Not for Me:

- Records a customer choice.
- Does not promise a replacement.
- May collect an optional reason.

This Conflicts With My Approved Criteria:

- Opens a structured form.
- References the immutable criteria version.
- Creates an admin review queue.
- Allows accepted no-charge replacement.
- Preserves the original match and decision history.

## 19. Implement Apply Pack selection and dynamic cart

The customer selects jobs directly from her private job cards.

Do not require her to copy URLs into Facebook, email, or a separate form.

Selected state:

```text
Apply Pack Selected
Resume + cover letter
$8
Remove
```

Cart:

- Supports one to 10 unique jobs.
- Shows count and exact total.
- Total equals count times $8.
- Prevents duplicate jobs.
- Includes optional emphasis notes, maximum 500 characters.
- Includes optional do-not-mention notes, maximum 500 characters.
- Asks whether any factual background changed.
- Revalidates selected jobs and availability policy.
- Checks full quantity against capacity.
- Reserves capacity.
- Shows exact expected deadline.
- Requires outcome and submission acknowledgments.

At 320 CSS pixels, the cart must not hide content or keyboard focus.

## 20. Implement the dynamic $8-per-job Stripe payment

Create a one-time $8 Stripe price.

The server calculates quantity from eligible unique selected job records.

Never trust browser quantity or total.

Before checkout:

- Confirm customer ownership.
- Confirm search delivery.
- Confirm each selected job is eligible and not already purchased.
- Confirm job availability or approved freshness state.
- Confirm capacity for the full quantity.
- Lock selected items to the cart.

On verified payment:

- Convert capacity reservation.
- Mark cart paid.
- Create one Apply Pack order per selected job.
- Associate all orders with the same provider payment reference.
- Set one fixed due time per order.
- Mark each selected match purchased.
- Queue one clear confirmation email.
- Audit every created order.

A replayed webhook must not create duplicate orders.

## 21. Implement admin Apply Pack production and delivery

Admin queue must show:

- Customer
- Job title
- Company
- Paid time
- Due time
- Time remaining
- Status
- Assigned admin
- Deliverable readiness
- Blocking issue

Production view must place together:

- Customer profile
- Approved criteria
- Source resume
- Optional old cover letter
- Background notes
- Formatting preference
- Cover-letter voice preference
- Target job snapshot
- Fit reasoning
- Matching evidence
- Important gaps
- Customer emphasis notes
- Customer do-not-mention notes

Admin uploads:

```text
One delivered resume
One delivered cover letter
```

Initial format:

```text
DOCX
```

Use safe private storage.

Quality checklist must block delivery until complete. Include:

- Correct customer identity and contact
- Correct company and position
- No invented metrics
- No invented tools or certifications
- Truthful historical employers and titles
- Natural job-language alignment
- Important gaps not disguised
- Resume opens and is editable
- Cover letter opens and sounds human
- Correct file names
- Correct file-to-job association
- Employer link rechecked
- No PII in logs or analytics

On delivery:

- Set delivered time.
- Make the two files available only to the correct customer.
- Generate safe customer-facing names.
- Queue delivery email once.
- Preserve version history.

## 22. Implement correction requests

The customer may submit the confirmed included number of factual-correction rounds during the confirmed window.

Form fields:

- Resume, cover letter, or both
- Incorrect information
- Correct information
- Location in document

The interface explains that a new job, new strategy, new experience, or complete rewrite is not a factual correction.

Admin can:

- Accept
- Reject as out of scope
- Upload corrected version
- Deliver corrected version
- Close request

Do not delete the audit record of the original version.

## 23. Implement the Match Promise and refund logic

Use the final user-confirmed policy.

At minimum preserve:

- The $20 fee pays for research and delivery against approved criteria.
- Choosing not to apply does not automatically create a refund.
- A material violation of an approved non-negotiable can be reviewed and replaced.
- Changed preferences after research begins do not retroactively invalidate the approved search.
- ApplyPack does not guarantee outcomes.
- Job availability can change.

If admin-triggered refunds are authorized:

- Require an authorized role.
- Show provider and local payment status.
- Require a reason.
- Call Stripe server-side.
- Update local state only from provider-confirmed truth.
- Prevent duplicate or excess refunds.
- Release future capacity only when appropriate.
- Email the customer.
- Audit safely.

## 24. Implement transactional email and inbound business email

Recommended transactional sender:

```text
ApplyPack <orders@mail.applypack.work>
Reply-To: support@applypack.work
```

Recommended public addresses:

```text
support@applypack.work
accessibility@applypack.work
privacy@applypack.work
```

Use the user's approved mailbox or routing provider.

Use Resend when approved for transactional email.

Configure provider-generated SPF and DKIM records.

Configure DMARC safely, beginning with a monitoring policy when approved and tightening only after alignment is verified.

Disable open and click tracking unless the user expressly enables them.

Do not attach private resumes and cover letters to ordinary email. Link to the authenticated portal.

Implement every template in `05_PAYMENTS_EMAIL_DNS_AND_OPERATIONS.md` with HTML and plain text.

Use durable email state and idempotency keys.

Handle retries, bounces, complaints, and permanent failures.

Alert the admin when a delivery-critical message fails.

## 25. Configure DNS and domain safely

Confirm registrar and DNS provider first.

Export or record current DNS before changes.

Preserve all required existing records.

Configure the exact site-host records supplied by the confirmed host.

Recommended canonical site:

```text
https://applypack.work/
```

Redirect:

```text
www to apex
HTTP to HTTPS
```

Add only provider-generated email and verification records.

Do not proxy email records through Cloudflare.

Verify:

- Apex
- `www`
- HTTPS certificate
- Redirects
- Canonical host
- Support inbound email
- Accessibility inbound email
- Privacy inbound email
- SPF
- DKIM
- DMARC alignment
- Transactional delivery
- Reply-To

Enable DNSSEC only when authorized and safe.

Record every change and verification in:

```text
docs/evidence/EMAIL_AND_DNS_REPORT.md
```

## 26. Implement public pages and approved copy

Use `02_SITE_COPY_AND_PAGE_MAP.md`.

Do not turn the homepage into a long text wall.

The homepage uses short problem-and-solution sections plus the visual simulations defined in that document.

Deeper pages contain the explanation.

Required public pages:

```text
/
/how-it-works/
/job-search-help/
/experience-connections/
/before-and-after/
/resume-screening/
/not-just-ai/
/pricing/
/faq/
/about/
/get-started/
/contact/
/accessibility/
/privacy/
/terms/
```

Required private entry:

```text
/my-applypack/
```

Preserve exact critical lines, including:

```text
Finding a job shouldn't become your full-time job.

Your next job doesn't have to look like your last one.

You don't have to know the job title yet.

You may be qualified for more than you think.

You bring the skills. ApplyPack finds where they fit.

Your experience may fit more jobs than you think. ApplyPack makes the connection.

Your resume may meet software before it meets a person.

Not just another AI resume.

Same experience. Better connection.

No one can promise you the job. ApplyPack can make sure you're ready to apply.
```

Do not change them into generic consulting copy.

Use the user's spelling preference and site tone from `DESIGN.md` and the copy file.

Do not use em dashes or en dashes in public copy.

## 27. Accessibility and ADA Title III readiness

Target WCAG 2.2 Level AA.

Do not claim certified, fully ADA compliant, or guaranteed accessible.

Required across public, customer, admin, and payment-return flows:

- Skip link
- Semantic landmarks
- One clear H1
- Logical heading hierarchy
- Keyboard operation
- Visible focus
- No focus hidden by sticky UI
- Persistent form labels
- Fieldsets and legends
- Clear required indicators
- Accessible validation and error summaries
- Status announcements
- Copy and paste in authentication
- Standard file input
- 200 percent text zoom
- 400 percent browser zoom and 320 CSS pixel reflow
- Sufficient text and UI contrast
- No color-only meaning
- Reduced-motion support
- No auto-looping homepage animation
- Accessible tabs and accordions
- Specific link and button names
- Accessible downloads
- Accessible Stripe checkout handoff and return

Automated accessibility scans are necessary but not sufficient.

Perform manual keyboard and screen-reader testing.

Create:

```text
docs/audits/ACCESSIBILITY_REPORT.md
```

## 28. Privacy and security

Implement all controls in `06_SECURITY_PRIVACY_ACCESSIBILITY_SEO.md`.

Non-negotiable:

- Private records remain private.
- Server-side authorization for every private operation.
- Customer isolation tests.
- Admin MFA.
- No client-side service-role secret.
- No PII in Stripe metadata.
- No customer narratives in logs or analytics.
- No permanent public file URLs.
- No private route in public sitemap.
- Rate limits.
- CSRF protection where applicable.
- Safe output encoding.
- File validation.
- Webhook signature verification.
- Idempotency.
- Security headers.
- Secret scanning.
- Dependency review.
- Retention cleanup.
- Backup and recovery documentation.

Create:

```text
docs/audits/SECURITY_REPORT.md
```

No known critical or high-severity security defect may remain at launch.

## 29. SEO and indexing

Implement accurate SEO, not tricks.

Requirements:

- Server-rendered or statically rendered main public copy.
- Unique title and description for each public page.
- One H1.
- Canonical URLs.
- Open Graph data.
- Crawlable real links.
- XML sitemap with public routes only.
- Correct robots.txt.
- Authenticated and noindex private pages.
- No JobPosting schema.
- No fake reviews.
- No fake ratings.
- No FAQ rich-result promises.
- Accurate WebSite, Organization, Service, Offer, and Breadcrumb structured data when applicable.
- Illustrative examples labeled.
- Google Search Console and Bing configuration when authorized.
- IndexNow when compatible and authorized.

Create:

```text
docs/audits/SEO_REPORT.md
```

## 30. Performance

Preserve a fast site.

Targets:

```text
LCP at or below 2.5 seconds
INP below 200 milliseconds
CLS below 0.1
```

Avoid:

- Autoplay video
- Large animation libraries for simple simulations
- Unnecessary chat widgets
- Session replay on private routes
- Multiple tracking pixels
- Layout-shifting banners
- Unoptimized images

Use responsive assets, dimensions, lazy loading below the fold, and minimal third-party scripts.

## 31. Legal and policy pages

Build Privacy, Terms, Accessibility, Pricing, and FAQ content from the handoff and confirmed providers.

Do not represent implementation drafts as attorney-reviewed legal advice.

Do not publish placeholders in production.

Every policy promise must match actual behavior, especially:

- 24-hour start and remedy
- Refunds
- Match replacement
- Resume requirement
- Correction window
- Retention
- AI use
- Payment provider
- Email tracking
- Customer data deletion
- Business legal identity

## 32. Monitoring, scheduled jobs, backups, and runbooks

Implement safe structured logging and alerting.

Required scheduled tasks:

- Expire capacity reservations.
- Send approaching-deadline alerts.
- Mark and alert overdue orders.
- Retry queued transactional email.
- Reconcile paid Stripe sessions that missed processing.
- Delete source documents whose retention date passed.
- Alert on failed cleanup.

Create runbooks:

```text
docs/runbooks/DNS_AND_DOMAIN.md
docs/runbooks/EMAIL_DELIVERABILITY.md
docs/runbooks/STRIPE_PAYMENTS.md
docs/runbooks/REFUNDS.md
docs/runbooks/DEADLINE_AND_CAPACITY.md
docs/runbooks/CUSTOMER_FILE_DELETION.md
docs/runbooks/PRODUCTION_INCIDENT.md
docs/runbooks/ROLLBACK.md
```

Each runbook includes prerequisites, exact safe steps, verification, failure symptoms, recovery, and stop conditions. Never put real secrets in documentation.

## 33. Testing is part of implementation

Use `07_TEST_PLAN_AND_SHIP_CHECKLIST.md` as the minimum test contract.

Run and record:

- Baseline tests
- Formatting
- Lint
- Type checking
- Unit tests
- Migration tests
- Integration tests
- Authentication tests
- Cross-customer isolation tests
- File-upload tests
- Stripe test-mode checkouts
- Webhook signature and replay tests
- Capacity race tests
- Email tests
- End-to-end customer flow
- Admin flow
- Multiple Apply Pack flow
- Criteria conflict flow
- Correction flow
- Failure-path tests
- Security tests
- Accessibility tests
- SEO validation
- Performance tests
- DNS and email verification
- Production smoke tests

Use synthetic customer data only.

Do not use the user's real resume or personal information in automated tests or committed fixtures.

Do not call a test mocked when it actually depends on a live provider, and do not call a provider integration verified when only a mock passed.

## 34. Deployment

Follow the existing repository's deployment model.

Before production:

- All required environment variables configured.
- Test and live keys separated.
- Migrations tested.
- Backup or restore point created before destructive change.
- Preview verified when available.
- Production build passes.
- Public copy has no placeholders.
- DNS change plan recorded.
- Rollback plan recorded.

Deploy only when authorized in the preflight.

After production deployment:

- Verify canonical HTTPS.
- Verify all public routes.
- Verify customer authentication.
- Verify synthetic upload.
- Verify intake persistence.
- Verify Stripe test or live flow according to authorization.
- Verify webhooks.
- Verify customer portal isolation.
- Verify admin MFA and queues.
- Verify transactional email.
- Verify inbound support email.
- Verify private downloads.
- Verify noindex and authentication on private routes.
- Verify monitoring and alerts.

Record deployed commit and provider project identities.

## 35. Live payment proof

If the user authorizes live financial verification in the initial preflight:

1. Run one real $20 Job Match Search checkout.
2. Verify the signed webhook, local payment record, capacity conversion, exact due time, and email.
3. Deliver a synthetic 10-job order.
4. Select one synthetic job.
5. Run one real $8 Apply Pack checkout.
6. Verify one Apply Pack order, due time, email, and delivery.
7. Download synthetic documents through the customer account.
8. Refund the approved live test charges.
9. Verify Stripe and local refund state.
10. Remove synthetic private data through the documented workflow.

Do not perform a live charge without explicit authorization.

If live charges are not authorized, state exactly what remains unverified and do not call live payments fully proven.

## 36. Independent audits

Before final release, run three independent subagent audits when available.

If true subagents are unavailable, perform three separate sequential audits and label them accurately.

### Auditor 1, product and workflow

Attempt to find:

- Wrong prices
- Missing 24-hour rules
- Confusing search criteria
- Fewer or more than 10 jobs
- Broken selection flow
- Wrong cart quantity
- Missing disclaimers
- Incorrect replacement behavior
- Unlimited correction loopholes
- Copy drift

### Auditor 2, security, privacy, and payments

Attempt to find:

- Cross-customer data leaks
- Admin escalation
- Public files
- Weak upload handling
- Webhook replay
- Price manipulation
- Capacity races
- PII in logs or metadata
- Bad retention
- Refund mismatch
- Provider secret exposure

### Auditor 3, accessibility, SEO, and operations

Attempt to find:

- Keyboard blockers
- Missing labels
- Focus obstruction
- Reflow failure
- Screen-reader confusion
- Private indexing
- Invalid metadata
- Broken DNS or email
- Performance regressions
- Missing runbooks or alerts

Fix credible findings and rerun affected tests.

## 37. 10th-man review

After the three audits, assume the consensus is wrong and attempt to prove the site should not ship.

At minimum answer:

- Can Customer A access Customer B's resume or documents?
- Can a customer pay less than the correct amount?
- Can one webhook create duplicate orders?
- Can concurrent checkouts oversell 24-hour capacity?
- Can the site keep accepting orders after capacity is impossible?
- Can a customer reasonably think the $20 guarantees satisfaction with all 10 jobs?
- Can a customer reasonably think ApplyPack guarantees a job?
- Can a stale or closed job still be sold for an Apply Pack?
- Can an admin deliver the wrong customer's files?
- Can a user complete every transaction with keyboard and screen reader?
- Can private pages be indexed?
- Can a provider failure lose a paid order silently?
- Can the public retention promise be false?
- Does the user retain ownership and recovery access to GitHub, hosting, DNS, database, Stripe, and email?

Fix every credible critical or high issue. Record lower risks and require explicit user acceptance before READY WITH ACCEPTED LIMITATIONS.

## 38. Final completion report

Create:

```text
docs/evidence/SHIP_READINESS.md
```

Then give the user a final response in this exact structure:

```text
APPLYPACK SHIP STATUS

Status:
READY TO SHIP | READY WITH ACCEPTED LIMITATIONS | NOT READY

Production URL:

Repository:

Branch:

Deployed commit:

What was completed:

Customer flow proof:

Admin flow proof:

Stripe proof:

Email and DNS proof:

Security proof:

Accessibility proof:

SEO and performance proof:

Data retention and backup proof:

Independent audit findings and fixes:

10th-man findings and fixes:

Known limitations:

Outstanding user-owned actions:

Rollback instructions:

Exact recommendation:
```

Do not say READY TO SHIP when a required credential, production deployment, DNS record, email authentication, live provider integration, migration, security test, accessibility test, or critical workflow is missing.

## 39. Behavior rules for the entire assignment

- Show evidence, not confidence statements.
- Do not invent completed work.
- Do not claim an external account was configured when it was not.
- Do not ask the user to act as a courier between tools when you have direct access.
- Do not request a fact the user already supplied.
- Do not repeat questions already answered in the preflight.
- Do not expose secrets.
- Do not modify unrelated repositories.
- Do not discard user changes.
- Do not use old or stale repository authority.
- Do not change product pricing or scope without direct approval.
- Do not change approved copy casually.
- Do not build beyond the MVP in a way that delays shipping.
- Do not leave required production paths mocked.
- Do not leave silent TODOs.
- Do not treat automated accessibility scans as full proof.
- Do not treat a browser redirect as payment fulfillment.
- Do not treat a UUID as authorization.
- Do not use robots.txt as privacy.
- Do not accept a deadline you cannot meet.

Your first visible response must now be the single consolidated preflight question set. After the user answers, proceed continuously through the complete build and release process.

---

End of prompt.

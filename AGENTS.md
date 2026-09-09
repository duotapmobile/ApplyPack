# AGENTS.md, ApplyPack Repository Rules

## Mission

Build and maintain ApplyPack as a production-ready job-search and application-preparation service.

The service uses one shared four-step profile for three connected products: an optional paid filtered job board, a standalone $20 human-reviewed ranked Top 10 delivered within 24 hours, and an $8 tailored resume-and-cover-letter package for an eligible board job or delivered Top 10 job.

## Read first

Before analysis or edits, read:

1. This `AGENTS.md`
2. Every file under `docs/applypack/`
3. Root `DESIGN.md` when present
4. Repository `README`, `START_HERE`, `PROJECT_MAP`, `PROJECT_STATUS`, `RECOVERY`, and `.agent-guidance` files when present
5. Package, deployment, environment, migration, and test configuration

If the handoff remains outside the repository, read every file in:

```text
C:\Users\mskir\Desktop\Apply_Pack\Chat docs
```

## Authority

Use this order when instructions conflict:

1. User's latest direct instruction
2. `DESIGN.md`, for visual design only
3. `docs/applypack/01_PRODUCT_SOURCE_OF_TRUTH.md`
4. `docs/applypack/02_SITE_COPY_AND_PAGE_MAP.md`
5. `docs/applypack/03_CUSTOMER_AND_ADMIN_WORKFLOWS.md`
6. Remaining ApplyPack handoff documents
7. Existing implementation where compatible

Record material conflicts and resolutions in `docs/evidence/IMPLEMENTATION_DECISIONS.md`.

## Existing site

Preserve the existing site's framework, design, routes, hosting model, package manager, and working behavior unless a change is required for the approved product, security, accessibility, or deployment.

Do not rewrite a working frontend to use a preferred stack.

Do not invent visual design when `DESIGN.md` exists.

## One preflight, then execute

Before implementation, ask all unresolved business decisions, credentials, provider logins, deployment authorizations, and external-action permissions in one consolidated preflight.

Never ask the user to paste passwords, secret keys, recovery codes, or card information into chat.

After the user answers, write the decisions to `docs/evidence/IMPLEMENTATION_DECISIONS.md` and continue through implementation, testing, deployment, provider configuration, and verification without stopping after a plan.

Ask another question only when no safe reversible default exists and guessing could cause data loss, financial loss, security failure, legal misrepresentation, or an unauthorized external action.

## Product invariants

Do not change without direct user approval:

```text
Job Match Search: $20
Job Match Search deliverable: exactly 10 jobs
Job Match Search turnaround: 24 hours
Apply Pack: $8 per selected job
Apply Pack deliverable: one tailored resume and one tailored cover letter
Apply Pack turnaround: 24 hours
Filtered job board: $6.99 weekly, $19.99 monthly, or $44.99 every three calendar months
Filtered job board: no free trial; renews until canceled
Filtered job board: neutral factual sorting only; never ranked or scored
Top 10: no subscription prerequisite
Apply Pack eligibility: active board job or delivered Top 10 job
No auto-apply
No interview, offer, compensation, or employment guarantee
Customer selects which jobs receive Apply Packs
```

Public promise:

```text
We find the jobs. We get you ready to apply.
```

## Truth rules

Never invent:

- Experience
- Job titles
- Employers
- Dates
- Metrics
- Revenue
- Team sizes
- Software
- Certifications
- Results
- Qualifications

Do not promise to beat or bypass an applicant tracking system.

Do not describe illustrative examples as real customers.

## Human review and source automation

- Human review is mandatory for ranked Top 10 delivery, generated documents, and policy-routed exceptions.
- Subscription-board listings are filtered by confirmed rules and are not represented as individually human-reviewed.
- Automated source collection is allowed only for a specifically documented, approved source and environment. Public reachability alone is not permission.
- Source revocation, stale data, parser uncertainty, and missing permission fail closed.
- Generated materials stay unavailable until content and rendered pages receive the required human approvals.

## Privacy and security

Treat resumes, cover letters, employment histories, preferences, and deliverables as private records.

Required:

- Server-side authorization
- Private storage
- Short-lived signed downloads
- Row-level security or an equivalent access-control layer
- Verified Stripe webhooks
- Server-calculated prices
- Idempotent fulfillment
- Rate-limited authentication
- Safe file validation
- No secrets in client code or Git
- No customer content in analytics or logs
- No PII in payment metadata
- Admin MFA

Do not use `robots.txt` as a privacy control.

## Payments

Use Stripe Checkout Sessions unless the existing approved stack has an equivalent secure flow.

The browser success page does not fulfill orders. Verified webhooks do.

A replayed event must not create duplicate orders, capacity consumption, deadlines, or email.

Do not accept Apply Pack quantity or price from the client without server validation.

## 24-hour capacity

Do not accept payment when current capacity makes the displayed deadline impossible.

Capacity reservation and conversion must be atomic.

Store due times in UTC and display the confirmed contractual timezone.

Never silently change a paid order's due time.

## Customer access

Recommended default:

- Email one-time code
- Verify before private upload
- No password required
- Customer can access only her records

Admin access is separate and requires MFA.

## Accessibility

Target WCAG 2.2 Level AA.

Do not claim certified or fully ADA compliant.

Every critical flow must support:

- Keyboard-only operation
- Visible focus
- Screen readers
- Persistent labels
- Clear errors
- 200 percent text zoom
- 320 CSS pixel reflow
- Reduced motion
- Accessible authentication
- Accessible file upload
- Accessible Stripe handoff and return

Automated scans are not enough. Complete manual testing.

## SEO and indexing

- Public marketing pages are crawlable and have unique metadata.
- Private customer, admin, checkout-return, and file routes are authenticated and noindex.
- Do not use JobPosting schema.
- Do not use fake reviews or ratings.
- Structured data must match visible content.
- Sitemap contains public canonical pages only.

## Code quality

- Follow existing repository conventions.
- Preserve the package manager and lockfile.
- Use strict typing where supported.
- Validate at server boundaries.
- Use version-controlled migrations.
- Add unit, integration, and end-to-end tests.
- Add negative tests for authorization, payment replay, capacity races, upload spoofing, and private file access.
- Add clear comments only where behavior is not self-evident.
- Do not leave TODOs in required production paths.
- Do not mock provider success in the final production proof.

## Repository library

The user permits read-only inspection of:

```text
C:\Users\mskir\Desktop\Repos
```

Use it to find compatible patterns and skills.

Do not edit other repositories, copy secrets, or import incompatible licensed code.

Record any reused pattern and source repository.

## Evidence and runbooks

Maintain:

```text
docs/evidence/
docs/audits/
docs/runbooks/
```

Final evidence must cover:

- Repository and deployed commit
- Architecture
- Migrations
- Tests
- Security
- Accessibility
- SEO
- Stripe
- Email and DNS
- Production smoke test
- Known limitations
- Rollback
- Ship status

## Independent review

Before ship declaration, perform:

1. Product and workflow audit
2. Security, privacy, and payment audit
3. Accessibility, SEO, and operations audit
4. 10th-man review that attempts to prove the site should not ship

Use real subagents when available. Otherwise perform separate sequential passes and say that they were sequential, not independent agents.

## Done means ready to ship

Do not declare complete while any required item remains a mock, TODO, unverified DNS record, untested webhook, inaccessible flow, missing credential, undeployed migration, insecure file path, or unresolved critical defect.

Final status must be one of:

```text
READY TO SHIP
READY WITH ACCEPTED LIMITATIONS
NOT READY
```

State evidence and remaining user-owned actions precisely.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

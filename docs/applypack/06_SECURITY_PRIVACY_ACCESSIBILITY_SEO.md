# ApplyPack Security, Privacy, Accessibility, and SEO Requirements

Last updated: September 1, 2026

## Non-negotiable principle

ApplyPack handles resumes, cover letters, employment histories, contact information, private customer preferences, payment records, and private deliverables. These are not ordinary marketing-site records.

Security, privacy, accessibility, and search behavior must be designed into the transaction flow. They are not optional cleanup tasks after the pages work.

# Part 1: Security

## Threat model

At minimum, design and test against:

- One customer viewing another customer's resume, job matches, order, or deliverables.
- A customer granting herself admin access.
- Insecure direct object references through guessed IDs.
- Public or permanent storage URLs.
- Stolen or replayed email one-time codes.
- OTP request abuse and user enumeration.
- Malicious DOCX or PDF uploads.
- File-type spoofing.
- Macro-enabled or password-protected files.
- Stored cross-site scripting in customer notes, job titles, company names, or admin-entered job content.
- Cross-site request forgery on state-changing operations.
- Stripe webhook forgery or replay.
- Client-side price or quantity manipulation.
- Duplicate payment fulfillment.
- Capacity overselling through concurrent checkouts.
- Refund-state mismatch between Stripe and the local database.
- Sensitive content appearing in logs, analytics, monitoring, URLs, or email subjects.
- Server-side request forgery when checking employer URLs.
- Unsafe redirects from employer links.
- Open redirects in authentication or checkout return URLs.
- Admin account takeover.
- Dependency or supply-chain compromise.
- Accidental use of production data in preview or local development.
- Retention jobs failing silently.
- Backup data surviving beyond a public deletion promise.

## Authentication and sessions

### Customers

Recommended:

- Email one-time code.
- Verify before accepting resume upload.
- Generic response whether or not an email exists.
- Rate limits per email, IP, device/session, and time window.
- Bounded code attempts.
- Single-use codes.
- Short code expiration that remains usable, confirm exact value during implementation.
- Secure, HttpOnly, SameSite cookies when the framework uses server sessions.
- Session revocation and sign-out.
- Do not store authentication tokens in URLs longer than required.
- Do not log codes, access tokens, magic links, cookies, or signed URLs.

### Admins

Required:

- Separate server-side admin-role table or provider-managed role assignment.
- MFA for all admin accounts.
- Least privilege roles.
- No admin function authorized only by hidden navigation.
- No service-role secret in client code.
- Re-authentication or equivalent protection for destructive actions such as refunds, admin-role changes, and permanent deletion.
- Owner access retained by the user.

## Authorization

Every private read and write must be authorized server-side.

Required tests:

- Customer A cannot read Customer B's profile.
- Customer A cannot read Customer B's source files.
- Customer A cannot read Customer B's job matches.
- Customer A cannot purchase an Apply Pack for another customer's job.
- Customer A cannot download Customer B's deliverable using a copied ID.
- Customer A cannot update payment status, due time, price, capacity, quality checks, or order status.
- An unauthenticated user cannot access any private route or object.
- A support-role admin cannot perform owner-only actions when roles differ.

Use unpredictable UUIDs, but do not treat UUIDs as authorization.

## Input validation and output encoding

- Validate all fields on the server.
- Use allowlisted enum values.
- Limit lengths for every free-text field.
- Normalize email and URLs carefully.
- Render customer and admin-entered text as text, not raw HTML.
- Sanitize any approved rich text.
- Use parameterized queries or safe ORM behavior.
- Reject unexpected fields where possible.
- Validate state transitions server-side.
- Validate prices and quantities against server constants or Stripe price records.

Recommended maximums:

```text
Full name: 150 characters
City: 100 characters
State: 100 characters
Target title entry: 150 characters each
Optional job emphasis note: 500 characters
Optional do-not-mention note: 500 characters
Long background narrative: 5,000 characters
Correction fields: 2,000 characters each
Contact message: 5,000 characters
```

Adjust only with documented reason.

## File-upload security

Required:

- Accept only confirmed launch formats.
- Validate file extension.
- Validate browser MIME as an untrusted hint.
- Validate magic bytes or container structure.
- Reject macro-enabled Word formats.
- Reject executable files, archives, images, and scripts.
- Reject password-protected or encrypted documents unless supported securely.
- Enforce file count and size limits.
- Generate private internal object names.
- Compute a cryptographic hash.
- Quarantine before acceptance when malware scanning is implemented.
- Store outside the public web root.
- Serve only after authorization with short-lived access.
- Set safe `Content-Disposition` download headers.
- Never execute embedded code or macros.
- Do not automatically send private uploads to an unapproved third party.

If the hosting environment cannot support private malware scanning, resolve the acceptable provider or residual-risk decision during preflight. Do not silently claim files are scanned when they are not.

Official reference:

`https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html`

## Employer URL safety

The admin enters external job URLs. Customer links must:

- Allow only `https` and, when unavoidable, `http` that redirects safely to HTTPS.
- Display the destination host before leaving ApplyPack when practical.
- Use `rel="noopener noreferrer"` for new tabs.
- Reject `javascript:`, `data:`, local-file, and other unsafe schemes.
- Avoid open redirect endpoints.

If the server checks external URLs:

- Block loopback, link-local, private-network, metadata-service, and reserved IP ranges.
- Resolve DNS safely and recheck after redirects.
- Limit redirects.
- Limit response size and timeout.
- Do not send cookies or authorization headers.
- Prefer HEAD or a tightly bounded GET when appropriate.
- Do not treat a successful HTTP response as proof the job is open.

Manual admin verification remains the source of truth for launch.

## Stripe security

- Stripe secret and webhook secrets remain server-side.
- Use hosted Checkout Sessions unless the approved current stack has an equivalent secure flow.
- Verify signatures using the raw request body.
- Store and deduplicate event IDs.
- Calculate price and quantity server-side.
- Do not fulfill from the success-page redirect.
- Do not include PII in metadata.
- Restrict payment methods to the approved immediate-confirmation set.
- Reconcile paid sessions that missed normal webhook processing.
- Log safe provider IDs, not complete event payloads indefinitely.

Official references:

- `https://docs.stripe.com/payments/checkout-sessions`
- `https://docs.stripe.com/payments/checkout/how-checkout-works`
- `https://docs.stripe.com/webhooks`

## CSRF and request integrity

When cookie-based sessions are used:

- Use SameSite cookies.
- Protect state-changing endpoints with framework-standard CSRF controls when required.
- Validate Origin or Referer for sensitive browser requests where appropriate.
- Use POST, PATCH, or DELETE for changes, never GET.
- Require fresh admin authorization for destructive operations.

## Rate limiting and abuse controls

At minimum, rate-limit:

- OTP requests
- OTP verification attempts
- Contact form
- File upload initiation
- Checkout creation
- Conflict reports
- Correction requests
- Signed download generation
- Admin login

Rate-limit by a combination of user, email hash, IP, and endpoint. Avoid logging the full email in third-party rate-limit keys.

## Security headers

Implement and verify a policy compatible with the current framework:

```text
Content-Security-Policy
Strict-Transport-Security
X-Content-Type-Options: nosniff
Referrer-Policy
Permissions-Policy
frame-ancestors through CSP
Cross-Origin-Opener-Policy when compatible
```

Do not break Stripe Checkout, authentication, or required provider scripts. Keep CSP narrow and documented.

## Secrets

- No secret values in Git.
- No secret values in `AGENTS.md`, prompts, documentation, screenshots, or logs.
- Use `.env.example` with placeholders only.
- Use environment-scoped secret stores.
- Rotate any exposed secret immediately.
- Prefer restricted provider keys.
- Record who owns each provider account.
- Require MFA on GitHub, host, DNS, Stripe, database, storage, email, and monitoring.

## Dependencies

- Preserve the existing package manager and lockfile.
- Add the fewest necessary packages.
- Check licenses.
- Run dependency and vulnerability scans.
- Remove unused packages.
- Pin or constrain versions according to repository policy.
- Do not import an entire template or framework to solve one integration.

## Logging and monitoring

Logs may include:

- Request ID
- Safe user or order UUID
- Safe route name
- Status transition
- Provider event ID
- Error code
- Timing

Logs must not include:

- Resume text
- Cover-letter text
- Customer narratives
- Full email addresses when avoidable
- File contents
- Authentication codes
- Access tokens
- Cookies
- Signed URLs
- Stripe secret or complete webhook payload
- Payment card data

Monitoring and analytics must redact request bodies on intake, upload, contact, correction, payment, and admin routes.

# Part 2: Privacy

## Data inventory

The implementation must document every category collected:

```text
Identity and contact
Email verification and session data
Location and work authorization
Employment history
Education and certifications
Skills and tools
Career preferences and exclusions
Uploaded resume and optional cover letter
Job-match decisions
Selected jobs
Customer notes
Generated deliverables
Correction requests
Payments and refunds
Support messages
Security and audit events
```

For each category, record:

- Purpose
- Collection point
- Storage provider
- Access roles
- Retention period
- Deletion behavior
- Third-party sharing
- Whether included in backups

## Data minimization

Do not collect unless required:

- Full street address
- Social Security number
- Full birth date
- Driver's license
- Children's names
- Medical information
- Marital status
- Race
- Religion
- Pregnancy
- Disability information
- Banking details

If a customer voluntarily types sensitive information into a free-text field, do not copy it into unrelated records or third-party systems.

## AI-assisted processing

The site must accurately describe the actual process.

Before using any AI provider with customer content:

- Confirm provider terms.
- Confirm retention settings.
- Confirm whether API content is used for model training.
- Use the lowest-retention configuration available.
- Limit content to what is needed.
- Remove direct identifiers when practical.
- Do not send payment data, authentication data, or unrelated customer records.
- Record the provider in the Privacy Policy.

If the first release is manual and no production AI API receives customer data, say so in the implementation decision log. Do not add an AI provider unnecessarily.

## Retention

Recommended source-document retention, pending confirmation:

```text
30 days after the relevant order is completed
```

Define separately:

- Source resumes and old cover letters
- Delivered resumes and cover letters
- Job results
- Search criteria
- Payment and refund records
- Customer account/profile
- Support messages
- Security and audit logs
- Backups

A public deletion promise must account for backups and provider retention. Use wording such as deleted from active systems when backup deletion is delayed and explain the backup cycle.

## Customer rights and requests

Provide a supported process for:

- Access to private files and orders
- Correction of account information
- Deletion request
- Source-document early deletion
- Email-preference control
- Privacy questions

Route:

```text
/privacy/
```

Contact:

```text
privacy@applypack.work
```

Do not promise statutory rights that do not apply universally. State practical service rights accurately and update when legal review requires.

## Payment privacy

- Stripe processes card information.
- ApplyPack stores provider references, amount, currency, status, and refund information.
- ApplyPack does not store complete card numbers or security codes.
- The Privacy Policy must name Stripe and link to or identify its role as payment processor.

## Email privacy

Recommended:

- Open tracking disabled.
- Click tracking disabled.
- No resume attachments in ordinary email.
- No job-search criteria in subject lines.
- No sensitive customer narrative in email previews.
- Portal links require authentication.

## Analytics privacy

Allowed event dimensions:

```text
page_name
section_name
button_name
utm_source
utm_medium
utm_campaign
utm_content
intake_step_number
number_of_apply_packs_selected
```

Never send:

```text
name
email
phone
resume filename
resume text
cover-letter text
customer narrative
job-application answer
private job notes
signed URL
order access token
```

Disable session replay and heatmaps on:

```text
/get-started/
/my-applypack/
/admin/
/api/
checkout return routes
contact forms
upload routes
private files
```

# Part 3: Accessibility and ADA Title III readiness

## Legal positioning

ApplyPack should be designed, built, manually tested, and maintained with accessibility in mind.

Public statement:

```text
ApplyPack aims to conform to WCAG 2.2 Level AA.
```

Do not claim:

```text
100% ADA compliant
ADA certified
Guaranteed accessible
```

The United States Department of Justice states that the ADA applies to goods and services offered on the web by public accommodations, while technical implementation should rely on recognized accessibility guidance and real testing.

Official references:

- `https://www.ada.gov/resources/web-guidance/`
- `https://www.w3.org/TR/WCAG22/`
- `https://www.w3.org/WAI/WCAG22/Understanding/`

## Semantic structure

Every page needs:

```html
<a href="#main-content" class="skip-link">Skip to main content</a>
<header>...</header>
<nav aria-label="Primary navigation">...</nav>
<main id="main-content">...</main>
<footer>...</footer>
```

Requirements:

- One clear H1 per page.
- Heading levels reflect structure.
- Real lists for sequences and features.
- Real buttons for actions.
- Real links for navigation.
- Tables only for true tabular data.
- Landmarks have meaningful labels when repeated.
- Page language set to `en-US` unless the content changes.
- Every page has a descriptive title.

## Keyboard

All functionality must work with keyboard alone.

Required:

- Logical focus order.
- Visible focus indicator.
- No keyboard traps.
- Escape closes dismissible dialogs.
- Focus moves into a modal and returns to the trigger.
- Tabs follow the WAI tab pattern.
- Accordions use native buttons with `aria-expanded` and `aria-controls`.
- File selection has a standard keyboard-operable input.
- Employer links and downloads have descriptive names.

## Focus visibility and obstruction

- Do not remove browser focus without an equal or stronger replacement.
- Focus must remain visible.
- Sticky headers, banners, and cart bars cannot entirely obscure the focused item.
- Provide sufficient scroll padding.
- Test focus at 400 percent zoom and on mobile layouts.

## Color and contrast

- Normal text at least 4.5:1.
- Large text at least 3:1.
- Essential UI boundaries and states at least 3:1 where required.
- Do not communicate required, included, excluded, paid, failed, or selected states by color alone.
- Pair check and cross icons with text headings such as Keep and Leave Behind.
- Do not use low-contrast placeholder text as the only label.

## Text resize and reflow

Test:

- 200 percent text zoom.
- 400 percent browser zoom.
- 320 CSS pixel equivalent width.
- No horizontal page scrolling except genuinely two-dimensional content.
- No clipped headings, buttons, checkboxes, deadlines, prices, or job-card actions.
- Tables or grids have an accessible small-screen alternative.

Official reference:

`https://www.w3.org/WAI/WCAG22/Understanding/reflow.html`

## Motion

Homepage simulations:

- Run once.
- Do not loop.
- Keep short.
- Preserve the final state.
- Respect `prefers-reduced-motion: reduce`.
- Do not flash.
- Do not require animation to understand the content.
- Do not use parallax.

Avoid auto-rotating carousels. If one is required by `DESIGN.md`, include stop, previous, next, and full keyboard and screen-reader behavior.

## Forms

Every form must have:

- Persistent visible labels.
- Required communicated in text.
- Fieldsets and legends for grouped choices.
- Instructions before the control.
- Clear examples that do not replace labels.
- Server and client validation.
- Error summary linked to invalid fields.
- Inline error association using `aria-describedby` or equivalent.
- Entered values preserved after errors.
- Error messages that explain how to fix the issue.
- Status messages announced without stealing focus unnecessarily.
- No automatic submission on focus or selection unless clearly expected.
- No short time limit.
- A review and correction step before payment.

For legal, financial, and data submission, let the customer review, correct, and confirm before final submission.

## Accessible authentication

- Permit copy and paste of codes.
- Use autocomplete tokens when supported.
- Do not require memory puzzles or transcription tests.
- Do not use inaccessible CAPTCHA.
- Provide clear resend and error behavior.
- Do not prevent password managers or assistive tools.

## File uploads

- Standard Choose File control remains available.
- Drag and drop is optional enhancement only.
- Announce upload progress and result.
- Display file name, type, and size.
- Provide Replace and Remove actions.
- Explain rejected files in plain language.
- Do not require precision dragging.

## Private job cards

Every action must have a specific accessible name, for example:

```text
Get an Apply Pack for Client Onboarding Coordinator at BrightPath Software, $8
```

Avoid:

```text
Get It
Learn More
Click Here
```

where the destination or action is not clear from context.

## Download links

Use names such as:

```text
Download resume for Client Onboarding Coordinator at BrightPath Software, Microsoft Word document
```

Do not rely only on a file icon.

## Status and deadlines

Do not rely on progress color. Use text such as:

```text
Research in progress
Due September 2, 2026 at 4:15 PM Eastern Time
```

Use polite status announcements for user-triggered changes. Do not repeatedly announce a countdown timer.

## Third-party checkout

Test Stripe Checkout with:

- Keyboard only
- Screen reader
- 200 percent zoom
- Mobile viewport
- Error state
- Return flow

Provide a monitored alternative contact if a customer reports an accessibility barrier in a third-party payment component.

## Accessibility statement

Link from every page footer.

Contact:

```text
accessibility@applypack.work
```

The statement must include:

- WCAG 2.2 Level AA target.
- Current testing approach.
- How to report a barrier.
- How to request an accessible alternative.
- Date last reviewed.
- Known limitations when any exist.

## Accessibility testing

Automated testing is not enough.

Required before production:

```text
axe-based automated tests
Lighthouse accessibility review
HTML validation where practical
color-contrast verification
keyboard-only walkthrough
NVDA with Chrome or Firefox on Windows
VoiceOver with Safari on iPhone or Mac when available
200 percent text zoom
400 percent browser zoom and 320 CSS pixel reflow
reduced-motion mode
Windows high-contrast or forced-colors mode
form-error walkthrough
OTP flow
file upload
Stripe checkout
private job selection
document downloads
admin dashboard critical paths
```

Record findings and resolutions in `docs/audits/ACCESSIBILITY_REPORT.md`.

# Part 4: SEO and public search behavior

## SEO principle

There are no hidden metadata hacks that guarantee ranking.

The implementation must provide:

- Useful original content.
- Clear public site architecture.
- Crawlable server-rendered or statically generated HTML.
- Accurate titles and descriptions.
- Internal links.
- Correct canonical URLs.
- Sitemap and robots behavior.
- Fast mobile experience.
- Accurate structured data.
- No public exposure of private customer pages.

Official references:

- `https://developers.google.com/search/docs/essentials`
- `https://developers.google.com/search/docs/fundamentals/creating-helpful-content`
- `https://developers.google.com/search/docs/appearance/title-link`
- `https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag`
- `https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data`

## Public rendering

- Main copy exists in initial HTML.
- Do not make essential content depend on animation, canvas, or click-only disclosure.
- Use crawlable `<a href>` links.
- Do not use buttons as navigation.
- Do not hide key marketing text in images.
- Preserve a logical document order on mobile and desktop.

## Canonical URL

Recommended, pending DNS confirmation:

```text
https://applypack.work/
```

Redirect HTTP and `www` alternatives to the canonical host.

Use consistent canonical URLs in:

- `<link rel="canonical">`
- Open Graph
- structured data
- XML sitemap
- internal links
- email links

## Page metadata

Every public page needs:

- Unique title.
- Unique meta description.
- One clear H1.
- Canonical URL.
- Open Graph title, description, URL, and image.
- Meaningful Open Graph image alt text when supported.

Do not add a meta-keywords tag.

## Sitemap

Generate an XML sitemap containing public canonical URLs only.

Exclude:

```text
/my-applypack/
/admin/
/api/
checkout success and cancel routes
private files
customer result pages
preview-only routes
```

Use accurate `lastmod` only when a material change occurs.

## robots.txt

Recommended shape, adapt to framework:

```text
User-agent: *
Allow: /

Disallow: /api/
Disallow: /admin/
Disallow: /my-applypack/

Sitemap: https://applypack.work/sitemap.xml
```

Do not use robots.txt as a privacy control. Private routes require authentication.

## Meta robots

Public pages:

```text
index, follow
```

Private customer and admin pages:

```text
noindex, nofollow, noarchive
```

Order confirmation and checkout return pages:

```text
noindex, follow
```

Do not block a page in robots.txt when a crawler must read its noindex directive, but authentication remains the real protection for private content.

## Structured data

Recommended public types:

```text
WebSite
Organization
Service
Offer
BreadcrumbList
AboutPage
Person, only for the real founder page
```

Do not use:

```text
JobPosting
fake Review
fake AggregateRating
QAPage for a company-written FAQ
LocalBusiness for a purely online business without a qualifying customer-facing location or service area
```

Structured data must match visible page content.

## Suggested homepage structured data

The implementation should generate JSON-LD equivalent to:

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": "https://applypack.work/#website",
      "url": "https://applypack.work/",
      "name": "ApplyPack",
      "alternateName": ["Apply Pack", "applypack.work"]
    },
    {
      "@type": "Organization",
      "@id": "https://applypack.work/#organization",
      "name": "ApplyPack",
      "legalName": "[CONFIRMED LEGAL ENTITY]",
      "url": "https://applypack.work/",
      "email": "support@applypack.work"
    },
    {
      "@type": "Service",
      "name": "ApplyPack Job Match Search",
      "serviceType": "Job-search research",
      "offers": {
        "@type": "Offer",
        "price": "20.00",
        "priceCurrency": "USD"
      }
    },
    {
      "@type": "Service",
      "name": "ApplyPack Tailored Resume and Cover Letter",
      "serviceType": "Application document preparation",
      "offers": {
        "@type": "Offer",
        "price": "8.00",
        "priceCurrency": "USD"
      }
    }
  ]
}
```

Replace placeholders only after confirmation.

## Search console and Bing

When authorized:

- Verify the domain property in Google Search Console.
- Submit the sitemap.
- Request indexing for the homepage and major public pages after production launch.
- Verify in Bing Webmaster Tools.
- Submit the sitemap.
- Configure IndexNow if compatible.
- Record verification ownership and recovery.

## Performance and Core Web Vitals

Targets at the 75th percentile when measured with real users:

```text
LCP at or below 2.5 seconds
INP below 200 milliseconds
CLS below 0.1
```

Implementation rules:

- Preserve the current fast frontend.
- Avoid autoplay video.
- Avoid a large animation library for simple homepage simulations.
- Use system fonts unless `DESIGN.md` requires a hosted font and performance remains acceptable.
- Reserve dimensions for images and dynamic content.
- Optimize and size images responsively.
- Lazy-load below-the-fold images.
- Do not lazy-load the primary hero asset.
- Defer nonessential analytics.
- Minimize third-party scripts.
- Keep private portal functionality responsive on low-powered mobile devices.

## Content quality

- Do not create mass-produced location pages.
- Do not promise qualifications or job outcomes.
- Label illustrative examples.
- Use real founder authorship where appropriate.
- Add reviewed dates to educational content.
- Explain how AI-assisted tools are used when relevant.
- Do not keyword-stuff.
- Do not hide keywords.
- Do not generate thin pages solely to capture search traffic.

## SEO verification artifacts

Create:

```text
docs/audits/SEO_REPORT.md
```

Include:

- Public route inventory.
- Titles and descriptions.
- Canonicals.
- Indexing directives.
- Sitemap contents.
- robots.txt.
- structured-data validation.
- broken-link results.
- performance results.
- Search Console and Bing status.
- Remaining indexing uncertainty.

## External job-source security

- Fetch only configured HTTPS origins through a source-specific allowlist.
- Reject redirects, oversized responses, unsupported structured payloads, and non-HTTP application URLs.
- Bound request time, interval, and posting count; stop on rate limits without blind retries.
- Never bypass robots controls, CAPTCHAs, authentication, or access restrictions.
- Treat job descriptions as untrusted text. Do not execute embedded markup or expose source content as HTML.
- Do not label an application link official unless it matches the configured official or alternate source host.
- Keep unsupported sources link-only or pending rather than adding a one-off scraper.
- Enforce permanent exclusions at normalization, persistence, result, and checkout boundaries.

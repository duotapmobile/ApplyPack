# ApplyPack Payments, Email, DNS, and Operations

Last updated: September 1, 2026

## Provider rule

Inspect the existing site and provider accounts first. Reuse a secure compatible provider already in production rather than creating duplicate systems.

Recommended defaults apply only when the user approves them in the consolidated preflight:

```text
Payments:
Stripe hosted Checkout Sessions

Transactional email:
Resend

Inbound support email:
Cloudflare Email Routing to an existing inbox, or a paid mailbox provider selected by the user

Authoritative DNS:
The domain's current DNS provider

Database, customer auth, and private storage:
Supabase when no compatible backend already exists
```

## DNS safety procedure

Before changing DNS:

1. Confirm the registrar and authoritative nameservers.
2. Export or record every existing DNS record.
3. Record the current website origin and host verification records.
4. Identify existing MX, SPF, DKIM, DMARC, CAA, and TXT records.
5. Confirm which records belong to the site host, email provider, payment provider, and domain verification.
6. Preserve records that are still needed.
7. Never replace the entire DNS zone without a reviewed migration plan.
8. Make one bounded change set at a time.
9. Verify each provider after propagation.
10. Keep a dated DNS change log with before and after values, excluding secret values.

Do not change nameservers merely because Cloudflare is a recommended option. Change them only if the user authorizes migration to Cloudflare and all existing records have been preserved.

## Canonical website DNS

Recommended canonical URL, pending confirmation:

```text
https://applypack.work/
```

Recommended behavior:

```text
https://www.applypack.work/ → permanent redirect to https://applypack.work/
http://applypack.work/ → HTTPS
http://www.applypack.work/ → HTTPS and canonical host
```

The exact A, AAAA, CNAME, ALIAS, or verification records come from the confirmed hosting provider. Do not invent them.

If Cloudflare is the DNS provider:

- Web-serving A, AAAA, or CNAME records may be proxied only when compatible with the host.
- Email, domain-verification, DKIM, SPF, and MX records remain DNS-only.
- Add comments or tags to records when supported.
- Enable DNSSEC only after the zone is stable and the registrar flow is understood.

## Business email architecture

The business needs two different capabilities:

### Human inbox

Customers need addresses that receive replies and support messages.

Recommended public addresses:

```text
support@applypack.work
accessibility@applypack.work
privacy@applypack.work
```

Optional later:

```text
billing@applypack.work
hello@applypack.work
```

For a low-cost launch, Cloudflare Email Routing can forward these addresses to an existing verified inbox when the domain uses Cloudflare DNS.

For a full mailbox with native sending, calendar, and folders, use the mailbox provider approved in the preflight.

Do not claim an address is monitored until routing and reply behavior are tested.

### Transactional sender

Recommended:

```text
From: ApplyPack <orders@mail.applypack.work>
Reply-To: support@applypack.work
```

Use a sending subdomain such as:

```text
mail.applypack.work
```

This separates transactional sending reputation and avoids unnecessary collision with root-domain inbox records.

Do not send from an address that cannot receive replies unless Reply-To is explicitly set to a monitored address.

## Transactional email DNS

The sending provider generates exact records. The agent must add the provider-generated values rather than copy placeholders from this document.

Expected record categories:

```text
SPF record for the sending subdomain
DKIM record or records for the sending subdomain
Provider return-path or bounce-handling MX/CNAME record when required
DMARC policy at the root domain
```

SPF rules:

- Do not create multiple SPF TXT records for the same hostname.
- Merge authorized senders only when the provider requires the same hostname.
- Prefer a dedicated sending subdomain to reduce root SPF complexity.
- Verify actual SPF pass after setup.

DKIM rules:

- Use the exact selector and key supplied by the provider.
- Keep the record DNS-only.
- Verify DKIM pass with a real test message.

DMARC recommended rollout, pending user approval:

```text
Host: _dmarc.applypack.work
Initial policy: p=none
Aggregate reporting address: a dedicated monitored address or DMARC reporting service
```

Move to quarantine or reject only after confirming all legitimate senders align correctly. Do not publish a strict policy prematurely and break legitimate mail.

## Email privacy settings

Recommended defaults:

- Disable open tracking.
- Disable click tracking.
- Do not place sensitive information in email subject lines.
- Do not attach customer resumes or cover letters to ordinary email.
- Link customers to their authenticated My ApplyPack workspace.
- Do not put permanent signed storage URLs in email.
- Use idempotency keys to prevent duplicate messages.
- Use plain-text alternatives for every HTML email.
- Include the exact deadline in confirmation messages.

## Email templates

### Authentication code

Subject:

```text
Your ApplyPack access code
```

Body:

```text
Your one-time ApplyPack code is:

[CODE]

This code expires at [TIME].

If you did not request this code, you can ignore this email.
```

Do not include private order details before authentication.

### Search purchase confirmation

Subject:

```text
Your ApplyPack search has started
```

Body:

```text
Hi [FIRST NAME],

We received your completed intake and $20 payment.

Your 10 matched job opportunities will be ready by:

[DATE]
[TIME AND TIMEZONE]

Use the button below to view your status and results.

[Open My ApplyPack]

ApplyPack does not guarantee interviews, offers, or employment. Employers make all hiring decisions.
```

### Search results delivered

Subject:

```text
Your 10 ApplyPack job matches are ready
```

Body:

```text
Hi [FIRST NAME],

Your 10 matched job opportunities are ready.

Review each job, see why it may fit, and choose the ones you want to pursue.

Application materials are optional and cost $8 per selected job.

[View My 10 Jobs]
```

### Apply Pack purchase confirmation

Subject:

```text
Your Apply Pack order has started
```

Body:

```text
Hi [FIRST NAME],

We received your order for [COUNT] Apply Pack[s].

Your tailored resumes and cover letters will be ready by:

[DATE]
[TIME AND TIMEZONE]

[View My Apply Packs]
```

### Apply Pack delivered

Subject:

```text
Your resume and cover letter are ready
```

Body:

```text
Hi [FIRST NAME],

Your Apply Pack for [JOB TITLE] at [COMPANY] is ready.

Review every detail before submitting your application.

[Download My Apply Pack]
```

### Criteria conflict submitted

Subject:

```text
We received your job-match review request
```

Body:

```text
Hi [FIRST NAME],

We received your report that [JOB TITLE] at [COMPANY] may conflict with your approved search criteria.

We will compare the job with the exact criteria approved for your order and update the status in My ApplyPack.

[View My ApplyPack]
```

### Factual correction submitted

Subject:

```text
We received your Apply Pack correction request
```

Body:

```text
Hi [FIRST NAME],

We received your factual correction request for [JOB TITLE] at [COMPANY].

You can follow the status in My ApplyPack.

[View My ApplyPack]
```

### Capacity notification

Subject:

```text
A 24-hour ApplyPack spot is available
```

Body:

```text
A new 24-hour delivery spot is available.

Availability can change as orders are placed.

[Start My Search]
```

Do not promise a reserved spot unless the system actually reserves one.

## Stripe product and price model

Create in Stripe test mode first.

Recommended products:

```text
Product: ApplyPack Job Match Search
One-time price: $20 USD
Internal lookup key: job_match_search_usd_2000
```

```text
Product: ApplyPack Resume and Cover Letter
One-time unit price: $8 USD
Internal lookup key: apply_pack_usd_800
```

Use one unit of the $8 price for each selected job. The server calculates and validates quantity from eligible selected job records. The browser cannot set a lower price or arbitrary quantity.

Do not use subscriptions.

## Stripe Checkout behavior

Use hosted Checkout Sessions unless the confirmed site already has an equally secure compatible integration.

### Search checkout creation

Server validates:

- Customer is authenticated.
- Email is verified.
- Intake is complete.
- Search criteria are approved.
- No active paid search already exists for the same approved criteria unless an intentional second order is allowed.
- Capacity is available and reserved.
- Price is exactly $20 USD.

Checkout Session contains:

```text
mode: payment
one $20 line item
success URL with safe session reference
cancel URL returning to review page
customer email or existing Stripe customer, as appropriate
internal order ID in metadata
```

Do not put name, resume text, search criteria, job titles, or other customer PII in Stripe metadata.

### Apply Pack checkout creation

Server validates:

- Customer owns the delivered search and selected matches.
- Selected jobs are eligible.
- Each selected job has not already been purchased.
- Each selected job meets the configured freshness check.
- Capacity exists for the full quantity.
- Total equals selected count times $8.
- The customer confirmed selected jobs and acknowledgments.

Checkout Session contains:

```text
mode: payment
one $8 line item with validated quantity
internal cart ID in metadata
success URL with safe session reference
cancel URL returning to cart
```

### Payment methods

Because the 24-hour clock begins on successful payment, enable only payment methods that produce a sufficiently immediate, reliable paid state for the launch flow. Do not begin work on a merely pending payment.

Wallets may appear through Stripe Checkout when supported and enabled.

The final enabled methods must be tested in the confirmed business country and currency.

## Webhook events

At minimum, handle:

```text
checkout.session.completed
checkout.session.expired
charge.refunded or refund.updated, based on integration
charge.dispute.created
```

If any asynchronous payment method is enabled, also handle the relevant asynchronous success and failure events. The recommended launch configuration avoids delayed methods.

Webhook requirements:

- Receive the raw request body.
- Verify the Stripe signature with the environment-specific webhook secret.
- Reject invalid signatures.
- Store provider event ID and processing status.
- Make processing idempotent.
- Do not create duplicate orders on replay.
- Return promptly after durable recording when asynchronous processing is used.
- Alert on repeated processing failure.

### Fulfillment behavior

Search payment success:

```text
convert capacity reservation
mark payment paid
set payment_confirmed_at
set work_ready_at
calculate due_at
move search order to ready_for_research
queue purchase confirmation email
write safe audit event
```

Apply Pack payment success:

```text
convert capacity reservation
mark cart paid
create one Apply Pack order per selected job
set shared payment confirmation timestamp
calculate due_at for each order
move each order to ready_to_draft
mark matches apply_pack_purchased
queue confirmation email
write safe audit events
```

The browser success page only reads fulfillment state. It does not create paid orders.

## Checkout expiration and capacity release

Stripe Checkout Sessions may expire. The application also has an internal capacity reservation expiration.

Requirements:

- Set a reasonable reservation period, recommended 15 to 30 minutes.
- Align the checkout session expiration when practical.
- Release capacity when checkout expires, is cancelled, or fails.
- Prevent an expired cart from converting without a fresh capacity check.
- Do not leave abandoned reservations consuming capacity.

## Refund operations

Final rules require user confirmation.

Admin refund flow should:

1. Show payment, order, work status, amount, and policy reason.
2. Require an authorized admin role.
3. Require a reason code.
4. Call Stripe server-side.
5. Record provider refund ID and amount.
6. Update local payment and order status idempotently.
7. Release future capacity only when appropriate.
8. Email the customer.
9. Audit the action.

Never mark a payment refunded locally before provider confirmation.

## Stripe taxes and receipts

The user must decide in preflight whether Stripe Tax or another tax workflow is needed. Do not make a legal tax conclusion in code.

Confirm:

- Legal seller name
- Business address
- Customer-facing statement descriptor
- Receipt email setting
- Whether Stripe collects billing addresses
- Whether taxes are included, added, or not collected based on professional advice

The public price, checkout price, and receipt must agree.

## 24-hour operations

### Search capacity

Configurable setting:

```text
maximum new 10-job searches accepted per rolling 24-hour period
```

A search consumes one search unit.

### Apply Pack capacity

Configurable setting:

```text
maximum Apply Packs accepted per rolling 24-hour period
```

Each selected job consumes one Apply Pack unit.

### Deadline display

Before checkout, show:

```text
Estimated delivery deadline based on a successful payment now:
[DATE AND TIME]
```

After verified payment, show contractual deadline:

```text
Your delivery deadline:
[DATE AND TIME]
```

### Internal alerts

Recommended thresholds:

```text
12 hours remaining
6 hours remaining
2 hours remaining
past due
```

Send alerts to the confirmed operator address. Do not include private resume content in alert subjects or third-party payloads.

### Missed deadline

The exact remedy must be confirmed. Recommended behavior:

- Immediately mark the order overdue internally.
- Notify the admin.
- Do not falsify the due time.
- Give the customer a clear status.
- Allow cancellation and refund of unfinished work when the miss is within ApplyPack's control, if that policy is approved.

## Job availability checks

For each delivered match:

- Record `date_checked`.
- Prefer the direct employer page.
- Mark salary, benefits, and remote status unknown when not published.
- Do not infer facts from an aggregator when the employer page conflicts.

Before Apply Pack purchase:

- Recheck the direct employer URL or require a recent manual check.
- Block purchase when the job is confirmed closed.
- If availability cannot be verified, disclose that state before payment and require the policy chosen in preflight.

After Apply Pack payment:

- If the job closes before work begins, follow the approved transfer or refund policy.
- If the job closes after delivery, do not automatically refund completed work.

## DNS and email verification checklist

Website:

```text
Apex resolves correctly
www resolves and redirects correctly
HTTP redirects to HTTPS
Certificate is valid
Canonical URL is correct
No mixed content
```

Inbound email:

```text
support address receives an external test
accessibility address receives an external test
privacy address receives an external test
reply flow works from the chosen mailbox
spam handling is reviewed
```

Transactional email:

```text
Sending domain verified
SPF passes
DKIM passes
DMARC aligns
Reply-To reaches monitored support inbox
Plain-text part exists
Links go to the canonical HTTPS site
No sensitive data is in subject lines
No open or click tracking when disabled by policy
Test sends reach Gmail, Outlook, and another provider when available
Bounce and complaint events are handled
```

Payments:

```text
$20 test checkout succeeds
$8 one-item test checkout succeeds
multiple $8 quantities succeed
cancel flow releases capacity
expired flow releases capacity
webhook replay is idempotent
refund synchronization works
unauthorized price manipulation fails
```

## Provider-account security

For Stripe, DNS, hosting, Supabase, Resend, GitHub, and mailbox accounts:

- Use the user's own account ownership.
- Enable MFA.
- Create least-privilege team access when available.
- Do not share root passwords.
- Do not paste secrets in chat.
- Use restricted API keys when supported.
- Rotate any secret accidentally exposed.
- Record recovery ownership and billing contact.
- Confirm the user retains owner access before declaring launch complete.

## Operational runbooks to create in the repository

The executing agent must create:

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

Each runbook must include:

- Purpose
- Prerequisites
- Exact dashboard or command path
- Safe verification
- Failure symptoms
- Recovery steps
- Escalation or stop condition
- No real secret values

## Official implementation references

The executing agent must recheck current official documentation during implementation.

- Stripe Checkout Sessions: `https://docs.stripe.com/payments/checkout-sessions`
- Stripe Checkout lifecycle and fulfillment: `https://docs.stripe.com/payments/checkout/how-checkout-works`
- Stripe webhooks and signature verification: `https://docs.stripe.com/webhooks`
- Supabase documentation: `https://supabase.com/docs`
- Supabase authentication: `https://supabase.com/docs/guides/auth`
- Resend domain verification: `https://resend.com/docs/dashboard/domains/introduction`
- Resend SMTP: `https://resend.com/docs/send-with-smtp`
- Resend DMARC: `https://resend.com/docs/dashboard/domains/dmarc`
- Cloudflare DNS: `https://developers.cloudflare.com/dns/`
- Cloudflare email routing: `https://developers.cloudflare.com/email-service/get-started/route-emails/`

# Provider evidence checklist

Secrets, personal addresses, full DNS token values, customer content, and payment details do not belong in this file.

Apply the October23 sandbox-validation amendment, October24 retention amendment and October25 confirmed-intake/service-error amendment before historical launch instructions. This is an evidence checklist, not authorization to provision resources, change provider data or open purchasing. Use locked forward recovery: disable new checkout and intake, preserve paid obligations, ordinary refunds, historical reconciliation, retained customer access and required maintenance, then restore or repair forward. Never assume the old application is compatible with a newer database.

## DNS and email

- [ ] Export the complete current Namecheap zone before mutation.
- [ ] Record each intended add/change/delete and verify unrelated nameservers and records are preserved.
- [ ] Confirm the existing monitored inbox and forwarding destination without displaying it in logs or commits.
- [ ] Configure the minimum aliases: help@applypack.work, orders@applypack.work, admin@applypack.work.
- [ ] Verify Resend SPF and DKIM from the exact provider-generated values.
- [ ] Add DMARC in monitoring mode only and confirm the aggregate-report destination exists.
- [ ] Configure Supabase custom SMTP and both confirmation and magic-link templates to show {{ .Token }} as the six-digit ApplyPack code.
- [ ] Disable email open/link tracking.
- [ ] Authenticate the founder-approved Gmail inbox through the provider flow.
- [ ] Verify code delivery, order mail, Reply-To, authentication results, spam placement where observable, failure/retry handling, SPF, DKIM, and DMARC.

## Stripe sandbox and live-account readiness

- [ ] Product Job Match Search, one-time USD price 1899 cents.
- [ ] Product Tailored Resume + Cover Letter, one-time USD price 799 cents per selected job.
- [ ] Verify the exact sandbox account, test mode, staging project/origin and final frozen release SHA before the hosted journey. Retain previous sandbox credentials, webhook configuration and history; inspect application obligations before switching accounts and preserve required account-specific processing.
- [ ] Account statement descriptor APPLYPACK.
- [ ] Public business name and support email are correct; no residential address is exposed in a test receipt.
- [ ] Webhook signs and delivers checkout completion/expiration, refund updates, and disputes.
- [ ] Replays do not duplicate orders, payments, capacity commitments, or mail.
- [ ] Cancelled and expired sessions do not become paid work.
- [ ] Duplicate/incorrect and eligible unfinished-item refunds reconcile locally and in Stripe.
- [ ] Customer-dependent email tests use only a founder-authenticated synthetic test identity.
- [ ] Enumerate every legacy paid-board subscription and every open legacy subscription Checkout Session in test and live mode; store a sanitized count-and-query receipt.
- [ ] Cancel every renewable legacy board subscription, expire every open legacy subscription Checkout Session, and re-query until both renewable and open counts are zero.
- [ ] Configure an external alert for any post-cutoff legacy renewal or invoice. The response is same-day cancellation, full refund, customer notice, and ledger reconciliation.
- [ ] Store the sanitized zero-state retirement receipt in `legacy_subscription_retirement_reference`; public checkout remains locked without this immutable activation evidence.
- [ ] Complete sandbox sign-in, private confirmed intake, owner invitation,1899-cent search payment, exactly ten reviewed jobs, optional799-cent pack purchase, owner-approved private documents and successful full refunds for both purchases. Record application payment/release IDs and the exact Stripe Session, PaymentIntent, completion-event and successful full-refund IDs.
- [ ] Generate the strict `sandbox-proof-live-pilot-v1` receipt through read-only checks of Stripe, staging database and deployed version. Bind the exact final SHA, origin/project, verified sandbox account, test-mode indicator, timestamp and evidence-bundle digest. Refresh within24hours of production activation; import through fresh administrator MFA and preserve the immutable server-calculated digest. This is reviewed evidence, not a cryptographic Stripe attestation.
- [ ] Reject old PUBLIC activation requests, wrong-account/release/live-mode/incomplete/stale sandbox receipts, new production CANARY operations and special test refunds. Preserve ordinary refunds and historical reconciliation.
- [ ] Verify the intended live account, completed onboarding, exact live prices and signed production webhook while purchasing stays locked. After final owner go-live approval, invite the first genuine customer and review the actual delivery before expanding. No mandatory live test charges/refunds; the first customer's pack purchase is optional.

## AWS production worker

- [ ] Approve one consolidated incremental-cost quote covering verified reuse, exact additions, ongoing/variable costs and bounded acceptance/recovery tests before provisioning. No paid certificate authority or NAT gateway is in the default design.
- [ ] Verify the approved budget configuration and notification recipients against the current quote; a historical $5 planning value is not a newly approved cap. Confirm subscriptions and actual delivered budget/failure/staleness alerts without exposing account identifiers or addresses.
- [ ] Record the KMS key ARN, least-privilege policy review, immutable Lambda version ARN, ECR image digest, VPC/subnet/route/security-group attestation, S3 endpoint policy, and successful synthetic render evidence.
- [ ] Hash the sanitized network attestation packet and store that hash in the immutable launch activation record.
- [ ] Verify isolated rendering, pinned fonts, cleanup after failures, worker drift detection and independent scheduler-staleness detection. A valid template, healthy dashboard or local fixture is not delivered-alert evidence.

## Supabase

- [ ] Staging migrations and preserved-data checks complete.
- [ ] Production backup and non-production restore drill complete.
- [ ] Demonstrate independent recovery of database records, private files, encryption keys, authentication and configuration after loss of the original machine/credentials. Measure restoration within240minutes and no more than15minutes requiring recovery/reconciliation, reconciling every paid transaction with Stripe. Neither daily backups nor file copies alone satisfy this requirement.
- [ ] OTP length is six, expiration is short, branded templates use {{ .Token }}, and production custom SMTP is active.
- [ ] Site URL and allowed origins use staging for staging and https://applypack.work for production; no obsolete magic-link callback remains.
- [ ] Private storage, signed URL expiration, RLS negatives, admin AAL2, and role-assignment boundaries pass.

## Railway

- [ ] Capture and hold staging's automatic deployment triggers before publication; hold production's automatic trigger before merge. Preserve the recorded configuration for the controlled release.
- [ ] Candidate CI and image checks pass on the actual committed SHA; after merge, validate the resulting full `main` SHA and align staging to it before the hosted payment journey. Evidence lives outside the frozen source tree; affected checks repeat after any code change.
- [ ] /api/live reports process liveness.
- [ ] /api/health reports actual Supabase, job-source, Stripe-price, document-safety, email, cron, HTTPS, and canonical readiness without secrets.
- [ ] Build/start commands and health check pass.
- [ ] applypack.work is canonical; www.applypack.work permanently redirects.
- [ ] Railway service domain remains operational but is not canonical.
- [ ] Production deploy uses the exact reviewed SHA only after staging gates.
- [ ] Deploy matching maintenance, observe one manual run and two actual fifteen-minute cycles, and verify delivered failure/staleness alerts. Verify locked production separately with environment-specific configuration and the same frozen source revision.

## Search readiness

- [ ] Canonicals, sitemap, robots, Open Graph, structured data, and private-route noindex verified.
- [ ] Google Search Console and Bing Webmaster setup attempted when authenticated access is available.
- [ ] Missing webmaster authentication does not block paid workflow readiness.
- [ ] IndexNow configured only if the selected Bing integration supports it without unnecessary paid infrastructure.

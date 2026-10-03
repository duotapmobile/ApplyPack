# Provider evidence checklist

Secrets, personal addresses, full DNS token values, customer content, and payment details do not belong in this file.

For the October 2 manual launch, this checklist and the governing amendment supersede conflicting historical price, subscription-board, canary, and rollback instructions. New checkout and document intake are disabled first during rollback; webhooks, refunds, retained customer access, maintenance, and audit evidence remain available.

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

## Stripe test mode

- [ ] Product Job Match Search, one-time USD price 1899 cents.
- [ ] Product Apply Pack, one-time USD price 799 cents per selected job.
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
- [ ] Run one authorized live 1899-cent search charge and one authorized live 799-cent Apply Pack charge, deliver both, then reconcile full refunds totaling 2698 cents before public activation.

## AWS production worker

- [ ] Confirm both AWS Budget notification recipients accepted their verification emails; a configured but unverified subscriber is not alert proof.
- [ ] Record the $5 monthly budget ID and an alert-delivery test without exposing account identifiers or email addresses.
- [ ] Record the KMS key ARN, least-privilege policy review, immutable Lambda version ARN, ECR image digest, VPC/subnet/route/security-group attestation, S3 endpoint policy, and successful synthetic render evidence.
- [ ] Hash the sanitized network attestation packet and store that hash in the immutable launch activation record.

## Supabase

- [ ] Staging migrations and preserved-data checks complete.
- [ ] Production backup and non-production restore drill complete.
- [ ] OTP length is six, expiration is short, branded templates use {{ .Token }}, and production custom SMTP is active.
- [ ] Site URL and allowed origins use staging for staging and https://applypack.work for production; no obsolete magic-link callback remains.
- [ ] Private storage, signed URL expiration, RLS negatives, admin AAL2, and role-assignment boundaries pass.

## Railway

- [ ] Isolated low-cost staging environment uses the exact feature-branch SHA.
- [ ] /api/live reports process liveness.
- [ ] /api/health reports actual Supabase, job-source, Stripe-price, document-safety, email, cron, HTTPS, and canonical readiness without secrets.
- [ ] Build/start commands and health check pass.
- [ ] applypack.work is canonical; www.applypack.work permanently redirects.
- [ ] Railway service domain remains operational but is not canonical.
- [ ] Production deploy uses the exact reviewed SHA only after staging gates.

## Search readiness

- [ ] Canonicals, sitemap, robots, Open Graph, structured data, and private-route noindex verified.
- [ ] Google Search Console and Bing Webmaster setup attempted when authenticated access is available.
- [ ] Missing webmaster authentication does not block paid workflow readiness.
- [ ] IndexNow configured only if the selected Bing integration supports it without unnecessary paid infrastructure.

# Provider evidence checklist

Secrets, personal addresses, full DNS token values, customer content, and payment details do not belong in this file.

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

- [ ] Product Job Match Search, one-time USD price 2000 cents.
- [ ] Product Apply Pack, one-time USD price 800 cents.
- [ ] Account statement descriptor APPLYPACK.
- [ ] Public business name and support email are correct; no residential address is exposed in a test receipt.
- [ ] Webhook signs and delivers checkout completion/expiration, refund updates, and disputes.
- [ ] Replays do not duplicate orders, payments, capacity commitments, or mail.
- [ ] Cancelled and expired sessions do not become paid work.
- [ ] Duplicate/incorrect and eligible unfinished-item refunds reconcile locally and in Stripe.
- [ ] Customer-dependent email tests use only a founder-authenticated synthetic test identity.

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

# Provider setup

## Supabase

1. Use an isolated staging project or environment within the existing account before production; do not add paid capacity without approval.
2. Apply every file in supabase/migrations in order only after the migration and recovery gate passes.
3. Configure the Site URL for the environment. Customer sign-in uses a six-digit OTP and has no magic-link callback.
4. Set the publishable and secret server keys in Railway. Never expose the secret key to the browser.
5. Configure confirmation and magic-link templates with the branded six-digit {{ .Token }} template, a short expiration, and custom SMTP. Disable open/link tracking.
6. Create admin@applypack.work through email-code sign-in, set its role directly through a trusted operator-only database action, and enroll a TOTP factor. Customer-controlled fields never assign roles.
7. Verify every Storage bucket is private and test cross-account access denial.
8. Prove backup completion and a non-production restore before production migration.

## Stripe

1. Use test mode first.
2. Create active one-time USD products and prices named Job Match Search at 2000 cents and Apply Pack at 800 cents. The server verifies names, amounts, currency, recurrence, product status, and price status.
3. Add the environment-specific /api/stripe/webhook endpoint.
4. Subscribe to checkout.session.completed, checkout.session.expired, refund.created, refund.updated, refund.failed, and charge.dispute.created.
5. Set the signing secret and server key in Railway.
6. Set the statement descriptor to APPLYPACK and inspect public receipt details for residential-address exposure.
7. Verify successful, cancelled, expired, mismatched-price, wrong-mode, in-progress replay, completed replay, refund, and dispute events.

Prices and quantities are server-controlled. Test mode must pass before live configuration. Do not enable Stripe Tax until the recorded tax classification is resolved.

## Resend and email

1. Add and verify applypack.work or a provider-recommended sending subdomain in Resend without disturbing existing inbound MX records.
2. Publish the exact SPF and DKIM records Resend provides.
3. Set EMAIL_FROM_ADDRESS=orders@applypack.work and EMAIL_REPLY_TO=help@applypack.work.
4. Configure orders@, help@, and admin@ with the smallest number of inboxes/aliases. They may forward to one existing monitored business inbox after that destination is confirmed securely.
5. Add DMARC in monitoring mode only.
6. Use the founder-authorized Gmail inbox to test OTP, receipt, delivery, support Reply-To, spam placement where observable, retry behavior, and SPF/DKIM/DMARC alignment.

## Document safety

1. Set APP_FILE_SCAN_MODE=document_validation for the zero-cost launch baseline.
2. Verify PDF/DOCX extension, MIME, signature, size, container, expansion, active-content, macro, embedded-object, encryption, and executable controls with accepted and rejected fixtures.
3. Keep pending, blocked, and failed documents inaccessible to operators.
4. Verify randomized private storage paths, atomic queue claiming, capped retries, retention, and audited short-lived signed downloads.
5. Do not describe this control as malware scanning. Record the residual risk from docs/launch/LAUNCH_DECISIONS_2026-09-02.md.
6. Connect ClamAV only if later approved after exact cost and privacy review; if used, configure its private host and prove a real PONG plus clean and EICAR paths.

## DNS

Export the complete Namecheap zone before mutation. Preserve nameservers and unrelated records. Add Railway and email records exactly as each provider displays them; never copy placeholder tokens from documentation. Record changes without committing secret verification values.

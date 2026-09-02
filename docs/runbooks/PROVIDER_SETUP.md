# Provider setup

## Supabase

1. Create separate test and production projects.
2. Apply the migration in supabase/migrations.
3. Configure Site URL and redirect URLs for localhost, Railway, and https://applypack.work/auth/callback.
4. Set the publishable and secret server keys in Railway. Never expose the secret key to the browser.
5. Create the founder profile through email sign-in, set its role to admin directly in the trusted database console, and enroll a TOTP MFA factor.
6. Verify both Storage buckets are private and test cross-account access denial.

## Stripe

1. Use test mode first.
2. Add the webhook endpoint https://applypack.work/api/stripe/webhook.
3. Subscribe to checkout.session.completed, checkout.session.expired, charge.refunded, and charge.dispute.created.
4. Set the signing secret and server key in Railway.
5. Verify successful, cancelled, expired, and replayed checkout events.

Prices are constructed server-side from locked cents values. Stripe product records may be added for reporting but do not control the accepted amount.

## Resend and email

1. Add and verify applypack.work in Resend.
2. Publish the exact SPF and DKIM records Resend provides.
3. Set EMAIL_FROM_ADDRESS=orders@applypack.work and EMAIL_REPLY_TO=help@applypack.work.
4. Configure orders@, help@, and admin@ as inbound aliases or mailboxes.
5. Send to an external mailbox and verify SPF, DKIM, and DMARC alignment.

## Malware scanning

1. Select and approve a scanner that can process private PDF and DOCX objects without retaining or training on customer content.
2. Keep each new intake at source_scan_status=pending while it is quarantined.
3. Have the trusted scanner integration set clean plus its provider reference and timestamp only after a successful scan; set blocked on any detection or scanner policy failure.
4. Set APP_FILE_SCAN_MODE=connected in Railway only after the integration is live.
5. Verify operators receive HTTP 423 for pending/blocked files and an audited 60-second signed download only for clean files.
6. Record the provider agreement, data region, retention setting, failure path, and test evidence.

## DNS

Add the Railway custom-domain CNAME exactly as Railway displays it. Add email DNS records exactly as the email provider displays them. Never copy placeholder provider tokens from documentation.

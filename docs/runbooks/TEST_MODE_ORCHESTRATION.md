# Test-mode orchestration runbook

Last updated: September 2, 2026

## Safety boundary

This workflow remains in Stripe test mode. `APP_PAYMENT_MODE=test`, a Stripe test credential, a test webhook event, fixed test price IDs, and `APP_CHECKOUT_ENABLED=true` must all agree. Live mode also requires `APP_LIVE_PAYMENTS_ENABLED=true`, every launch gate, the resolved tax classification, and the explicitly authorized smoke-test phase.

The public Railway service currently uses a restricted Stripe test key. Do not replace it with a live key during this runbook.

## Implemented flow

1. A new upload is placed in private quarantine and recorded in `source_documents`.
2. The zero-cost baseline validates each PDF or DOCX type, signature, size, structure, expansion, and active content; unknown and failed results remain locked. This is not an antivirus scan.
3. The $20 checkout is unavailable until every current source document is `clean`.
4. A verified test payment queues `search_discovery` exactly once.
5. The worker synchronizes only registered automated official sources, applies normalization, exclusions, default filters, deduplication, and ranking, and stores reviewable candidates.
6. The admin receives a link to the MFA-protected review queue. Fewer than 10 candidates is shown honestly and requires verified manual additions.
7. Only the existing admin delivery action releases exactly 10 jobs and emails the customer.
8. A verified $8-per-job test payment queues one `document_draft` task per selected job.
9. ApplyPack creates private, editable first-party DOCX drafts from the customer's structured intake facts. Both drafts pass the configured document-safety checks and remain in the MFA-protected operator queue. The existing admin upload/review action is still the only path to customer delivery.

## Stripe test prices

The setup script is idempotent and refuses every non-test key. The current restricted sandbox key uses these least-privilege permissions:

- Charges and Refunds: Write
- Products: Write
- Prices: Write
- Checkout Sessions: Write

Stripe's permission control allows only `None`, `Read`, or `Write`; `Write` is the correct single selection and includes the reads needed to verify what was created. Do not try to select Read and Write together.

To verify or repair the fixed test prices, run:

```powershell
cd C:\Users\mskir\Desktop\Apply_Pack\site
$railway = railway variables --json | ConvertFrom-Json
$env:STRIPE_SECRET_KEY = $railway.STRIPE_SECRET_KEY
npm.cmd run stripe:configure:test
```

Layman's explanation: the first command opens the project folder; the second and third temporarily copy the existing Railway test key into this PowerShell window without printing it; the last command creates or reuses the locked $20 and $8 test prices. It will stop rather than touch live-mode Stripe data.

The test price IDs are already stored in Railway. If they ever need to be saved again, keep all payment switches fail-closed and prevent an automatic deployment:

```powershell
railway variable set "STRIPE_JOB_SEARCH_PRICE_ID=price_REPLACE" "STRIPE_APPLY_PACK_PRICE_ID=price_REPLACE" "APP_PAYMENT_MODE=test" "APP_CHECKOUT_ENABLED=false" "APP_LIVE_PAYMENTS_ENABLED=false" --skip-deploys
```

Layman's explanation: this saves only sandbox price references, keeps both checkout and live payments off, and does not restart the running website.

## Document-safety baseline

Set `APP_FILE_SCAN_MODE=document_validation` in local, staging, and production environments. Run the unit fixtures that accept ordinary PDF/DOCX files and reject signature mismatch, path traversal, expansion bombs, macros, ActiveX, embedded objects, PDF JavaScript/actions, rich media, XFA, and encryption.

Do not provision a hosted ClamAV service for this rehearsal. If a later cost and privacy review approves ClamAV, use its existing optional integration test as additional evidence and keep the private port inaccessible from the public network.

## Required test-mode rehearsal

Use only a synthetic customer, synthetic résumé, Stripe's documented test payment method, and an email listed in `APP_SAFE_TEST_EMAILS`.

1. Apply migrations to a disposable Supabase project or the local stack.
2. Enable document_validation and verify all accepted and hostile document fixtures.
3. Configure the two test prices and a test webhook secret.
4. Set `APP_PAYMENT_MODE=test`, `APP_CHECKOUT_ENABLED=true`, and keep `APP_LIVE_PAYMENTS_ENABLED=false`.
5. Complete one $20 checkout and verify one payment, one confirmed capacity reservation, one 24-hour deadline, one search task, and one confirmation email event.
6. Replay the signed webhook and verify no duplicate work, payment, capacity, deadline, or email.
7. Review and release exactly 10 synthetic jobs from `/admin`.
8. Complete one $8 checkout and verify one order and one document task for each selected job.
9. Verify one private resume draft and one private cover-letter draft are generated and structurally validated for every selected job; download them as the operator, edit/review them, and verify the customer still cannot access them before the delivery confirmation.
10. Replay simultaneous checkout attempts and confirm they resolve to one database intent and one Stripe Checkout Session.
11. Keep production checkout disabled after the rehearsal.

## Stop conditions

Stop immediately if a key is live mode, a webhook has `livemode=true`, an email is not allowlisted, a source document did not pass the configured safety checks, a price differs from $20/$8 USD, or the database is not disposable test data.

# Orchestration verification — September 3, 2026

## Safety boundary

All payment work in this rehearsal used the DuoTap Stripe sandbox. Railway remains configured with `APP_PAYMENT_MODE=test`, `APP_CHECKOUT_ENABLED=false`, and `APP_LIVE_PAYMENTS_ENABLED=false`. Real Resend delivery was disabled for the synthetic end-to-end customer; email events were recorded as skipped. No live charge or customer email was created.

## Configuration verified

- The restricted sandbox key can create/reuse Products, Prices, and Checkout Sessions. Stripe's permission selector is mutually exclusive: `Write` includes the operations needed by this setup, so `Read` is not selected separately.
- The idempotent setup created or reused the exact $20 Job Match Search and $8 Apply Pack prices and repaired product display names to the names enforced by checkout.
- Both prices were retrieved from Stripe with `livemode=false`, active status, USD currency, and the expected amounts.
- The price IDs and fail-closed payment/file-safety switches were saved in Railway with `--skip-deploys`.
- Staging and production Supabase backups were created outside Git. Both restore rehearsals preserved the expected source, capacity, and production profile/order/payment counts.

## End-to-end test evidence

- A synthetic customer completed six-digit email sign-in, all seven intake steps, private PDF upload, strict document validation, and a real hosted $20 Stripe test-card Checkout.
- Stripe delivered the signed charge, PaymentIntent, and Checkout events to the local webhook. The application created exactly one order, payment, confirmed reservation, 24-hour deadline, and `search_discovery` task.
- Replaying the same signed completed event returned success without changing any of those counts or duplicating email events.
- An AAL2/MFA-protected admin review released exactly ten clearly synthetic jobs. The customer portal then displayed all ten direct application links.
- The rehearsal exposed and fixed mutually recursive `jobs`/`job_matches` row-level policies. A new migration preserves delivered-order ownership and the permanent Liveops exclusion through non-recursive security-definer predicates.
- The customer selected one reviewed match and the backend created an exact $8 sandbox Checkout Session using the configured price.
- Repeated automated hosted-checkout attempts triggered Stripe's hCaptcha. It was not bypassed. Stripe CLI's official test fixture generated the paid $8 session and signed event; the disposable local cart was linked to that fixture session before the failed event was retried.
- The paid event produced exactly one $8 Apply Pack order, payment, item, confirmed capacity reservation, 24-hour deadline, and `document_draft` task.
- The rehearsal exposed and fixed missing structural-validation context for first-party DOCX drafts. Both generated files now pass strict DOCX validation before the configured scanner verdict.
- One resume and one cover letter were stored in the private `operator-drafts` bucket. The task and item reached `awaiting_review`/`draft_ready`, and a QA email event was recorded.
- An authenticated AAL1 customer could see zero Apply Pack item records and zero operator-draft objects before human delivery.
- The customer selection control is covered by a component regression test, including capacity loading and the $8 cart summary.

## Final local verification

- `npm run check` passed: ESLint, TypeScript, 25 Vitest files with 112 passing tests, and the Next.js production build.
- The default integration run completed with three scanner-dependent tests skipped because external scanner integration flags were intentionally absent. The generated-DOCX integration was then run explicitly in `document_validation` mode and passed.
- A clean local Supabase reset applied migrations 001 through 021. The checkout-concurrency, intake-delivery, and security-financial rollback suites passed, and `supabase db lint --local --level warning` reported no schema errors.
- The final Playwright run used a dedicated port and one worker so it could not reuse an unrelated local website. All 40 desktop and mobile tests passed, including every public route, six-digit sign-in, all seven intake screens, serious/critical accessibility checks, security headers, and 320-pixel overflow checks.
- The clean local database contains 66 canonical employers, 7 aliases, 69 job sources, 2 affiliate directories, and 11 source-exclusion records. It contains zero jobs with a Liveops employer, source name, official application URL, or source job URL.
- Source registration remains separated: 30 core direct employers, 3 remote-first employers, 26 selective broad employers, 7 contractor/staffing/flexible sources, and 3 compatibility imports. Two official Lever sources are automated, 63 sources are official-link-only, three are existing imports, and notifyMD is pending official-source verification.

## Remaining production gates

- Run the complete lint, typecheck, unit, integration, browser, migration, and build checks on the final diff.
- Commit and push the reviewed branch; production GitHub is not updated until that push succeeds.
- Apply the reviewed migrations to production only after final checks and the existing backup/restore evidence are re-confirmed.
- Deploy the exact reviewed commit with checkout and live payments still disabled, then verify `/api/live` and `/api/health` on `https://applypack.work`.
- A human may complete one public-domain $8 sandbox Checkout if Stripe presents an anti-automation challenge. Live payments remain out of scope.

Current status: **TEST ORCHESTRATION VERIFIED; RELEASE CHECKS AND DEPLOYMENT PENDING**.

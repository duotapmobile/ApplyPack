# Paid personalized job board — implementation status

Status: **implemented locally, not ready for paid production use**

## Completed in this branch

- Server-owned USD plan allowlist: weekly $6.99/week, monthly $19.99/calendar month, and $44.99 every three calendar months.
- Stripe recurring-price verification for amount, currency, recurring interval/count, active product/price, and licensed quantity.
- Authenticated subscription Checkout with no trial, server-selected price, customer binding, duplicate-live-subscription guard, and a return URL that grants no access.
- Signed-webhook integration that grants/extends access on `invoice.paid`, revokes it on renewal failure/deletion, keeps paid-period access for period-end cancellation, rejects stale events, and shares the existing idempotent webhook claim.
- Provider reconciliation in the authenticated maintenance job. Reconciliation requires an active subscription and a paid latest invoice before restoring access.
- Self-service Stripe customer portal entry; plan switching is not implemented.
- Versioned database migration for subscriptions, admission decisions, independent $8 board-material orders, RLS, one-live-subscription enforcement, and server-side entitlement checks.
- Server-side hard paywall on list, detail, and application-link APIs, with private/no-store responses and current-profile-snapshot binding.
- Inclusion-only admission function: confirmed dealbreaker violations exclude; unknowns warn; at least one confirmed or transferable capability connection is required; no score, tier, or rank is emitted.
- Neutral newest/disclosed-salary sorting primitives with stable ID tie-breaking and missing salaries last.
- Public plan/pricing page and private board states for logged out, unpaid, pending verification, active, empty, unavailable, and expired-link cases.
- Existing standalone $20 Top 10 flow is preserved and remains subscription-independent. The schema keeps paid material orders independent of subscription state.
- Camofox rejection and source-rights/current-pipeline audits.

## Not completed or not live-verified

- No automated source is authorized/enabled; therefore no real board inventory, count, freshness metric, or authorized live-source test exists.
- Admission persistence/background recomputation from full candidate facts is not wired. The pure rule and current-profile invalidation boundary are implemented; a worker must materialize admissions after authorized ingestion and every profile version.
- Lever pagination/checkpoint/resume/retry remains incomplete. Workable, SmartRecruiters, and Remote OK adapters are not implemented or enabled.
- Full/partial subscription refund and dispute-to-subscription correlation is not wired in the new Stripe event handler. Those events remain a production blocker even though the domain state machine is fail-closed.
- The $8 self-selected-job table and customer CTA exist, but Checkout-to-existing document-pipeline fulfillment is not wired. The CTA therefore routes to the established intake rather than creating an unfulfillable charge.
- The paid page currently renders a first page; interactive sort/pagination controls and a dedicated details UI still need completion. The protected APIs implement the boundaries.
- No test-mode Stripe objects, webhook endpoint, customer portal configuration, Supabase migration, Railway environment, or production deployment was changed.
- Jurisdiction-specific subscription, renewal, cancellation, tax, and consumer-law review remains required.

## Configuration required before test-mode integration

- `APP_JOB_BOARD_CHECKOUT_ENABLED=true` only in an approved test environment
- `STRIPE_JOB_BOARD_WEEKLY_PRICE_ID`
- `STRIPE_JOB_BOARD_MONTHLY_PRICE_ID`
- `STRIPE_JOB_BOARD_THREE_MONTH_PRICE_ID`
- Existing validated Stripe secret/webhook, Supabase, canonical URL, cron, and portal configuration

Do not enable checkout until the migration is applied in an isolated test database, all three Stripe prices are verified, the webhook event list is configured, and refund/dispute handling is complete.

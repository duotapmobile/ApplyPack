# Railway deployment

## Before the first deploy

1. Pass every local gate and review the branch.
2. Complete provider setup in an isolated low-cost staging environment.
3. Apply and validate the migration in the test Supabase project.
4. Confirm no secret or customer document is present in Git history or build output.
5. Push the reviewed commit to GitHub.

## Web service

1. In Railway, create a project from `duotapmobile/ApplyPack`.
2. Confirm Railpack detects Node, runs `npm run build`, and starts with `npm run start`.
3. Add every variable from `.env.example` through Railway Variables. Generate high-entropy independent webhook and cron secrets.
4. Configure process liveness at `/api/live` and dependency readiness at `/api/health`.
5. Deploy the exact reviewed commit.
6. Inspect build and runtime logs, then confirm `/api/health` returns 200 without exposing credentials or unnecessary internals.

The readiness route returns 503 until the canonical HTTPS origin, Supabase, validated Stripe prices, document safety, email, cron secret, and database capacity rows are ready.

Railway's deployment healthcheck is not continuous monitoring. Configure a separate external uptime check for `/api/health` and alerts for Stripe webhook failures, email failures, missed deadlines, and application errors.

## Domain and callbacks

1. Add `applypack.work` and `www.applypack.work` as Railway custom domains.
2. Copy the CNAME/verification records exactly from Railway into the DNS provider.
3. Choose `https://applypack.work` as canonical and redirect `www` to it.
4. Set `NEXT_PUBLIC_APP_URL=https://applypack.work` and redeploy.
5. In Supabase Auth, set the Site URL to `https://applypack.work` and use the branded six-digit OTP template. Do not add the deleted magic-link callback.
6. In Stripe, register `https://applypack.work/api/stripe/webhook`.
7. Verify HTTPS, canonical tags, sitemap, robots, sign-in redirect, checkout return URLs, and webhook delivery on the final hostname.

## Scheduled maintenance

Repair the existing maintenance service using the tracked `railway-maintenance.json` and `scripts/run-maintenance-once.mjs`; schedule it every 15 minutes. Do not create a duplicate service. See [Maintenance runner](MAINTENANCE_RUNNER.md) for deployment and verification gates. A recognized dependency hold logs `BLOCKED`, exits zero and remains explicitly not ready; execution failures exit nonzero. A successful process exit never fabricates a healthy maintenance heartbeat.

Job-source observation uses a different cron service and endpoint so network collection cannot consume the maintenance request budget. Do not create or enable this service until the employer-specific staging activation packet is approved. When approved, invoke `POST /api/cron/job-sources` with the same bearer-secret pattern and keep `APP_JOB_SOURCE_SYNC_ENABLED=false` in every other environment.

## Release

1. Run the full test-mode purchase, delivery, correction, conflict, refund, email, and privacy matrix.
2. Record the release SHA and evidence in the ship checklist.
3. Resolve the recorded tax classification before accepting a first live customer charge.
4. Announce the live-payment smoke-test phase, then perform only the specifically authorized one $20 and one $8 charge against the founder-authenticated synthetic customer and refund both.
5. Keep capacity disabled until the live smoke tests and inbox/DNS checks pass.
6. Enable capacity and begin continuous monitoring.

## Rollback

Before any rollback, disable new purchasing with APP_CHECKOUT_ENABLED=false, APP_JOB_BOARD_CHECKOUT_ENABLED=false and APP_LIVE_PAYMENTS_ENABLED=false; disable automatic collection with APP_JOB_SOURCE_SYNC_ENABLED=false and APP_JOB_SOURCE_PROJECTION_ENABLED=false. Record and disable acceptance in both the legacy capacity_limits rows and corrected ap_capacity_pools, and the affected ap_commerce_configuration sales switches. Use the exact columns from the applied schema; do not erase reservations, paid capacity commitments, orders, payment events, review history or source evidence.

Keep webhook verification/reconciliation, retained customer access and maintenance for existing obligations operational. A dependency hold must remain visible; it is not a reason to discard paid work or pretend readiness.

Database migrations are additive and forward-only. Select a reviewed rollback commit demonstrated compatible with the current migration ledger and policies; a merely successful historical deployment may predate these contracts. If no compatible rollback exists, keep purchasing and ingestion closed and deploy a forward repair. After recovery, verify the exact Git SHA, liveness/readiness separately, worker execution, callbacks, customer isolation and a genuine test-mode transaction before reopening acceptance.

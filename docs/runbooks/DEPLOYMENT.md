# Railway deployment

## Before the first deploy

1. Pass every local gate and review the branch.
2. Complete provider setup in a test environment.
3. Apply and validate the migration in the test Supabase project.
4. Confirm no secret or customer document is present in Git history or build output.
5. Push the reviewed commit to GitHub.

## Web service

1. In Railway, create a project from `duotapmobile/ApplyPack`.
2. Confirm Railpack detects Node, runs `npm run build`, and starts with `npm run start`.
3. Add every variable from `.env.example` through Railway Variables. Generate high-entropy independent webhook and cron secrets.
4. Set the healthcheck path to `/api/health` with a 120-second timeout.
5. Deploy the exact reviewed commit.
6. Inspect build and runtime logs, then confirm `/api/health` returns 200 and the expected release SHA.

The health route returns 503 until the canonical HTTPS origin, Supabase, Stripe, email, cron secret, and database capacity rows are present. This makes an incomplete provider configuration fail the deployment healthcheck.

Railway's deployment healthcheck is not continuous monitoring. Configure a separate external uptime check for `/api/health` and alerts for Stripe webhook failures, email failures, missed deadlines, and application errors.

## Domain and callbacks

1. Add `applypack.work` and `www.applypack.work` as Railway custom domains.
2. Copy the CNAME/verification records exactly from Railway into the DNS provider.
3. Choose `https://applypack.work` as canonical and redirect `www` to it.
4. Set `NEXT_PUBLIC_APP_URL=https://applypack.work` and redeploy.
5. In Supabase Auth, set the Site URL and allow `https://applypack.work/auth/callback`.
6. In Stripe, register `https://applypack.work/api/stripe/webhook`.
7. Verify HTTPS, canonical tags, sitemap, robots, sign-in redirect, checkout return URLs, and webhook delivery on the final hostname.

## Scheduled maintenance

Create a separate Railway cron service that performs one authenticated HTTP request and exits. Share `CRON_SECRET` with the web service and schedule it hourly in UTC. Example start command:

```sh
curl --fail --silent --show-error --request POST --header "Authorization: Bearer ${CRON_SECRET}" https://applypack.work/api/cron/maintenance
```

Confirm the first run exits successfully and records expiration/retention counts. Alert on any failed run.

## Release

1. Run the full test-mode purchase, delivery, correction, conflict, refund, email, and privacy matrix.
2. Record the release SHA and evidence in the ship checklist.
3. Repeat the minimum $20 and $8 paths in live mode only after explicit owner authorization.
4. Keep capacity disabled until the live smoke tests and inbox/DNS checks pass.
5. Enable capacity and begin continuous monitoring.

## Rollback

Use Railway's prior successful deployment for code rollback. Database migrations are forward-only: validate compatibility before rollback and never reverse a production migration ad hoc. If payment or confidentiality may be affected, disable both capacity rows before rollback. After recovery, verify the release SHA, health endpoint, provider callbacks, customer isolation, and one test-mode transaction before reopening capacity.

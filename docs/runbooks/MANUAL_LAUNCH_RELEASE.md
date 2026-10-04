# Manual launch deployment, canary, and rollback

This runbook supersedes the Release and Rollback sections of `DEPLOYMENT.md` for the October 2 manual launch. The older `$20`/`$8` instructions are historical and non-operational.

## Before the first deploy

1. Pass every local gate and all four exact-SHA supervisor reviews.
2. Complete provider setup in an isolated low-cost staging environment.
3. Apply and validate every forward migration in the test Supabase project.
4. Confirm no secret or customer document is present in Git history or build output.
5. Push the reviewed commit to GitHub.

## Web service

1. In Railway, create a project from `duotapmobile/ApplyPack`.
2. Confirm Railpack detects Node, runs `npm run build`, and starts with `npm run start`.
3. Add every variable from `.env.example` through Railway Variables. Generate high-entropy independent webhook and cron secrets.
4. Keep `APP_CHECKOUT_ENABLED=false` and `APP_CANARY_CHECKOUT_ENABLED=false`. They are independent public and canary gates.
5. Configure process liveness at `/api/live` and dependency readiness at `/api/health`.
6. Deploy the exact reviewed commit and apply only its forward migrations.
7. Inspect build and runtime logs, then confirm `/api/health` returns 200 at the exact SHA without exposing credentials or unnecessary internals. `acceptingOrders` must remain false.

The readiness route returns 503 until the canonical HTTPS origin, Supabase, validated current Stripe prices, document safety, email, maintenance heartbeat, manual inventory, and authoritative capacity pools are ready. Healthy infrastructure does not unlock checkout.

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

Create a separate Railway cron service that performs one authenticated HTTP request and exits. Share `CRON_SECRET` with the web service and schedule it hourly in UTC. Example start command:

```sh
curl --fail --silent --show-error --request POST --header "Authorization: Bearer ${CRON_SECRET}" https://applypack.work/api/cron/maintenance
```

Confirm the first run exits successfully and records capacity rollover, expiration, retention, reconciliation, queue, and alert evidence. Enabled SEARCH and MATERIALS pools receive an audited successor bucket automatically when the current 31-day bucket has seven days or less remaining; a conflicting or missing current bucket fails maintenance closed. The maintenance heartbeat and external alert must therefore remain continuously monitored. Dormant board processing may be skipped; current Stripe/webhook integrity must remain healthy while checkout is locked or in CANARY mode.

## Controlled canary and public activation

Historical `$20` and `$8` amounts are reconciliation/refund records only. They must never be used for a new canary or public checkout.

1. Complete the full test-mode purchase, delivery, correction, conflict, refund, email, tenant-isolation, accessibility, backup/restore, and failure-recovery matrix. Record exact-SHA evidence and zero unresolved P0/P1 findings.
2. Store the tax approval, legacy subscription zero-state, AWS worker/network attestation, maintenance, backup, inventory, accessibility, supervisor, and accepted-P2 evidence references. Both AWS Budget notification recipients must have accepted their verification emails.
3. With both checkout flags still false, use the MFA-protected Admin Capacity controls to enable the authoritative `SEARCH` and `MATERIALS` pools. The limits remain fixed at one search and two Apply Packs per rolling 24 hours; record the audit reason.
4. POST the complete evidence bundle with `activationPhase: "CANARY"` to `/api/admin/manual-launch/activations`. This creates an immutable exact-SHA CANARY activation. It does not open checkout.
5. Create the founder-authenticated synthetic customer's short-lived search authorization through `/api/admin/manual-launch/canary-authorizations`, including the exact completed intake draft. Set `APP_CANARY_CHECKOUT_ENABLED=true`, redeploy, and verify `APP_CHECKOUT_ENABLED=false`.
6. Complete exactly one real `$18.99` search charge, webhook, ten-match human review, exact-ten delivery, customer email, portal access, and download. Then create the same customer's short-lived MATERIALS authorization and complete exactly one real `$7.99` one-job Apply Pack charge and delivery.
7. Queue both canary refunds through `/api/admin/manual-launch/canary-refunds`; verify Stripe and the local ledger both report the two full successful refunds totaling exactly `$26.98`.
8. Set `APP_CANARY_CHECKOUT_ENABLED=false` and redeploy. POST the final evidence bundle with `activationPhase: "PUBLIC"` to `/api/admin/manual-launch/activations`. The database rejects PUBLIC activation unless the exact release has one successful SEARCH refund and one successful MATERIALS refund totaling 2,698 cents.
9. Confirm `/api/health` is HTTP 200 at the exact SHA, `acceptingOrders` is still false, all supervisors signed, tax approval is stored, capacity is available, and the canary refunds settled. Only then set `APP_CHECKOUT_ENABLED=true` and redeploy for public invitation-based checkout.

## Canary retry and emergency stop

- Stop new canary sessions first: set `APP_CANARY_CHECKOUT_ENABLED=false` and redeploy. Do not disable the webhook or maintenance services.
- Revoke a still-active, not-yet-bound authorization with `PATCH /api/admin/manual-launch/canary-authorizations`, providing its exact ID and a 12–500 character evidence reference. The shared database lock refuses a successful revoke once checkout binding has begun.
- Disable both authoritative pools in Admin Capacity, with an audit reason, when no new checkout of either product may begin.
- For a bound attempt, POST the failed designation ID and evidence to `/api/admin/manual-launch/canary-retries`. The endpoint retrieves the exact Stripe Checkout Session, expires it when still open, requires Stripe to report both `expired` and `unpaid`, records immutable local reconciliation, and only then supersedes the designation. It fails closed for paid, complete, ambiguous, mismatched, or unverifiable attempts.
- Create a fresh short-lived authorization before retrying. Issue a fresh search invitation for SEARCH; MATERIALS derives a fresh immutable checkout identity from the new authorization while keeping the customer's substantive selection unchanged.

## Rollback

Disable `APP_CHECKOUT_ENABLED` and `APP_CANARY_CHECKOUT_ENABLED` first, revoke active canary authorization, and disable both authoritative pools. Preserve Stripe webhooks, refunds, customer access, maintenance, and audit evidence. Use only a deployment whose application contract is compatible with the applied forward schema. Migration 061 preserves the prior three-argument canary-refund RPC, migration 065 preserves the preceding intake RPC, migration 067 preserves both the immediately preceding Liberation Sans document contract and the locked Arial contract, and migration 068 keeps historical artifacts downloadable while making them ineligible for approval or release. Keep migration 068 applied as a required forward security fix. After migrations 066, 067, or 068 have been applied, the minimum compatible application rollback commit is `d61331eb951a34a7a23fb33e51d319d0ed2283fc` or a reviewed descendant. Do not roll back to a deployment that lacks its dual-version customer-access compatibility allowlist: the rollback target must display and download valid immutable files from both supported contracts while requiring the current contract for every new approval and release. Reapproving the Liberation Sans renderer is a forward recovery option only when checkout remains locked and its identity, font hash, network attestation, and family are reverified; approval is never inherited from migration 066. Existing files remain authorized by their own immutable renderer and font evidence. Database migrations are forward-only: run `npm run test:rollback` and `npm run test:database`, validate the selected deployment/schema pair, and never reverse a production migration ad hoc. After recovery, verify the release SHA, health endpoint, provider callbacks, one historical Liberation Sans download, one locked Arial download, pending paid work, refunds, webhook replay, maintenance heartbeat, and one test-mode transaction before reopening either checkout gate.

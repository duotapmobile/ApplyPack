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

### Sensitive-storage cleanup dead letters

`STORAGE_CLEANUP_DEAD_LETTER` means at least one private object reached 20 failed deletion attempts. It is a critical condition: maintenance and `/api/health` remain HTTP 503 and checkout remains locked. Independent document, workflow, webhook, payment, email, and refund processors continue running during the hold.

1. Keep both checkout flags false and both capacity pools disabled. Do not disable the webhook or maintenance services.
2. In the MFA-protected admin operations view, record only the aggregate pending/dead-letter counts, alert key, release SHA, and incident reference. Never copy a storage path or customer content into chat, tickets, email, or general logs.
3. In a restricted service-role database session, select the exact `storage_cleanup_queue` row with `attempts >= 20` and inspect `id`, `bucket`, `storage_path`, `reason`, `attempts`, `last_error`, and timestamps. Access to the path is operationally sensitive and must stay in the restricted session.
4. Before deleting anything, prove the object is not a live registered source, draft attachment, generated file, editable source, render review, current delivery, or released paid artifact. Check the exact bucket/path against `source_documents`, the resume/cover-letter paths in `intake_drafts`, `ap_generated_file_versions`, `ap_artifact_quality_reviews`, and material artifact provenance. If any live reference exists or ownership is ambiguous, do not delete or clear the row; escalate the incident for security review.
5. Using the protected Supabase Storage admin surface, delete only the exact object named by the locked row, or obtain provider evidence that the exact object is already absent. Do not bulk-delete a prefix or bucket.
6. Only after deletion/absence is verified, lock the same queue row in a transaction, delete it with conditions on its `id`, `bucket`, `storage_path`, and `attempts >= 20`, and insert an `audit_logs` receipt. The receipt must contain the bucket, controlled reason, attempt count, operator identity, time, incident/evidence reference, and deletion outcome—but not the storage path, customer content, provider error text, or credentials. If the conditional delete does not return exactly one row, roll back and reinvestigate.
7. Run maintenance once. Verify paid-obligation processors ran, the cleanup action is successful, the dead-letter count is zero, the managed critical alert resolves, the success heartbeat advances, and `/api/health` returns 200 only when every other launch dependency is healthy. Preserve sanitized screenshots/receipt IDs in the release evidence bundle.

Never reset `attempts`, delete the queue row first, mark an object absent without provider proof, or reopen checkout merely because the object was removed.

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

Disable `APP_CHECKOUT_ENABLED` and `APP_CANARY_CHECKOUT_ENABLED` first, revoke active canary authorization, and disable both authoritative pools. Preserve Stripe webhooks, refunds, customer access, maintenance, and audit evidence. Use only a deployment whose application contract is compatible with the applied forward schema.

Migration 061 preserves the prior three-argument canary-refund RPC, migration 065 preserves the preceding intake RPC, migration 067 preserves both the immediately preceding Liberation Sans document contract and the locked Arial contract, migration 068 keeps historical artifacts downloadable while making them ineligible for approval or release, migration 069 prevents the 24-hour release-freshness rule from silently expiring an otherwise valid paid download, migration 070 makes cleanup intent durable for every sensitive material upload while preventing an ordinary employer listing edit from clawing back an already released file, migration 071 makes every anonymous, saved-draft, and completed-intake customer source upload crash-safe, and migration 072 permits a valid employer-required delivery filename that matches the preview basename because the two objects remain isolated in different private buckets. Migration 073 binds each acceptance receipt to the exact approved Terms, Privacy Policy, and displayed acceptance copy. Migration 074 preserves the supported v2 application rollback by routing it through the v3 content-bound finalizer and provides a service-role-only path for explicit customer re-consent on a previously completed draft; it never silently backfills consent. Migration 075 makes those explicit acceptances append-only by exact hash, serializes concurrent re-consent, and preserves every earlier acceptance episode when Terms, Privacy, or acknowledgement copy changes. Migration 076 preserves any immutable receipt written during the 074 rolling window, appends its correct hash-matched acceptance, records an immutable reconciliation link, and makes exact replay idempotent. Migration 077 applies the same cross-field URL, requisition, and weak-record fingerprint identity policy inside both inventory-locked admission RPCs, refuses to carry a historical selected-inventory conflict forward, and invalidates every feasibility assessment and quote derived before the atomic policy. Migration 078 revokes stale invitations, returns their capacity through the audited revocation trigger, and requeues completed feasibility requests whose assessments migration 077 invalidated. Migration 079 adds an initial insert-conflicting cutover scan and schema-readiness contract. Migration 080 closes the remaining old-writer interleaving with an ACCESS EXCLUSIVE drain, installs a permanent per-inventory identity trigger for every insert path, rescans under that lock, and adds the live conflict scan and trigger contract to service-role-only readiness. Keep web, admin, and maintenance inventory writers quiesced while migrations 077 through 080 apply. Health and both checkout gates remain false unless migrations 077 through 080, the persistent trigger, the clean live inventory, and all three authoritative identity predicates are active.

Keep migrations 068 through 080 applied as required forward security and compatibility fixes. After migrations 066 through 080 have been applied, the minimum compatible application rollback commit is `aeae1dee597e153602febd6adfea5644e4628d20` or a reviewed descendant. That floor binds health and both checkout gates to the migration-080 schema contract. Do not roll back to a deployment that lacks its dual-version customer-access compatibility allowlist, approved legal-acceptance presentation, durable delivered-access rules, complete sensitive-upload cleanup, append-only legal-revision receipts, migration-074 receipt reconciliation, atomic inventory identity enforcement, feasibility recovery after the identity-policy cutover, the persistent database identity guard, or runtime binding to the migration-080 schema floor. The rollback target must display and download valid immutable files from both supported contracts after ordinary source aging, closure, or listing edits; require the current legal content, document contract, and source verification for every new approval and release; and retain durable cleanup intents for editable sources, render previews, delivery objects, anonymous source documents, saved-draft source documents, and direct completed-intake source documents until their database registration commits.

Before rehearsing or executing rollback, set `AP_ROLLBACK_TARGET_SHA` to the exact intended deployment commit and run `npm run test:rollback`; the check rejects a target before `aeae1dee597e153602febd6adfea5644e4628d20`, one that does not bind runtime health and checkout to schema 080, one whose exact normalized Terms/Privacy, acknowledgement-presentation, or wizard source differs, one lacking any of the three material-upload intent contracts, or one lacking any customer source-upload intent path. It also requires the restored database configuration to carry the exact approved legal versions, hashes, canonicalization version, receipt schema, and immutable reconciliation contract. Reapproving the Liberation Sans renderer is a forward recovery option only when checkout remains locked and its identity, font hash, network attestation, and family are reverified; approval is never inherited from migration 066. Existing files remain authorized by their own immutable renderer and font evidence until their file version is explicitly superseded or revoked. Database migrations are forward-only: also run `npm run test:database`, including the 074-to-076 upgrade rehearsal, validate the selected deployment/schema pair, and never reverse a production migration ad hoc.

After recovery, verify the release SHA; `/api/health`, including the exact legal-content binding; explicit re-consent for completed and checkout-locked drafts; a later Terms, Privacy, and copy revision appending new immutable episodes without duplicating an exact retry; provider callbacks; one historical Liberation Sans download; one locked Arial download after its source verification exceeds 24 hours; one delivered download after an ordinary listing edit; current-source rejection for a new approval/release; a crash-recovery cleanup drill covering all three material buckets and all three customer source-upload flows; pending paid work; refunds; webhook replay; the maintenance heartbeat; and one test-mode transaction before reopening either checkout gate.

# Stripe sandbox restoration preparation - October 23, 2026

Status: NOT READY for deployment or credential replacement. This is a concrete target/configuration record and ordered preparation plan, not an approved release candidate or provider apply receipt. Continue from `CODEX_STRIPE_HANDOFF_2026-10-23.md`; do not repeat account setup, OAuth, planner, or catalog creation.

## Exact target and proposed configuration

| Item | Verified target / required value |
| --- | --- |
| Repository | `https://github.com/duotapmobile/ApplyPack.git` |
| Current local HEAD | `a3de4a447d499fb7d416e1a1d167e281372903b2` (not an approved deployment candidate) |
| Railway project | `fb5a58c4-8ccb-4205-82f9-8b8738c84e56` |
| Environment | staging, `6633e585-5bcd-4729-b167-2a99628daf86` |
| Web service | ApplyPack-staging, `3d379eca-87ac-48ba-9f95-9d69c806a5db` |
| Supabase project | `fmugizadzdnqfckujqlw` |
| `STRIPE_EXPECTED_ACCOUNT_ID` | `acct_1UTeOMJBHv2xRTvu` |
| `STRIPE_JOB_SEARCH_PRICE_ID` | `price_1UTkYBJBHv2xRTvu8oQ7H9wg` |
| `STRIPE_APPLY_PACK_PRICE_ID` | `price_1UTkaTJBHv2xRTvug7ibWWau` |
| `STRIPE_SECRET_KEY` | Secret/restricted **test** key for the account above; enter directly in provider secret storage, never chat or Git |
| `STRIPE_WEBHOOK_SECRET` | Exact endpoint's signing secret; enter directly in this web service only |
| Receiver | `https://applypack-staging-staging.up.railway.app/api/stripe/webhook` |
| Snapshot event API version | `2026-08-26.dahlia`, matching installed stripe-node 22.6.0 |
| Checkout | Hosted, `mode=payment`, card only, USD, automatic tax explicitly false |
| Totals | Search 1899 cents; one pack 799 cents; two packs 1598 cents |

The server credential must permit retrieval of its own account (`GET /v1/account`), price/product reads and the existing application operations. Existing staging account lookup is denied; key-prefix inspection is insufficient. No publishable key is required by the hosted redirect flow. Do not send these secrets to the separate maintenance service `866e36fd-2fec-45fd-ba01-7150a789e419`.

Keep all six checkout/live/board/source-sync switches explicitly false through restoration. Set `APP_PAYMENT_MODE=test`, `APP_DEPLOYMENT_ENV=staging`, the exact staging app/Supabase origins, and `APP_EXPECTED_RELEASE_SHA` to the actual reviewed candidate. Do not invent a candidate SHA or set it to the baseline merely to satisfy validation.

Proposed own-account snapshot endpoint events:

```json
[
  "checkout.session.completed",
  "checkout.session.expired",
  "refund.created",
  "refund.updated",
  "refund.failed",
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed"
]
```

Use the existing snapshot route and SDK. No thin-event migration, subscription events for new sales, SDK upgrade, Tax enrollment or tax activation is part of this change. Historical board-account webhook obligations must be retained separately if found; the new account's eight-event list is not authorization to remove historical destinations.

## Evidence that blocks an immediate cutover

1. The old staging key has five historical test Sessions (three complete, two expired), four Payment Intents (three succeeded, one canceled), and no refunds in exhausted lists. Own-account and dispute reads return 403 `more_permissions_required`. No corresponding rows were found in the inspected staging order/payment/refund/event tables. Their provenance is unresolved, not reconciled.
2. `ap_checkout_initiations` and `ap_checkout_mode_configuration` return 404 `PGRST205`. Their absence from the REST schema cache does not establish the migration ledger or zero pending obligations. Migration 085 requires its own exact-target preparation and approval.
3. There is no active web or maintenance deployment. Liveness is 404. The latest removed deployment built successfully but has no runtime logs; the reason for removal is unavailable. Adding Stripe variables does not explain or resolve this state.
4. Current provider build is RAILPACK with null configured/resolved config paths; the current launch profile is not active. The watched Git branch has `checkSuites=false`. A push can cause an unintended deployment.
5. The 159-entry dirty baseline contains broader launch work. Local Stripe changes are overlaid on that work, not an independently deployable candidate. No committed candidate, required exact-SHA CI, or accepted recovery strategy has been established here.

## Ordered continuation

1. **Resolve the old account read boundary first.** Use the existing account's secure provider interface or an appropriately authorized read credential to verify its account ID and dispute/subscription obligations. Do not reveal keys in chat, rerun OAuth for the new sandbox, or alter catalog objects. Attribute the completed test Sessions to their actual application/environment using read-only provider metadata and the correct ledger. No deletion, refund, or synthetic backfill is authorized by this plan. Preserve the original key, endpoint, and legacy price associations until the obligation audit is complete or explicit account routing is implemented and reviewed.
2. **Prepare the source candidate.** Review the necessary existing checkout, migration, security and launch-profile dependencies with the bounded Stripe delta. Freeze an exact committed candidate using a publication path that cannot trigger the current unchecked branch automatically. Record source, lockfile and configuration hashes; run required candidate CI and recovery checks. Do not upload the dirty directory or blindly redeploy historical HEAD. The local preservation inventory is at `evidence/stripe-sandbox-2026-10-23/baseline.json`.
3. **Prepare schema 085 independently.** Inspect the actual hosted migration ledger. Follow `LAUNCH_DATABASE_OPERATIONS.md` for the exact reviewed source, quiescence, protected backup/restore, recovery acceptance and 084-to-085 change receipt. Obtain any missing named-target migration authorization only once those concrete inputs exist. This task has not applied a migration or supplied human recovery approval.
4. **Prepare the provider change for review.** Follow `.railway/launch.ts` and `RAILWAY_LAUNCH_PROFILE.md`; capture a fresh no-value plan/etag, pre-change configuration, CI enforcement, exact full candidate SHA, configuration/image hashes, and an executable rollback or accepted forward-recovery plan. Reject unrelated staged changes. Capture `railwayConfigFile`, resolved `configFile`, build/start/health settings and source trigger for each affected service. If the desired restoration needs a different approved profile, resolve that scope before applying; do not silently substitute the historical Railpack configuration. Scoped deployment approval is the final step after this preparation, never approval of an unreviewed dirty tree.
5. **Restore with checkout locked.** Deploy the exact approved web candidate, verify `/api/live` 200 and actual deployed SHA, then restore same-candidate maintenance per its existing runbook. Preserve historical webhooks/refunds/customer access and prove locked negative checkout behavior. A liveness response alone is not launch health.
6. **Pair the new sandbox securely.** Only after the old-account cutover is safe, configure the verified account and existing price IDs and enter the matching server key directly into the exact web service. After the receiver works, create or reuse the endpoint above and set its signing secret directly. Verify account/endpoint/API version/events/URL and an actual signed delivery. The code's account guard cannot prove pairing for direct events without `event.account`; a local self-generated signature is not provider proof. Keep all values out of evidence except safe IDs, presence and provider version references.
7. **Collect real application evidence.** Follow `TEST_MODE_ORCHESTRATION.md`: verify real dependencies, exact release and scoped fresh-TOTP rehearsal authorization; complete an eligible invitation-based search and eligible delivered-job pack purchase. Check totals, quantities, raw-body rejection, wrong-account/mode rejection, simultaneous retries, lost response, webhook-before-response, expiration, and provider event replay. Confirm one fulfillment/capacity allocation/deadline/receipt per purchase. Do not bypass inventory, consent, encryption, document rendering, maintenance or capacity to make a standalone Checkout pass. Refunds remain outside this task's authorization.
8. **Close rehearsal.** Lock both database/configuration modes, reconcile sessions and retain evidence. Record local tests, actual deployed SHA, hosted payments and webhook outcomes separately. Live charges, live refunds, subscriptions, tax activation and public launch require separate authorization.

No provider apply, variable change, endpoint creation, charge, refund, migration, Git commit, push or deployment was performed by this continuation.

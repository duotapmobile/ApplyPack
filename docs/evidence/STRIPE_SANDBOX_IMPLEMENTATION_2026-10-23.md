# Stripe sandbox implementation - October 23, 2026

**NOT READY.** Local safeguards are implemented and tested. The existing catalog is verified, but credentials, a functioning hosted receiver, deployment, and real Checkout/webhook evidence remain blocked. This record supplements the original connection review and handoff, which remain unchanged.

## Source and preservation

- Canonical root: `C:\Users\mskir\Desktop\Apply_Pack\applypack-production-v2`.
- Origin: `https://github.com/duotapmobile/ApplyPack.git`.
- Branch: `codex/manual-launch-hardening-2026-10-02`.
- Full HEAD: `a3de4a447d499fb7d416e1a1d167e281372903b2`.
- Initial state: 159 dirty status entries, comprising the earlier 157 plus the two handoff files. All 683 underlying modified/untracked files were copied and hashed before edits in ignored `evidence/stripe-sandbox-2026-10-23/`.
- Final preservation check: all 683 remain present; 674 are byte-identical and nine contain the reviewed incremental edits. No unexpected change or deletion was found. Both original handoff documents are byte-identical; the existing decision log retains its complete original text with an appendix. `final-validation.json` binds the changed files and test outcome.
- No Git staging, commit, push, reset, cleanup, branch change, or sibling `site` access. Current local edits do not create a deployable candidate.

## Implemented behavior

1. `STRIPE_EXPECTED_ACCOUNT_ID` is required for new-checkout configuration. Before new-price validation, `assertStripeAccount` calls the credential's own `/v1/account` endpoint through the installed SDK and requires exact identity. The request has a five-second timeout and no automatic network retry. A missing/malformed identity, other account, denied lookup or provider failure cannot authorize a new Session.
2. Webhook raw-body signatures and payment mode remain first. The credential account and any supplied event `account` are checked before any event write, claim or fulfillment. Verification failure returns a generic retryable 503 without provider details. Direct own-account events usually omit `account`: this runtime check does **not** prove the configured signing secret belongs to that account. Secure provider pairing remains a mandatory cutover gate.
3. The original `order_id` / `cart_id` webhook fallback now uses `STRIPE_LEGACY_JOB_SEARCH_PRICE_ID` / `STRIPE_LEGACY_APPLY_PACK_PRICE_ID` for historical 2000/800-cent settlement. It permits inactive historical catalog entries while retaining exact amount, name, type, currency and quantity validation. Missing legacy configuration cannot fall back to current prices. Operational clients remain usable while checkout is locked.
4. The environment template/schema and proposed Railway launch web profile preserve the new account setting. No value or secret was applied to Railway. Hosted one-time Checkout, 1899/799-cent totals, automatic tax OFF, quantity validation, invitations, capacity and durable idempotency remain in place.

## Current provider observations

Official Stripe MCP account enumeration again returned only Apply Pack sandbox `acct_1UTeOMJBHv2xRTvu`, `livemode=false`. Retrieval of the existing price/product pairs confirmed active one-time USD prices, correct product names/default associations and inclusive tax behavior:

| Product | Product ID | Price ID | Cents |
| --- | --- | --- | --- |
| Job Match Search | `prod_VUk2iNfZrwb6Zq` | `price_1UTkYBJBHv2xRTvu8oQ7H9wg` | 1899 |
| Tailored Resume + Cover Letter | `prod_VUk3Vqm4pZjwIy` | `price_1UTkaTJBHv2xRTvug7ibWWau` | 799 |

The exhausted webhook-endpoint list was empty. No catalog, Tax, payment, endpoint or account mutation was performed. Installed stripe-node remains 22.6.0 with snapshot API default `2026-08-26.dahlia`.

Railway inspection targeted project `fb5a58c4-8ccb-4205-82f9-8b8738c84e56`, staging environment `6633e585-5bcd-4729-b167-2a99628daf86`, web service `3d379eca-87ac-48ba-9f95-9d69c806a5db`:

- Zero active web deployments and `/api/live` HTTP 404. Separate maintenance also has zero active deployments.
- Retained FAILED `24c14a2c-2579-4ada-8467-d2b59f4a068f` at `902ce8311677984caf8dbc320cec647121459582`: provider records BUILD_IMAGE failure; retained logs stop at TypeScript with no terminal error. Root cause remains unknown.
- Latest REMOVED `3b30864c-7c2b-4022-aa50-16597dc7f018` at current HEAD: build completed compilation, TypeScript, 69 pages and image export `sha256:c20e5e15bd0792d4b507264d367afdd0a14630380f7f118a1b085b12bb6ae0d3`; no runtime logs. Removal recorded `2026-10-23T00:53:29.615Z`, without an exposed reason/actor. Both records have redeploy/rollback unavailable.
- Current builder RAILPACK; `railwayConfigFile` and resolved `configFile` null; build/start/root/Dockerfile overrides null. Health `/api/live`, timeout 120, ON_FAILURE with three retries. The proposed launch Docker configuration is not active.
- GitHub trigger `f757c36d-dad5-4a57-aaae-d04b622dcc2d` watches the current branch with **`checkSuites=false`**. Publishing to it can trigger deployment without waiting for candidate checks.
- Staged-change inspection returned empty with zero change-field paths. This is a point-in-time observation, requiring recheck before any future apply.

## Old credential and database boundary

Existing web-service Stripe key, signing secret and price-variable names are present; values were used only transiently in memory for read-only inspection and were not printed or saved. Current search/pack IDs differ from the new catalog.

Observed existing staging search/pack IDs are `price_1UMs8MHIQhVBusrZFwMUP6yH` and `price_1UMs96HIQhVBusrZSBpdtVnf`. The three completed test Sessions are dated September 3 UTC and total 800, 3000, and 2000 cents; the 3000-cent Session must not be assumed to satisfy any current contract. Their metadata uses the historical `cart_id` or `order_id` branches. Shared object-ID suffixes are not verified account identity.

Exhausted reads using the existing test credential found five Sessions (three complete, two expired, none open), four Payment Intents (three succeeded, one canceled), and zero refunds, all test-only. Account and dispute retrieval returned HTTP 403 `more_permissions_required` (`invalid_request_error`). Existing-account identity, disputes and the full historical obligation audit remain unresolved.

The staging Supabase origin matched `fmugizadzdnqfckujqlw.supabase.co`. Exact counts were zero in `ap_checkout_attempts`, `ap_material_checkout_intents`, `ap_payment_attempts`, `ap_refund_operations`, `ap_external_commands`, `webhook_events`, `ap_provider_events`, `orders`, `payments` and `refunds`. However, `ap_checkout_initiations` and `ap_checkout_mode_configuration` returned HTTP 404 `PGRST205`; availability of migration 085 is unproved, not an observed empty ledger. Three completed provider payments without records in these inspected staging tables require provenance/reconciliation. Credentials were not replaced.

## Validation and review

Local behavioral tests use synthetic inputs, mocked provider/database operations, and the real Stripe signature implementation where noted. They do not create a provider Checkout or prove hosted payment delivery.

- Focused Stripe/mode/historical/payment-route/tax/manual-launch tests: 65 passed.
- New signed-webhook behavior tests: 15 passed, including changed raw body, wrong signing secret/mode/account, unavailable account lookup, locked historical settlement, price substitution, and replay without duplicate fulfillment/email.
- Durable-checkout integration file: 14 passed, covering retries, ambiguous provider outcomes and reconciliation; this is a mocked provider/database boundary test, not hosted database execution.
- Railway configuration tests: 9 passed; Railway TypeScript check passed.
- Root TypeScript and changed-file lint passed. A final source-bound validation receipt is recorded in the ignored evidence directory.
- Independent subagents reviewed governing authority, staging/provider state, payment design and the finished local delta. No additional actionable code regression was identified. The direct-event signing-secret/account pairing limit was explicitly retained as a provider gate.

## Remaining outcome

No matching new-account runtime credential or signing-secret configuration is established. No active receiver, approved committed deployment candidate, schema-085 hosted proof, protected recovery approval, hosted test payment or signed provider delivery exists from this work. No full build, new database-engine test, hosted E2E, live charge/refund, tax activation or public launch was performed.

The exact proposed configuration, endpoint event list, legacy-account hold and ordered source/database/provider preparation are in `../runbooks/STRIPE_SANDBOX_RESTORATION_2026-10-23.md`. Do not request deployment approval against the dirty tree: first produce the reviewed candidate, recovery/migration receipts and provider plan. The immediate external prerequisite is read-only access sufficient to identify the old key's account and reconcile its historical obligations.

The signed-in browser fallback could not initialize because the Windows sandbox returned `helper_unknown_error: apply deny-read ACLs`; no dashboard was inspected. The human was asked only to open the existing staging key's settings to resolve actual denied reads, without sharing a secret. No repeat permission setup or account selection for the new sandbox was requested.

## References checked

- [Stripe account retrieval](https://docs.stripe.com/api/accounts/retrieve); installed SDK `accounts.retrieveCurrent` uses `/v1/account`.
- [Stripe webhook signatures and endpoint configuration](https://docs.stripe.com/webhooks).
- [Stripe event retention](https://docs.stripe.com/api/events/retrieve): event retrieval was not added as a historical replay gate.

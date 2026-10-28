# Stripe connection and integration review — 2026-10-23

Status: NOT READY for application activation. OAuth access and the official implementation planner were verified. The user supplied the account-menu screenshot confirming the displayed Apply Pack parent; runtime integration remains unverified and the staging web service is stopped/failed.

## Repository identity

- Root: `C:\Users\mskir\Desktop\Apply_Pack\applypack-production-v2`
- Origin: `https://github.com/duotapmobile/ApplyPack.git`
- Branch: `codex/manual-launch-hardening-2026-10-02`
- HEAD: `a3de4a447d499fb7d416e1a1d167e281372903b2`
- Existing working tree: 157 dirty entries before this new evidence file. No existing changes were modified.

## Connection evidence

The installed official Stripe plugin is version `11c74d6b`. A direct MCP server named `stripe` was added at `https://mcp.stripe.com`. The initial browser authorization expired. A subsequent browser authorization succeeded, and the CLI reported `auth_status: o_auth`.

The current desktop chat did not expose Stripe tools. Fresh, ephemeral CLI sessions using the saved OAuth connection successfully invoked the official Stripe MCP tools. No API secret, OAuth token, webhook signing secret, password, or MFA code was requested in chat or recorded in this evidence.

Provider account enumeration and account retrieval established:

| Field | Provider result |
|---|---|
| Accessible Stripe context | `acct_1UTeOMJBHv2xRTvu` |
| Name | Apply Pack sandbox |
| Mode | Sandbox/test; `livemode: false` |
| Website | `www.applypack.work` |
| Parent business display name | Apply Pack, shown in the user-supplied account-menu screenshot |
| Parent live business account ID | Not exposed by the authorized sandbox connection |

This context differs from the old DuoTap sandbox `acct_1Sx9HmHIQhVBusrZ`. The user subsequently supplied `codex-clipboard-e64db844-e43b-4d04-94b8-4a36e2cd3fca.png`, whose account-menu header shows `Apply Pack sandbox` above `Apply Pack`. This confirms the displayed parent name and establishes the intended sandbox target for the setup. The parent live account ID and account creation history are not exposed by the authorized sandbox connection; live-account identity must be established separately before any live configuration. Do not infer ownership from the supplied publishable-key text or Google sign-in email.

## Railway staging identity

Provider read-only inspection verified:

- Project: Apply Pack, `fb5a58c4-8ccb-4205-82f9-8b8738c84e56`.
- Environment: staging, `6633e585-5bcd-4729-b167-2a99628daf86`.
- Web service: ApplyPack-staging, `3d379eca-87ac-48ba-9f95-9d69c806a5db`.
- Domain: `applypack-staging-staging.up.railway.app`.
- Intended test webhook URL: `https://applypack-staging-staging.up.railway.app/api/stripe/webhook`.
- Service status references deployment `24c14a2c-2579-4ada-8467-d2b59f4a068f`, FAILED/stopped, with zero active deployments, at source SHA `902ce8311677984caf8dbc320cec647121459582`.
- The newest deployment-history entry is `3b30864c-7c2b-4022-aa50-16597dc7f018`, REMOVED, at current local HEAD `a3de4a447d499fb7d416e1a1d167e281372903b2`.
- One read of `/api/live` returned HTTP 404. Retained logs for the older failed deployment show compilation followed by TypeScript checking, without a terminal error or runtime startup evidence; they do not establish the cause of failure.

The maintenance service is separate: ApplyPack-maintenance, `866e36fd-2fec-45fd-ba01-7150a789e419`, with no public domain. No variable values were retrieved, no secrets were changed, and no deployment was started. A functioning webhook receiver is not established.

[Verified staging dashboard](https://railway.com/project/fb5a58c4-8ccb-4205-82f9-8b8738c84e56?environmentId=6633e585-5bcd-4729-b167-2a99628daf86)

## Official implementation planner

`mcp__stripe__stripe_implementation_planner` was actually called. An initial attempt was blocked by the helper CLI's `never` approval policy. The call then succeeded with automatic approval review enabled; no approval rejection was bypassed.

- Guide: `iguide_61Vd7s8ZEixrnsPYm41JBHv2xRTvu`
- Initial result: draft decision tree, no integration shape.
- Selected path: Stripe only; browser; no Managed Payments; standard checkout; no Payment Links; hosted Checkout.
- Follow-up result: `status: accepted`.
- Returned shape: `{"checkout_type":"hosted","provider":"checkout_studio","origin_context":"web"}`.

The planner's generic recommendations included Link, Dynamic Payment Methods, and Adaptive Pricing. They were not applied. The planner did not explicitly reconcile the submitted fixed USD totals, automatic-tax-off requirement, card-only methods, capacity, webhook fulfillment, idempotency, or SDK version. Its returned provider tag is recorded as planner metadata, not authority to migrate the working integration. The original selected-path documentation describes server-created Checkout Sessions and redirecting to the returned hosted URL, matching the existing integration approach.

No fallback skills installation was necessary because the real planner was available and completed its workflow.

## Review findings and retained constraints

- Preserve existing hosted, one-time Checkout Sessions. The application already validates prices server-side, verifies raw-body webhook signatures, and uses durable idempotency and capacity controls. No publishable-key insertion or checkout rewrite was performed.
- The current runtime checks test/live mode but does not enforce an expected Stripe account ID. A consistent set of credentials, prices, and webhook from the wrong account could pass those checks. Verify all account identities together before changing runtime configuration.
- Required new-account prices remain active one-time USD prices: `Job Match Search` at 1,899 cents, and `Tailored Resume + Cover Letter` at 799 cents per selected job.
- Do not run `scripts/configure-stripe-test-prices.mjs` blindly: it also deactivates historical board products/prices and only checks the test-key prefix before account mutations.
- The governing October 19 tax amendment keeps totals at $18.99 and $7.99 per selected pack, with automatic tax explicitly OFF. The request for Stripe Tax and permission to access it do not settle a new tax collection/display contract. No tax settings or registrations were changed.
- Existing operational credentials and webhook signing secret are singular. Check any outstanding old-account checkout/refund obligations before replacing them.
- Installed SDK is stripe-node 22.6.0 with default API `2026-08-26.dahlia`. Official sources reviewed on this date showed SDK 23.0.1 and API `2026-09-30.endive`. No SDK/API upgrade was performed. The installed skill's older Clover latest-version claim was not relied upon.

## Permission decisions

The user requested broader ongoing sandbox access rather than setup-only permissions. The user also reported that the authorization UI permitted only Read for Credit Notes, Files, Payment Intents, Payment Methods, Setup Intents, and Workflow Definitions, and selected Write for Subscriptions. These are user-reported selections, not a provider-verified permission audit. Technical permission does not itself authorize subscriptions, tax activation, real financial transactions, or workflow execution.

## Initial sandbox inventory

A subsequent official MCP inventory explicitly scoped every account read to `acct_1UTeOMJBHv2xRTvu` and verified `livemode: false`:

- Zero active or inactive Products and Prices; each list was exhausted (`has_more: false`). The Price list excludes inline prices.
- No webhook endpoints or event destinations.
- Tax settings: `pending`, default `tax_behavior: inferred_by_currency`, default `tax_code: txcd_10000000`.
- No Tax registrations in any status.
- Active default payment-method configuration: `pmc_1UTeOvJBHv2xRTvu1ArgnTbR`. Multiple methods are available/enabled at the account level; the application still explicitly requests card-only Checkout.
- No read operations were denied. No settings were changed during inventory.

The existing default tax code is an observed provider value, not a validated classification of either ApplyPack service. It must not be treated as such. The account-level inferred tax behavior would use exclusive pricing for USD if inherited; fixed-total prices should explicitly specify inclusive behavior before any later Tax activation.

The user asked which tax option would minimize effort. The recommendation was to retain the exact customer totals, prepare inclusive sandbox prices, and leave collection off while service classification and registrations are verified. Paid Tax Complete enrollment was not recommended at this stage and was not authorized or performed. This recommendation does not constitute user approval to enable tax collection or amend the application tax contract.

## Validation and remaining work

### Completed sandbox catalog

The official Stripe MCP created and retrieved all four objects in `acct_1UTeOMJBHv2xRTvu`, with `livemode: false` throughout:

| Field | Job Match Search | Tailored Resume + Cover Letter |
|---|---|---|
| Product | `prod_VUk2iNfZrwb6Zq` | `prod_VUk3Vqm4pZjwIy` |
| Price | `price_1UTkYBJBHv2xRTvu8oQ7H9wg` | `price_1UTkaTJBHv2xRTvug7ibWWau` |
| Currency and amount | USD 1899 cents | USD 799 cents |
| Lookup key | `job_match_search_usd_1899_manual_launch_v2` | `apply_pack_usd_799_manual_launch_v2` |

Both prices are active, one-time (`recurring: null`), explicitly `tax_behavior: inclusive`, and set as the matching product's default price. Exact product names, descriptions, metadata, associations, amounts, and mode were retrieved and verified. Final exhausted inventory contains exactly two active products and two active prices, with no inactive entries. No objects were reused; no actions were denied. No tax code was assigned and no Tax setting was changed. Inclusive price behavior does not activate automatic tax.

Completed: repository identity checks; official skill/payment-reference review; read-only integration review; saved OAuth verification; successful provider account enumeration/retrieval; actual planner draft and acceptance calls; comparison with official hosted Checkout documentation; creation and provider retrieval of the two sandbox catalog entries above.

Not completed: parent live account ID verification for future live access; supplied publishable-key match (the current hosted integration does not use it); runtime credential account match; webhook receiver configuration; secret entry; restoration of a working staging receiver; hosted webhook delivery; end-to-end test payment; SDK upgrade validation; any future tax collection decision.

Only the two sandbox products and prices above, their default-price associations, and local evidence/handoff documentation were changed during setup. No application code, payment methods, webhooks, Tax configuration, Railway variables, deployment, payment, or refund was changed. No application tests were run because this work changed no runtime implementation. Local test availability was inspected separately and does not prove provider integration. No commit or push was performed.

Next dependent steps: reuse the verified catalog entries, establish matching runtime credentials and a functioning staging receiver, and test hosted Checkout and signed webhook delivery. The existing automatic-tax-off contract remains in force. Keep the protected sibling `site` checkout untouched. See `docs/runbooks/CODEX_STRIPE_HANDOFF_2026-10-23.md` for the continuation plan requested by the user.

## Official references

- [Stripe MCP](https://docs.stripe.com/mcp)
- [Stripe sandboxes](https://docs.stripe.com/sandboxes)
- [Hosted Checkout integration](https://docs.stripe.com/payments/accept-a-payment?payment-ui=checkout&ui=stripe-hosted)
- [Stripe API versioning](https://docs.stripe.com/api/versioning)
- [stripe-node 23.0.1](https://github.com/stripe/stripe-node/releases/tag/v23.0.1)
- [Stripe tax behavior](https://docs.stripe.com/tax/products-prices-tax-codes-tax-behavior)
- [Stripe Tax pricing](https://stripe.com/tax/pricing)
- [Tax filing and remittance](https://docs.stripe.com/tax/filing)

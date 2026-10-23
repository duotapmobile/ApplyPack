# ApplyPack Stripe implementation handoff — 2026-10-23

## User request and scope

The user asked to implement the Stripe plan and switch to Codex. Continue the already-authorized sandbox integration work without repeating permission selection, account setup, or product creation. The user wants minimal ongoing administration and can complete necessary human-only browser steps one at a time. Never request secrets in chat or ask the user to run PowerShell.

Preserve $18.99 Job Match Search and $7.99 per selected Apply Pack as final USD totals, one-time payments, hosted Checkout Sessions, and automatic tax OFF. The sandbox prices are explicitly inclusive so future authorized tax can come out of those totals. Service tax classification and registration requirements remain unresolved. Do not enable collection, register for tax, enroll in a paid Tax plan, create subscriptions, charge live cards, issue refunds, or launch publicly under this handoff. Broader API permissions do not independently authorize those actions.

## Workspace and existing changes

Work only in `C:\Users\mskir\Desktop\Apply_Pack\applypack-production-v2`. Verify root, origin `https://github.com/duotapmobile/ApplyPack.git`, branch, full HEAD and status, then read AGENTS.md and its required governing documents before implementation. At handoff, branch was `codex/manual-launch-hardening-2026-10-02`, HEAD `a3de4a447d499fb7d416e1a1d167e281372903b2`. There were 157 pre-existing dirty entries, plus the new Stripe evidence and handoff files. Preserve all existing changes. Never touch the sibling `site` checkout or deploy the dirty tree indiscriminately.

Full evidence: `docs/evidence/STRIPE_CONNECTION_REVIEW_2026-10-23.md`.

## Stripe target and completed provider work

- Official OAuth MCP at `https://mcp.stripe.com` is saved and has successfully executed authenticated reads and sandbox catalog writes.
- Verified context: `acct_1UTeOMJBHv2xRTvu`, Apply Pack sandbox, `livemode: false`, website `www.applypack.work`.
- User supplied the account menu showing Apply Pack sandbox under Apply Pack. Do not repeat this identity question. The parent live account ID is still unverified and outside sandbox scope.
- Old DuoTap account `acct_1Sx9HmHIQhVBusrZ` is the wrong target. Do not trust the default Stripe CLI context.
- Official planner guide `iguide_61Vd7s8ZEixrnsPYm41JBHv2xRTvu` completed with accepted hosted Checkout path. Its generic recommendations do not authorize a migration, Adaptive Pricing, extra payment methods, or new tax behavior.

| Application variable | Existing verified value |
|---|---|
| STRIPE_JOB_SEARCH_PRICE_ID | `price_1UTkYBJBHv2xRTvu8oQ7H9wg` |
| STRIPE_APPLY_PACK_PRICE_ID | `price_1UTkaTJBHv2xRTvug7ibWWau` |

Search product `prod_VUk2iNfZrwb6Zq`: Job Match Search, USD 1899 cents. Pack product `prod_VUk3Vqm4pZjwIy`: Tailored Resume + Cover Letter, USD 799 cents. Both products/prices active, test-only, matching defaults, exact names, one-time, tax behavior inclusive. Final inventory: exactly two active products and two active prices; zero inactive. Reuse them. The helper completed successfully and is no longer running.

Initial inventory found no webhooks/event destinations, no Tax registrations, Tax settings pending. Observed default `txcd_10000000` is not a validated service tax classification. No Tax settings were changed.

## Railway target and current blocker

- Project Apply Pack: `fb5a58c4-8ccb-4205-82f9-8b8738c84e56`.
- Staging environment: `6633e585-5bcd-4729-b167-2a99628daf86`.
- Web service ApplyPack-staging: `3d379eca-87ac-48ba-9f95-9d69c806a5db`.
- Intended webhook: `https://applypack-staging-staging.up.railway.app/api/stripe/webhook`.
- Dashboard: https://railway.com/project/fb5a58c4-8ccb-4205-82f9-8b8738c84e56?environmentId=6633e585-5bcd-4729-b167-2a99628daf86
- Maintenance is a separate service `866e36fd-2fec-45fd-ba01-7150a789e419`; do not place web-service secrets there.

No active deployment. Service status references failed/stopped `24c14a2c-2579-4ada-8467-d2b59f4a068f` at older SHA `902ce8311677984caf8dbc320cec647121459582`. Newest history entry `3b30864c-7c2b-4022-aa50-16597dc7f018` is REMOVED at current HEAD. `/api/live` returned 404. Retained older build logs do not establish the failure cause. Do not assume adding Stripe secrets fixes staging. No Railway variable values were read or changed, and no deployment was started in this setup.

## Implementation sequence

1. Revalidate checkout/provider identity and read governing amendments, existing Stripe implementation, deployment plan and current diff. Preserve current Checkout, fulfillment and historic-account obligations. Investigate the stopped staging service and establish an exact deployable source without bundling unrelated changes.
2. Establish that the staging server credential belongs to the verified sandbox, and that configured prices and webhook are from the same account. Consider a targeted expected-account guard because the current runtime checks only test/live mode. Inspect existing tests first; add only meaningful negative coverage needed by any code change. Do not use `scripts/configure-stripe-test-prices.mjs` blindly: it also retires historical catalog entries and lacks an account-ID guard.
3. Configure the verified existing price IDs and matching `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in the exact staging web service using an approved secret store/provider UI. Human-only entry must happen directly in that service, never chat or Git. Check outstanding old-account obligations before replacing singular credentials. No publishable key is needed for the existing hosted redirect flow.
4. Prepare a concrete, reviewed staging restoration/deployment using existing repository deployment controls. Complete all independent implementation and validation first; obtain only any genuinely missing consequential deployment authorization at the final step. Check unrelated pending provider changes before applying.
5. Create/verify a sandbox webhook for the exact functioning receiver. The current route handles checkout.session.completed, checkout.session.expired, refund.created, refund.updated, refund.failed, charge.dispute.created, charge.dispute.updated and charge.dispute.closed. Match the implementation's supported event/API behavior rather than guessing a latest version.
6. Run focused relevant tests and real sandbox end-to-end Checkout/webhook verification, including exact totals, server-controlled quantities, invitation/capacity restrictions, signed raw-body verification and replay idempotency. Confirm no duplicate fulfillment. Never substitute mocked tests for provider evidence.
7. Update evidence with exact provider IDs, source/deployed SHAs, what passed and what remains. Separate local checks, hosted test proof and live launch status. Do not declare READY TO SHIP with missing operational gates.

## Tooling observations

Installed stripe-node was 22.6.0 with API default `2026-08-26.dahlia`; no SDK upgrade was made. Recheck before deciding whether an upgrade is necessary.

The previous chat's tool set did not refresh after OAuth, but fresh ephemeral Codex CLI sessions could invoke official Stripe MCP. If direct Stripe tools are available here, use them. Do not repeat login unless an actual authentication error requires it. The previous sandbox shell launcher had a Windows deny-read ACL helper failure; narrow normally reviewed escalation worked. No automatic approval rejection was bypassed.

The previous setup made no runtime code changes and ran no application tests. Only the sandbox catalog/default-price associations and local documentation were changed. Nothing was committed, pushed or deployed.

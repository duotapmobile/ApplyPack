# Stripe staged key verification - October 23, 2026

Status: **KEY VERIFIED; HOSTED CHECKOUT NOT READY.**

The user entered the existing Apply Pack sandbox secret into Railway as `STRIPE_SANDBOX_CANDIDATE_KEY` and explicitly left it staged, not deployed. Read-only verification at 2026-10-23T18:31:40.380Z confirms the key is valid and belongs to the intended sandbox. No key value was printed, saved locally, or included in this receipt.

## Verified provider state

- Railway project: `fb5a58c4-8ccb-4205-82f9-8b8738c84e56`.
- Environment: staging, `6633e585-5bcd-4729-b167-2a99628daf86`.
- Web service: ApplyPack-staging, `3d379eca-87ac-48ba-9f95-9d69c806a5db`.
- Staged patch: `18b27ee8-2ec6-40fb-b22c-2081dc616262`, status `STAGED`, updated `2026-10-23T18:28:29.140Z`.
- The patch contains exactly one leaf: the candidate variable on the web service. The candidate is absent from the applied variables. Existing runtime credentials were not replaced.
- Own-account lookup using the candidate returned `acct_1UTeOMJBHv2xRTvu`, exactly matching Apply Pack sandbox.
- Search price `price_1UTkYBJBHv2xRTvu8oQ7H9wg`: active, test-only, one-time USD 1899 cents, inclusive tax behavior, correct active product and default-price association.
- Pack price `price_1UTkaTJBHv2xRTvug7ibWWau`: active, test-only, one-time USD 799 cents, inclusive tax behavior, correct active product and default-price association.
- Exhausted new-account webhook list: zero endpoints.
- Active staging web deployments: zero; `/api/live` returned HTTP 404.
- Provider mutations, deployments, payment creation, refunds and migration applications in this verification: zero.

The candidate removes the missing new-account API credential blocker. It does not establish a configured runtime key, matching webhook signing secret, running receiver, payment fulfillment, or permission to apply all staged changes.

## Remaining sequence

1. Prepare and validate a reviewed committed application candidate and exact-target staging restoration. The current checkout remains on `codex/manual-launch-hardening-2026-10-02` at `a3de4a447d499fb7d416e1a1d167e281372903b2`, with existing uncommitted changes. Do not deploy that directory indiscriminately or push the watched branch, whose previously observed provider trigger did not enforce checks, without fresh review.
2. Retain the old runtime key and webhook until historical-account obligations are resolved or explicit account routing is reviewed. The new credential does not provide access to the old account's denied reads. Preserve the earlier five-Session/three-paid-Session findings as unresolved.
3. Prepare schema 085 and recovery receipts using the existing database runbook. `operations/staging-085-migration-final.log` is explicitly a **self-test** receipt, not proof of a hosted migration; it does not clear this gate.
4. Present the concrete restoration change for any missing final scoped approval only after preparation. Restore locked web and maintenance with the verified release and required database/dependency state.
5. Configure the account/price/runtime key pairing, create or reuse the exact sandbox webhook, and transfer its signing secret directly into provider storage. Verify a genuine signed delivery. An additional manual key handoff should not be required if the approved provider tooling can transfer the endpoint secret directly in memory.
6. Run an eligible invitation-based search and eligible pack checkout through the application, prove exact totals and once-only fulfillment, then retain the separate hosted evidence.

The next human action is **not** to click Deploy or create another key. The saved sandbox API key has been verified. Deployment preparation and the unresolved historical-account boundary remain engineering work; any necessary additional human access or consequential approval must be requested against a specific prepared action.

Full restoration constraints: `../runbooks/STRIPE_SANDBOX_RESTORATION_2026-10-23.md`.
Redacted machine receipt: ignored `evidence/stripe-sandbox-2026-10-23/staged-key-verification.json`.

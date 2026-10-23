# Paid-launch execution record — October 23, 2026

Status: NOT READY. This record describes implementation and observed provider state. It does not authorize public purchasing or certify hosted acceptance.

## Governing release

Amendment 17 replaces mandatory live test payments/refunds with sandbox validation and a genuine first-customer pilot. Amendment 16 preserves fixed totals and tax configuration; amendment 14 preserves the approved document standard. Historical migrations and paid records are retained.

The canonical checkout is applypack-production-v2, origin https://github.com/duotapmobile/ApplyPack.git, branch codex/manual-launch-hardening-2026-10-02. Initial HEAD was a3de4a447d499fb7d416e1a1d167e281372903b2. The 688 pre-existing changed/untracked files were copied and hashed before implementation into ignored evidence/paid-launch-2026-10-23/before with baseline.json. The initial HEAD is not the new candidate SHA.

## Provider observations and holds

- Railway project Apply Pack: fb5a58c4-8ccb-4205-82f9-8b8738c84e56, Hobby subscription.
- Staging environment 6633e585-5bcd-4729-b167-2a99628daf86: web and maintenance have no active deployments. Both unchecked GitHub triggers were captured, deleted and verified absent before any publication. Exact restoration inputs are in ignored staging-trigger-hold.json. This did not apply the user's staged Stripe candidate or deploy code.
- Production environment c841e757-e60d-441e-b951-f5c75244df3e: existing web service 793579f2-525f-463f-90ac-cf6689433cc3; no production maintenance service was provisioned. Region/replica overrides are null, so the new profile preserves placement. The production automatic trigger still needs to be held immediately before merging.
- Supabase management API via authenticated CLI identifies production spjaaxndiduhrcleazwb (Apply Pack), us-west-2, INACTIVE, direct host db.spjaaxndiduhrcleazwb.supabase.co. The production database credential is absent. The target registry remains empty until its complete verified connection/CA/credential tuple is available.
- Staging Supabase fmugizadzdnqfckujqlw is ACTIVE_HEALTHY. A TLS verify-full, read-only PostgreSQL transaction at 2026-10-23T19:21:28Z verified the actual ledger through 084. All 13 inspected current and historical checkout, payment, refund, command, webhook, outbox, search and material queues/tables are empty. The 085 checkout-initiation table is absent, as expected. Receipt: ignored staging-obligations.json. Refresh before credential switching.
- Railway staging and production have existing Stripe, webhook, Supabase and Resend credentials, but no configured AWS encryption/document-worker identity or Roles Anywhere credential pair. This machine has no available AWS credential chain. Do not interpret this as proof that the owner's AWS account contains no reusable resources.
- The connected Stripe account is the verified Apply Pack sandbox acct_1UTeOMJBHv2xRTvu only. Live onboarding, catalog and webhook remain to verify through authorized live access.
- A read-only Resend domain-list request using the current production credential returned HTTP 401. This does not establish email delivery or domain readiness; diagnose credential validity/scope through authorized provider access before sending acceptance email. No email was sent.

## Source implementation and checks

Forward migration 202610230086_sandbox_validation_launch_activation.sql adds the versioned sandbox activation contract and immutable server-digested proof, rejects obsolete PUBLIC evidence, and retires new production CANARY operations while preserving staging testing and historical/ordinary refunds.

The runtime requires fresh MFA and validates the final deployed SHA, strict account/project/origin/mode/amount/delivery/refund receipt and its activation-time freshness. A later passage of 24 hours does not expire an approved launch.

Separate production Railway IaC pins main to an exact SHA, forces purchasing locks, preserves environment-specific secrets and prepares separate 15-minute maintenance. Applying resources requires the reviewed cost digest and exact project/environment/service/SHA scope. These authoring guards are not proof of provider identity, cost approval or health.

Migration tools preserve the historical 085 command/receipt and add explicit 084-through-086 staging operation with separate hashes. Production tools accept only verified missing forward migrations from supported predecessors through 086. CI runs real isolated structural recovery. Protected hosted recovery and measured 240/15 targets remain separate mandatory gates.

Independent product and operations reviews also found operator invitation UI, historical customer delivery access, refunded-order wording and maintenance identity/classification defects. Their remediation and focused tests belong to the candidate before freezing it.

All local validation logs are under ignored evidence/paid-launch-2026-10-23. The initial unit attempts experienced native-test timeouts and very slow PowerShell startup and were stopped; their failed logs remain preserved. A direct Node invocation with an explicit single worker is used for the replacement run. Local results must not be represented as hosted payment, email, recovery, phone or screen-reader acceptance.

Local verification completed before candidate freeze:

- All six supported predecessors (080 through 085) upgraded to 086 in the disposable local stack. Each passed all 19 current lifecycle fixtures. The 085 case additionally passed 18 historical fixtures and byte-preserving activation/payment/refund assertions. Six concurrent connections reused one checkout/payment/reservation; cleanup retries registered exactly four immutable keys. The local database was restored to the clean current schema afterward, and generated database types matched.
- The direct full unit run passed 105 suites and 905 tests, with one suite initialization failure caused by an outdated Stripe mock. That mock now preserves the real sandbox identity constants; its six cleanup-readiness tests passed on rerun. This is a repaired local aggregate, not a claim that the original full run was green. Committed-SHA CI must pass independently.
- Both isolated integration suites passed all 15 payment/fulfillment tests. The invitation, historical delivery and refund-copy changes passed 48 tests in five focused suites, with an independent security review of their ownership, authentication, path and structural-validation checks.
- The final release-contract run passed 80 maintenance, readiness and read-only evidence tests. The production dependency audit, whole-repository lint, corrected production build (including TypeScript and page generation) and whitespace checks passed. Committed-revision CI/image/browser/render checks remain a separate gate.
- Guided research, official-source observation and exact-ten release forms passed all 27 focused tests, with full TypeScript and focused lint passing. Product/workflow, security/payments, operations/access and separate challenge reviews are saved under docs/audits. No critical/high finding remains in their reviewed remediated paths; the recorded hosted and human acceptance gaps have not been waived.
- The publication scan records paths, sizes and hashes without credential values. Its only URL findings were literal test templates and fake-password rejection fixtures, including a historical copy of that same test source. Raw browser captures and all current private/provider evidence remain ignored.

## Read-only sandbox proof

After final main SHA, deployment, approved sandbox journey, document review and refunds:

1. Create a private JSON manifest with releaseSha and exactly two purchases, one SEARCH and one MATERIALS. Each purchase has productKind, paymentAttemptId, deliveredReleaseId and refundId. No names, emails, card data or credentials belong in this manifest.
2. Supply AP_SANDBOX_SUPABASE_URL as https://fmugizadzdnqfckujqlw.supabase.co and the two transient secret variables AP_SANDBOX_SUPABASE_SECRET_KEY and AP_SANDBOX_STRIPE_SECRET_KEY through provider/secure process storage. Never paste them into chat, command arguments or Git.
3. Run npm run verify:sandbox-launch -- --manifest <private-input.json> --out <new-private-output-directory>.
4. The verifier performs only GETs. It checks deployed identity before and after, actual Stripe account/catalog/payment/event/refund objects, and linked application customer, payment, webhook, delivery and refund records. It requires ten distinct search members and the selected-job resume/cover-letter pair. It emits sandbox-proof-bundle.json and sandbox-validation-receipt.json without customer identity or raw provider bodies.
5. Keep the bundle private. Import the receipt under evidence.sandboxValidation with activationContractVersion sandbox-proof-live-pilot-v1 through the existing administrator activation endpoint with fresh MFA. The database computes and stores its own immutable digest. Refresh verification within 24 hours of activation. This is reviewed evidence, not a Stripe signature.

## Remaining controlled execution

Review and commit the candidate, obtain actual committed-SHA CI/image results, hold production's automatic trigger, merge and validate final main. Align staging to that exact revision. Keep all later provider evidence outside the frozen source. A code fix starts a new candidate and requires affected validation.

Finalize one consolidated incremental-cost quote after AWS inventory and provider billing access; obtain approval before paid provisioning. Retain old Stripe credentials and endpoint records before switching. The empty staging obligations permit that future switch without resolving unmatched historical provider-only test objects.

Before hosted migration, prove protected/off-machine and operator-credential-loss recovery for records, private objects, keys, authentication and configuration. Require RTO at most 240 minutes and RPO/reconciliation at most 15 minutes. Database structural tests and a same-machine DPAPI backup are insufficient. Use locked forward repair, preserve obligations and reconcile every Stripe payment.

Then apply verified missing forward migrations, deploy locked staging web and matching maintenance, complete the genuine sandbox journey and negative checks, prepare locked production live configuration, and complete delivered alerts/email plus one manual and two actual scheduled maintenance cycles.

Use the maintenance runner with APP_DEPLOYMENT_ENV and APP_EXPECTED_RELEASE_SHA bound to the intended environment and full revision. Direct administrator calls additionally require x-applypack-expected-environment and x-applypack-expected-release-sha request headers alongside the existing bearer credential. The route rejects a mismatch before maintenance writes and the runner verifies the same response identity. Historical bearer-only curl examples and hourly maintenance instructions are superseded.

The owner performs human document/device/accessibility acceptance and the final go-live decision. Invite one genuine paying customer only after acceptance; deliver under the ordinary policy and review that delivery before expanding invitations. An Apply Pack remains optional.

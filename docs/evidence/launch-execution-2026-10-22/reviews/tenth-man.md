# Independent local tenth-man challenge

Review observation: 2026-10-23T04:00:42Z. Reviewer: independent Codex `tenth_man` agent. Canonical root and origin were verified as `C:\Users\mskir\Desktop\Apply_Pack\applypack-production-v2` and `https://github.com/duotapmobile/ApplyPack.git`. Branch: `codex/manual-launch-hardening-2026-10-02`; baseline HEAD: `a3de4a447d499fb7d416e1a1d167e281372903b2`. The working tree is dirty and includes preserved user-owned files; HEAD does not identify the reviewed implementation bytes.

Verdict: **NOT READY**. This is a source challenge of local implementation, not a test run, human release approval, provider receipt, supervisor approval, or restricted-canary eligibility determination. Two concrete P1 defects were identified and sent to the implementing team. Their closure requires source re-review and regression evidence; neither is accepted as a limitation.

## Method and boundaries

Read the supplied revised plan, repository instructions and governing amendments 16, 14 and 12. Independently traced shared session creation, both checkout routes, mode and resource authorization, fresh-admin control routes, migration 085, verified webhook dispatch, maintenance and the inherited provisional checkout and monitoring paths. Compared the old worker at baseline HEAD with the current implementation to challenge deployment overlap. Reviewed production target/manifest/hash/ledger/recovery guards, CI, rollback source checks, readiness reporting and the three other local reports. No code was edited, no provider was contacted, and no database reset or heavy test ran for this review. Report files are the only writes by this reviewer.

Roles Anywhere tooling is being implemented concurrently by another agent. It is work in progress, not reviewed or reported as complete here. These source hashes are observation-specific; later changes require delta review.

## Findings

### TM-01 — P1 — legacy provisional reopen permits old-instance Session creation after a database lock

Status at observation: **OPEN; fix requested**. Owner: Engineering implementation; human owner unassigned.

Migration 085 revokes service execution of the old invited-search and material begin functions, but leaves `ap_reopen_provisional_search_checkout(uuid)` executable by `service_role`. Migration 030 defines this function at lines 561–581 and grants it through the service-function loop beginning at line 2467. No subsequent migration removes that permission in the observed snapshot.

The baseline worker's `handleProvisionalCheckout` calls that RPC for a `NONE` checkout with a `CREATING`/`REQUIRED` command, then calls Stripe Session creation directly. The reopen RPC checks quote/allocation state but not `ap_checkout_mode_configuration`, current release or scoped authorization. An old instance with stale purchasing flags can therefore restart a preexisting provisional command after migration 085 and a new database `LOCKED` state. Updating only the new worker does not close the old instance's executable path. This contradicts the plan's old/new-instance requirement and the earlier local security report's broader claim that old entry points cannot bypass the mode lock.

Required correction: revoke service execution of this legacy reopen function in 085, since the new worker no longer calls it, or enforce an equivalently strict database lock without reviving general creation. Preserve provider inspection, expiration, valid-payment and refund functions. Regression proof must assert the service grant is absent and model the old worker call after lock. Already-running provider calls still require the plan's instance drain/expiration/reconciliation evidence; a grant change is not proof that all deployed instances are quiescent.

### TM-02 — P1 — provider-paid/application-unsettled attempts disappear from maintenance

Status at observation: **OPEN; fix requested**. Owner: Engineering implementation; human owner unassigned.

`ap_reconcile_checkout_initiation` sets an initiation to terminal `PAID` solely because a retrieved Stripe Session says `payment_status='paid'`, without checking whether the verified webhook has settled `ap_payment_attempts` or created the fulfillment/refund obligation. `reconcileCheckoutInitiations` selects only `INITIATED`, `OPEN` and `EXPIRATION_REQUIRED`, then counts the observation as processed. Later sweeps omit that `PAID` row. The application payment can remain `UNPAID` if its webhook has not arrived or cannot be replayed.

No separate manual-product Session reconciliation path was found. The other maintenance Stripe reconciliation is for retired board subscriptions. The operations commerce snapshot counts received/pending/failed webhook rows, so a missing webhook produces no entry to alert on. In this boundary a customer may be charged while application order/refund processing never starts and maintenance can return success. Mode transition checks also ignore the now-terminal initiation.

Required correction: persist the provider-paid/application-unsettled discrepancy as an actionable pending state or equivalent durable alert/query. Keep it unresolved across repeated maintenance sweeps until the verified payment path records the obligation; detect already-terminal mismatches too. Do not turn read-only Session observation into unverified fulfillment. Add tests for paid Session with no webhook, repeated sweep and readiness/alert failure, then verified-webhook settlement resolving exactly once. Preserve already-paid monotonicity and late-payment/refund accounting.

## Other observations

- Exact six-mode environment validation, shared authorization, immutable resource hashes, one authorization/attempt, one Session identity and service-only tables are present. These controls do not negate the two boundary defects above.
- Missing-provider absence reconciliation requires an elapsed deadline plus grace period and exhausted bounded provider listing with request IDs. The earlier permanent-lock defect has a source correction; its final test receipt belongs to the serial test runner.
- Production tooling rejects an empty/unrecognized target registry, binds the approved manifest and migration hashes, validates the predecessor ledger and CA/credential target, and requires encrypted backup/isolated-restore receipts. An approved reference string is not proof of protected object/key/off-machine recovery. No such provider or human proof is supplied by this review.
- Clean CI is configured to identify the tested checkout and reject skipped/failed/flaky required receipts. The explicit rollback target remains a real prerequisite. Source-pattern compatibility checks alone do not demonstrate a deployed rollback application functioning against schema 085. A reviewed forward-recovery-only strategy is required if no distinct tested compatible candidate exists.
- The readiness reporter labels its anonymous and single-instance limitations. Its successful output must not be relabeled as full unauthorized-customer, all-instance, provider, accessibility or ship proof.
- The execution register still shows several implemented areas as NOT STARTED/RUNNING. It is provisional; update it from final receipts and unresolved findings before presenting a completion result.

## Evidence still absent from this review

No final committed candidate or clean CI URL; no hosted 085 ledger/backup/restore/migration proof; no approved AWS workload identity/worker image scan or deployed isolation evidence; no provider-backed rehearsal/canary journeys; no protected private-object/key/off-machine recovery; no human document acceptance; no keyboard/screen-reader/physical-iPhone acceptance; no real production charges/refunds; no named release/operations responders; no public activation. The user explicitly deferred human assignments while authorizing continued local work. These remain separate gates, not accepted limitations or permission to mutate providers.

## Reviewed source snapshot

| File | SHA-256 |
| --- | --- |
| `supabase/migrations/202610220085_staging_rehearsal_checkout_attempts.sql` | `7b679972a831675a0e94099cb65c645ca20ba2eef8a544a676be0e634d433aa2` |
| `src/lib/commerce/checkout-initiation.ts` | `d2f7a68acac3940a1993f4c7badd9b565ed80b61619332485b790c90815f25e6` |
| `src/lib/commerce/checkout-authorization.ts` | `5730c50fd1a38b1c6786034931504e35659b60c23735c6efb8f92fae67e53975` |
| `src/lib/stripe/mode.ts` | `969afdbe10206e4804ad7db50b74bd2be6d494d664e9bf0fac6ebd69da457a94` |
| `src/lib/commerce/workers.ts` | `d5dd97952c700f94445cadc06f214cf514debe2f6ccf70b4b288c8cf0c1c48d2` |
| `src/app/api/cron/maintenance/route.ts` | `10a3dbd5d894faef8a389f15d444251a089e133a4b315222c509c3731a26ffa9` |
| `src/app/api/stripe/webhook/route.ts` | `f0cd6c4c0b54141da23725f55a805924d389e93e79fe6798885d029f7980b514` |
| `src/lib/operations/summary.ts` | `3d23b29f0b8abfda422b5b8a04bf8e22272821fc776808b18a2f9e325844ffb9` |
| `scripts/apply-production-forward-migrations.ps1` | `5afcf0120f4e2d17241a6b7d3ff128b386d1c30989f01bea9f26098dfdce675d` |
| `scripts/lib/ProductionDatabaseGuard.ps1` | `65da9316f995b77945504e03b14a7c3825652d0e190b84b2a0de57f7e6c8b6b8` |
| `.railway/launch-contract.ts` | `913594a277409c52e5dfb220773f030526f644ae4aa7bb2482e8948d5f56cd05` |
| `.github/workflows/ci.yml` | `dbaef1f42cc6c41a7f8cb8bec23ec15a9048d77fc2921ad1eb983a2fd914a490` |
| `scripts/report-staging-readiness.mjs` | `0f5ea2b659c36025165d461cde02e9627cee8752882c6485d39cd4534a089860` |
| `scripts/run-supabase-rollback-test.mjs` | `222044bc253ff1c0877e3fcaef64ac53a89823fdc1761d67da78959018c1b41f` |

## Corrective source delta — October 23, after 04:04Z

The initial findings above are retained as the review record. Re-inspection accepted the following source corrections; final regression execution remains pending and the release verdict remains **NOT READY**.

- **TM-01: code correction accepted, verification pending.** Migration 085 now revokes `service_role` execution of `ap_reopen_provisional_search_checkout(uuid)`. The SQL regression asserts the service role cannot execute it. The new worker continues to inspect/expire/reconcile historical attempts without restarting provider creation.
- **TM-02: code correction accepted, verification pending.** A service-only `ap_checkout_initiations_requiring_reconciliation` RPC selects active attempts and terminal `PAID` attempts whose application payment is not both settled and verified. Runtime uses that RPC and returns unresolved until verification exists, including when payment wins an attempted expiration. Repeated sweeps retain the discrepancy, and maintenance already treats unresolved attempts as a failed queue. `ap_set_checkout_mode` now applies the same paid/unsettled predicate, so a transition cannot declare reconciliation complete prematurely. The signed webhook remains the fulfillment authority. Added test source covers repeated sweeps, missing verification timestamp, eventual settlement and expiration/payment race; SQL test source checks the transition refusal and pending query.
- The database implementer separately reported an inherited Apply Pack font predicate still requiring Arial after the approved Liberation Sans migration. That correction and real one/two-pack SQL fixtures are in progress and were not certified by this review. Incorporate their final results into product review; a source-only positive description of the inherited transaction is insufficient.
- All 22 user-owned pre-existing files were rehashed at this follow-up and matched `preexisting-work.json` exactly.

Re-reviewed delta identities:

| File | SHA-256 |
| --- | --- |
| `supabase/migrations/202610220085_staging_rehearsal_checkout_attempts.sql` | `78d71f743e278bebd0ece3273b222bd5b340dec2b8c6f26d8cd885014e8ad1c8` |
| `src/lib/commerce/checkout-initiation.ts` | `7223b3f42c83cb37afd20b338cb8c1d42fb25fd095522b62119f6c5748607095` |
| `tests/integration/durable-checkout.integration.test.ts` | `0424bb337e486f2fef5f8c9518743c63625a3aad86e41aaab0c7367854d3c190` |

This delta does not turn earlier test receipts into evidence for later code. Attach new receipt hashes, tested source identities and results before closing either finding. Changes after these hashes require another bounded review.

## Roles Anywhere source delta — 2026-10-23T04:17:51Z

Scope: independently reviewed the new credential provider, KMS/S3/Lambda integration, remote KMS compatibility boundary, helper installer/container packaging, disabled trust/profile/role template, local change-set generator, certificate-expiry utility, tests and runbook. No AWS operation, certificate issuance, secret entry, image build or heavy test was performed by this reviewer. No new concrete P0/P1 remains identified in this bounded source scope after the corrections below; this is not provider approval and overall status remains **NOT READY**.

Observed controls:

- Hosted KMS, S3 and Lambda clients use an explicit provider. The provider rejects alternate static/default-chain credentials and environment endpoint/TLS overrides, then verifies the exact account/environment caller role with regional STS using explicit credentials. No static-key fallback is supplied on helper failure.
- A shared cache coalesces concurrent refreshes, refreshes five minutes before temporary credential expiry and discards the cached value if renewal fails. Helper output must contain temporary credentials with at most one hour remaining. This bounds intended session lifetime; it does not prove provider revocation or immediate invalidation of already-issued credentials.
- Leaf/CA fingerprints, environment subject, issuer/signature, leaf private-key match, at-most-30-day certificate lifetime and remaining validity are checked before renewal. Temporary decoded buffers are cleared. Sealed source remains in process memory as the runbook explicitly states.
- Helper executable and ancestor directories must be root-owned, not writable by group/other and not symlinks. Runtime requires non-root Linux x86-64, a pinned helper hash and actual tmpfs at `/dev/shm`. Direct helper arguments avoid a shell; private leaf files use a private directory and mode 0600, are removed on success/failure, and provider errors are sanitized. Abrupt process/container loss still requires actual cleanup evidence; the runbook does not claim memory erasure or instant cleanup after a crash.
- The prepared template defaults trust and profile to disabled, isolates the environment caller role from Lambda execution, and restricts trust to the exact source anchor/account and certificate subject. The generator produces a boundary for one exact worker version, `ephemeral/` object prefix and exact KMS key/application/deployment/key-version context. The offline CA private key is not an input to provisioning/runtime artifacts. Separate environment CA custody and actual policy identities remain operational proofs.
- The launcher image pins a Node base digest, installs a source-hashed helper as root, then selects UID/GID 1000 for runtime. Its copy allowlist excludes environment files, docs, tests and customer evidence. Source inspection does not establish that the final web image builds, starts, scans cleanly or has correct provider configuration.

Review interventions and disposition:

1. **Shared-file endpoint override: corrected in source.** Explicit credentials alone did not prevent the installed Smithy SDK from loading `endpoint_url` from shared config. Inspection of the installed SDK's endpoint resolver confirmed its explicit-endpoint precedence. The KMS/S3/Lambda clients now supply fixed regional HTTPS endpoints, matching the existing explicit STS endpoint. Add/retain regression evidence for the intended endpoint behavior.
2. **Extra PEM blocks: corrected in source.** X509/key parsing and first-object DER pins alone could accept trailing PEM objects, including an accidentally copied private CA key. Runtime now requires exactly one certificate block for each certificate field and exactly one supported private-key block for the leaf key. New negative test source rejects concatenated objects, trailing text and mismatched endings. It does not prove that an operator has kept CA material offline.
3. **Direct STS dependency: implementation pending at observation.** The helper module imports `@aws-sdk/client-sts`; root is adding it as a direct pinned dependency after the running test process. Do not rely on an incidental transitive installation or mark the build graph complete before install/build/prune verification.
4. **KMS health identity freshness: recommended hardening pending at observation.** The five-minute KMS health cache key omits RA role/profile/trust/certificate fingerprints. A valid-looking identity rotation can reuse an earlier green probe until cache expiry, although real operations still verify credentials and fail closed. Include those nonsecret identity fields or explicitly invalidate the probe after identity changes; record the bounded freshness in provider receipts.
5. **Staging remote compatibility is not a purchase bypass.** `evaluateLaunchInfrastructure` requires `APP_KMS_PROVIDER === 'aws'` as well as successful encryption health, and shared checkout authorization requires that infrastructure result. The retained legacy staging remote adapter cannot authorize current rehearsal/canary/public purchasing. Production rejects the remote adapter directly.

Remaining proof: final local dependency/build/test/container receipts; actual public CA/leaf validation and helper execution using approved credentials; provider account/trust/profile/role/policy verification; KMS round trip and wrong-context denial; exact-version/cross-environment/prefix denials; credential refresh over real expiry; actual revocation behavior and measured remaining session lifetime; cleanup after process loss; delivered certificate expiry alerts; named issuance/rotation/revocation/recovery responders. The runbook's UNASSIGNED roles and `providerVerified=false` labels are appropriate. No provider mutation or human acceptance is implied.

| Reviewed file | SHA-256 |
| --- | --- |
| `scripts/lib/aws-roles-anywhere.mjs` | `399cf4a951e9627b0fe7fb8544ef0fa50846649b4c937a35dcc9fcca7774b0e5` |
| `src/lib/security/aws-workload-credentials.ts` | `34b862b9e332b111848deadfae33f6cd2438e6d81473d2e2850a90166468072b` |
| `src/lib/security/aws-kms.ts` | `721706dd01a5cc4ef43bcb04ef592effc3ee0e91371ad1ac3ec9fe3225d94fd6` |
| `src/lib/security/remote-kms.ts` | `a46e3344af8155407be0749949d26896b62a47670b73e6fe42323e85a8804171` |
| `src/lib/security/kms-health.ts` | `0ed23bbf804aa2ba4641070c9fdc2bb6f581341386e909fecd70779b77a845df` |
| `src/lib/files/aws-document-worker.ts` | `a2dc622a1003db04d8612f971453a89c0a8128bf12e3368f61968b3633673d2b` |
| `src/lib/operations/launch-readiness.ts` | `5b11ca9eba8bddd85146c3f24eccb0743f7f725872162e2e1020d7453178275e` |
| `scripts/prepare-aws-roles-anywhere.mjs` | `73ac8ad86c5f152e5d731224446621301880945323885f679bdd6e648951b582` |
| `scripts/install-aws-signing-helper.mjs` | `720703c9c5b9f17e277c9c9bdc50bda8a4b2bc33bba81154c7fd0c2aeb2154fc` |
| `scripts/check-launch-container.mjs` | `fefc4b75d3d4e0d2ee9a21325f0c395c0d20e4d285e1a463fb54882c6bcebca8` |
| `scripts/check-aws-roles-anywhere-expiry.mjs` | `783bea05e618d933e259417d3c4fd6f3edc71f70efe818c86131e8fa8132c656` |
| `scripts/test-aws-roles-anywhere.mjs` | `a628b7678ab106ea356b0b1e3ab55300db29e50d58b7d0f84dc70752cac57bc5` |
| `infra/aws/roles-anywhere/template.json` | `8005b55ba239fe4808123cc77edf73d409d5ecb84e7a45ddc2ff936bdebdba98` |
| `Dockerfile.launch` | `55c243c7878e67217575fff511ff7f6114933973ba42a9d00a0b1180ce111ca8` |
| `Dockerfile.launch.dockerignore` | `37436bd88adb47e5596b1e0b69d7e48ce3ca7245f40df14fba504da89676cba2` |
| `docs/runbooks/AWS_ROLES_ANYWHERE_CALLER.md` | `435678f014f80187c86973ec78d4302e6db0d84c2ea648555ddf253a7f9a53cb` |

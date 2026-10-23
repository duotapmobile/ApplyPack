# Independent local security and payments code review

Current authoritative snapshot: **2026-10-23T06:01:38.4348393Z**. This replaces the earlier provisional snapshots and their pending-local-test wording. Reviewer: Codex operations-tooling agent, reviewing runtime/SQL and final AWS client wiring authored by other agents. Baseline HEAD `a3de4a447d499fb7d416e1a1d167e281372903b2`, branch `codex/manual-launch-hardening-2026-10-02`; reviewed working-tree changes remain uncommitted.

**Disposition: SEC-01–06 are remediated in the reviewed source and backed by inspected local regression receipts. No unresolved P0/P1 was identified in this bounded review. Hosted acceptance, human security approval and launch eligibility remain unproven.** An optional capacity-member guard hardening observation is recorded below.

This report is not one of the four hosted acceptance reports, either required supervisor review, human signoff, or permission for canary/public activation. It does not independently assess operational scripts or the Roles Anywhere bootstrap authored by this reviewer. The final root-authored client wiring and runtime identity checks were assessed separately from that bootstrap. No provider credentials or hosted mutations were used.

## Scope and method

Read both purchase routes, shared durable authorization/session code, Stripe mode/price validation, verified webhook handling, admin mode/rehearsal/canary controls, fresh TOTP, frozen migration 085 and inherited payment/expiry functions. Traced crash-before-create, lost response, webhook-before-response, duplicate binding, revoke/create, authorization expiry, old/new instance overlap, paid/expired ordering, locked maintenance and late refunds. The final pass also reviewed explicit KMS/S3/Lambda client credentials/endpoints, account/environment targets, readiness wrapper and hosted fallback denial.

## Findings and current dispositions

| Finding | Reviewed correction | Current disposition |
| --- | --- | --- |
| SEC-01 / P1: crash before provider creation left an attempt unresolved forever | Absence closure requires full provider listing exhaustion over the persisted creation window, request IDs and audited SHA-256 evidence, deadline plus five minutes, an unbound attempt and unpaid/unverified payment. Partial/capped/error searches remain unresolved. Late paid binding/accounting is retained. | Source reviewed; local integration and real SQL regressions inspected. Hosted Stripe enumeration/ordering remains required. |
| SEC-02 / P1: historical `ap_reopen_provisional_search_checkout` service grant bypassed the new mode lock for old workers | 085 revokes the old reopen grant as well as historical begin entrypoints; real SQL checks the absence of those grants. | Source reviewed; five-predecessor SQL matrix inspected. Actual deployed-instance overlap remains required. |
| SEC-03 / P1: provider PAID observation dropped an unverified payment from reconciliation | Service-only selector and mode-unlock guard include PAID attempts until the linked payment is verified and settled. Runtime counts these unresolved and never fulfills solely from provider observation. | Source reviewed; local integration/SQL regressions inspected. Actual signed webhook delay/replay remains required. |
| SEC-04 / P1: hosted staging could bypass Roles Anywhere with legacy remote KMS | Both staging and production require AWS. Legacy remote requires explicit provider selection, test/development Node context and no deployment marker. Missing/unknown contexts reject before a request. | Source reviewed; focused 47/47 local regression receipt inspected, including zero-fetch negatives. Real hosted caller identity remains required. |

The final worker hardening uses one resolved environment for configuration/account/provider and requires target account 838445019912, a same-account version ARN and exact environment bucket. Clients use explicit provider and regional endpoints; no hosted default credential-chain fallback was found. The local readiness check validates the sealed leaf binding before reporting configuration present; actual AWS identity is separately checked on refresh.

The final webhook delta preserves signature/mode verification before binding, binds before fulfillment for webhook-before-response, and observes only after normal processing. Historical reconciliation can accept archived one-time prices/products while retaining exact amount/currency/product validation; current checkout still requires active prices. These checks do not authorize current creation at historical 800/2000 amounts.

## Inspected local receipts

| Receipt | Result | SHA-256 |
| --- | --- | --- |
| `../integration-results-final.json` | 15 passed, 0 failed, 0 pending | `d651b5ca3a67fd0069ca0d0fded330299ba5c2c6adc15f5875402c43430532bd` |
| `../integration-final.log` | Corresponding runtime integration output | `30f9c711ab44370f8e23796dd556e9a88cf740e9d811e583cafe99ca288346f2` |
| `../aws-hosted-boundary-results.json` | 47 passed across 4 suites, 0 failed, 0 pending | `678c1027dbbad20821e73cec1d5a963dd2c43f06a2ae295428521a438ae64f7f` |

The integration tests use mocked providers. The SQL matrix uses disposable local PostgreSQL. These receipts are local validation, not real Stripe/AWS behavior or a clean exact-commit CI/deployment record. Broad serial unit/browser/render/image results are tracked by the parent task and are not asserted by this report.

## AWS cleanup correction and preserved intermediate evidence

SEC-05 / P1 was the absence of durable deletion after a process crash or swallowed immediate S3-delete failure. The current source registers all four exact temporary keys atomically before any upload, in a separate service-only AWS ledger that historical Supabase cleanup workers cannot acknowledge. Its operation identity, environment bucket, four-key scope and ten-minute deletion grace are immutable; completed receipts remain. The worker checks the original sixty-second submission window after credential resolution and again before Lambda submission. Immediate deletion retains the obligation for the delayed second deletion. The configured Lambda timeout is thirty seconds.

Maintenance deletes at most twenty due keys, four at a time with bounded SDK requests, preserves failed/exhausted obligations and checks the overdue queue after its bounded batch. Thirty minutes past deletion eligibility, exhausted retries, query errors or missing AWS counts hold readiness closed. Parser and renderer share one five-minute in-memory probe cache keyed by worker and credential identity, including rotation-sensitive material; database approval/revocation remains uncached. These corrections remediate the reviewed local source defect. They do not establish actual S3 deletion, crash recovery, versioning state or sufficient hosted drain capacity.

Inspected final SQL matrix: all five predecessors 080–084 passed eighteen fixtures each (90 executions), including six independent AWS registration connections producing exactly four keys and one immutable lease. That historical AWS-only snapshot used SQL `e604c3b38f230f358b1f7ff66ced4bb07e573066c4812faee87c1eeacf5849b8`; the final readiness correction below supersedes it; the previous payment/material body reconstructs exactly when the narrow AWS block is removed. The old `2c5a4fb8...` SQL and 85-execution matrix are historical, superseded overall snapshots.

The 180-test focused run retained one failure in the temporary-bucket policy validator; all cleanup/cache/overdue behavior cases passed. The corrected validator and maintenance negative replay then passed all 24 tests with zero skipped/pending. The failed original receipt is retained rather than relabeled as a clean run. The validator itself is outside this runtime/SQL review's source scope.

| Historical intermediate receipt | Result | SHA-256 |
| --- | --- | --- |
| `../database/upgrade-matrix-085-aws-final.json` | 90 SQL fixture executions and checkout/AWS concurrency passed locally | `4cfb83fca867c8474fa53f146a425decf477ac920d2ea64ab3d364a416f3331c` |
| `../database/upgrade-matrix-085-aws-final.stdout.log` | Corresponding complete matrix output | `323ba6649f4e3d4a868644044ebe1f5ad44d3b9da667690b90b904339511a24a` |
| `../aws-cleanup-cache-targeted-results.json` | 179 passed, 1 failed, 0 pending; original failure preserved | `cff891fa10aa03c0a5f2308f2a79a132d629a755934f771ede13cb992ac501f1` |
| `../aws-cleanup-negative-replay-results.json` | 24 passed, 0 failed/pending after correction | `2c0b289e1ba84db40e377d34edc197b77de34939a09da995c6d900c2f813bc07` |

Hosted acceptance still must prove deletion after interruption, no remaining object versions, actual process/replica traffic and queue drain within the maintenance deadline. One process's cached health probes add up to 48 rows per hour against a nominal scheduled drain of 80 rows per hour, before real document traffic. Local queue guards expose and hold on backlog; they do not prove adequate deployed capacity. See `../../../runbooks/LAUNCH_MAINTENANCE_CLEANUP.md` for the operational thresholds.
## Final schema readiness correction

SEC-06 / PRODUCT-02 (P1): the prior readiness function reported schema 085 but omitted 085 from its required-migration array, so the application correctly rejected that database response. Independently reviewed the narrow correction: migration 085 anchors the prior eight-ID list, appends 085 independently of closing whitespace, and verifies the returned exact nine-element JSONB array inside its transaction. A failed rewrite aborts. The real checkout fixture and every predecessor upgrade assert that exact array; the upgrade runner also requires `ready: true`.

The regression failed against the old e604 database before the correction. The replacement c995 clean replay, all eighteen fixtures, all five upgrade paths (90 fixture executions), checkout/AWS concurrency, generated-type check and actual final readiness query passed. Actual final state is LOCKED, exact nine migration IDs including 085, no invalid indexes or active queries, empty attempt/cleanup ledgers, and no old reopen execution grant. This locally remediates the composed readiness defect; it supplies no hosted or human approval.

Current SQL SHA-256: `c99561da94f676f3d8f7fdc32d731fae54210f302d33bc5ea5811b58d7b5e935`. Checkout, payment, Materials and AWS cleanup behavior are unchanged by this narrow response correction. Earlier e604 and 2c5a matrix receipts are preserved historical evidence, not current whole-source proof.

| Current final receipt | Result | SHA-256 |
| --- | --- | --- |
| `../database/upgrade-matrix-085-readiness-final.json` | Five predecessors, 90 fixture executions, both concurrency proofs passed | `ca59c4c67b4d02fdeccd93ae4dbdadd0e29b8154db34f8eb241e5a1a45edd43d` |
| `../database/upgrade-matrix-085-readiness-final.stdout.log` | Complete replacement matrix output | `323ba6649f4e3d4a868644044ebe1f5ad44d3b9da667690b90b904339511a24a` |
| `../database/database-final-state-085-readiness.json` | Exact nine IDs, ready true, LOCKED, generated types and clean local state verified | `2e6f97391660063abc26d992d9ae9572e8b7e93342ca0d73894fadcc35302774` |
## Remaining limits

Optional defense in depth: the capacity-member COMPLETED trigger checks for an immutable release for the material line rather than repeating the exact-revision check. Independently traced the sole completion writer in migration 031: it resolves the active revision at line 1752, filters artifacts to it, records that revision in the release bundle at line 1813 and updates only matching member revisions at lines 1819–1820. The application calls that service-only RPC through its admin route; no direct application member-table writer or browser grant was found. No reachable wrong-revision path was established. This is redundant hardening, not a release-blocking defect or a new human risk-acceptance gate; frozen 085 remains unchanged.

Require actual signed-webhook/retry/expiry/refund proof, admin MFA negatives/positives, customer isolation/download tests, KMS context and cross-environment denial, leaf refresh/revocation, all deployed-instance mode checks and negative checkout probes. Human approval and required hosted acceptance remain pending. Local source/fixture success cannot establish production or restricted-canary eligibility.

## Review history

The initial 23:49 review found SEC-01. Subsequent independent tenth-man review found the overlooked historical reopen grant (SEC-02); root found the provider-paid sweep gap (SEC-03); this reviewer found SEC-04 during final wiring review. The real MATERIALS fixture exposed inherited composed-path defects missed by the initial bounded source review. All current dispositions above refer to the final hashes below; no earlier hash table or obsolete pending-local-proof statement remains authoritative.

## Current reviewed source SHA-256

| File | SHA-256 |
| --- | --- |
| supabase/migrations/202609070031_chunk5_materials_delivery.sql | a8bd0b1cf664806b1d0fadfecef24e0ddc2e81aacde77145e0e0666fab77f2c8 |
| supabase/migrations/202610220085_staging_rehearsal_checkout_attempts.sql | c99561da94f676f3d8f7fdc32d731fae54210f302d33bc5ea5811b58d7b5e935 |
| src/lib/commerce/checkout-initiation.ts | 7223b3f42c83cb37afd20b338cb8c1d42fb25fd095522b62119f6c5748607095 |
| src/lib/commerce/checkout-authorization.ts | 5730c50fd1a38b1c6786034931504e35659b60c23735c6efb8f92fae67e53975 |
| src/lib/stripe/mode.ts | 969afdbe10206e4804ad7db50b74bd2be6d494d664e9bf0fac6ebd69da457a94 |
| src/lib/stripe/server.ts | a819b18cbc1e9577c2871e3d64588fa79cc5f3e81ac3503089023f269a7fe1cf |
| src/app/api/checkout/search/route.ts | e121430412f9ffdbaa492e030fe489ff86db6e09b1c39ac58ab6d3f56c9c029b |
| src/app/api/checkout/apply-packs/route.ts | 785a77dfe57d5e5770f491d36c13023ae8f04e79fe843723bbb284becf35de97 |
| src/app/api/stripe/webhook/route.ts | f0cd6c4c0b54141da23725f55a805924d389e93e79fe6798885d029f7980b514 |
| src/app/api/admin/manual-launch/checkout-mode/route.ts | 4723a884a71c633c18bebf0fb067493828bef9d5655305436d902f077bcdccb3 |
| src/app/api/admin/manual-launch/rehearsal-authorizations/route.ts | 5ddbb40fa4bd841d3a30bece13f7c8c595c4b032ea383aa80ea44b472ac1c993 |
| src/app/api/admin/manual-launch/canary-authorizations/route.ts | 130b18a3e78ab43b3cde32620c8383da860ee3e7e279ef8ebe3d92f9be9f9d1c |
| src/lib/auth/require-admin.ts | d0c76f678db709de0ccf6bc745b684f93750c738baa9a0e0c3b7b6750fb17ff1 |
| src/lib/security/aws-kms.ts | 721706dd01a5cc4ef43bcb04ef592effc3ee0e91371ad1ac3ec9fe3225d94fd6 |
| src/lib/security/remote-kms.ts | 9be686e704c65e18517d878420a3ad6ea6c90931b11577467f777a8ab2f9f996 |
| src/lib/security/aws-workload-credentials.ts | 34b862b9e332b111848deadfae33f6cd2438e6d81473d2e2850a90166468072b |
| src/lib/security/kms-health.ts | 013ab5c59a479bebadee799318aa58dc3822fce588e11f002c437060efa21dc5 |
| src/lib/files/aws-document-worker.ts | ef63c4cd7fd0e6e73604169fdb57b19b1b49e3005f500bd481b0bf6bd6aa565a |
| tests/integration/durable-checkout.integration.test.ts | 0424bb337e486f2fef5f8c9518743c63625a3aad86e41aaab0c7367854d3c190 |
| tests/integration/rehearsal-checkout-attempts.sql | b6e655a29da63519d17fe68d4cc2c3ebe1ac1a01a00e3f3d3ffd02aa89420feb |
| tests/integration/rehearsal-material-checkout.sql | 3b36f24e130ab6505b1dad84af8116ccfef663c69170781b90318b72da3fdf43 |
| tests/unit/remote-kms.test.ts | 13af05a8d796781a57fda8dffee67632fe5f77476576e482986df7a91bf202a2 |
| tests/unit/aws-document-worker-environment.test.ts | 37fad73366a1426ea3829501c0d58d57c3f5d690c519ec90cb2603cd2e775a11 |
| tests/unit/stripe-historical-price.test.ts | d97f4af4cbee62a586f4fdbff3f27e680a34983bfbef53c883d92a2d9738eb34 |
| src/lib/files/aws-temporary-cleanup.ts | e2742007c592c12b8b343dda8d2a20a461f5c87ea9d0d5d87376c42e2a7a8d46 |
| src/lib/files/isolated-extraction.ts | ff0aa1a779b18812f588a98083928bc4ff46292f3dad30c6195ff2bff04e3640 |
| src/lib/operations/launch-readiness.ts | 41e974cb87999b17658d88cd7a8fd977fd98f0432fe48bfd2ce932290b641c5f |
| src/lib/operations/summary.ts | 961e904e1a573622ce25938f8c626171c369a263041b0bbe2f1b29acd41f62bc |
| src/lib/operations/maintenance-observability.ts | aa357a8c7bb9bd7a35d562ed412f8bea4ab3b501d83d8da7b1fa19139336096e |
| src/app/api/cron/maintenance/route.ts | 8525b9d795db5ccb76bf8a1e8a64320074b2f6fb05bbdc9c24cf713555e5e7a6 |
| tests/integration/aws-temporary-cleanup.sql | dea2b6471eb0250a0c9c7c218ef754c9db02db71f5dcc0403543b9bc41339f00 |
Any affected source hash change requires delta review. Baseline HEAD alone does not identify these working-tree bytes.



## Packaging boundary recheck

At 2026-10-23T06:53:52.363Z, all 31 source hashes in this independent review still matched the current checkout. The subsequent image/helper packaging remediation does not change those reviewed runtime/SQL bytes. Image vulnerability clearance, source-build provenance and installer/bootstrap correctness require their separate independent packaging review and actual image receipts; this report does not self-review this agent's operational implementation or imply those gates passed.

# Independent local product and workflow code review

Current authoritative snapshot: **2026-10-23T06:01:38.5086013Z**. This replaces earlier provisional snapshots and their pending-local-test wording. Reviewer: Codex operations-tooling agent, reviewing runtime/SQL authored by other agents. Baseline HEAD `a3de4a447d499fb7d416e1a1d167e281372903b2`, branch `codex/manual-launch-hardening-2026-10-02`; reviewed working-tree changes remain uncommitted.

**Disposition: PRODUCT-01/02 and the related SEC-01–06 corrections are source-reviewed with inspected local regression receipts. No unresolved P0/P1 product-contract defect was identified in this bounded review. Hosted customer journeys, human document approval and required supervisor signoff remain pending.** An optional member-completion guard hardening observation appears below.

This report covers fixed prices, one/two-pack semantics, clocks, invitation and immutable history under amendments 16, 14, and 12 and the supplied revised launch plan. It is not a hosted acceptance report, human Product Owner approval, supervisor review, or restricted-canary eligibility. Operational tooling authored by this reviewer is excluded. No provider operation or test command was run for this review; source and other agents' local receipts were inspected.

## Contract assessment

| Contract | Current source/local evidence | Hosted evidence still required |
| --- | --- | --- |
| Fixed totals | Current domain/creation amounts are 1899/799 cents; one/two-pack fixture proves 799/1598. One-time card checkout disables automatic tax. Historical800/2000 reconciliation remains separate and current creation still requires active prices. | Actual prices/products, wrong mode/price/quantity/tax negatives and 1899/799/1598 journeys. |
| Invitation search | Authorized wrapper retains exact draft/snapshot/assessment/invitation-secret checks, expiry/revocation, held capacity and consumption. Rehearsal does not remove these prerequisites. | Completed intake, feasibility, invitation, consent and locked negative probes. |
| One/two packs | Exact delivered-release ownership and sorted selected-job scope; distinct eligible jobs, reviewed employer rules, inputs and protected contact payload; one independent line/revision per job; whole-cart atomic reservation. Fixture rejects an invalid second line and wrong one/two-cart authorization. | Two complete resume/cover-letter pairs with independent line/deadline visibility and customer access. |
| Capacity | Shared global one-search/two-material rolling limit; retry reuses one reservation; six SQL connections prove shared attempt/payment/reservation. Spent capacity is not returned by supersession/refund. | Hosted concurrent capacity, legitimate rolling windows and refund-retention evidence. |
| Clocks | New search starts at verified provider payment; original material starts at later of selected inputs and verified payment; 24 hours unchanged. Processing time no longer extends deadlines. Existing stored history is not bulk rewritten. | Provider/database timestamps, delayed/replayed webhook, later-input, daylight-saving display and overdue/remedy handling. |
| History/remedies | Immutable attempt/provider/resource scope; consumed authorizations cannot create again; lock/revoke preserves paid obligations. Final fixture proves late two-pack payment produces two independent 799 refund obligations and rejects content/capacity/paid-clock mutation. | Historical downloads, correction/replacement/conflict cases, real refund/dispute outcomes and customer isolation. |

## PRODUCT-01 / P1 disposition

Real MATERIALS creation found six inherited composed-path blockers missed by the initial source review: the obsolete 800-only constraint alongside 799/800; current Arial predicates after 081 adopted Liberation Sans; anonymous immutable snapshot lookup by direct customer ID; generic immutable revision/member triggers rejecting legitimate initial reservation/payment lifecycle; and command transitions skipping COMPENSATING/APPLYING.

Independently reviewed frozen 085 fixes only the anchored obsolete constraint and current font predicates, resolves original snapshot ownership through the exact customer's DELIVERED service/order, allows one-time exact reservation and verified paid-clock initialization, and preserves member identity/spent capacity through permitted lifecycle changes. Quote invalidation skips already-invalidated rows. Current content, capacity binding and paid clocks remain immutable. The actual one/two-pack SQL fixture exercises 799/1598 creation, whole-cart rejection, replay, exact scope, late refunds, revoke/payment and mutation negatives.

**PRODUCT-01 is locally remediated and regression-backed at the hashes below.** Related security findings and dispositions are in `security-payments.md`; none of these local corrections constitutes provider or human acceptance.

## Inspected local receipts

| Receipt | Result | SHA-256 |
| --- | --- | --- |
| `../integration-results-final.json` | 15 passed, 0 failed, 0 pending; mocked-provider runtime cases | `d651b5ca3a67fd0069ca0d0fded330299ba5c2c6adc15f5875402c43430532bd` |
| `../aws-hosted-boundary-results.json` | 47 passed, 0 failed/pending; SEC-04 local hosted-fallback negatives | `678c1027dbbad20821e73cec1d5a963dd2c43f06a2ae295428521a438ae64f7f` |

The SQL matrix uses disposable local PostgreSQL. Test results do not prove real permitted jobs, truthful/visually acceptable documents, real employer requirements, on-time delivery, DNS/email, accessibility or protected recovery. Broad serial unit/browser/render/image outcomes remain separately tracked by the parent task; no clean exact-commit CI/deployment is certified here.

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
## Remaining limits and review history

Optional defense in depth: the material member COMPLETED trigger does not repeat the release caller's exact-revision check. Independently traced migration 031's sole completion writer through active revision selection, matching artifacts, the exact release bundle and the revision-filtered member update. Only the authorized admin route calls the service-only RPC; no direct application writer or browser grant was found. No reachable violating path was established. A redundant trigger check is optional hardening, not a new release blocker or human risk-acceptance gate; frozen 085 remains unchanged.

Hosted acceptance must verify two separately tracked document pairs and customer-visible deadlines rather than aggregate Stripe quantity alone. Require real inventory, human document approval, private customer access, notifications, paid-obligation processing during holds and the required supervisor reports. No hosted or human approval was supplied by this review.

Initial 23:49 and 00:20 provisional reviews were source-only. The later real MATERIALS fixture exposed the inherited blockers above; the current snapshot reviews their corrections and the final matrix/integration receipts. Earlier pending-local-proof wording and draft hashes are superseded entirely.

## Current reviewed source SHA-256

| File | SHA-256 |
| --- | --- |
| supabase/migrations/202609070031_chunk5_materials_delivery.sql | a8bd0b1cf664806b1d0fadfecef24e0ddc2e81aacde77145e0e0666fab77f2c8 |
| supabase/migrations/202610220085_staging_rehearsal_checkout_attempts.sql | c99561da94f676f3d8f7fdc32d731fae54210f302d33bc5ea5811b58d7b5e935 |
| src/lib/commerce/checkout-initiation.ts | 7223b3f42c83cb37afd20b338cb8c1d42fb25fd095522b62119f6c5748607095 |
| src/lib/commerce/checkout-authorization.ts | 5730c50fd1a38b1c6786034931504e35659b60c23735c6efb8f92fae67e53975 |
| src/lib/domain/applypack.ts | 0389b3fa4244c83f3891517a8dff84d2e13494c0124574dba5501bec75a0caf2 |
| src/lib/materials/contract.ts | 76f4f4b1738c7be224662e0e1ec851e54e14d20b622b53b03bf9a83358400984 |
| src/lib/commerce/fixed-total.ts | 5be8e70ea0ab9087f1171a802804ec694b6354cc618eb9fa50e27b0e9903472d |
| src/lib/stripe/server.ts | a819b18cbc1e9577c2871e3d64588fa79cc5f3e81ac3503089023f269a7fe1cf |
| src/app/api/checkout/search/route.ts | e121430412f9ffdbaa492e030fe489ff86db6e09b1c39ac58ab6d3f56c9c029b |
| src/app/api/checkout/apply-packs/route.ts | 785a77dfe57d5e5770f491d36c13023ae8f04e79fe843723bbb284becf35de97 |
| src/app/api/stripe/webhook/route.ts | f0cd6c4c0b54141da23725f55a805924d389e93e79fe6798885d029f7980b514 |
| tests/integration/durable-checkout.integration.test.ts | 0424bb337e486f2fef5f8c9518743c63625a3aad86e41aaab0c7367854d3c190 |
| tests/integration/rehearsal-checkout-attempts.sql | b6e655a29da63519d17fe68d4cc2c3ebe1ac1a01a00e3f3d3ffd02aa89420feb |
| tests/integration/rehearsal-material-checkout.sql | 3b36f24e130ab6505b1dad84af8116ccfef663c69170781b90318b72da3fdf43 |
| src/lib/files/aws-temporary-cleanup.ts | e2742007c592c12b8b343dda8d2a20a461f5c87ea9d0d5d87376c42e2a7a8d46 |
| src/lib/files/aws-document-worker.ts | ef63c4cd7fd0e6e73604169fdb57b19b1b49e3005f500bd481b0bf6bd6aa565a |
| src/lib/files/isolated-extraction.ts | ff0aa1a779b18812f588a98083928bc4ff46292f3dad30c6195ff2bff04e3640 |
| src/lib/security/kms-health.ts | 013ab5c59a479bebadee799318aa58dc3822fce588e11f002c437060efa21dc5 |
| src/lib/operations/launch-readiness.ts | 41e974cb87999b17658d88cd7a8fd977fd98f0432fe48bfd2ce932290b641c5f |
| src/lib/operations/summary.ts | 961e904e1a573622ce25938f8c626171c369a263041b0bbe2f1b29acd41f62bc |
| src/lib/operations/maintenance-observability.ts | aa357a8c7bb9bd7a35d562ed412f8bea4ab3b501d83d8da7b1fa19139336096e |
| src/app/api/cron/maintenance/route.ts | 8525b9d795db5ccb76bf8a1e8a64320074b2f6fb05bbdc9c24cf713555e5e7a6 |
| tests/integration/aws-temporary-cleanup.sql | dea2b6471eb0250a0c9c7c218ef754c9db02db71f5dcc0403543b9bc41339f00 |
Any affected source hash change requires delta review. Baseline HEAD alone does not identify these working-tree bytes.



## Packaging boundary recheck

At 2026-10-23T06:53:52.363Z, all 23 source hashes in this independent review still matched the current checkout. The subsequent image/helper packaging remediation does not change those reviewed runtime/SQL bytes. Image vulnerability clearance, source-build provenance and installer/bootstrap correctness require their separate independent packaging review and actual image receipts; this report does not self-review this agent's operational implementation or imply those gates passed.

# Independent Materials database delta review

Review date: October 23, 2026 (America/New_York). Reviewer: `runtime_checkout`, reviewing changes authored by `database_attempts`. The reviewer implemented the related TypeScript checkout path; this report independently reviews the final Materials SQL delta and its fixture, not the reviewer's own runtime changes. Baseline checkout remains `a3de4a447d499fb7d416e1a1d167e281372903b2`, with uncommitted changes.

## Reviewed identities

| File | SHA-256 |
| --- | --- |
| `supabase/migrations/202610220085_staging_rehearsal_checkout_attempts.sql` | `c99561da94f676f3d8f7fdc32d731fae54210f302d33bc5ea5811b58d7b5e935` |
| `tests/integration/rehearsal-material-checkout.sql` | `3b36f24e130ab6505b1dad84af8116ccfef663c69170781b90318b72da3fdf43` |
| `tests/integration/aws-temporary-cleanup.sql` | `dea2b6471eb0250a0c9c7c218ef754c9db02db71f5dcc0403543b9bc41339f00` |
| `tests/integration/rehearsal-checkout-attempts.sql` | `b6e655a29da63519d17fe68d4cc2c3ebe1ac1a01a00e3f3d3ffd02aa89420feb` |
| `scripts/run-supabase-rehearsal-upgrade-test.mjs` | `939404210b9e882410436c9e75367a10c8febc058939f6352de74406c496c238` |
| `src/lib/operations/launch-schema.ts` | `76fa919335b3b5f75faedd3890c5a0565001e33418ea86ea6a9c100ea34595e9` |

## Findings

No concrete P0/P1 was identified in the reviewed delta. This is a source review, not a replacement for the real PostgreSQL execution and predecessor-upgrade receipts.

- Anonymous immutable intake snapshots resolve through the exact customer-owned delivered service and delivered order. The lookup does not treat null snapshot ownership alone as authorization. The fixture rejects a different customer's release and verifies that browser roles cannot forge the service ownership join.
- The current 799-cent price repair drops only the exact verified obsolete duplicate 800-only constraint. It retains the intended current/historical constraint and historical rows. The fixture purchases one line for 799 cents and two lines for 1598 cents, verifies whole-cart rollback on one invalid line, and confirms one capacity reservation across replay.
- Current Materials begin/release gates use the approved Liberation Sans font. The forward rewrite is anchored and limited to those two current functions; it does not alter historical artifact/download font contracts.
- Revision content and identity remain immutable. Capacity can bind once to a matching member/customer allocation, and the paid clock can initialize once after the payment and allocation become paid/consumed. Original clocks derive from selection and verified payment time; later revisions retain the acceptance/payment/capacity rule. Negative fixture updates reject content changes, capacity removal, an unpaid clock, and subsequent paid-clock rewriting.
- Capacity-member identity remains immutable while guarded one-way state transitions permit paid consumption, delivery completion, and supersession. A spent member cannot become returned. The revised external-command transitions include the required intermediate compensation/application states.
- The fixture preserves payment after authorization revocation and handles an expired Session followed by a valid paid event with two exact line refunds. These are real SQL assertions over persisted records, not runtime mocks.

## Subsequent AWS cleanup SQL review

The reviewer separately read the dedicated cleanup table, trigger, registration RPC, grants and fixture added by the database agent. At the historical cleanup-delta source hash `e604c3b38f230f358b1f7ff66ced4bb07e573066c4812faee87c1eeacf5849b8`, removing only that inserted block reconstructed the previously reviewed SQL hash `2c5a4fb8ef0b777cb9db7772f93b4089878b123d050ceb35068a28b3cae7fb23`; the existing Materials and checkout definitions were unchanged. The later readiness-only correction is reviewed separately below.

The new ledger separates AWS deletion intents from the older Supabase Storage queue. Registration binds the canonical database environment to an exact account/environment bucket and four exact UUID-scoped temporary keys. An advisory lock and row locks preserve one complete four-row group and its original database timestamps across retries. Partial or malformed groups fail closed. The ten-minute deletion deadline and sixty-second submission deadline cannot be renewed. Completed rows remain as receipts, and completion of any key prevents resubmission. Browser roles have no access; the service role can read and update only progress fields, with immutable identity/timestamp and monotonic-progress checks. The fixture covers environment mismatch, immutable lease replay, completed replay, malformed groups and denied browser/direct insertion paths. No concrete P0/P1 was found in this SQL delta. This independent SQL review excludes the reviewer's own TypeScript cleanup additions.

## Subsequent schema-readiness correction

**Resolved, readiness contract mismatch:** the database agent's final read-only check found that the earlier `e604c3b38f230f358b1f7ff66ced4bb07e573066c4812faee87c1eeacf5849b8` migration reported schema 085 and `ready=true`, but its `requiredMigrations` array ended at 084. The runtime correctly rejected that incomplete list. The preserved `database/readiness-regression-before-fix.log` records the strengthened real SQL fixture failing with `rehearsal_required_migrations_contract_failed` and exit code 3; earlier green receipts did not cover this exact contract.

The reviewer independently read the corrected final migration block, fixture, upgrade-runner checks and runtime contract. The replacement now matches the complete prior eight-ID literal without assuming an immediately adjacent closing parenthesis. Missing anchors abort the migration, and an exact nine-ID JSONB postcondition rejects an incomplete replacement. Fixture and runner use null-safe `IS DISTINCT FROM` comparisons for the version and complete ordered list; the runner also requires `ready=true`. These checks agree with the runtime's required migration identities. No concrete regression was found in the correction. The final receipt records that replacing only this block reconstructs the prior `e604` hash, leaving checkout, Materials and AWS cleanup bytes unchanged; that scope proof is attributed to the database agent.

## Defense-in-depth observation

Optional redundant hardening: the capacity-member completion trigger requires a material release for the same line, but does not itself compare that release's `lineRevisionId` with the member revision. The existing `ap_commit_material_release_v2` function creates the immutable release for the exact current revision and updates only the matching revision's members. It is the only current completion writer, is service-only, and the application calls it through the protected admin route; browser roles cannot write member rows. No current violating caller or authorization bypass was found. Adding the same revision comparison to the trigger would strengthen redundant enforcement against a future trusted writer. The database author retained the frozen matrix unchanged on that basis. This is not a known release-blocking defect or a risk-acceptance waiver.

## Evidence boundaries

The earlier `database/upgrade-matrix-085-final.json` and stdout hash `80e98dfd7d09e7168b956e108a963a8915be539a323a360599c34d8764fc81cd` remain historical evidence for the pre-cleanup SQL hash `2c5a4fb8ef0b777cb9db7772f93b4089878b123d050ceb35068a28b3cae7fb23` and its 85 fixture executions. They are not the final cleanup-delta execution receipt.

The reviewer previously read `database/upgrade-matrix-085-aws-final.json` (SHA-256 `4cfb83fca867c8474fa53f146a425decf477ac920d2ea64ab3d364a416f3331c`) and verified its stdout file hash `323ba6649f4e3d4a868644044ebe1f5ad44d3b9da667690b90b904339511a24a`. Its 90 fixture executions, concurrency results and type checks remain historical evidence for the `e604` cleanup-delta source, before the readiness correction. They are not whole-current-source execution evidence.

The current `database/upgrade-matrix-085-readiness-final.json` has verified SHA-256 `ca59c4c67b4d02fdeccd93ae4dbdadd0e29b8154db34f8eb241e5a1a45edd43d`. The reviewer read this receipt and verified its migration, updated fixture, runner and final-state bindings. It records a clean replay with 18 fixtures and all five 080-through-084 predecessor paths passing 18 fixtures each (90 upgrade executions), the exact nine required migration IDs on every path, paid and prior Supabase cleanup history preserved, six independent checkout retry connections, concurrent revoke/bind, and six independent AWS cleanup registration connections preserving four keys and one immutable lease. Its new progress timestamps and current source hash identify the rerun even though deterministic stdout retains the same hash as the earlier run.

The reviewer also read and hash-verified `database/database-final-state-085-readiness.json` (SHA-256 `2e6f97391660063abc26d992d9ae9572e8b7e93342ca0d73894fadcc35302774`). After the runner restored the disposable local schema, this receipt records `ready=true`, the exact nine-ID list ending in 085, mode `LOCKED`, no test checkout/cleanup rows, no invalid indexes, and generated types matching that schema. Execution was performed by the database agent, not independently rerun by this reviewer. Historical legal/inventory/legacy data-preservation runners retain their explicitly limited prior-`e604` receipts; no whole-`c995` execution claim is made for those older runs. Browser and current full-unit validation remain outside this report.

This review did not mutate a hosted database. Hosted staging/provider purchase journeys, human document review, production payment/refund proof, recovery drills, signed independent supervisor reports, and public activation remain separate unfulfilled gates. This report does not mark the release READY or authorize deployment.

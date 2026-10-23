# Final local independent tenth-man review

## Current read-only challenge — 2026-10-23T05:44:29Z

**Verdict remains NOT READY; FTM-01 is locally closed for the bound correction below.** The durable cleanup implementation, negative behavior coverage and new real SQL upgrade/concurrency evidence now support closure of the original missing-intent defect. The initial probe-amplification and missing bucket-versioning guard findings also have inspected local corrections. No additional reachable P0/P1 was identified in this final bounded challenge. This does not close complete-candidate validation, hosted cleanup/capacity/drift acceptance, human approval or release gates. The reviewer made no source changes and ran no tests, database operations, image build/scan or provider calls during this resumed read-only pass.

Canonical path, origin, current branch and HEAD were rechecked and still match the first-pass identities. The tree remains dirty and uncommitted. The following later evidence supersedes the earlier pending status only within its stated scope:

- **SQL correction proof:** `../database/upgrade-matrix-085-aws-final.json`, SHA-256 `4cfb83fca867c8474fa53f146a425decf477ac920d2ea64ab3d364a416f3331c`, records 18 fixtures for each of five predecessors, 90 lifecycle executions, preserved paid/Supabase-cleanup history, locked mode, service-only ledger, generated-type match, and both six-connection checkout/revoke-bind and cleanup-registration proofs. The reviewer inspected the completion log and independently recomputed all 27 hashes in the receipt; all matched current files. Migration 085 remains `e604c3b38f230f358b1f7ff66ced4bb07e573066c4812faee87c1eeacf5849b8`. This is disposable local SQL proof, not a hosted migration or rollback result.
- **Focused negative replay:** `../aws-cleanup-cache-targeted-results.json` preserves 179/180 passed and one real validator failure, SHA-256 `cff891fa10aa03c0a5f2308f2a79a132d629a755934f771ede13cb992ac501f1`. The root correction requires an unconditional `AWS::S3::BucketPolicy` resource, as well as the unconditional deny statement. `../aws-cleanup-negative-replay-results.json` then reports 24/24 passed, zero failed/pending, SHA-256 `2c0b289e1ba84db40e377d34edc197b77de34939a09da995c6d900c2f813bc07`. Both the failure and passing replay remain visible. All source and result hashes in `../aws-cleanup-targeted-reviewed.json` were independently recomputed and matched. This is focused replay, not a claim that a new 180-test complete pass or full unit pass occurred.
- **Strict unknown-count handling:** launch readiness now requires exact numeric zero for exhausted and overdue AWS cleanup. Operations summary requires safe nonnegative integers for all three AWS cleanup counts before database/maintenance readiness. Missing counts no longer imply healthy zeroes. The reviewer independently read these root-authored changes, the remote-isolation delegation to the shared identity cache, and the maintenance `STORAGE_CLEANUP_OVERDUE` diagnostic/alert recovery additions. Generic cleanup action failure no longer fabricates an observed overdue/dead-letter diagnosis.
- **Independent operator review now recorded:** `bucket-versioning-independent-review.json`, SHA-256 `c2a8f4ca9ccae566c78ed203013be055e2df5f82299791e271f99d4f11561127`, records the root's independent review of this reviewer's seven authored operator files. All seven file hashes matched. The four-line validator correction authored by root was independently reviewed by `runtime_checkout`, as recorded in `accessibility-seo-operations.md` findings 5–6. This reviewer still does not self-certify the authored operator changes; the separate reviewers and receipt provide that coverage.
- **Complete local launch image build/start now proven:** `../operations/launch-image-results.json`, SHA-256 `261ad74b6a6c7387479c216881d95c9bd0c3fa4d2b0916af15eeb5ce503b4afd`, reports build and isolated production startup PASS for image `sha256:e5a99d878e5b6c04cdeab26fbbc3c2071062da77208312e87939716103a2e0d9`. The smoke log reports UID 1000, root-owned pinned helper, read-only filesystem/tmpfs, no network or published ports, live/home 200, staging noindex, truthful unconfigured readiness 503, checkout false and verified teardown. The reviewer independently compared all 360 before/after manifest entries and current files: no input changed. This uses public staging placeholders and is not an exact target-configured deployed image, AWS proof or approval. Image vulnerability scan remains pending; the Docker Scout attempt did not execute because automatic review rejected possible external image/package metadata egress. The prepared offline alternative has no result yet.
- **Current full-suite attempt is not passing evidence:** `../unit-current-invocation-failure.json`, SHA-256 `084d27dcad7632992e291d86caa4c689e64dfafa1959707a2e0293b681426978`, preserves the lost PowerShell/npm forwarded options, default four-worker execution, 797/801 text-log result, four child-process timeouts and absent framework JSON. Assertions/deadlines were not weakened. A correctly invoked exclusive direct-Node run and then the applicable 311-case browser matrix remain pending. The earlier 741-pass receipt still predates this correction and cannot stand in for those runs.

The independently reviewed runtime and validator source identities updated since the prior delta are:

| File | SHA-256 |
| --- | --- |
| `src/lib/operations/summary.ts` | `961e904e1a573622ce25938f8c626171c369a263041b0bbe2f1b29acd41f62bc` |
| `src/lib/operations/launch-readiness.ts` | `41e974cb87999b17658d88cd7a8fd977fd98f0432fe48bfd2ce932290b641c5f` |
| `src/lib/operations/maintenance-observability.ts` | `aa357a8c7bb9bd7a35d562ed412f8bea4ab3b501d83d8da7b1fa19139336096e` |
| `src/lib/files/isolated-extraction.ts` | `ff0aa1a779b18812f588a98083928bc4ff46292f3dad30c6195ff2bff04e3640` |
| `scripts/validate-aws-document-worker-template.mjs` | `d67ba1692169c4a0012c78d14380290883b8c109dc25dc76166096766ecbef4e` |
| `docs/runbooks/LAUNCH_MAINTENANCE_CLEANUP.md` | `17a7a84d1d6cbffa7bf1ecbfe467780f244ae4ac2c889354e16d61c316b4e07b` |

The cleanup runbook retains the 48 probe rows/hour versus 80 drained rows/hour single-process limitation and requires actual hosted load, replicas, restarts and the 120-second whole-maintenance deadline to be measured. Eight real worker operations/hour is the nominal remaining sweep capacity before overlap/retries; fail-closed overload detection is not throughput proof. The configured USD 5 monthly AWS ceiling and budget ownership/notifications also require actual provider cost/alert evidence; neither local source configuration nor this review establishes their operation. Fresh bucket evidence and continuing policy/versioning drift observation remain mandatory. There is still no compatible committed schema-085 rollback candidate or proven protected forward-recovery receipt. Human roles remain explicitly deferred, and all hosted/human/public-activation gates remain separate.

## Prior delta — 2026-10-23T05:16:40Z

**Verdict remains NOT READY.** No additional reachable P0/P1 was found in the root/DB-authored cleanup, submission lease, shared readiness probe cache and overdue-hold source inspected below. FTM-01 has an implemented local correction and meaningful targeted regression evidence; final closure still requires the current SQL upgrade matrix, tests for the latest cache/overdue changes, affected complete validation and real provider cleanup/drift proof. The historical first-pass observation below is retained as provenance and is superseded by this delta where explicitly stated. The checkout, branch and baseline HEAD remain those stated in that first pass; the working-tree hashes below identify this delta.

### Cleanup correction and independent source review

The service-only `ap_begin_aws_temporary_cleanup` RPC atomically registers exactly four UUID-v4 object paths in a separate `ap_aws_temporary_cleanup` table before any S3 upload. This avoids old Supabase maintenance consuming the new AWS work. Account, deployment, bucket and path are constrained. Browser roles cannot inspect or invoke the ledger; service-role direct insert/delete and target/lease mutation are denied. Replays retain the original DB timestamp and lease, partial/conflicting groups fail, and completed rows remain as immutable operation receipts. The runtime rejects completed/invalid receipts and checks the 60-second submission window after credentials resolve and again before Lambda invocation. Cleanup starts ten minutes after creation. Immediate bounded deletion never acknowledges the durable intent, so a process loss, suppressed immediate deletion failure or late provider output remains recoverable.

Maintenance deletes at most 20 due objects per run, four concurrently, through the exact account/environment/prefix and explicit AWS credential/endpoint provider. A row is completed only after a successful S3 delete; a failed delete or acknowledgement remains eligible for retry. Exhausted retries and query failures fail readiness/maintenance. The new post-batch query also exposes outstanding work older than 30 minutes past its cleanup deadline, including work beyond the batch limit. Operations summary reports due age, and launch readiness holds on overdue or dead-letter work. Retained completion rows prevent accidentally renewing a submitted operation's lease.

The independent review found a concrete interim amplification issue: renderer readiness probed on every request while file-safety probed separately, creating at least 240 and potentially 480 cleanup rows/hour under once/minute monitoring, against an 80-row/hour sweep. The root corrected this with a shared single-flight five-minute `probeDocumentWorker` cache, including failures, keyed by worker configuration, AWS credential/identity inputs, release and database identity. Renderer approval/revocation reads remain uncached. The inspected changes close that repeated-health-request path. The obsolete interim amplification behavior is not reported as an unfixed defect in the current snapshot.

Capacity remains a hosted acceptance question: the launch IaC pins one web replica and one maintenance replica; Railway liveness uses `/api/live`. A continuously exercised five-minute probe cache creates at most 48 rows/hour per stable web process, leaving 32 of the 80-row/hour sweep capacity, or eight real worker operations/hour. Process restarts, deployment overlap and extra workers add probes. The overdue hold exposes overload; it does not establish adequate throughput. Verify actual document volume, process/replica count, retry load and whole maintenance duration before activation. Likewise, the ten-minute grace relies on the configured 30-second Lambda maximum and bounded client submissions; provider execution/timeout behavior still needs hosted proof.

### Versioning guard authorship and evidence boundary

Key-only `DeleteObject` does not establish removal of historic object versions. The existing preflight had no bucket versioning check. The AWS API distinguishes an empty never-versioned configuration from both `Enabled` and `Suspended`; see [GetBucketVersioning](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetBucketVersioning.html).

At the root's explicit request, this reviewer authored a narrow follow-up in seven operator files: `scripts/aws-document-worker-bucket-preflight.mjs`, `scripts/aws-document-worker-synthetic-probe.mjs`, its existing fixture script, `scripts/validate-aws-document-worker-template.mjs`, both AWS document-worker templates, and `docs/runbooks/AWS_DOCUMENT_WORKER.md`. These authored changes are **excluded from this reviewer's independent certification**. Root independent review/receipt owns their approval. No application, SQL or runtime test source was authored by this reviewer.

The authored operator change requires a fresh postdeployment read-only receipt before synthetic upload, preserving bootstrap ordering. It checks the exact owner/account/environment/bucket, empty versioning configuration and unconditional bucket-policy deny of `s3:PutBucketVersioning`. The receipt binds the exact source/image/function/network-preflight and expires after 15 minutes; the probe validates its bytes/digest before the first upload. CloudFormation gains only exact-bucket policy-management permissions. Runtime permissions are unchanged. Operator read permissions remain explicitly scoped and provider approval is still needed. The deny materially limits accidental versioning drift, but a privileged policy change can remove it. Observation-time evidence is not lifetime proof; activation requires fresh receipts, installed-policy confirmation and functioning provider drift checks/alerts. The application does not claim to detect bucket-administration drift itself.

The reviewer executed only four small offline checks for these authored operator changes: Node syntax, parsed-template validator, existing network/image preflight fixtures, and existing synthetic-probe fixtures extended with versioning/policy/receipt-binding/freshness rejection cases. All exited zero. Those are author validations, not independent provider or runtime evidence. No AWS/provider calls, heavy suites, database, browser, rendering or image-build runs were executed by this reviewer.

### Current receipts inspected, not authored executions

- `../aws-cleanup-targeted-results.json`: success true, 127/127 passed, zero failed/pending; SHA-256 `71f805c39d19d41efed25a47df70987d8060263772feaf4763579f9f39c1358f`. The reviewed behavior tests exercise intent-before-write, failed persistence, lost upload/Lambda responses, all immediate deletes failing, expired leases, delayed output, failed delete/ack retries, wrong scope and dead letters. This receipt precedes the latest cache/overdue and operator guard edits; their updated run is pending at this observation.
- `../unit-results-final-serial.json`: success true, 741/741 passed, zero failed/pending; SHA-256 `bd59f870bf63bdd4914bac337021f96e24a40301edc69e1b618639e4999ca685`. This supersedes the earlier full-suite failures only for its tested snapshot; it predates the cleanup delta and is not the final complete candidate run.
- `../database/concurrency-085-aws.stdout.log`: both six-connection checkout/revoke-bind and six-connection exactly-four-cleanup-keys/single-lease assertions report PASS; SHA-256 `93056960c5861482ab88db52dcf8590be9c08a17db281c3a32766624c7832b7a`. DB Engineering reports clean replay plus 18 fixtures and generated types passed. The prior matrix receipt still binds the old `2c5a...` migration; the replacement five-predecessor/18-fixture matrix is pending and must be inspected before claiming its closure.
- Pinned local rendering now has success true, 2/2 passed, zero failed/pending in `evidence/applypack-chunk5-render-pinned-20261023-005857/test-results.json`. The associated log SHA-256 is `c4703720df3c50725670c3e10edbed8413a53f9ed102e5e3fba4d4930d67f5f6`; the attempt receipt SHA-256 is `5912b437b8a45115535674794f021c48eeba2e5e935fe5adf31a19fdb593b29f`. This is actual local pinned-render test evidence, not human visual/document approval or hosted rendering proof.

### Independently reviewed cleanup delta identities

| File | SHA-256 |
| --- | --- |
| `supabase/migrations/202610220085_staging_rehearsal_checkout_attempts.sql` | `e604c3b38f230f358b1f7ff66ced4bb07e573066c4812faee87c1eeacf5849b8` |
| `src/lib/database.types.ts` | `7fb809b1d2a850f2b63f23485ff975d0457b03f12b805314c48a5ff3e88a857d` |
| `src/lib/files/aws-temporary-cleanup.ts` | `e2742007c592c12b8b343dda8d2a20a461f5c87ea9d0d5d87376c42e2a7a8d46` |
| `src/lib/files/aws-document-worker.ts` | `ef63c4cd7fd0e6e73604169fdb57b19b1b49e3005f500bd481b0bf6bd6aa565a` |
| `src/app/api/cron/maintenance/route.ts` | `8525b9d795db5ccb76bf8a1e8a64320074b2f6fb05bbdc9c24cf713555e5e7a6` |
| `src/lib/operations/summary.ts` | `c342ac1e2bfa98191c68b0d324c0913b2c56c83cedd3e9dfb45b169b236f0874` |
| `src/lib/operations/launch-readiness.ts` | `b545301cadd6ea235d88dfa2666e1bd6ce6378ef441561e9271f84a6bdb9e01b` |
| `tests/integration/aws-temporary-cleanup.sql` | `dea2b6471eb0250a0c9c7c218ef754c9db02db71f5dcc0403543b9bc41339f00` |
| `tests/unit/aws-document-worker-cleanup.test.ts` | `013c792566eb43e8e2b16823e687ebc63fe6e9d8e67e45ca29c8869b46c26a11` |
| `tests/unit/aws-temporary-cleanup.test.ts` | `cb958159d792ed154df65f9cc3e329c2687ca60a7c368cd6487f7c1d2fb086c8` |

All unrelated hosted, human, committed-candidate/CI, rollback/forward-recovery and release gates listed below remain open. The user has deferred assigning the actual release approver and operations responder; this report does not fill those roles.

## Historical first pass — retained observation and source hashes

Observation: 2026-10-23T04:58:56Z. Reviewer: independent Codex `final_adversarial_review` agent. This is a bounded source and receipt review of work authored by other agents. The reviewer ran no application, browser, rendering, database or provider test and made no source, configuration or test changes. This report is the reviewer's only authored artifact.

Canonical checkout and origin were independently verified: `C:\Users\mskir\Desktop\Apply_Pack\applypack-production-v2`, `https://github.com/duotapmobile/ApplyPack.git`. Branch: `codex/manual-launch-hardening-2026-10-02`. Baseline HEAD: `a3de4a447d499fb7d416e1a1d167e281372903b2`. The implementation remains uncommitted; HEAD does not identify the reviewed working-tree bytes. All 22 pre-existing user-file SHA-256 values were independently compared with `../preexisting-work.json` and matched at this observation.

**Verdict: NOT READY.** The prior checkout P1 corrections have inspected local regression evidence. This pass identified an inherited missing durable cleanup path for AWS temporary document objects; implementation and independent delta review are pending. Required final local validation, committed-candidate CI, hosted acceptance and human approvals also remain separate gates. This is not restricted-canary eligibility, a final phase supervisor approval, a human risk acceptance, or deployment authorization. The user expressly deferred human assignments while authorizing continued local implementation.

## Scope and method

Read the supplied revised plan, repository instructions and governing amendments 16, 14 and 12. Independently traced both checkout routes, shared authorization/initiation, current mode validation, migration 085, admin MFA/mode/authorization controls, verified webhook ordering, maintenance reconciliation, KMS/worker clients, Roles Anywhere bootstrap/template/preparation, launch image and CI contracts, rollback checks, indexing controls and test-result rejection. Read the current product, security, accessibility/SEO/operations, Materials SQL and provisional supervisor reports as secondary evidence. Operational database backup/migration scripts remain covered by the separate independent `ops-tooling.md` review rather than a new complete audit here.

The current Roles Anywhere trust-policy structure was also compared with the official [AWS trust model](https://docs.aws.amazon.com/rolesanywhere/latest/userguide/trust-model.html): the service principal, required STS actions, subject CN condition and trust-anchor source condition are consistent with that model. This documentation check is not AWS validation of the prepared resources.

## Findings and closure status

### FTM-01 — P1 — durable AWS temporary-object cleanup is missing

Status: **OPEN; implementation underway by Engineering**. Human owner remains unassigned. This is inherited runtime behavior, not a regression introduced by the new credential provider.

The reviewed `src/lib/files/aws-document-worker.ts` uploads private source bytes to the temporary AWS bucket and may create PDF/page-image objects. Its `finally` block issues four deletes and suppresses every deletion error. No durable AWS-object cleanup intent is recorded before upload. A process loss after upload, or failed delete, therefore leaves no application work item for retry/alerting. The Lambda handler cleans its local temporary directories but does not independently delete these S3 objects. The existing Supabase cleanup queue does not contain these AWS objects. A one-day S3 lifecycle defense does not satisfy the plan's separate durable cleanup and failure-alert requirement.

Required closure: persist exact environment/account/bucket/key cleanup ownership before any remote write; retain recoverable work across successful immediate deletion, timeout and process loss long enough to cover late provider completion; use bounded deletion and durable retry/dead-letter alerts; deny wrong-environment and unrelated keys. Tests must establish persistence-before-write, no write after a failed intent, retry after process loss or delete/ack failure, and late completion before delayed cleanup.

The root proposed durable intents and a delayed maintenance sweep. The review additionally challenged old-instance overlap: historical maintenance consumes all rows of `storage_cleanup_queue` using Supabase Storage, so merely adding AWS buckets to that table could let an old worker handle new-provider work incorrectly. A separate AWS queue or an equivalently enforced provider-aware claim/ack boundary avoids relying on the behavior of a nonexistent Supabase bucket. A bounded submission window and explicit timeout budget are also needed so stale resumed work cannot outlive its cleanup grace. These are design requirements pending source review, not claims that a fix has passed.

### Prior TM-01 — legacy reopen bypass — locally closed for the reviewed snapshot

Migration 085 revokes service execution of `ap_reopen_provisional_search_checkout(uuid)` as well as the historical invited-search/material begin functions. The older direct search begin grant was already revoked by migration 052. Authorized wrappers retain the authoritative mode/release check. The real SQL fixture includes old-entrypoint grant denials and mode lock behavior; the five-predecessor matrix binds the reviewed SQL. Actual instance draining and already-in-flight provider calls remain hosted deployment checks.

### Prior TM-02 — provider PAID/application unsettled — locally closed for the reviewed snapshot

The service-only reconciliation selector includes PAID initiations until their linked payment is PAID with a verified timestamp. Mode unlock rejects that discrepancy. Runtime keeps it unresolved across sweeps, including payment winning an expiration race, and maintenance marks the stage failed. Provider observation does not call fulfillment. The integration receipt contains the repeated-sweep and settlement cases; the SQL matrix covers persisted-state behavior. Real missing/delayed signed-webhook recovery remains a hosted requirement.

### Other reviewed corrections

- Hosted staging and production require AWS KMS; the legacy remote adapter is restricted to explicitly selected local test/development without a deployment marker. Client credentials and regional endpoints are explicit. Worker account, versioned ARN, environment and temporary bucket are bound together. The 47-test receipt supports the local negative boundary claims.
- Roles Anywhere checks exact deployment/account/role/profile/trust identities, a pinned root-owned helper and ancestors, strict single-object PEM fields, leaf/CA/key binding, bounded certificate/session lifetimes, temporary files, generic errors and explicit STS caller identity. The refresh cache clears after failure and does not fall back to static/default credentials. No additional reachable P0/P1 was identified in this bounded bootstrap review.
- Materials creation retains exact delivered customer/service/order ownership, current 799-cent pricing with historical 800-cent preservation, one/two-pack atomic admission, approved font predicates, and narrowly permitted initial reservation/paid-clock transitions. The real Materials fixture and independent SQL delta report support those local corrections. The suggested redundant completion-trigger revision comparison is not a demonstrated violating application path: the current completion RPC binds the active revision to both release and member. It is not treated here as a new blocker or risk-acceptance waiver.

## Independently inspected receipts

Counts were parsed from the files. Executions belong to the implementing agents; this reviewer did not rerun them.

| Receipt | Observed result | SHA-256 |
| --- | --- | --- |
| `../integration-results-final.json` | success true; 15 total/passed; 0 failed/pending | `d651b5ca3a67fd0069ca0d0fded330299ba5c2c6adc15f5875402c43430532bd` |
| `../aws-hosted-boundary-results.json` | success true; 47 total/passed; 0 failed/pending | `678c1027dbbad20821e73cec1d5a963dd2c43f06a2ae295428521a438ae64f7f` |
| `../unit-native-serial-results.json` | success true; 25 total/passed; 0 failed/pending | `1ad7ba80589f74dfb3e1a928ee5b9d4095c5dd3712f24fbe06bd790ed03a59f3` |
| `../unit-results-reviewed.json` | preserved intermediate failure: 736/738 passed, 2 failed, 0 pending | `8bb48b8d68b7c240ecd960adb43c10f79b6f45a97e91bfa28c488ffc992475ba` |
| `../database/upgrade-matrix-085-final.stdout.log` | five 080–084 predecessors, 17 fixtures each; six independent retry connections; revoke/bind pass; final schema restore | `80e98dfd7d09e7168b956e108a963a8915be539a323a360599c34d8764fc81cd` |
| `../operations/roles-anywhere-tests.log` | 11 passed; 0 failed/skipped/todo | `4d7768b2a6c6e8cc1dfd2b498f2982d2863169042cc871ff77f570474bbc1fa8` |

Every source/log hash listed inside `../database/upgrade-matrix-085-final.json` was independently recomputed and matched: migration 085, both rehearsal SQL fixtures, concurrency runner, predecessor runner, generated database types and matrix stdout. That receipt reports 85 lifecycle-fixture executions and type drift success on the disposable local database. A subsequent cleanup schema change will invalidate the affected SQL/type/runner proof and require new receipts.

The production dependency audit reports zero vulnerabilities. It does not establish image safety. Roles Anywhere's 11 tests exercise pure validation/cache contracts and malformed material; they do not execute a genuine successful certificate chain/helper/provider exchange or prove real expiry/revocation. The credential-only image receipt explicitly excludes the complete application build. These distinctions are accurately preserved in the current runbook and local validation register.

## Release and evidence limits

The final complete unit run, browser matrix, pinned document rendering, complete launch-image build/start and high/critical image scan were still in progress or pending at this observation. The earlier failed receipts must remain visible until a later complete successful receipt supersedes their conclusion. The last typecheck/build/lint observations also precede some later source changes; affected checks need rerun against the final bytes.

CI now has release-branch/manual triggers, required receipt checks, database/type/Windows/render/browser gates and a separate launch-image workflow. These are configured jobs, not clean executed CI. The rollback job intentionally rejects a missing or same-candidate SHA. `../database/rollback-compatibility.json` records no compatible committed alternative in the inspected local refs. The plan permits a separately reviewed forward-recovery strategy, but neither an actual compatible rollback nor proven protected forward recovery is supplied. Do not relabel this blocker as a passing rollback test or substitute the baseline SHA.

Current peer reports correctly distinguish local correction closure from hosted acceptance and exclude their authors' own code from independent certification. They do not replace the required four phase reports and eight final supervisor approvals. This review adds independent coverage of the Roles Anywhere bootstrap and launch image/CI source; source and report hashes below are observation-specific, and later edits need delta review.

Still required separately: reviewed committed candidate and exact configuration manifest; real staging/production ledger and approved migration receipts; private-object/auth/key/off-machine recovery; actual AWS identity, refresh/revocation, isolated worker and cleanup proof; signed Stripe/payment/refund journeys; verified email/DNS and delivered alerts; real permitted inventory; human document review; keyboard, NVDA and physical iPhone VoiceOver/Safari acceptance; named responders and release approver; real 2698-cent canary refund reconciliation; and explicit public activation approval. None is waived or accepted by this local report.

## Reviewed source identities

| File | SHA-256 |
| --- | --- |
| `supabase/migrations/202610220085_staging_rehearsal_checkout_attempts.sql` | `2c5a4fb8ef0b777cb9db7772f93b4089878b123d050ceb35068a28b3cae7fb23` |
| `src/lib/commerce/checkout-authorization.ts` | `5730c50fd1a38b1c6786034931504e35659b60c23735c6efb8f92fae67e53975` |
| `src/lib/commerce/checkout-initiation.ts` | `7223b3f42c83cb37afd20b338cb8c1d42fb25fd095522b62119f6c5748607095` |
| `src/lib/stripe/mode.ts` | `969afdbe10206e4804ad7db50b74bd2be6d494d664e9bf0fac6ebd69da457a94` |
| `src/lib/security/aws-workload-credentials.ts` | `34b862b9e332b111848deadfae33f6cd2438e6d81473d2e2850a90166468072b` |
| `src/lib/security/aws-kms.ts` | `721706dd01a5cc4ef43bcb04ef592effc3ee0e91371ad1ac3ec9fe3225d94fd6` |
| `src/lib/security/remote-kms.ts` | `9be686e704c65e18517d878420a3ad6ea6c90931b11577467f777a8ab2f9f996` |
| `src/lib/security/kms-health.ts` | `013ab5c59a479bebadee799318aa58dc3822fce588e11f002c437060efa21dc5` |
| `src/lib/files/aws-document-worker.ts` | `e681eb71142ce299cc7323372c54108199fbaf8219ea73d8d0e9d26096a9f725` |
| `src/app/api/cron/maintenance/route.ts` | `10a3dbd5d894faef8a389f15d444251a089e133a4b315222c509c3731a26ffa9` |
| `scripts/lib/aws-roles-anywhere.mjs` | `34b878ec94d7d314d7099ee9c8799e78ae4346a343ef24095bc94b3a38a738b2` |
| `scripts/test-aws-roles-anywhere.mjs` | `a628b7678ab106ea356b0b1e3ab55300db29e50d58b7d0f84dc70752cac57bc5` |
| `scripts/prepare-aws-roles-anywhere.mjs` | `73ac8ad86c5f152e5d731224446621301880945323885f679bdd6e648951b582` |
| `infra/aws/roles-anywhere/template.json` | `8005b55ba239fe4808123cc77edf73d409d5ecb84e7a45ddc2ff936bdebdba98` |
| `Dockerfile.launch` | `55c243c7878e67217575fff511ff7f6114933973ba42a9d00a0b1180ce111ca8` |
| `Dockerfile.launch.dockerignore` | `37436bd88adb47e5596b1e0b69d7e48ce3ca7245f40df14fba504da89676cba2` |
| `scripts/test-launch-image.mjs` | `5f47cbd747eedeead813c5b85837ea8f5aa31aeecafd7f39ff0d5969bdbd1388` |
| `.github/workflows/launch-image.yml` | `d2e17c3f82b86b1181fd8a8a06129c81755e7a61f468694dddbca41f37eb5277` |
| `.github/workflows/ci.yml` | `dbaef1f42cc6c41a7f8cb8bec23ec15a9048d77fc2921ad1eb983a2fd914a490` |
| `.railway/launch.ts` | `99b5019f8cf0d72ede6d1c5d504f1a9e7b8c91a71f9650022a7e2e1339d2aead` |
| `.railway/launch-contract.ts` | `d04f18ee7a55aa0940b719babcf74b85dd4b3f24048efb650380d18a04f2e822` |
| `scripts/run-supabase-rollback-test.mjs` | `222044bc253ff1c0877e3fcaef64ac53a89823fdc1761d67da78959018c1b41f` |
| `scripts/assert-required-test-results.mjs` | `d4a76141032b358223e5fef9b25637c7da97a257aeef9bb737667968396be989` |

Any affected source, schema, runtime image, credential identity, worker, font, legal or environment change invalidates its dependent review/testing evidence. Baseline HEAD and a copied report title cannot substitute for those bindings.

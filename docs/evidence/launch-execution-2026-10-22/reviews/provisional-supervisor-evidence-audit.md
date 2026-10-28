# Provisional supervisor evidence audit

## Final readiness delta and current review boundary

The corrected migration is `c99561da94f676f3d8f7fdc32d731fae54210f302d33bc5ea5811b58d7b5e935`. Its clean 18-fixture replay, five-predecessor/90-fixture matrix, both concurrency proofs and final exact readiness/type checks passed. The current matrix receipt is `ca59c4c67b4d02fdeccd93ae4dbdadd0e29b8154db34f8eb241e5a1a45edd43d`; actual final-state receipt is `2e6f97391660063abc26d992d9ae9572e8b7e93342ca0d73894fadcc35302774`. The author does not independently certify this SQL. Root's separate `schema-readiness-independent-review.json` (SHA-256 `5854915b9daa7094f37d09839e2374a053b65f5749a4608947e0add9671c5b48`) records source and receipt review; this audit checked all five of its bound source/receipt hashes and found them matching. It reports no relaxed runtime gate and no external action or human approval.

The final supervisor snapshot `provisional-supervisor-evidence-audit.final.snapshot.json` (SHA-256 `b787791cc743db6391b921b9a81fa110f9b456e4b7d2243d13a0e956dd4d42e3`) verifies all 98 peer-report table bindings: 32 product, 41 security, 19 accessibility/operations and six Materials/readiness entries. It also verifies all five bound items in root's independent readiness review. No mismatch remains at this observation. The author reread the refreshed report deltas: Materials explicitly reviews c995's anchor/postcondition and attributes execution to the database author; accessibility explicitly reviews the narrow `npm.cmd` argument-forwarding correction without claiming a successful current full suite or hosted Windows CI.

The earlier mismatch snapshot `provisional-supervisor-evidence-audit.readiness.snapshot.json` (SHA-256 `3450fdf185cfac8b4508c22d843b47030ceb56461156e185ebf0e93cf850b206`) remains unchanged. It correctly recorded two stale accessibility identities and the then-historical e604 Materials table. The report author subsequently reviewed and refreshed those entries; this audit did not silently substitute source hashes or rewrite the failed observation.

| Current peer report | SHA-256 |
| --- | --- |
| `product-workflow.md` | `419f942b646b7326ddeaf1de4a1ba38e1e6b8a2ad42a1655112544a6e1a2db38` |
| `security-payments.md` | `990fa09e0f88779e436f8faaeb504c7022b0006e300f46ea530164051753db7c` |
| `accessibility-seo-operations.md` | `83ab97147ffa3c5e7ec006fdc1f0a133cabc02754fcaf569228dd76b65f1b0ed` |
| `materials-database-delta.md` | `557bf3b6beb275c24aa09cf582f4fb47ebf99580201859a65ec8fb072888e7fa` |

All remaining sections below preserve the earlier pre-readiness audit snapshot, including its then-current identities and pending-run wording; they are historical observations, not current-source approval. The legacy-board unchanged replay and legacy backfill subsequently passed. Those and legal/inventory results retain explicit prior-e604 scope in `../database/READINESS_CONTRACT_CORRECTION.md`. The database is now idle. No hosted, human, compatible application rollback or public activation gate is supplied by these local results. Verdict remains **NOT READY**.

Refreshed October 23, 2026 after the durable AWS cleanup matrix. Reviewer: `database_attempts`. This reviews peer-authored reports and their receipt claims. The reviewer authored migration 085 and the SQL runners: references to those executions establish provenance and counts, not independent certification of the reviewer's code. Independent Materials and AWS ledger findings are attributed to `runtime_checkout` in `materials-database-delta.md`. Baseline HEAD is `a3de4a447d499fb7d416e1a1d167e281372903b2`; the implementation remains uncommitted.

Verdict: **NOT READY**. The current product/security deltas have local evidence supporting their bounded implementation findings. They do not supply the four hosted phase reports or eight final supervisor approvals, human acceptance, provider-backed journeys or deployment authorization. This is a local provisional report review only.

## Earlier snapshot: peer-report assessment

| Report | Supported local conclusion | Outstanding limits |
| --- | --- | --- |
| `product-workflow.md` | Its latest delta names the current SQL and real MATERIALS fixture and correctly links local one/two-pack, fixed-price, atomic-cart, immutable-clock and refund tests. It incorporates the separate AWS ledger, immutable lease, bounded cleanup and readiness hold, while distinguishing hosted drain capacity. All 29 source/receipt table entries match. It acknowledges earlier source review missed composed-path material defects. | Actual permitted exact-ten inventory, hosted purchases/deliveries/downloads, two complete independent document pairs, promised clocks, human document quality and real customer access remain unproven. No Product Owner or final supervisor approval is supplied. |
| `security-payments.md` | Its current delta independently traces the absence deadlock, legacy reopen bypass, provider-paid/unverified discrepancy, hosted remote-KMS boundary and missing durable AWS deletion. All 38 source/receipt table entries match. The 15-test integration and 47-test AWS boundary receipts passed with zero failed/pending cases. Its distinction between mock-provider/local SQL evidence and real Stripe/AWS behavior is correct. | Actual signed-webhook ordering/replay, expiration races, live refunds, admin MFA/customer isolation, deployed-instance drain, private objects, no remaining S3 versions and hosted caller identity still need execution. The material completion-trigger suggestion is optional redundant hardening; no reachable violating application path was found. |
| `accessibility-seo-operations.md` | Correctly distinguishes noindex from authorization, configured CI from executed hosted CI, anonymous/single-instance probes from full acceptance, emulated WebKit from physical iPhone/VoiceOver, and isolated native replay from a successful complete suite. The native receipt supports 25 passed, zero failed/pending. All 19 current table hashes match. It reviews the strict numeric cleanup-count guard and unconditional bucket-policy validator correction, preserves the failed focused run and bounds the 24-test replay. | Current full-unit/build/browser/render results and all manual accessibility/hosted/recovery evidence retain separate requirements. The earlier 741-test pass predates the cleanup delta. A configured required Windows job and one local isolated replay are not hosted CI acceptance. |

The independent `materials-database-delta.md` review binds current migration `e604c3b38f230f358b1f7ff66ced4bb07e573066c4812faee87c1eeacf5849b8`, both material/cleanup fixtures, and the replacement 90-execution matrix receipt. It separately reviews the AWS ledger, original lease, grants and fixture while excluding its author's runtime changes. Removing only the added cleanup block reconstructs the earlier SQL exactly. Its three source-table hashes match; no concrete P0/P1 was reported in the inspected scope. This audit verifies the review's provenance and execution-count claims, not the database author's code independently.

The peer reports correctly preserve the original 179-pass/one-failure focused receipt and distinguish the subsequent corrected 24-test replay. Their shared five-minute health-probe cache and bounded twenty-key maintenance batch are implementation controls, not proof that deployed traffic can be drained. A one-process calculation of 48 probe rows/hour against nominal 80 deletion rows/hour excludes real document traffic and additional replicas/restarts. Hosted interruption/deletion, versioning state and observed drain capacity remain required. The operator bucket-versioning tooling is outside these runtime/SQL peer reviews' source scope and requires its separate independent assessment.

The optional redundant exact-revision check in the member completion guard is not a release-blocking risk-acceptance requirement. The only completion writer is `ap_commit_material_release_v2` (migration 031:1819–1820), which stores the same active revision in the release bundle (1813) and updates only that revision's members. The only application caller is the authenticated administrator route `src/app/api/admin/material-lines/[id]/route.ts:84`; browser table writes are revoked (migration 022:1773) and no direct member-table writer exists in application source. Trusted service-role direct DML remains available, so future privileged writers could benefit from the redundant guard.

## Earlier snapshot: receipts inspected

The JSON counts below were parsed from the actual files, not copied only from report prose. The AWS boundary receipt has four test-file entries and integration has two; runner aggregate suite counts also include nested suites. All 89 cited table entries across the four peer reports matched actual file hashes. `provisional-supervisor-evidence-audit.snapshot.json` records the exact observation, entries and receipt data (SHA-256 `9ba7a03c208da9e86bf00b896a6c6c5dc1bfaf3b55519c5520da5bd4b5b02724`). These are local receipts.

| Receipt | Observed outcome | SHA-256 |
| --- | --- | --- |
| `aws-hosted-boundary-results.json` | success true; 47 total/passed, 0 failed/pending | `678c1027dbbad20821e73cec1d5a963dd2c43f06a2ae295428521a438ae64f7f` |
| `integration-results-final.json` | success true; 15 total/passed, 0 failed/pending | `d651b5ca3a67fd0069ca0d0fded330299ba5c2c6adc15f5875402c43430532bd` |
| `unit-native-serial-results.json` | success true; 25 total/passed, 0 failed/pending | `1ad7ba80589f74dfb3e1a928ee5b9d4095c5dd3712f24fbe06bd790ed03a59f3` |
| `aws-cleanup-cache-targeted-results.json` | success false; 180 total, 179 passed, 1 failed, 0 pending/todo; original validator failure retained | `cff891fa10aa03c0a5f2308f2a79a132d629a755934f771ede13cb992ac501f1` |
| `aws-cleanup-negative-replay-results.json` | success true; 24 passed, 0 failed/pending/todo after correction | `2c0b289e1ba84db40e377d34edc197b77de34939a09da995c6d900c2f813bc07` |
| `database/upgrade-matrix-085-aws-final.json` | exit 0; five 080–084 predecessors, 18 fixtures each, 90 executions; six-connection checkout and AWS proofs; historical paid/Supabase cleanup rows preserved; latest local schema restored | `4cfb83fca867c8474fa53f146a425decf477ac920d2ea64ab3d364a416f3331c` |
| `database/upgrade-matrix-085-aws-final.stdout.log` | All five PASS lines and checkout/AWS concurrency/latest-restoration markers present | `323ba6649f4e3d4a868644044ebe1f5ad44d3b9da667690b90b904339511a24a` |

The earlier `database/upgrade-matrix-085-final.json` (85 executions on pre-cleanup SQL) remains historical, explicitly superseded by `upgrade-matrix-085-final.superseded.json`; it is not current-source proof. The database matrices were authored and run by this reviewer; the peer reports' independent source assessments and the execution receipts are distinct evidence. Additional legal/inventory checks passed. The legacy-board SQL assertion passed but its final local reset exceeded the unchanged 120-second subprocess limit; the failed receipt is preserved and replay/backfill are pending while host contention is cleared. Read-only inspection found latest 085, no active other client queries and no invalid indexes. This audit does not relabel that failed runner as passing.

No hosted provider calls follow from synthetic local data or mock-provider results. `database/rollback-compatibility.json` records no committed schema-085 compatible candidate in locally available refs and same-HEAD rejection before database action. A tested application rollback is therefore blocked; a locked forward-recovery strategy still needs its own reviewed hosted proof.

## Earlier snapshot: reviewed report identities

| Report | SHA-256 |
| --- | --- |
| `product-workflow.md` | `67455d8438ee4dd90e36196355163885a79851ef10c0cd5e3f4d594de0079426` |
| `security-payments.md` | `999c7d2ffa94f2659c29e92fe182f79e85b103b51ffb2ed261a34f0b87f5e1ae` |
| `accessibility-seo-operations.md` | `9ed4cb575bf28a93a49438d7508e0c345b575ae5a1ce1d3e2b74d47a6deb4558` |
| `materials-database-delta.md` | `e1c7d528686ad552339ed92bc4fb0458732b54b454fd837d7978e458fd4a13fa` |

Allowed next work is continued local validation and evidence review. Final acceptance must name a committed candidate and exact phase configuration, unresolved P0/P1 findings, explicitly owned/accepted P2 items and the precise permitted next action. These local reports neither assign deferred human responders nor authorize restricted canary, provider mutation or public activation.

# Independent post-manifest verification

Observation: 2026-10-23T09:40Z. Reviewer: `final_adversarial_review`. **Manifest binding verification: PASS. Final local handoff scope: PASS. Release verdict: NOT READY.** No new concrete application P0/P1 or material readiness overclaim was identified in this final evidence review.

The canonical checkout remains `C:\Users\mskir\Desktop\Apply_Pack\applypack-production-v2`, origin `https://github.com/duotapmobile/ApplyPack.git`, branch `codex/manual-launch-hardening-2026-10-02`, baseline HEAD `a3de4a447d499fb7d416e1a1d167e281372903b2`. Implementation remains uncommitted. Baseline HEAD does not identify the implemented candidate bytes.

## Actual output and binding checks

The reviewer parsed the actual generated `PROVISIONAL_LOCAL_MANIFEST.json`, independently recomputed every explicit path/SHA-256 binding, and checked byte counts where supplied. All **164 binding occurrences, representing 158 distinct path/hash bindings, match**. The manifest contains 42 evidence records, nine handoff bindings and four explicitly preserved failures. It is 62,410 bytes.

The reviewer also recomputed the current tracked/nonignored-untracked Git path set using the recorded execution-evidence/generated-output exclusions. All **736 source paths and hashes match** the final source inventory. All **376 current image-input hashes match** the accepted image inventory. This preserves the reviewed local image identity `sha256:d9a489a347ce9b0518f9364cdfef3f0b363ad0352c0296ca407f8e8d85f02939` and config digest `sha256:6146c0557c83fc9c424b23d68dc750177eb458161c47e035fa546ef8fa3c6719` without claiming a new build or scan.

The actual browser framework JSON was independently parsed again: **351 unique tests**, each with exactly one passed result and retry zero; zero failed, skipped, flaky or global-error results. Project counts remain desktop 74, Firefox 69, WebKit 69, mobile-WebKit 69 and mobile Chromium 70. The earlier review's 94 browser receipt/source/tool/artifact binding checks, 62 historical screenshot checks and source reconciliation remain separately recorded in the frozen final local validation review.

The later collector additions were read, not executed by this reviewer. They require the accepted browser status and runner/validator exits, complete before/after source and preservation counts, empty teardown residuals, all 63 artifact hashes, validator pass text and a passing scoped hygiene receipt. They retain actual browser enumeration, project/uniqueness checks, source path-set equality, image/legal source checks and mandatory evidence/failure sets. No concrete defect was found in this narrow delta.

## Hygiene and final documents

The actual hygiene receipt records `PASS_SCOPED_SIGNATURE_SCAN`: 326 enumerated text files, 14,001,911 bytes, zero recorded signature findings and 126 explicit binary/unlisted/large-file exclusions. The reviewer independently recomputed all 326 text hashes and the count/byte totals; all match. At inspection, the only bundle files outside its captured or excluded inventory were the hygiene receipt itself and the subsequently generated manifest, as its limitations anticipate.

This verifies the recorded scan and snapshot bindings; the reviewer did not rerun the signature scanner. It does not establish exhaustive secret/PII absence, binary/archive sanitization or publication approval. This subsequently written sidecar is also outside that captured hygiene snapshot. Publication still requires affected hygiene review for later files and excluded artifacts.

All nine manifest-bound handoff files were read: the local handoff, validation summary, execution register, evidence dependencies, validation commands, review index, provisional cost model and two unapplied patches. The earlier unit-command issue is corrected: future runs create a fresh exclusive ignored attempt directory and retain separate runner and validator exits; the accepted historical result files are explicitly preserved. No bound file was edited by this reviewer.

The final documents distinguish the 801-test snapshot from the 43 overlapping affected replays and later test-only decomposition. They preserve both failed browser attempts, disclose nine independent 120-second budgets replacing one aggregate budget, and do not describe this as a production latency fix. The cost model remains an assumption-based scenario, not observed billing or an approved target; its $5 budget is an alert threshold, not a cap. This reviewer did not independently refresh public prices or inspect billing. Proposed overlapping changes remain unapplied; the bound patch-check receipt records checks, not application or staging.

## Exact identities

| Artifact | SHA-256 |
| --- | --- |
| `PROVISIONAL_LOCAL_MANIFEST.json` | `5a4559b861a50e5697f50137977a37ddf41c279bf6a3758046c66d3fbbad9838` |
| `build-provisional-local-manifest.mjs` | `6b887e05ac17f55d215243a2f2d53219577c06ff2559c18d3bce92f41571df92` |
| `LOCAL_MANIFEST_INPUTS.json` | `7118e4ca9634187734f11ae12813f4d6c1d9503c84ceb09145cff75272f5ff25` |
| `final-hygiene-check.json` | `f7c5c7be06d4d7c17af7612dc4aee4e75119f1f11bf554f0380ffd1425be1bac` |
| `local-source-final.json` | `cdc9b8f0bbbecdece65e4575623973082ba53e8cfc315fd0eabad5a1c385282d` |
| `reviews/final-local-validation-review-2026-10-23.md` | `6a1458323213dcb255998ab83064e7ae0819346054bbf3410e155b74dc20979d` |

This separate sidecar verifies the already-generated manifest without changing its bound reports or introducing a self-hash cycle. It is intentionally not a record inside that manifest. A future revised manifest may bind this sidecar while preserving these observation-time outputs.

## Remaining boundaries and independence

The manifest truthfully keeps `candidateGitSha: null`, `candidateFrozen: false` and clean CI URLs empty. The local web image uses public staging placeholders, is not deployed or registry-published, and supplies no deployed worker ARN/image identity. Actual provider account/project/service configuration, authorized external phase, deployed legal-content binding, hosted renderer/parser acceptance and human document approval remain unset or unverified.

Recovery remains blocked: neither a distinct compatible committed schema-085 rollback nor an approved protected forward-recovery strategy is established. A synthetic restore does not prove protected objects, keys, authentication, off-machine restoration or accepted RTO/RPO. Human assignments remain deferred by the user's explicit instruction. Hosted journeys, credential expiry/revocation, worker isolation and never-versioned bucket drift, maintenance throughput under replicas/restarts, payment/refund reconciliation, device/assistive-technology review and public activation still need their separate target-bound evidence and approvals.

The reviewer previously authored seven operator bucket-versioning files; their implementation remains excluded from this reviewer's independent certification and is covered by the other recorded reviewers. Root and the execution agents ran the collectors and validation jobs. This reviewer performed local read-only parsing, hashing and document/source inspection and wrote only this new sidecar. No test, build, provider call, deployment, payment, patch application, staging or commit was performed in this verification.

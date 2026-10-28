# Independent final review — recovery CI continuation

Review date: 2026-10-23. Reviewer: independent `final_adversarial_review` agent. Result: **PASS for the bounded local continuation; NOT READY for release.** No remaining concrete local correctness or security fix was identified in the reviewed delta. This is an independent source and evidence review, not a human approval or an execution receipt authored by this reviewer.

## Identity and scope

The reviewed checkout is `C:\Users\mskir\Desktop\Apply_Pack\applypack-production-v2`, origin `https://github.com/duotapmobile/ApplyPack.git`, branch `codex/manual-launch-hardening-2026-10-02`, baseline HEAD `a3de4a447d499fb7d416e1a1d167e281372903b2`. The implementation remains dirty and uncommitted. That baseline commit does not identify the candidate bytes; the continuation manifest correctly records a null candidate SHA and `candidateFrozen: false`.

The final `CONTINUATION_MANIFEST.json` SHA-256 is **`9a112a927edd917d491ac1f76b2bab2c783c2735bf8624beef52a801d681d09f`** (14,296 bytes). I rehashed its 56 explicit binding occurrences, representing 54 distinct path/hash bindings, with no mismatch. Its evidence array contains 52 records. The complete current source inventory contains 739 paths; the before/current bytes and the independently enumerated Git path set match. The image inventory contains 379 matching current inputs. All 22 protected pre-existing files remain exact.

There are exactly seven implementation/documentation changes relative to the prior 736-input source snapshot: the CI workflow, database operations runbook, new recovery dispatcher and its tests, new shared structural helper, existing strict rollback runner, and the affected manual-launch unit file. There are no source removals. The three new files explain the increase to 739. The older manifest and its independent sidecar remain unchanged, dated evidence for the earlier source and image.

## Recovery strategy and trust review

The continuation closes a real local gap: the plan and production guard permitted reviewed `LOCKED_FORWARD_RECOVERY`, but CI previously unconditionally required a compatible application rollback SHA. The dispatcher now supports both strategies without fabricating a compatible SHA or accepting a generic skip.

The default remains strict `TESTED_COMPATIBLE_SHA`; it requires a full, distinct SHA and retains the application compatibility checks. Forward recovery accepts only the exact strategy and repository-configured JSON plus its exact digest. No forward plan dispatch input, arbitrary file, URL fetch, or default acceptance path was added. Mixed rollback/forward configuration fails closed.

The operational forward path requires the canonical repository, GitHub Actions push/manual context, an allowed main/release ref, a clean checkout, actual HEAD equal to the tested GitHub SHA, current schema bytes, migration 085 bytes, and the ordered complete migration digest. It rejects PR synthetic merges. Plan validation checks exact keys, compact JSON and digest, candidate/ref bindings, bounded review validity, reviewer/reference shapes, numeric recovery objectives, and all required protected-recovery checkpoints.

Repository configuration and syntactically valid reviewer/reference fields remain statements of review, not authentication of a person or verification of linked content. Specific comment/review URLs can change and are not dereferenced by this gate. A real trusted CI run and human review remain necessary. No repository variable was changed and no actual approver or acceptance was invented.

Review found and resolved an exact-origin mismatch: checkout can produce the canonical HTTPS origin without `.git`, so the dispatcher now accepts exactly the canonical forms with and without that suffix, while rejecting near matches. This behavior was checked against the [checkout URL helper](https://raw.githubusercontent.com/actions/checkout/v4/src/url-helper.ts). The runbook also now avoids describing mutable comment links as immutable evidence.

Both accepted strategies execute the shared structural reset/restore helper. I independently compared the extraction against the preserved prior runner after explicit import/path/return/message normalization. The strict compatibility block, SQL input initialization, and full structural reset/result tail remain equivalent. Failure cleanup and schema/inventory assertions were retained. The two affected unit changes only include the extracted helper in existing source reads; assertions were not removed or weakened.

## Executed local evidence reviewed

I parsed the actual focused results and rehashed their bindings: 61 Node tests passed with no failures/skips; 19 affected Vitest assertions passed with no failures/pending assertions. The final focused receipt records successful lint, typecheck, runners, and validation. Dirty-tree, missing-rollback, and self-rollback operational probes fail before database work. Synthetic plan fixtures are test inputs, not approval evidence.

The earlier 18-pass/1-fail unit attempt remains preserved. Its source assertion read only the pre-extraction file; the final two source-reader adjustments account for the corrected 19-pass result. A separate collection mistake produced a null original PowerShell exit receipt; that file remains preserved and is not treated as valid proof. The final owner receipt records the subsequent exit assertions and successful execution. All 19 promoted source/destination pairs and their hashes/sizes matched.

The actual structural database receipt has 103 verified source/log/runner bindings and 100 unchanged input hashes. Its child process exited zero and actual output contains `ROLLBACK_OK` and `RESTORE_OK`. The recorded before/after local disposable database has schema 085, 90 migrations, the required nine migration IDs, `LOCKED` release state, empty operational rows, and no invalid indexes or unrelated active client queries. The local Supabase reset and restore were executed by the parent. This is empty synthetic structural recovery, not a compatible application rollback or protected production/off-machine restore. It used the local Supabase network and must not be called a network-none database exercise.

The refreshed image is **`sha256:8c2931e9502c23feedbcc5512f4f2a1b8b4e31eebf5886f9cc8161cb08607280`**, configuration **`sha256:a89c9a92568353acf5303e1dfb1d8aec838aab7f9d386cdf6a42fc0758709101`**. All 379 image inputs match; the image input delta is limited to the four recovery scripts. The collector binds the OCI index/platform/config digest chain, archive hash, saved tag/config, inspected rootfs, and scanner metadata. I checked these recorded identities and parsed the actual scanner report, without repeating Docker execution or hashing the large archive myself.

The complete scan reports **zero HIGH/CRITICAL findings**, with actual package coverage of 14 Debian, 116 Node, and 26 Go packages. Scanner and smoke records bind the same image/config/layers. The scanner used a pinned local database, no suppression file, network-none execution, read-only inputs, and no Docker socket. The runtime smoke passed nonroot/read-only/tmpfs/network-none checks, native Sharp/helper checks, home/liveness responses, readiness 503, checkout disabled, and teardown.

The first image build failed with global build `--network=none` and remains preserved. The successful second build allowed normal public dependency retrieval. Only the smoke runtime and scanner were network-none; the build is not claimed to have been offline. The prior image proof remains dated and is superseded for the changed copied scripts by this refreshed image.

## Scoped hygiene disposition

The original failed hygiene receipt and first collector are preserved. The reviewed receipt retains **33 raw database-URL signature hits**, with **zero unresolved hits**, rather than claiming zero raw findings. I rehashed all 49 enumerated text inputs and independently recounted the captures.

The only disposition is bound to `focused-manual-hardening-before.ts.txt`, SHA-256 `6f27e57c0c639cde209c24bb784dc88124be13143dee745ce87a5f30b1dc7615`: 31 captures are literal source interpolations, and two at lines 537/571 are dummy fixture literals in stubbed-spawn negative tests. Their captured-value hash is `49e7fe32454e3248d317d70a771bc95559df96115fe9a01faca5972e0475c1d6`. The collector requires the exact file/hash/rule/count/line/literal-hash combination; other hits remain failures. No matched credential-like values are reproduced here.

This bounded scan does not establish PII completeness or publication safety. Its later receipt, manifest, handoff, and this review are outside the captured scan snapshot. The reviewed disposition does not modify the original source or discard the failed scan.

## Key final bindings

| Artifact | SHA-256 |
| --- | --- |
| `finalize-continuation.mjs` | `59692addcca7b0a859386baf6b4a08f766ddb5ba82b638df8c6f6eb6dabd5c14` |
| `source-final-reviewed.json` | `714074858c80fe520403db6c1e24365a12f97697a51d81ebb92faf08fa3d2fdf` |
| `source-delta.json` | `28cda59c567b056a60e1c8416a93b7e815104c0e64486c68369345891422d70b` |
| `focused-final-local-checks.json` | `9c370856a7a068ae764658c580a9a997401e8921a6c036dece71d72172098586` |
| `focused-extraction-equivalence.json` | `ecaf13cbb9a44a7e6bc72dfb7117331926ea932477252cfa417fcb17f4db37d6` |
| `structural-20261023-attempt-01.json` | `9003fbcc5a6b354dc9f8083ea4c8be0d370466be163ed52aa345b8453235ef38` |
| `image-attempt-02/image-validation.json` | `bbfacc3a52a863654cf823fb3c63ab3d9a624f123a241836cb6d37b204d2d54e` |
| `image-attempt-02/image-archive-binding.json` | `a0ff22dd346d0b554e385511a713f93ce4033c84f0041f50fb883da65ae51c18` |
| `hygiene-check-reviewed.json` | `427a4588966032c1f62d766a7c4ff45b89aea990800057f0b33fe9ff99cce831` |
| `LOCAL_HANDOFF.md` | `5c9d654e82b74fa1fd138d385e4830cfc8ef84f004454e0b36895b990a8d187a` |

The original provisional manifest remains `5a4559b861a50e5697f50137977a37ddf41c279bf6a3758046c66d3fbbad9838`; its post-manifest review remains `ae748c9d5256bab2598ef1543b775cb4b7e40ee8bee85921d7a45e55c98adf3e`.

## Remaining boundaries and independence

The handoff accurately preserves the earlier 801-unit, 43-focused, 351-browser, migration/integration, and document-render evidence as dated proof reused because application, migration, dependency, font, and renderer bytes did not change. The new 19 affected tests overlap existing coverage; they are not a new full-suite total. The new image and recovery evidence do not establish provider deployment, actual CI, normal-document human acceptance, device accessibility, or recovery approval.

A reviewed committed candidate and exact-candidate CI are still required. Actual strategy approval, protected private-object/key/auth/off-machine recovery, named human release/operations owners, hosted/provider journeys, human document/device checks, and separate production/canary/public-activation authorization remain open. Existing capacity/load/restart assumptions and budget caveats remain unresolved by this continuation. The user explicitly deferred people assignments. No staging, commit, push, PR publication, deployment, live payment, or provider mutation was performed by this review.

I authored none of the seven continuation changes, their collectors, tests, or execution receipts. I previously authored seven bucket-versioning operator files; those remain excluded from my independent implementation certification and have their separate parent review. I did not rerun tests, query providers, or operate Docker during this final evidence review.

This new sidecar is deliberately outside the nonrecursive continuation manifest and its captured hygiene snapshot. It binds the already-final manifest without changing that manifest or any previously bound file, avoiding a self-hash cycle. It does not upgrade local evidence into release readiness.

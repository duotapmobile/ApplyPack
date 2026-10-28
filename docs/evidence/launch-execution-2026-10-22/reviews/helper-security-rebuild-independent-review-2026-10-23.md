# Independent helper security rebuild review — 2026-10-23

Reviewer: `database_attempts`, independent of the helper implementation author. Scope: local source and existing execution evidence only. No implementation edits, Docker builds, provider calls, credential access, or hosted actions were performed by this reviewer.

Status: **PASS_LOCAL_HELPER_SOURCE_ARTIFACT_AND_RECEIPT_REVIEW.** No unresolved concrete P0/P1 finding remains in this reviewed helper scope. This is local helper evidence, not application-image, hosted, hardware, or production approval. The provisional review is preserved as `helper-security-rebuild-independent-review-2026-10-23.pre-final.md`.

The checkout identity was verified as `C:\Users\mskir\Desktop\Apply_Pack\applypack-production-v2`, origin `https://github.com/duotapmobile/ApplyPack.git`, branch `codex/manual-launch-hardening-2026-10-02`, HEAD `a3de4a447d499fb7d416e1a1d167e281372903b2`. The implementation is uncommitted; HEAD alone does not bind these changes.

## Candidate finding preserved

`helper-rebuild-candidate-authentication-gap-2026-10-23.json` preserves the original observation and exact candidate hashes. The candidate A authentication `go.sum` has 204 records, all for `/go.mod`, and zero archive records. Its SHA-256 is `ba79d01a4d2c92f040f9454899b47dfe07c1e961c072cdd505e5da208aa83daf`. All 24 external modules in the candidate binary match the reviewed patched lockfile, but none can be compared with an archive checksum in this separate exported authentication file. The author and root were notified before accepting the final rebuild.

The distinction matters because Go's manifest checksum and module archive checksum cover different content. A later cache-integrity check does not establish independent archive provenance by itself. See the official [Go module authentication reference](https://go.dev/ref/mod#authenticating) and [cache verification reference](https://go.dev/ref/mod#go-mod-verify). This finding is a provenance acceptance gap, not evidence that dependency content is malicious. Resolution requires explicit authenticated archive evidence and a checked correspondence with the selected/linked modules.

**Resolved in the final source and both final executions.** The fresh module now explicitly downloads each pinned root requirement plus selected `x/text`, records authenticated JSON/checksum output, and checks every external module actually linked into the binary against both the independent record and reviewed lockfile. Each final build has 26 authenticated archive records and 24/24 matching external linked modules. Final authentication `go.sum` SHA-256 is `74f33fefbcef1f6ad1ccb3c598b2a98344baf38dc7aa29e110a005e73914a1d1` for both builds. The earlier candidate is not the accepted reproducibility pair.

## Source review

The initial twelve helper input files were read, including the complete shell procedure, Dockerfile, dependency patch, both module manifests, checksum delta, original license/notice, modification notice, and corrected offline test. The patch changes four direct module versions and adds ten checksums for the four replacements plus selected `x/text`; it leaves unrelated module selections and upstream application code unchanged. The procedure checks original and patched bytes, uses the exact upstream commit archive and pinned compiler image, prohibits implicit toolchain/VCS fallback, and compiles under Docker network isolation with read-only module selection. Compile/test stages check upstream source immutability again.

The corrected offline test parses the certificate reader's JSON and compares the returned DER, key type, and serial to its synthetic certificate. It generates RSA-2048 and P-256 keys only in the test filesystem, verifies SHA-256/384/512 signatures with OpenSSL, and rejects signatures against changed messages. Its child environment is scrubbed and it invokes provider-related subcommands only for help output. Successful local signing is not AWS issuance, certificate enrollment, revocation, TPM, PKCS#11, or hosted runtime proof.

The source is AWS helper v1.8.5 at full commit `08f7df47e6da0b58c0e5960c41f5d3601042b1d2`. The build retrieves the official HTTPS archive and requires 267,960 bytes and SHA-256 `021e688e0297ab09956b5f1e36c3d0c3a0f25c8e49d55cbe42c8e2291bc97292` before extraction. It checks original module, license, and notice bytes before applying the exact patch and checks patched bytes after compilation/tests. The compiler and frontend are pinned by digest. Settings prohibit implicit toolchain downloads, VCS fallback, and private/insecure checksum bypass.

The modified distribution is explicitly labeled `1.8.5+applypack.1`, an ApplyPack-built derivative. The source commit signature was not verified; neither source nor output is represented as AWS-signed, and the output is not represented as an AWS-published binary. The recorded compiler archive checksum is provenance metadata: the actual compiler integrity boundary is the pinned image and exact toolchain version, not a separate archive download performed by this script.

## Other resolved review requests

- **Windows byte stability:** the author identified `core.autocrlf=true`. Local `.gitattributes` now requires LF, `git check-attr` confirms it for shell/patch/pinned checksum inputs, and both final exported manifests include the rule and match current bytes.
- **Mutable frontend:** `docker/dockerfile:1.7` is now pinned to SHA-256 `a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e`. The preserved registry manifest's actual hash matches that digest.
- **Limited notice inventory:** collection now recursively preserves license, notice, copying, patent, copyright, and author filenames with hashes. Final outputs include nested AWS SDK/Smithy singleflight and CIRCL P-384 licenses and Go module patent files omitted by the shallow collector. All copies match inventory hashes. The broad rule also conservatively preserves a license-check workflow text file; the file count is not a count of separate licenses.
- **Invocation evidence:** the final author receipt records exact uncached build and isolated offline-test commands and their successful exits; this reviewer checked those constraints and their bound logs/outputs.

AWS's original Apache-2.0 license and notice, the Go license/patent notice, linked-module notices, and an explicit modification notice remain in the output. Detailed source/test/authentication manifests remain in exported `build-evidence`; concise actual-binary provenance and notices are the intended runtime payload. Keeping build-only historical lockfiles outside the runtime does not remove a linked library from the binary scan or waive a detected vulnerability. This review verifies preserved files and provenance, not a legal certification.

## Final independent artifact and receipt verification

The reviewer-generated `helper-security-rebuild-independent-audit-2026-10-23.json` binds 162 source, artifact, notice, and receipt files. Its SHA-256 is `6b7e55899c700b3a31eff49c73089f4215e56c04a7e6677e12f20df416bc0955`. It also checks all 156 nested path/hash records in the author's final receipt `../operations/signing-helper-security-rebuild.json`, SHA-256 `230cdf2356beca8619bac1ece2490ced39c5dcd7b2dee08ba899f32b8f64086a`.

The accepted pair is `evidence/helper-security-rebuild/authenticated-a` and `authenticated-b`. The actual binaries compare equal byte for byte. Each is 12,110,464 bytes, SHA-256 `6bc6af3a10ff0894a552a9a40c414436d0cb91e422262b10e85af61f619d9c9b`.

| Independent check | Final A | Final B |
| --- | ---: | ---: |
| Exported source hashes matching current files | 13/13 | 13/13 |
| Authenticated archive records and download objects | 26 | 26 |
| External linked modules matching authenticated and reviewed checksums | 24/24 | 24/24 |
| Linked-module notice-related files matching source inventory | 34/34 | 34/34 |
| Distributed notice-related files matching output inventory | 38/38 | 38/38 |
| Upstream command-parser tests | 3 passed, 0 failed/skipped | 3 passed, 0 failed/skipped |
| Synthetic offline checks | 22 passed | 22 passed |
| Changed-message signature rejections | 6 | 6 |

Both source-immutability manifests have SHA-256 `06acd485345abe9a243142a6fb224d95a3ea2473e11fe5abfe23d54e97abf45d`; the build checks all 148 listed upstream files before acceptance, excluding only the deliberately patched module manifest/checksum files. Binary metadata records Go 1.26.10, Linux amd64/v1, CGO enabled, PIE, and trimpath. The shared-library record requires `libc.so.6` and `/lib64/ld-linux-x86-64.so.2`; final runtime compatibility remains a separate application-image check.

The final commands use two separate `docker build --no-cache --platform linux/amd64` invocations with distinct image identities. Preparation and compile execute in both logs rather than reusing those layers. Source/output starts clean with no object/module cache mounts. Reproducibility here concerns the helper executable; the test images differ because their evidence contains execution timestamps.

Both test commands use network `none`, a read-only root filesystem, image UID 1000, all capabilities dropped, `no-new-privileges`, CPU/memory/PID limits, and a 16 MiB `/tmp` tmpfs. The commands contain no environment injection, credential volume, Docker socket, or host-key mount. Keys are generated in that temporary filesystem and the test containers are removed after execution. The source also scrubs the environment of helper subprocesses. No credential/provider behavior is inferred from help output or synthetic signing.

## Exact-output scan

The accepted result is `../operations/helper-vulnerabilities.json`, SHA-256 `ad140fe11c7310d54b3bbb0cd07c082c2cdfed72666f9b37df86137f0fdb10b4`. It identifies `aws_signing_helper` as a Go binary, records 26 packages including standard library v1.26.10, and reports zero HIGH/CRITICAL findings. The actual scan input hash equals the accepted A/B binary. The earlier filesystem-mode probe detected zero binaries and is explicitly unaccepted; no conclusion relies on it.

The inspected `rootfs` command uses Trivy 0.76.1, `--severity HIGH,CRITICAL`, `--exit-code 1`, `/dev/null` as the ignore file, and offline scanning with database updates disabled. It has no ignore-unfixed, file/directory exclusions, or reachability waiver. Before/after container receipts show UID 1000, network `none`, a read-only root filesystem, only task-owned scanner/input/output/cache/temp mounts, and process exit 0. The scan log confirms one language-specific binary inspected.

The author receipt records scanner SHA-256 `d1dfca6ae10a1ad4540bb94e64f0510077c47008920a9b554986b39dca573d83` and database SHA-256 `0f73904c4479e500481f7caa499395de97574ceb4f82042af0ce9ad65c135457`, updated 2026-10-23T01:18:09Z. This reviewer verified the scan command, containment, exact input, recognized package result, and database metadata SHA-256 `c172059c9859708181aa2e8a58fdf6f3ce1fec636b2a8c56280dd37c17deab2b`. The large database payload and scanner executable were not independently re-hashed in this lightweight review; their provenance remains the author/original scanner evidence. The result is limited to this binary and database snapshot, not unreported lower severities or future advisories.

## Frozen source bindings

Paths are relative to `infra/aws/roles-anywhere-helper/`.

| File | SHA-256 |
| --- | --- |
| `.gitattributes` | `2ebcc9ec3cee0e13e8edad732c5a10679f30797499f80e61963ed23548604e07` |
| `Dockerfile` | `307841251c94dc2f17bc8fec52d28530b66896635f465af66596e67194917f19` |
| `build.sh` | `e74c06f08b481b84f899a061c24da462897518d0ea1b84f77b1b1c1cd5405940` |
| `inputs.env` | `2014a4aa0f1fc9479cfea3752832f9a0d2a237470527a34915b9b95a4d5bdd32` |
| `dependency.patch` | `7a0d4bdd432ec80ebc960495655120de9efa3a49cb1ecfc3ef40347425a01271` |
| `go.mod.upstream` | `c189247114216b25c9e3854de61fa8c1df297cc3985298c0fd63e4cecb55e951` |
| `go.mod.patched` | `aa18568c82b100258e6c606034912208613623608ca7b839b04368339aa3c047` |
| `go.sum.upstream` | `4d39806f64fefab5c99d4cc00b53b147dd7e0c28a29b87ee4c3e27b99ff8c60b` |
| `go.sum.patched` | `eb55cfcd54ea0e7dec81a345dd81cf4e2e321d2c1302b4b8146b1c8c72a9870b` |
| `UPSTREAM_LICENSE` | `09e8a9bcec8067104652c168685ab0931e7868f9c8284b66f5ae6edae5f1130b` |
| `UPSTREAM_NOTICE` | `d4290ed64c2edd0fce1d84e3f9dfb2881240fe534def76b8cd29ed6af683e287` |
| `MODIFICATIONS.md` | `e9b7c2b56d43eb410c27a9cc6ad327185c5bf1dd4546c730a4c8ec901963bf0a` |
| `offline-self-test.go` | `7a9581cc942eec08b70e155562b0b89cfa8798eae704a811e12cb3d1f7f2b8eb` |

## Remaining proof boundaries

The final application image must install the reviewed binary under its fixed hash, retain notices/provenance, start with required shared libraries, and pass its complete image scan. Parent/root and operations review that packaging separately. This review does not establish AWS credential acquisition, STS or Roles Anywhere behavior, enrollment/revocation, TPM/PKCS#11 hardware support, hosted runtime, CI publication, human/device approval, or production readiness. No such credentials or provider interactions were used in these local helper checks.

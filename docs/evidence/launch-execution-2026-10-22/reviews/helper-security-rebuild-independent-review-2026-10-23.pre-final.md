# Independent helper security rebuild review — 2026-10-23

Reviewer: `database_attempts`, independent of the helper implementation author. Scope: local source and existing execution evidence only. No implementation edits, Docker builds, provider calls, credential access, or hosted actions were performed by this reviewer.

Status: **IN PROGRESS — final source freeze, archive-authentication proof, two final builds, and strict scan remain unverified by this reviewer.** Candidate evidence below does not authorize accepting an output hash or releasing an image.

The checkout identity was verified as `C:\Users\mskir\Desktop\Apply_Pack\applypack-production-v2`, origin `https://github.com/duotapmobile/ApplyPack.git`, branch `codex/manual-launch-hardening-2026-10-02`, HEAD `a3de4a447d499fb7d416e1a1d167e281372903b2`. The implementation is uncommitted; HEAD alone does not bind these changes.

## Candidate finding preserved

`helper-rebuild-candidate-authentication-gap-2026-10-23.json` preserves the original observation and exact candidate hashes. The candidate A authentication `go.sum` has 204 records, all for `/go.mod`, and zero archive records. Its SHA-256 is `ba79d01a4d2c92f040f9454899b47dfe07c1e961c072cdd505e5da208aa83daf`. All 24 external modules in the candidate binary match the reviewed patched lockfile, but none can be compared with an archive checksum in this separate exported authentication file. The author and root were notified before accepting the final rebuild.

The distinction matters because Go's manifest checksum and module archive checksum cover different content. A later cache-integrity check does not establish independent archive provenance by itself. See the official [Go module authentication reference](https://go.dev/ref/mod#authenticating) and [cache verification reference](https://go.dev/ref/mod#go-mod-verify). This finding is a provenance acceptance gap, not evidence that dependency content is malicious. Resolution requires explicit authenticated archive evidence and a checked correspondence with the selected/linked modules.

## Source examined so far

The initial twelve helper input files were read, including the complete shell procedure, Dockerfile, dependency patch, both module manifests, checksum delta, original license/notice, modification notice, and corrected offline test. The patch changes four direct module versions and adds ten checksums for the four replacements plus selected `x/text`; it leaves unrelated module selections and upstream application code unchanged. The procedure checks original and patched bytes, uses the exact upstream commit archive and pinned compiler image, prohibits implicit toolchain/VCS fallback, and compiles under Docker network isolation with read-only module selection. Compile/test stages check upstream source immutability again.

The corrected offline test parses the certificate reader's JSON and compares the returned DER, key type, and serial to its synthetic certificate. It generates RSA-2048 and P-256 keys only in the test filesystem, verifies SHA-256/384/512 signatures with OpenSSL, and rejects signatures against changed messages. Its child environment is scrubbed and it invokes provider-related subcommands only for help output. Successful local signing is not AWS issuance, certificate enrollment, revocation, TPM, PKCS#11, or hosted runtime proof.

Candidate A's exported binary is 12,110,464 bytes, SHA-256 `6bc6af3a10ff0894a552a9a40c414436d0cb91e422262b10e85af61f619d9c9b`. Its metadata records Go 1.26.10, Linux amd64/v1, CGO enabled, PIE, and trimpath. Exported logs show three passing upstream command-parser tests and 22 passing offline checks. These are candidate observations only; final input bindings and isolated invocation receipts still need verification.

## Additional review requests

- Preserve LF bytes through a fresh Windows checkout; the author identified `core.autocrlf=true` and is adding local `.gitattributes`.
- Pin the Dockerfile frontend digest as well as the compiler image digest; the observed frontend digest is available in the build logs.
- Preserve and inventory nested linked-module licenses, notices, patent, author, and copyright files rather than limiting collection to depth two.
- Preserve exact final build and offline-test commands, including uncached builds, network isolation, non-root UID, read-only filesystem, bounded temporary storage, and absence of credential mounts. Build stdout alone does not record all invocation flags.

Final source hashes, receipt hashes, finding dispositions, and remaining proof boundaries will be recorded after the author freezes the corrected inputs and produces final outputs. Earlier candidate failures and observations must remain explicitly historical.

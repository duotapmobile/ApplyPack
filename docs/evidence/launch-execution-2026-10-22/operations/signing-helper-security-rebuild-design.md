# AWS signing helper security rebuild design

Status: LOCAL HELPER GATES PASS, observed 2026-10-23. The corrected independent clean builds and offline checks are recorded in `signing-helper-security-rebuild.json`. Both produce the exact 12,110,464-byte binary SHA-256 `6bc6af3a10ff0894a552a9a40c414436d0cb91e422262b10e85af61f619d9c9b`, version `1.8.5+applypack.1`. This is helper evidence only; final image, CI, hosted, human, and device gates remain separate.

## Reason and boundaries

The retained `launch-image-vulnerabilities.json` reports six HIGH entries in the official AWS signing helper 1.8.5: CVE-2026-56854 in x/crypto, CVE-2026-78669 in x/net, and CVE-2026-111943, CVE-2026-78667, CVE-2026-78669, CVE-2026-97031 in the Go standard library. The official release remains 1.8.5. Its compiler is Go 1.26.6 and its modules are x/crypto 0.53.0 and x/net 0.56.0. No advisory is suppressed or waived.

Build the exact released AWS application source with a minimal module security update and supported Go 1.26.10. Preserve credential-process, update, serve, sign-string, read-certificate-data, version, all other upstream commands, CGO, PIE, external linking, and trimpath. Do not remove code to change scanner results. Do not substitute static cloud credentials or remove Roles Anywhere requirements.

The result is an ApplyPack security rebuild, not an AWS-published or AWS-signed binary. Its visible version will be `1.8.5+applypack.1`. No provider credentials, hosted actions, or real customer data are required for local preparation and verification.

## Immutable input pins observed from official sources

| Input | Pin |
| --- | --- |
| AWS source release | v1.8.5 |
| AWS source commit | `08f7df47e6da0b58c0e5960c41f5d3601042b1d2` |
| Source archive URL | `https://codeload.github.com/aws/rolesanywhere-credential-helper/tar.gz/08f7df47e6da0b58c0e5960c41f5d3601042b1d2` |
| Source archive SHA-256 | `021e688e0297ab09956b5f1e36c3d0c3a0f25c8e49d55cbe42c8e2291bc97292` |
| Source archive bytes | 267960 |
| Source commit date | 2026-08-20T20:32:18Z |
| Go toolchain | 1.26.10, linux/amd64, `GOTOOLCHAIN=local` |
| Official compiler archive | `https://dl.google.com/go/go1.26.10.linux-amd64.tar.gz` |
| Official compiler archive SHA-256 | `ccfe7ae822d2c2f41f4fe7c956199967a4dac22d0ee0d2b2bfdb440aab3b20c5` |
| Official Go builder | `docker.io/library/golang:1.26.10-bookworm@sha256:88750ccdd0f2a77fcc00a14b1a48d6409bd8ddb5d7c2dd6ec0b4a2e916daf9d9` |
| Builder platform | linux/amd64, exact platform manifest |
| Builder index digest | `sha256:632dff7351799a5a9954a48dc06670ade72ee44e8c351cdc0e5a57af2fea21af` |
| Official builder Dockerfile revision | `650cf2f338d22da87df8c773cfc88afa26699502:1.26/bookworm` |

The official builder includes GCC, G++, libc development headers, make, pkg-config, and Go. Its Dockerfile verifies the compiler archive checksum and signature. Both clean builds consumed the pinned image, installed no additional packages, checked `go version`, and recorded GCC/linker versions. The Docker frontend is also pinned: index `sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e`, linux/amd64 manifest `sha256:b5f3b260a9678e1d83d2fce86eeddf79420b79147eaba2a25986f47133d73720`; registry metadata is retained in `helper-dockerfile-frontend-manifest.json`.

GitHub reports the source commit's signature verification as false. The source provenance evidence is the official AWS repository, full commit identity, and independently recorded archive checksum over HTTPS. Do not describe this source archive as cryptographically signed by AWS.

## Minimal module graph update

`x/net v0.60.0` requires the complete following graph. Preserve all unrelated upstream module versions. The update must be recorded as an auditable go.mod/go.sum-only patch plus the build-time version identifier; application source remains byte-identical to the tagged archive.

| Module | Version | Content checksum | go.mod checksum |
| --- | --- | --- | --- |
| golang.org/x/crypto | v0.57.0 | `h1:3ZVCjf8Ggz7zneR/EHRVx68Ctf+2pmIMP2UFhh9cC6M=` | `h1:Fdz0i5U6CoizGwLda9DttjSk6qlZo25zYNtR+ycvuZA=` |
| golang.org/x/net | v0.60.0 | `h1:79p50tfZlm0J9YfoDsSi639qSXNGVwEzOPLCxM2FsYU=` | `h1:2DA/G1UfVbCpQPeWTmMPGY7Cs2PkBkwu743bVX5PIVg=` |
| golang.org/x/sys | v0.48.0 | `h1:bbX/i/6MgT9BVLM9RT1thmxL04yeTAhbEz4SyadbXoo=` | `h1:hNLxWAXmnKAxqDtdwIYC4bM9oQPEecfsnNMuSxOs3og=` |
| golang.org/x/term | v0.46.0 | `h1:3+OXuTbaKDgwk8jTi3aSLHRlmWqHEUDUtxnbFigO4YE=` | `h1:+K02xbkittuwc0Am4abfA3Fc+XRGXkvBXNO88NCXPoc=` |
| golang.org/x/text | v0.42.0 | `h1:JbOZXgfeCPU9gacVtYliJqOhD+zhrEqK4LfdpmlUZqI=` | `h1:ojzP1Z+2QtioaF8DTtO8K5q7JWVVYwZKenzujK0Zd0E=` |

These values were read from `https://sum.golang.org/lookup/<module>@<version>`. Go must independently authenticate the module cache using its checksum database, not merely trust this transcription. Do not disable checksum verification. Use the exact public proxy and checksum database, fail on missing or mismatched sums, run `go mod verify`, and compare final go.mod/go.sum byte hashes with reviewed inputs before and after compilation. Any additional selected module/version is a review item, not an automatically accepted update.

## Build interface and file ownership

Helper remediation agent owns new `infra/aws/roles-anywhere-helper/` files: immutable input manifest, common build script, separate helper Dockerfile, module patch/checksum inputs, offline self-test, and upstream license/notice preservation. The same common build procedure must be invoked by the standalone verification build and the launch image's builder stage. It must work on a clean CI/Railway builder with only the committed repository and public pinned upstream inputs; no unpublished local image or untracked helper binary is required.

Operations agent owns `Dockerfile.launch`, `scripts/install-aws-signing-helper.mjs`, `scripts/lib/aws-roles-anywhere.mjs`, associated runtime tests/runbook changes, and the final web image startup/scan. This avoids competing edits.

Common output is `/out/aws_signing_helper`, accompanied by concise runtime `/out/provenance/` and `/out/licenses/`. Detailed source, module authentication, graph, and test records are in `/out/build-evidence/`, excluded from the runtime image. Operations copies the binary into a fixed build input path and installs it root-owned at `/usr/local/bin/aws_signing_helper` after checking a hard-coded reviewed SHA-256. Every runtime use retains the existing integrity check. No environment-supplied hash, variable path, network fallback, vulnerable binary fallback, or hash computed and trusted from the same unreviewed build output is allowed.

## Required build procedure

1. Use the exact linux/amd64 builder manifest; reject wrong platform/compiler. Set fixed locale, timezone, work/output paths, source commit timestamp, GOOS/GOARCH, CGO_ENABLED=1, GOTOOLCHAIN=local, and clean build/module cache directories. Do not use host mounts or Docker cache mounts containing dependencies or prior object files.
2. Download the exact source archive, enforce size and SHA-256, and safely extract only inside the fixed source directory. Check original go.mod/go.sum hashes, apply the reviewed minimal patch, and verify patched hashes. Record a manifest showing application source files unchanged.
3. In a clean isolated module without go.sum, explicitly download each exact root requirement plus graph-selected x/text so the public checksum database authenticates module ZIPs. Require each resulting archive checksum to match the reviewed go.sum, and each actual linked dependency h1 to match both records. Verify the cache and freeze the selected module list. Compile in a separate network-disabled Docker build step using only verified source/modules and `-mod=readonly`.
4. Preserve upstream `-buildmode=pie`, `-linkmode=external`, `-w -s`, and `-trimpath`; set the version through the upstream cmd.Version linker variable. Add deterministic VCS handling and fixed build metadata only as recorded build options. Do not change runtime application logic.
5. Record `go version -m`, ELF headers/program headers/dynamic dependencies, module graph and sums, source/patch/script hashes, builder digest, compiler/linker versions, binary hash/size, and licenses. Confirm the PIE ELF and required shared libraries remain available in the proposed final runtime.
6. Build twice from distinct clean source/module/object-cache directories with no cached compilation layers. Shared immutable base-image layers are acceptable; source extraction, module verification, compilation, and output comparison must execute independently. Require identical binary SHA-256 and bytes. Preserve both build logs and provenance receipts. A source path difference test can be used to verify trimpath if needed.
7. After matching builds and independent review, hard-pin the output SHA-256 in the checked-in runtime trust metadata. Later CI/Railway builds must reproduce this pin or fail installation. A mismatch is never automatically accepted.

## Offline validation and scan gates

- Run `version`, top-level help, and help for every upstream command with networking disabled. Assert the ApplyPack rebuild identifier and command preservation.
- Use generated synthetic RSA and ECDSA keys/certificates to run read-certificate-data and sign-string; verify the produced signatures independently with OpenSSL or a separate standard-library verifier. Inspect upstream sign-string implementation first to verify its fixed message and formats. Do not call credential-process against AWS to obtain real credentials.
- Run relevant upstream offline tests with pinned dependencies. Hardware/TPM/PKCS#11 environment tests that require unavailable fixtures are separately reported; do not call an incomplete subset the complete upstream suite. Preserve features in the binary regardless.
- Run local helper/container self-tests with read-only root, non-root UID, a bounded tmpfs for synthetic keys, and no network. Synthetic private keys stay in temporary test storage and are not published as operational credentials.
- Scan the rebuilt binary with the already-pinned Trivy scanner and current locally downloaded database, networking and updates disabled. Require zero HIGH/CRITICAL findings, with no ignore list, waiver, reachability suppression, or removed metadata.
- Rebuild the full launch image, repeat non-root/read-only/no-network smoke tests and strict full-image scan, and refresh source-input manifests. A clean helper scan does not establish a clean web image.

## Licenses and provenance

Retain the upstream Apache-2.0 LICENSE and NOTICE with the distributed binary, identify ApplyPack's dependency/build modifications, include Go's license and linked dependency licenses/notices, and include a machine-readable dependency inventory. Preserve package attribution and source URLs. This is a software distribution provenance checklist, not a legal compliance certification.

## Remaining gates

The accepted pair is `authenticated-a` and `authenticated-b`, each built with `--no-cache`, separate clean source/module/object caches, identical 13 inputs, and unchanged 148 upstream application files. Each freshly authenticated 26 module ZIPs, matched all 24 external linked module h1 values against both authenticated and reviewed sums, preserved 38 license/notice/patent files, passed the three upstream offline command tests, and passed 22 independent helper checks under nonroot/read-only/network-none execution. Binary bytes match exactly. ELF evidence records PIE, `libc.so.6`, and `/lib64/ld-linux-x86-64.so.2`.

The authoritative Trivy 0.76.1 rootfs report is `helper-vulnerabilities.json`: it detected `aws_signing_helper` as a Go binary with 26 package entries and zero HIGH/CRITICAL findings against the pinned database snapshot. No ignore list or waiver was used. The initial filesystem-mode result detected zero files and is explicitly unaccepted, retained as `helper-scan-filesystem-unaccepted.json`; it is not clean-scan evidence. Earlier failed license-collection, test-assumption, and incomplete authentication candidates remain historical and are not the accepted build pair.

Final full-image scan/runtime compatibility, clean CI, hosted Roles Anywhere refresh/STS behavior, hardware-specific functionality, and human/device approval remain separate gates. No human or release approval is inferred from local success. The exact commands, artifact identities, hashes, prior failures, and limits are in `signing-helper-security-rebuild.json`.

## Primary references

- AWS release: https://github.com/aws/rolesanywhere-credential-helper/releases/tag/v1.8.5
- AWS pinned source: https://github.com/aws/rolesanywhere-credential-helper/tree/08f7df47e6da0b58c0e5960c41f5d3601042b1d2
- AWS build: https://raw.githubusercontent.com/aws/rolesanywhere-credential-helper/v1.8.5/Makefile
- AWS command reference: https://raw.githubusercontent.com/aws/rolesanywhere-credential-helper/v1.8.5/commands.md
- Go releases/support: https://go.dev/doc/devel/release
- Go compiler checksums: https://go.dev/dl/?mode=json
- Official builder source: https://raw.githubusercontent.com/docker-library/golang/650cf2f338d22da87df8c773cfc88afa26699502/1.26/bookworm/Dockerfile
- x/net graph: https://raw.githubusercontent.com/golang/net/v0.60.0/go.mod
- Go module authentication: https://go.dev/ref/mod#authenticating
- Advisories: https://pkg.go.dev/vuln/GO-2026-6303 ; https://pkg.go.dev/vuln/GO-2026-6611 ; https://pkg.go.dev/vuln/GO-2026-6809 ; https://pkg.go.dev/vuln/GO-2026-6609 ; https://pkg.go.dev/vuln/GO-2026-6607

> Historical design and research snapshot. The implemented local package and strict zero-High/Critical image proof are now recorded in `LAUNCH_IMAGE_VALIDATION.md` and `launch-image-results.json`. This proposal alone is not a current release approval.

# Read-only image remediation research

Observed 2026-10-23. The current image remains blocked by the retained 75 High / 1 Critical findings in `launch-image-vulnerabilities.json`. This document proposes remediation; it is not a successful replacement build, waiver, deployment approval or evidence of zero findings. No application source, dependency lockfile or image was changed during this research.

## Bundled npm

All eleven Node findings are under `usr/local/lib/node_modules/npm`; the scan detected 115 application packages and reported none under `app/node_modules`. Both launch configurations run Node scripts directly (`scripts/start-production.mjs` and `scripts/run-maintenance-once.mjs`). The smallest runtime correction is to retain npm in the application builder and omit npm/Yarn from the final runtime. This is an explicitly documented [official Node Docker multi-stage pattern](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md#smaller-images-without-npmyarn), not removal of package manifests or suppression of findings. The remaining application manifests and operating-system metadata must remain available to scanning.

| Bundled package | Installed | Advisory IDs | Scanner fixed-version choices |
| --- | --- | --- | --- |
| brace-expansion | 2.0.2 | CVE-2026-102276, CVE-2026-102278, CVE-2026-13149, CVE-2026-14257, CVE-2026-69152 | 2.1.6 or 5.0.11 satisfies the highest listed fix on those branches |
| http-cache-semantics | 4.2.0 | CVE-2026-93748 | No fix listed by this scanner database |
| ip-address | 10.1.0 | CVE-2026-69192 | 10.3.1 |
| pacote | 19.0.2 and 20.0.1 | CVE-2026-9496 | 21.5.1 |
| picomatch | 4.0.3 | CVE-2026-33671 | 4.0.4, 3.0.2 or 2.3.2 |
| sigstore | 3.1.0 | CVE-2026-48815 | 4.1.1 |

For comparison, official [npm 12.2.1](https://github.com/npm/cli/releases/tag/v12.2.1) includes http-cache-semantics 4.3.0, ip-address 10.7.2 and brace-expansion 5.0.12. Its [package manifest](https://raw.githubusercontent.com/npm/cli/v12.2.1/package.json) supports Node 22.22.2 and later on the 22 branch. Upgrading a runtime package manager that neither launch command uses is unnecessary if the final image omits it. No application dependency override is indicated by these eleven findings.

## Debian candidate comparison

Official `node:22-trixie-slim` currently uses Node 22.23.4. Its read-only registry result identifies linux/amd64 manifest `sha256:93c4ef18bd9f668c013e8800677f6709fe426db3f29fe758d34dd72600018a7e` and index `sha256:8eb619e402eaede1748a3c8173bffab391592812e85136452f781741c7242ddf`. The corresponding [official source](https://raw.githubusercontent.com/nodejs/docker-node/main/22/trixie-slim/Dockerfile) retains glibc and the Node 22 major version. This candidate has not been pulled, built or scanned here.

A plain Trixie replacement does **not** establish the strict zero-finding gate. Debian's current primary tracker reports:

| Observed advisory | Trixie status/version | Primary source |
| --- | --- | --- |
| CVE-2026-53613 | util-linux 2.41.5-0+deb13u1 fixed | [Debian tracker](https://security-tracker.debian.org/tracker/CVE-2026-53613) |
| CVE-2026-53615 | util-linux 2.41.5-0+deb13u1 fixed | [Debian tracker](https://security-tracker.debian.org/tracker/CVE-2026-53615) |
| CVE-2026-76642 | util-linux 2.41.5-0+deb13u1 vulnerable; fix listed only in unstable 2.42.3-1 | [Debian tracker](https://security-tracker.debian.org/tracker/CVE-2026-76642) |
| CVE-2026-78408 | util-linux 2.41.5-0+deb13u1 vulnerable; fix listed only in unstable 2.42.4-1 | [Debian tracker](https://security-tracker.debian.org/tracker/CVE-2026-78408) |
| CVE-2026-78409 | util-linux 2.41.5-0+deb13u1 vulnerable; fix listed only in unstable 2.42.3-1 | [Debian tracker](https://security-tracker.debian.org/tracker/CVE-2026-78409) |
| CVE-2026-78410 | util-linux 2.41.5-0+deb13u1 vulnerable; fix listed only in unstable 2.42.3-1 | [Debian tracker](https://security-tracker.debian.org/tracker/CVE-2026-78410) |
| CVE-2026-41992 | gzip 1.13-1+deb13u1 fixed | [Debian tracker](https://security-tracker.debian.org/tracker/CVE-2026-41992) |
| CVE-2026-54369 | acl 2.3.2-2 vulnerable; fix listed only in unstable 2.4.0-1 | [Debian tracker](https://security-tracker.debian.org/tracker/CVE-2026-54369) |
| CVE-2026-84782 | OpenSSL security 3.5.7-1~deb13u3 fixed | [Debian tracker](https://security-tracker.debian.org/tracker/CVE-2026-84782) |
| CVE-2026-16742 | systemd 257.13-1~deb13u1 vulnerable; fix listed only in unstable 261.2-1 | [Debian tracker](https://security-tracker.debian.org/tracker/CVE-2026-16742) |
| CVE-2025-69720 | ncurses 6.5+20250216-2 vulnerable; fix listed only in unstable 6.6+20251231-1 | [Debian tracker](https://security-tracker.debian.org/tracker/CVE-2025-69720) |
| CVE-2026-9538 | Perl 5.40.1-6+deb13u1 vulnerable; fix listed only in unstable 5.42.3-1 | [Debian tracker](https://security-tracker.debian.org/tracker/CVE-2026-9538) |
| CVE-2023-45853 | zlib 1:1.3.dfsg+really1.3.1-1 fixed | [Debian tracker](https://security-tracker.debian.org/tracker/CVE-2023-45853) |

The zlib tracker notes that Bookworm's vulnerable source does not build the affected contrib/minizip binary. That vendor qualification does not change or suppress the requested strict scanner result. Mixing unstable packages into a stable runtime is not proposed.

## Supported minimal runtime candidate

The maintained [distroless project](https://github.com/GoogleContainerTools/distroless) publishes `gcr.io/distroless/nodejs22-debian13:nonroot-amd64`. Read-only registry inspection returned:

- Manifest `sha256:eed5cbf9fcdb7f97de1fb39adde1972efa57df1085c0c76a5ea17c7c27ff8f6c`.
- Configuration `sha256:914858645274036e2349a5a2f9c7e4e459be1a36fa17f6bc4c081d2e244b8c80`.
- Annotation `com.google.distroless.nodejs.version=22.23.4`, linux/amd64.
- Entrypoint `/nodejs/bin/node`, default UID 65532, CA bundle `/etc/ssl/certs/ca-certificates.crt`; default PATH does not include `/nodejs/bin`.

Its declared [base](https://raw.githubusercontent.com/GoogleContainerTools/distroless/main/base/config.bzl), [C/C++](https://raw.githubusercontent.com/GoogleContainerTools/distroless/main/cc/config.bzl) and [Node](https://raw.githubusercontent.com/GoogleContainerTools/distroless/main/nodejs/config.bzl) package lists retain glibc, OpenSSL, zlib, libzstd and compiler runtime libraries while omitting the eight unresolved Trixie advisory sources above, shells and npm. The declaration is a reason to evaluate the actual image, not a claim that its resolved packages are vulnerability-free.

The concrete packaging candidate is to keep the existing application build stage, copy its production dependencies/application and the separately verified helper into this final runtime, preserve UID 1000 explicitly, make helper and every ancestor root-owned and non-writable to the application, and use absolute `/nodejs/bin/node` runtime commands or explicitly add that directory to PATH. Create writable Next cache directories in the build stage and copy only those with UID 1000 ownership. No package database, package manifest or operating-system identity may be removed to affect scanner output.

[Railway documents Docker image start commands as exec-form overrides](https://docs.railway.com/deployments/start-command), so the direct maintenance script needs no shell. No port expansion is needed in the command; the Node script reads its environment. Hosted Railway behavior remains to be proved. The hosted web image uses the remote AWS renderer and parser; it does not require a local LibreOffice/font stack. The current helper already executes on the Bookworm glibc runtime; compatibility with the candidate's glibc and retained libraries is still an inference until tested.

Before adopting the candidate, verify the distroless signature with its documented issuer/identity, retain the resolved image digest, test the actual helper executable and ancestor checks under UID 1000, test `/dev/shm`, execute both web and bounded maintenance startup paths without a shell, validate native Node dependencies, and rerun the same full offline vulnerability scan. Include metadata/package coverage checks. No candidate image has been executed by this research.

## AWS helper dependency remains separate

The installed official helper 1.8.5 has six High findings. AWS's [official download page](https://docs.aws.amazon.com/rolesanywhere/latest/userguide/credential-helper.html) and [latest release](https://github.com/aws/rolesanywhere-credential-helper/releases/tag/v1.8.5) still identify that version; no patched official release is established by this research. Its identity functionality must remain. The independent helper advisory review is evaluating an exact upstream source revision, supported patched Go toolchain and dependency-only patch with complete provenance if no official patched binary exists. A replacement runtime base alone cannot remove these helper findings.

All candidate changes require fresh source/image receipts, smoke tests and a passing zero-High/Critical scan. Existing failed evidence remains preserved.

## Implementation handoff design — source remains frozen

The helper reviewer owns a shared pinned build script, input manifest, dependency patch, licenses and standalone builder under `infra/aws/roles-anywhere-helper/`. `Dockerfile.launch` will invoke the same builder in its own `signing-helper-build` stage so a fresh Railway/CI build does not depend on an unpublished local image or binary. The interface is `/out/aws_signing_helper` with provenance and licenses. The final installer will read only that fixed copied artifact, verify the independently reproduced SHA-256 before execution, install at `/usr/local/bin/aws_signing_helper`, and fail on any mismatch. The runtime constant will pin that single output digest. The vulnerable official binary is not a fallback.

The final `web` stage will use the exact distroless manifest above, `USER 1000:1000`, `/app`, explicit `/nodejs/bin` PATH and an exec-form Node command. Its root-owned application/helper files and UID-owned Next cache will be copied with explicit ownership from builder stages. The helper parent chain and the complete public CA bundle must remain. The build context will allow only the new helper build inputs, alongside the existing source allowlist. The installer and integrity tests must reject stale or altered helper artifacts. Runtime checks must confirm Node 22.23.4, helper execution without credentials, trusted ancestors, tmpfs and package/OS metadata presence.

The smoke script will additionally exercise the actual maintenance CLI without configuration (expected sanitized failure before network access), and its exported runner with an injected synthetic response (successful parsing with no provider request). A tiny in-memory Sharp PNG conversion will exercise the shipped native module against the new libc. No shell, package installation or local document rendering is needed for those checks.

Cosign is not installed on this host. Official immutable [Cosign 3.1.4](https://github.com/sigstore/cosign/releases/tag/v3.1.4) asset metadata was read from GitHub before any download/execution: Linux amd64 SHA-256 `424e2c97d0b45fd7a6b608a87f090f35633f4c23ece5f092d48bba11aaf4bbfa`; Windows amd64 executable SHA-256 `cbe953787074611f1334cbf37dc1cf953995bb8c45398eb4fc7bb781d29c1f2a`. After verifying the selected tool checksum, verify the exact distroless manifest with issuer `https://accounts.google.com` and identity `keyless@distroless.iam.gserviceaccount.com`, retaining default claim, certificate and transparency checks. Pin the same verification in image CI. No unverified tool execution, skip-claim flag or skipped transparency check is planned.

The parent task owns the exclusive host unit run. Implementation and heavy validation wait for its handoff. The new helper and runtime each require independent review and complete fresh evidence; this design does not pre-approve a resulting artifact hash.

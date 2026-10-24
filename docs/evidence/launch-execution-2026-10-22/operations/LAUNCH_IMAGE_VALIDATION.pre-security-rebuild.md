# Local launch image validation

Current result: **build PASS; isolated production startup PASS; vulnerability gate FAILED**. This is an uncommitted local candidate, not a release, provider acceptance or approval to activate checkout.

The image `applypack-launch-web:local-review` has image identity `sha256:4def6e3d13b4d9ce80076ecfa660955384fd5e07e1a9e23d10b65cb400304fc4` and image configuration `sha256:31b623e82856960b1b0c2306e092aa45595b16f59e9e086bf441ca6be8de8ecd`. All 360 recorded build inputs matched before and after the build. Public staging placeholders supplied the build configuration; no application credentials were read. Earlier image receipts are retained with `pre-endpoint-fix` suffixes.

Startup ran as UID 1000 with a read-only root filesystem, no published ports and no network. The pinned signing helper, root-owned helper ancestry and ephemeral `/dev/shm` checks passed. `/api/live` and the homepage returned 200, staging noindex was present, and unconfigured readiness returned 503 with `acceptingOrders: false` and `sessionCreationConfigured: false`. The task container was removed.

## Offline scan result

Trivy 0.76.1 was verified against the official release archive SHA-256 `c7cbe3137fb8a48a17574bede3dd6beb16742d1e9772929940fc90082c39d9c0`; extracted binary SHA-256 is `d1dfca6ae10a1ad4540bb94e64f0510077c47008920a9b554986b39dca573d83`. The public vulnerability database was downloaded separately without application access. Its metadata reports update time `2026-10-23T01:18:09.482141619Z`; its SHA-256 is recorded in `launch-image-scan-status.json`.

The application image scan ran with network disabled, no Docker socket, UID 1000, a read-only root filesystem, telemetry and update checks disabled, an empty ignore file, and a ten-minute limit. It completed in about six minutes with exit code **1**, and the scanner container was removed. The archive SHA-256 is `568b656aa2a2a38af2f70b3687e1d287c0e3c2b8ba7a1a98699674565b2129e4`.

| Detected component | Packages detected | High findings | Critical findings |
| --- | ---: | ---: | ---: |
| Debian 12.15 | 91 | 58 | 1 |
| Node packages | 314 | 11 | 0 |
| AWS signing helper Go components | 26 | 6 | 0 |

These are **76 package/advisory pairs, 28 distinct advisory IDs and 29 affected package/version pairs**. All eleven Node findings are in the base image's bundled npm. The scan detected 115 application Node packages and reported no High/Critical findings under `app/node_modules`; this does not prove the absence of undiscovered vulnerabilities. Six findings affect the pinned official AWS helper. Fifty-nine affect Debian packages. Fixed-version metadata is present for sixteen findings; it is absent for sixty. No findings were ignored or waived.

The full scanner report is `launch-image-vulnerabilities.json`; the compact exact package paths, CVEs, installed/fixed versions and component counts are in `launch-image-findings-summary.json`. `launch-image-results.json` records the failed gate. **The image must not be treated as release-cleared.** Read-only remediation research is recorded separately; source remains frozen while the parent task runs its exclusive unit suite.

## Historical scanner transport restriction

Automatic approval review rejected Docker Scout before execution because it could send image-derived package metadata to an external service without authorization for that destination. `launch-image-scout-rejection.json` preserves that result. The replacement Trivy path completed without image upload or scanner network access. The failure above is the actual vulnerability result, not an approval or transport failure.

No image was pushed, no provider application call was made and no launch approval is inferred.

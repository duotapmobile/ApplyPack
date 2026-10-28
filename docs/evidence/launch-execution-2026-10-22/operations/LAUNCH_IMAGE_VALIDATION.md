# Local launch image validation

Current result: **PASS for the locally built, uncommitted image package.** This is not a target-configured release build, hosted acceptance, deployment or launch approval.

The final linux/amd64 image is `sha256:d9a489a347ce9b0518f9364cdfef3f0b363ad0352c0296ca407f8e8d85f02939`, config `sha256:6146c0557c83fc9c424b23d68dc750177eb458161c47e035fa546ef8fa3c6719`. It contains Node 22.23.4 and the independently reproduced ApplyPack helper 1.8.5+applypack.1, SHA-256 `6bc6af3a10ff0894a552a9a40c414436d0cb91e422262b10e85af61f619d9c9b`. Its immutable distroless Debian 13 base signature was verified with the exact certificate identity and issuer. The Dockerfile frontend, Node builder and Go builder are also pinned by digest.

All 376 complete allowlisted build inputs, including all 13 helper files and the Dockerfile-specific ignore control file, match before build, after build and after scan. The input inventory digest is `ee383c2319446accad22569af12597863920374c3d26f8d4c62f48f20da46045`; baseline Git HEAD alone does not identify these uncommitted bytes.

The 18 lightweight Node contracts passed with no failures or skips. The actual network-disabled Linux installer stage passed all 6 cases: altered bytes, symlink, writable input and alternate destination denied; exact artifact installed; overwrite denied. The final build reused that exact successful layer. Full Next build succeeded with build/runtime telemetry disabled.

The actual full-image smoke passed as UID 1000 with a read-only filesystem, tmpfs scratch, no network, no published ports and no credentials. It proved helper hash/root-owned ancestors and version, retained public CA/OS/helper provenance, absence of shell/package manager, native Sharp PNG processing, direct maintenance CLI rejection of missing configuration and synthetic injected maintenance-response handling. Liveness/homepage returned 200; staging remained noindex; unconfigured readiness returned 503 with both order acceptance and session creation false. The synthetic maintenance check is not a hosted cycle.

The exact image archive was analyzed with checksum-pinned Trivy 0.76.1 in a separate network-disabled, read-only, UID 1000 container, without a Docker socket, telemetry or database updates. The scan completed within the unchanged 10-minute bound, exit 0, with **zero HIGH and zero CRITICAL findings**, no ignored findings and no fixable-only filter. Required coverage validation passed: Debian 13.7, 14 OS packages; 116 Node packages including application dependencies; 26 compiled-helper Go packages. The prepared database timestamp/hash and complete findings are retained. Both test and scanner containers were removed and teardown verified.

## Evidence

- `launch-image-source-{before,after,final}.json`: complete unchanged input inventories.
- `launch-image-build.log`, `launch-image-identity.json`, `launch-image-smoke.log`: actual build, image identity and isolated runtime result.
- `launch-image-installer-contract.json`, `image-remediation-light-contracts-final.log`: installer 6 and Node 18 checks.
- `launch-image-vulnerabilities.json`, `launch-image-findings-summary.json`, `launch-image-scan-{status,coverage}.json`: full scan, strict result and required inventory proof.
- `launch-image-distroless-{signatures,verification}.json`, `launch-image-cosign-identity.json`: signed immutable base verification.
- `launch-image-final-receipt-hashes.json`: exact current receipt hashes.
- `image-remediation-source-delta.json`: precise post-801-unit-test source delta and remaining parent-owned validation.

## Preserved history and limits

The prior bookworm/official-helper image failed with 75 HIGH and 1 CRITICAL finding; all of its build/input/smoke/scan receipts remain under distinct `.pre-security-rebuild` names. No finding was waived. Docker Scout never executed after automatic review rejected possible metadata egress; the later offline Trivy path supplied actual local proof. The successful intermediate build that printed Next's default telemetry notice is separately preserved under `.pre-build-telemetry-disable`; the final build explicitly disables it. No application credentials were supplied to either build.

The source is uncommitted and the public build arguments are staging placeholders. Actual release configuration, exact committed candidate CI, hosted AWS identity/revocation, Railway web/maintenance behavior, protected/off-machine recovery and required human/hosted acceptance remain separate outstanding gates. The image was not pushed or deployed. Zero current High/Critical findings do not prove absence of all vulnerabilities; repeat the strict gate for the actual release candidate using the required current vulnerability data.

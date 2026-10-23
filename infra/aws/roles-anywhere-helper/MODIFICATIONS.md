# ApplyPack security rebuild of AWS IAM Roles Anywhere Credential Helper

This is an ApplyPack-built derivative, version `1.8.5+applypack.1`. It is not an AWS-published or AWS-signed binary.

Upstream: https://github.com/aws/rolesanywhere-credential-helper
Release: v1.8.5
Source commit: `08f7df47e6da0b58c0e5960c41f5d3601042b1d2`

Changes are limited to dependency versions/checksums and build metadata. All upstream application source is unchanged. Build with supported Go 1.26.10; retain the upstream CGO-enabled PIE, external-link, trimpath, and stripped-debug release flags. Set the existing cmd.Version linker variable to the ApplyPack identifier. Disable implicit toolchain downloads and VCS-dependent build metadata.

Updated dependencies: golang.org/x/crypto v0.57.0, golang.org/x/net v0.60.0, golang.org/x/sys v0.48.0, golang.org/x/term v0.46.0, and golang.org/x/text v0.42.0 through the selected graph. All unrelated module selections are retained.

These updates address CVE-2026-56854, CVE-2026-78669, CVE-2026-111943, CVE-2026-78667, and CVE-2026-97031. Actual scan evidence must be retained for the exact distributed binary and full application image; this notice is not a clean-scan assertion.

The source archive is pinned by full upstream commit and SHA-256. Its GitHub commit signature is not verified. Do not describe the archive or this binary as cryptographically signed by AWS. Module verification uses Go's authenticated checksum database and the reviewed go.sum.

AWS's original Apache-2.0 LICENSE and NOTICE are preserved alongside this notice, the Go license, and module licenses/notices. No AWS trademark ownership or endorsement is claimed.

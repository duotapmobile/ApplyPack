# PostgreSQL recovery image inputs

The shipping default is `database-recovery`, a client-only image based on the same pinned distroless Debian13 Node runtime as the web image. `database-recovery-fixture` is explicitly test-only. It contains the full PostgreSQL server and must never be deployed.

The previous full-server worker at source `eaddb590384fe3a6c3e558addf2819236e072586` passed the real synthetic snapshot/restore test but failed [image run 40228250532](https://github.com/duotapmobile/ApplyPack/actions/runs/40228250532). Its report contained 62 HIGH Debian package findings plus 25 HIGH and one CRITICAL finding in unused gosu (Go1.24.6). Trivy reported no fixed versions for those Debian entries. Removing only gosu would not have resolved that gate. The report is preserved in the run's `database-recovery-image-local-contracts` artifact.

This replacement changes shipped contents, not the vulnerability threshold. It builds unmodified PostgreSQL17.11 clients/libpq without readline, ICU, LDAP, Kerberos or XML support. TLS/OpenSSL and zlib compression remain required. It installs actual local Debian packages with source/version/file inventory and preserves the base image's library metadata. The scan must detect PostgreSQL clients, libpq, libc, OpenSSL, zlib, application Node packages and the signing helper, with zero HIGH or CRITICAL findings.

Inputs and source evidence:

- [Official PostgreSQL17.11 source archive](https://ftp.postgresql.org/pub/source/v17.11/postgresql-17.11.tar.bz2) and [official SHA-256](https://ftp.postgresql.org/pub/source/v17.11/postgresql-17.11.tar.bz2.sha256). The downloaded archive was independently checked locally against `dd27f2b3c59e73ed14aa3324901242bf69a032a6347805f274e6260322d42979`.
- [PostgreSQL build options](https://www.postgresql.org/docs/17/install-make.html) and [requirements](https://www.postgresql.org/docs/17/install-requirements.html). The actual verified archive was inspected for configure flags, `HAVE_LIBREADLINE`, `HAVE_LIBZ`, `USE_OPENSSL`, `USE_ICU` and linked-library rules.
- [Distroless base package definitions](https://github.com/GoogleContainerTools/distroless/blob/main/base/config.bzl). The installed runtime is pinned by digest in `client-build-inputs.env`, rather than following that mutable branch.
- Upstream copyright and client/support source notices remain inside the runtime. Compiler versions, source paths, configure/compile logs, built packages and installed hashes are exportable through the `database-recovery-build-evidence` target.

The build emits `/opt/applypack/database-recovery-runtime.json` with actual compiled client hashes. Capture and bind its canonical digest in the reviewed target registry for the exact candidate image. No registry registration, hosted execution or deployment is performed by this build.

Local Docker is unavailable on this host. Shell/JavaScript syntax, executable runtime guards, scanner coverage and container-orchestration tests are local evidence only. The new image build, real roundtrip and HIGH/CRITICAL scan remain mandatory CI gates. The fixture checks exact shipping client/libpq/manifest parity before testing the snapshot.

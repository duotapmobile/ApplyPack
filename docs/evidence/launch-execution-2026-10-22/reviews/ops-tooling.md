# Independent local operations tooling review

Reviewed October 23, 2026 by the database agent, which did not author these tooling files. Baseline HEAD: `a3de4a447d499fb7d416e1a1d167e281372903b2`; branch `codex/manual-launch-hardening-2026-10-02`. Hashes below identify uncommitted reviewed bytes, not a released candidate. No hosted endpoint, credential, migration, deployment or provider mutation was used for this review.

Verdict: no concrete unresolved P0/P1 found in this bounded source review. **NOT READY for hosted execution or public activation.** This review does not approve a production target, validate actual backup recovery, or replace either required supervisor review.

## Controls verified in source

- The new production target registry is empty. The production entrypoints require a SHA-256-bound manifest and a matching independently reviewed registry identity before reading production credentials or contacting a database. They reject the staging project, wrong environment, unexpected project/host/port/login/database/CA, malformed full release SHA and migration/ledger hashes. Required environment mode flags are locked. The operation authorization binds the exact operation, project, release and manifest digest.
- Production forward migration checks a clean committed source and source hashes, exact observed predecessor ledger including statement counts/digests, readiness checkpoint, no invalid indexes, pinned Docker/Postgres identity, CA bytes and `verify-full`. The missing reviewed sequence 081–085 is derived from the manifest predecessor 080–084. Each migration records its source and ledger row within its transaction, followed by postflight verification. A failure after a mutation may have committed yields `PRODUCTION_DATABASE_ADVANCEMENT_REQUIRES_INSPECTION`; it cannot be reported as a clean failure or automatically rerun.
- The forward entrypoint requires a recent backup receipt and isolated restore receipt bound to the manifest, full release, envelope, predecessor schema, aggregate row digest and verified teardown. Protected recovery, off-machine recovery, private-object recovery, quiescence, RTO/RPO and rollback/forward-recovery references are required by the manifest. Their external truth still requires review; presence of a reference is not recovery proof.
- The production backup/restore adapter uses authenticated encrypted streaming, bounded output/regular-file protections, exact source ledger/readiness, pinned Postgres tools and isolated restore with network `none`, no published port and teardown verification. It keeps database structural restoration separate from private objects, keys, authentication, email and actual customer access.
- The separate staging safeguard requires schema 084 and all four 081–084 ledger entries. The new staging migration runner requires the exact staged project/host/CA, source-bound 081–084 predecessor statements, exact 084 checkpoint, explicit 085 execution scope and matching recovery receipts. It retains the prior 080 tools as historical procedures rather than broadening their identity gates.

## Validation quality and findings

The pure guard test exercises malformed identity/manifest/ledger/recovery cases and denial of a fictional target by the real empty registry. The adapter SelfTest cases cover environment scrubbing, synthetic credential handoff, output handling, envelope authentication and evidence parsing. These do not independently prove database recovery.

The separate `test-isolated-database-recovery.ps1` closes that important test gap: it loads the actual production adapter in SelfTest mode, runs a pinned network-isolated Postgres fixture, and calls the real encrypted backup stream and decrypt-to-`pg_restore` path. It compares two synthetic rows, RLS/policy, trigger and index validity and verifies teardown. Source inspection confirms it does not override the production target registry or read production credentials. The execution receipt is owned by the operations agent/root; this reviewer did not rerun it.

Resolved receipt-label defect: production migration receipts previously hardcoded `endpointType` as `session-pooler` even for an approved direct host. The reviewer independently read the shared `Get-ProductionDatabaseEndpointType` classifier, both backup/forward receipt callers and their test assertions. The classifier requires the exact direct host/project and `postgres` login, or a session pooler with `postgres.<projectRef>`, and rejects drift. It supplies metadata only; the full manifest, empty trusted registry, source/CA hashes and scoped operation authorization remain mandatory before any hosted action. The pure guard fixture covers both classifications and direct-host/login negatives, and the forward SelfTest uses the same classifier. The locally inspected final guard receipt reports 30 checks, zero provider calls and no production credentials. The refreshed `operations/selftest-receipts-final.json` (SHA-256 `861cfc4a9fcf498e7c515a12fad4e6da381fdad0cb4fc44327ff9ef6670e8917`) binds the corrected c995 migration. All four command exit codes are zero, and their actual source/log hashes match. This is local guard/adapter evidence, not hosted recovery proof or independent certification of this reviewer's SQL.

No production identity has been admitted to the registry. No actual production inventory/backup, off-machine restore, private-object retrieval, key recovery or customer access was observed. No final committed candidate or compatible rollback SHA is certified here. A claimed production recovery success must supply those distinct receipts and acceptance evidence.

## Reviewed SHA-256

| File | SHA-256 |
| --- | --- |
| `scripts/lib/ProductionDatabaseGuard.ps1` | `4cffd6f193c85fefdc6e06e313f33f7bfc7ec4d865f46e7dc9004ddfaf57eba0` |
| `scripts/apply-production-forward-migrations.ps1` | `8c8a6c2095a7e72f256419ceeaa6f24aa8b8303636915150248540a6743cd355` |
| `scripts/production-database-safeguard.ps1` | `91ca907a89269cba0ddc8fc86ad84241628c36af50e32e6dee9d94246384a5e6` |
| `scripts/staging-schema084-database-safeguard.ps1` | `4398e4eeeed5df436aaf9c220d0fa4b67835b6600e56f36441d8f6dc8f0e7e6c` |
| `scripts/apply-staging-rehearsal-migration.ps1` | `f4f5c0e0e6b144751f55aa0566546d67dfac4f8f352031f7900ae4bcadc1c0f6` |
| `scripts/test-production-database-guard.ps1` | `ff341c612eb2ce65f05cdcd71009a7fe817baae5baab894da39ea5a2b1615101` |
| `scripts/test-isolated-database-recovery.ps1` | `d4712431959c619b5aa4414cd37a348692dc5c3ab453f01c7d352d8dc240b989` |
| `docs/launch/production-database-targets.json` | `64c773c5bd61f93e3bc052ed3d8e856368742a417d9a2020efc4183bfd9ff631` |

Changes to reviewed bytes require delta review. Later edits to migration 085 also require fresh source hashes and validation in any execution manifest.

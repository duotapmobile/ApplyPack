# Launch database operations

The October 22 launch plan adds separate schema-084 recovery and migration-085 paths. The schema-080 safeguard and 081–084 staging migration runner remain unchanged. These tools do not grant provider permission, prove recovery, or change launch status. Execute only from a reviewed committed candidate in the canonical checkout. Keep writers quiesced throughout backup, restore verification, migration and postflight; preserve inbound webhook events for reconciliation.

## Local validation

Use PowerShell 7 on Windows. Synthetic tests never load provider credentials:

```powershell
pwsh -NoProfile -File scripts/test-production-database-guard.ps1
pwsh -NoProfile -File scripts/staging-schema084-database-safeguard.ps1 -Mode SelfTest
pwsh -NoProfile -File scripts/apply-staging-rehearsal-migration.ps1 -Mode SelfTest
pwsh -NoProfile -File scripts/production-database-safeguard.ps1 -Mode SelfTest
pwsh -NoProfile -File scripts/apply-production-forward-migrations.ps1 -Mode SelfTest
pwsh -NoProfile -File scripts/test-isolated-database-recovery.ps1
```

The last test requires Docker Desktop's Linux engine and the locally present image `public.ecr.aws/supabase/postgres@sha256:b3bfedb107413abb3b8cb0d0874b0414a1dceb3d55bc0c778de6ad22d1f7dc86`. It uses a new container, network `none`, no published ports, disposable tmpfs, synthetic rows, and the actual encrypted streaming adapter. It proves structural engine recovery, never customer access or off-machine recovery. No image pull is performed.

## Candidate CI recovery strategy

The database CI job runs `node scripts/check-launch-recovery-strategy.mjs`. Missing `AP_RECOVERY_STRATEGY` selects the existing strict `TESTED_COMPATIBLE_SHA` path. It requires a full distinct `AP_ROLLBACK_TARGET_SHA` and executes the unchanged application compatibility checks followed by the isolated SQL rollback/reset checks. `npm.cmd run test:rollback` retains this strict behavior; it never automatically falls back to forward recovery. The shared SQL checks live in `scripts/lib/supabase-structural-recovery.mjs`, preserve every latest-schema restore invariant, and remain mandatory for either accepted strategy. Reset/restore failures are fatal. These SQL checks are a disposable local schema exercise, not encrypted backup restoration or protected application recovery.

The alternative `LOCKED_FORWARD_RECOVERY` path requires an explicitly reviewed, candidate-bound plan supplied through controlled GitHub configuration. Configure these three repository variables: `AP_RECOVERY_STRATEGY`, `AP_FORWARD_RECOVERY_PLAN_JSON`, and `AP_FORWARD_RECOVERY_PLAN_SHA256`. The workflow maps them from `vars.*`; that context can also resolve organization-level configuration when a repository-level value is absent, so the code does not establish which configuration level supplied a value. Review that configuration and the workflow together. The gate does not accept a plan path, URL download, checked-out PR document, dispatch input, or skip flag. Clear `AP_ROLLBACK_TARGET_SHA` when choosing forward recovery; any mixed strategy inputs fail. Unset, malformed, expired, mismatched, or unknown plan fields fail before any database command.

Repository variables are configuration statements, not signatures or independent evidence of human identity. GitHub collaborators with repository write access can manage repository variables; maintain controlled configuration and review the exact candidate/workflow plus the approved variable values. See [GitHub variable access and creation](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-variables). Variables are not masked secrets; include only sanitized plan data. The gate never logs the full plan, names, or reference contents, and never retrieves referenced URLs. It cannot prove a reviewer approved a link or that hosted recovery happened merely because a variable says so.

After the source is reviewed and committed, from the clean canonical checkout run:

```powershell
node scripts/check-launch-recovery-strategy.mjs --describe
```

This read-only command requires the canonical HTTPS remote (with or without the terminal `.git`, accommodating `actions/checkout`), clean tracked files, and no nonignored untracked files. It reports the actual full `HEAD`, schema version, exact `launch-schema.ts` byte hash, and migration-set digest; it does not establish approval or recovery. The migration digest is SHA-256 of compact `JSON.stringify` over the lexically ordered array of `{path,sha256}` for every migration SQL file, with exact file-byte hashes and repository-relative forward-slash paths. Compute it in the candidate's CI checkout byte format. Ignored generated outputs are permitted; source changes are not. Do not commit the candidate's own SHA back into its source. A separate approver reviews the sanitized plan outside that candidate; an authorized operator then sets the three repository variables after approval. This implementation does not set them or supply an approval.

`AP_FORWARD_RECOVERY_PLAN_JSON` must be the exact compact, single-line `JSON.stringify` encoding of an object with precisely these fields. `AP_FORWARD_RECOVERY_PLAN_SHA256` is the lowercase SHA-256 of those received UTF-8 bytes, without a trailing newline. Duplicate keys, extra fields, and a differently encoded JSON string are rejected.

| Field | Required binding |
| --- | --- |
| `version`, `strategy`, `status` | `1`, `LOCKED_FORWARD_RECOVERY`, `REVIEWED` |
| `repository`, `ref` | `duotapmobile/ApplyPack` and the exact reviewed `refs/heads/main` or `refs/heads/codex/manual-launch-hardening-2026-10-02` |
| `candidateSha`, `schemaVersion`, `launchSchemaSha256`, `migrationSetSha256` | Actual clean tested candidate and describe-command values; schema must be `202610220085` |
| `reviewedBy` | Actual human full name, not an unassigned role, placeholder, fixture, or bot |
| `approvalReference`, `riskAcceptanceReference` | Specific comment/review permalinks in the canonical repository: `https://github.com/duotapmobile/ApplyPack/issues/<number>#issuecomment-<id>` or a pull request comment/review permalink. Referenced content is not fetched, authenticated, or made immutable by the link. |
| `reviewedAt`, `expiresAt` | Exact UTC ISO timestamps with milliseconds; review is not in the future, expiry is still future, and validity lasts at most seven days |
| `acceptedRecoveryTimeMinutes`, `acceptedDataLossMinutes` | Explicitly accepted safe integers; RTO is positive and data loss is nonnegative |
| `protectedRecoveryPlan` | Exact object described below; these are required planned gates, never completed-proof claims |

`protectedRecoveryPlan` contains `reference` (an actual canonical repository comment/review permalink), these six exact `true` flags: `requiredBeforeHostedMigration`, `applicationCheckoutLocked`, `outboundMailDisabled`, `livePaymentsDisabled`, `externalCallbacksDisabled`, `scheduledWritersDisabled`; and `checks`, exactly this ordered array: `databaseRows`, `privateObjectsAndVersions`, `applicationEnvelopeKeys`, `protectedConfiguration`, `authenticationDependencies`, `ownerAccess`, `validDocumentDownload`, `wrongUserDenial`, `keyAccess`, `offMachineRecovery`, `operatorCredentialLossRecovery`, `retentionAndDeletion`. Review the concrete procedure, ownership, and numeric risk acceptance behind the references before configuring variables. No example fixture is an accepted plan.

Operational forward acceptance additionally requires GitHub Actions identity for this repository, a `push` or `workflow_dispatch` on the reviewed allowed branch, and `GITHUB_SHA` equal to actual clean `git rev-parse HEAD`. A pull-request synthetic merge run is explicitly rejected for forward recovery; test the reviewed committed candidate via push/manual execution instead. Local environment strings and pure unit fixtures do not establish trusted configuration or real approval. Requiring the exact tested candidate avoids mistaking a PR head for a synthetic merge commit. A source/schema/ref change requires a new reviewed plan and digest.

Success means only that CI accepted the reviewed plan's configured bindings and its mandatory structural SQL test passed. It never reports that application rollback was tested on the forward path. Actual protected recovery, private objects/versions, envelope keys, auth, owner/download/wrong-user checks, off-machine and operator-loss recovery, and retention obligations remain separate mandatory gates before hosted migration or release. They are not prerequisites for constructing this pre-staging CI plan, and passing this plan cannot waive them.

## Staging 084 to 085

Read the actual hosted ledger first. Only schema `202610190084`, ready under its own contract, qualifies. The runner verifies exact 077–080 ledger statement digests and exact published 081–084 source statements. It rejects already-applied 085, missing predecessors, invalid indexes, wrong host/project/CA, wrong credential identity, dirty required source and output paths inside any Git checkout. The new migration is `202610220085_staging_rehearsal_checkout_attempts.sql`; do not reuse prior 081–084 approval.

Set the existing `AP_PREMIGRATION_EXPECTED_*` bindings to staging project `fmugizadzdnqfckujqlw`, session pooler `aws-0-us-west-2.pooler.supabase.com`, port `5432`, database/current user `postgres`, login `postgres.fmugizadzdnqfckujqlw`, and the exact reviewed full release SHA. Set `AP_DEPLOYMENT_ENV=staging`. Set all six `APP_CHECKOUT_ENABLED`, `APP_CANARY_CHECKOUT_ENABLED`, `APP_REHEARSAL_CHECKOUT_ENABLED`, `APP_LIVE_PAYMENTS_ENABLED`, `APP_JOB_BOARD_CHECKOUT_ENABLED`, and `APP_JOB_SOURCE_SYNC_ENABLED` values to exact lowercase `false`. Credentials stay in Windows Credential Manager under `ApplyPack/Supabase/Staging/Database`; never pass a password or connection URL in arguments or environment.

After scoped approval, using absolute private paths outside Git:

```powershell
pwsh -NoProfile -File scripts/staging-schema084-database-safeguard.ps1 -Mode Backup -BackupPath $apBackup -ReceiptPath $apBackupReceipt -CaCertificatePath $apCa
pwsh -NoProfile -File scripts/staging-schema084-database-safeguard.ps1 -Mode Restore -BackupPath $apBackup -ReceiptPath $apRestoreReceipt
```

The CA file must match SHA-256 `700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7`. Capture the approved migration's exact byte SHA-256, not a draft value. Set `AP_REHEARSAL_MIGRATION_AUTHORIZATION` to `apply085:<staging-project>:<full-release-sha>:<lowercase-migration-sha256>` and `AP_WRITERS_QUIESCED_REFERENCE` to the approved stop/checkpoint receipt. These markers record already-granted approval; setting a marker is not approval.

```powershell
pwsh -NoProfile -File scripts/apply-staging-rehearsal-migration.ps1 -Mode Apply -ExpectedMigrationSha256 $apMigrationSha256 -BackupReceiptPath $apBackupReceipt -RestoreReceiptPath $apRestoreReceipt -ReceiptPath $apMigrationReceipt -CaCertificatePath $apCa
```

The paired recovery receipts must identify the same encrypted envelope, exact candidate and schema, matching row-count digest, an isolated restore with teardown, and a backup no older than 24 hours. Quiescence and object/key recovery evidence still need operator review. Windows line-ending differences in published predecessor statements are normalized only from CRLF to LF for the historical ledger comparison; the new migration's approved byte hash remains exact.

## Production review and target registration

Production entrypoints never accept a staging target or generic connection URL. `docs/launch/production-database-targets.json` initially has no trusted targets. A separate reviewed commit must register the provider-verified production tuple: environment `production`, exact project reference, host, port 5432, CA SHA-256, and credential target `ApplyPack/Supabase/Production/Database`. The tooling cannot register itself or infer production from an arbitrary non-staging project. No production identity was verified by this implementation.

Prepare a private JSON manifest with `version: 1`, that exact identity tuple, `database/currentUser: postgres`, full `releaseSha`, observed `expectedSchemaVersion` (080–084 only), `postSchemaVersion: 202610220085`, and a complete ordered `expectedLedger`. `loginUser` must be `postgres` for the exact direct host `db.<project>.supabase.co`, or `postgres.<project>` for the registered session pooler. Both use port 5432; transaction pooling is rejected. This follows the [Supabase direct/session connection contracts](https://supabase.com/docs/guides/database/connecting-to-postgres). Each ledger entry has `version`, `name`, `statementCount`, and `statementsDigest`: SHA-256 of PostgreSQL `array_to_json(statements)::text` encoded as UTF-8. `expectedLedgerSha256` hashes the ordered lines `version:name:statementCount:statementsDigest` joined by LF with no final LF. No migration repair or assumption about prior hosted state is allowed.

`migrations` contains exactly the missing forward steps through 085, in order. Each entry has `version`, `name`, exact repository-relative `relativePath`, exact byte `sha256`, `checkpoint`, `predecessor`, and `predecessorCheckpoint`. Checkpoint names are the published names from the SQL. Include `quiescenceReference`, `protectedRecoveryReference`, `offMachineRecoveryReference`, `privateObjectsBackupReference`, numeric `acceptedRecoveryTimeMinutes` and `acceptedDataLossMinutes`, and `recoveryStrategy` (`TESTED_COMPATIBLE_SHA` with a tested full `rollbackSha`, or `LOCKED_FORWARD_RECOVERY`). References identify separately reviewed evidence; they are not generated proof.

Use `scripts/inspect-production-database-plan.ps1 -ManifestPath <private-json> -ExpectedManifestSha256 <exact-lowercase-hash>` for local read-only validation. It does not use credentials or authorize mutations. Review its exact tuple and migrations, then obtain scoped approval for each operation. Set all six lock variables false, `AP_DEPLOYMENT_ENV=production`, the exact `AP_PREMIGRATION_EXPECTED_*` bindings, and `AP_PRODUCTION_DATABASE_AUTHORIZATION=<backup|restore|apply>:<project>:<release-sha>:<manifest-sha256>` for that operation only.

```powershell
pwsh -NoProfile -File scripts/production-database-safeguard.ps1 -Mode Backup -ApprovedManifestPath $apManifest -ApprovedManifestSha256 $apManifestSha256 -BackupPath $apBackup -ReceiptPath $apBackupReceipt -CaCertificatePath $apCa
pwsh -NoProfile -File scripts/production-database-safeguard.ps1 -Mode Restore -ApprovedManifestPath $apManifest -ApprovedManifestSha256 $apManifestSha256 -BackupPath $apBackup -ReceiptPath $apRestoreReceipt
pwsh -NoProfile -File scripts/apply-production-forward-migrations.ps1 -Mode Apply -ApprovedManifestPath $apManifest -ApprovedManifestSha256 $apManifestSha256 -BackupReceiptPath $apBackupReceipt -RestoreReceiptPath $apRestoreReceipt -ReceiptPath $apMigrationReceipt -CaCertificatePath $apCa
```

The production runner uses only the dedicated production credential target, the exact local Docker Desktop named pipe and pinned database image, TLS `verify-full`, secret-first stdin handoff, bounded psql execution, an exact predecessor ledger and atomic migration/ledger transaction. It records a missing receipt or lost connection after mutation starts as an unknown outcome requiring read-only inspection. Never rerun blindly. Keep the failed operation's sanitized code and inspect ledger/checkpoints before creating a new state-specific plan.

## Recovery scope and stop conditions

The encrypted envelope is DPAPI CurrentUser protected. Its original machine/operator dependency means it is insufficient as the only production backup. Prove a separately protected, authorized recovery route that survives loss of either before approving a production operation. These tools deliberately do not weaken DPAPI or export its key. Obtain and prove an independently recoverable private object/version/hash backup, envelope-key recovery, protected configuration and authentication dependencies. Supabase database dumps include Storage metadata, not the stored file bytes. Do not confuse the structural restore (which omits restored ownership/grants) with a protected full application recovery environment.

The protected environment must disable outbound mail, live payments, external callbacks and all scheduled writers, and prove owner access, valid download, wrong-owner denial and key access. Record age/completeness, measured duration, accepted RTO/RPO, deletion/retention obligations, and recovery-operator ownership. Until these pass, recovery and launch remain blocked even if every local engine test passes.

Any identity/hash/ledger/receipt mismatch, unrecognized predecessor, restore mismatch, cleanup failure, missing approval, or unknown migration outcome stops work. Preserve paid obligations, webhook events and encrypted artifacts. Never reverse published migrations, repurpose customer KMS keys, or erase paid history.

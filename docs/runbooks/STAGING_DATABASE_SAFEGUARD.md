# Staging database encrypted backup and isolated restore

## Purpose and boundary

Use `scripts/staging-database-safeguard.ps1` to create the governed pre-migration staging backup and to prove that the encrypted backup can be restored into a disposable local container. The helper is Windows-only and supports the staging Supabase project reference `fmugizadzdnqfckujqlw` only.

This helper does **not** apply migrations. It expects the source database to be at schema `202610040080` with migrations 081 through 084 absent. Applying migrations 081 through 084 remains a separately reviewed forward-only operation after the backup and restore evidence passes. The helper has no production binding and rejects `AP_DEPLOYMENT_ENV=production`.

The implementation provides these controls:

- Reads exactly the Windows Generic Credential Manager target `ApplyPack/Supabase/Staging/Database` with `CredReadW`. It does not enumerate credentials.
- Keeps the password in memory, encodes it into an explicit temporary byte buffer, passes that buffer to the database client over standard input, and clears managed and unmanaged buffers best-effort. It does not use a buffered text writer and never logs or persists the password or a database URI.
- Pins the staging project reference, session-pooler endpoint, port, database, tenant-qualified login, connected `current_user`, provider CA hash, PostgreSQL 17.6 client image, and image digest.
- Forces libpq `verify-full` with the reviewed provider CA.
- Streams `pg_dump --format=custom` directly into an authenticated encrypted envelope. No plaintext dump is written to disk.
- Protects a random per-backup 64-byte data key with Windows DPAPI `CurrentUser`. The envelope uses AES-256-CBC plus HMAC-SHA-256 encrypt-then-MAC. Restore authenticates the complete envelope before releasing plaintext.
- Writes only to an explicit existing directory outside every Git worktree, rejects reparse-point ancestors, holds a non-delete-sharing directory identity handle throughout each write, validates the opened file handle as a direct child before and after publication, creates the ciphertext as a same-directory partial file, flushes it, and atomically renames it. Failure cleanup deletes the verified partial by handle.
- On every backup-stream, encryption, output, flush, or process failure, terminates the complete child process tree, waits for exit, drains redirected streams, disposes handles, clears credential buffers, removes the named source container, and independently verifies its absence before returning.
- Opens the encrypted restore source once with `FileShare.None` and keeps that handle through metadata authentication, archive-list validation, and restore. A second valid CurrentUser envelope cannot replace the authenticated bytes between phases.
- Restores only into the pinned PostgreSQL 17.6 container with `--network none`, no published ports, and a temporary in-memory data directory. The container is removed and absence is verified before a success receipt is written. A primary restore error remains primary if teardown also fails; the controlled cleanup code is attached separately.
- Records sanitized counts, a deterministic SHA-256 over sorted per-public-table row counts, tool versions, image identity, release SHA, RLS/schema/ledger integrity, and teardown evidence. It records no row contents, identifiers, URLs, document data, password, or connection URI.

The encrypted file is bound to the Windows user profile that created it. A different Windows user cannot decrypt it. Preserve the Windows profile and test recovery under the same operator account. DPAPI `CurrentUser` does **not** protect against malware, an attacker already running as that same Windows user, a compromised interactive session, or an administrator able to act as that user. Run this workflow only from a clean, patched operator machine; lock the session when unattended; restrict the evidence directory ACL; and move the encrypted evidence to controlled offline storage after verification. DPAPI is an operator-machine safeguard, not a replacement for the provider's retained backups.

## Prerequisites

Stop if any prerequisite is missing:

1. Work from the exact reviewed commit on `codex/manual-launch-hardening-2026-10-02` after the required supervisor reviews pass.
2. Keep `APP_CHECKOUT_ENABLED=false` and `APP_CANARY_CHECKOUT_ENABLED=false`.
3. Quiesce every staging web, admin, maintenance, and direct-service writer. Keep them quiesced until migrations 081 through 084 and the post-migration readiness verification are complete.
4. In Windows Credential Manager, create or update one **Generic credential**:
   - Internet or network address: `ApplyPack/Supabase/Staging/Database`
   - User name: `postgres.fmugizadzdnqfckujqlw`
   - Password: the current staging database password
5. Never paste the password into PowerShell, a command argument, an environment variable, chat, Git, or an evidence file. If authentication fails, reset the staging database password in Supabase and update only that Generic credential through the Windows Credential Manager UI.
6. Retain the reviewed provider CA file. Its required SHA-256 is `700723581420DD1AC98FD7E9AC529F0EF210EADCAF87FC868A3AD7D114C2F3B7`.
7. Docker Desktop must be running and the pinned image must already exist locally:

   ```text
   public.ecr.aws/supabase/postgres:17.6.1.166
   public.ecr.aws/supabase/postgres@sha256:b3bfedb107413abb3b8cb0d0874b0414a1dceb3d55bc0c778de6ad22d1f7dc86
   ```

8. Create a dedicated, ordinary directory that is not inside this repository, any other Git worktree, OneDrive reparse paths, or a synced folder. The examples use `C:\ApplyPack-Staging-Evidence`; the directory must exist before the command runs.

## Synthetic self-test

Run this before any credential or database operation:

```powershell
$repo = 'C:\Users\mskir\Desktop\Apply_Pack\applypack-production-v2'
& pwsh -NoLogo -NoProfile -File "$repo\scripts\staging-database-safeguard.ps1" -Mode SelfTest
```

Required marker:

```text
STAGING_DATABASE_SAFEGUARD_SELF_TEST_OK
```

The self-test uses only synthetic bytes, a local disposable child process, and a temporary directory. It proves a DPAPI round trip, authenticated encrypt/decrypt, tamper rejection, truncation rejection, non-shareable envelope-handle pinning, repository-path and directory-race rejection, partial-file cleanup, process-tree termination and wait, simulated container cleanup, credential-buffer clearing, restore-error precedence, and secret-log redaction. It does not read Credential Manager, run Docker, or contact a database.

## Bind the immutable staging identity

Set only these non-secret process variables in the PowerShell window used for the operation:

```powershell
$env:AP_DEPLOYMENT_ENV = 'staging'
$env:AP_PREMIGRATION_EXPECTED_PROJECT_REF = 'fmugizadzdnqfckujqlw'
$env:AP_PREMIGRATION_EXPECTED_HOST = 'aws-0-us-west-2.pooler.supabase.com'
$env:AP_PREMIGRATION_EXPECTED_PORT = '5432'
$env:AP_PREMIGRATION_EXPECTED_DATABASE = 'postgres'
$env:AP_PREMIGRATION_EXPECTED_LOGIN_USER = 'postgres.fmugizadzdnqfckujqlw'
$env:AP_PREMIGRATION_EXPECTED_CURRENT_USER = 'postgres'
$env:AP_PREMIGRATION_EXPECTED_RELEASE_SHA = git -C 'C:\Users\mskir\Desktop\Apply_Pack\applypack-production-v2' rev-parse HEAD
$env:APP_CHECKOUT_ENABLED = 'false'
$env:APP_CANARY_CHECKOUT_ENABLED = 'false'
```

Do not set or construct a database URI. The helper independently reconstructs the exact arguments and rejects every different value. It also requires the two executable helper files to be tracked and byte-for-byte clean at `HEAD`, and requires the explicit release-SHA binding to equal that 40-character commit.

## Create the encrypted pre-migration backup

Choose new filenames. The helper refuses to overwrite an existing backup or receipt.

```powershell
$repo = 'C:\Users\mskir\Desktop\Apply_Pack\applypack-production-v2'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = "C:\ApplyPack-Staging-Evidence\applypack-staging-pre-081-$stamp.apdb"
$receipt = "C:\ApplyPack-Staging-Evidence\applypack-staging-pre-081-$stamp.backup.json"
$ca = 'C:\Users\mskir\Downloads\prod-ca-2021.crt'

& pwsh -NoLogo -NoProfile -File "$repo\scripts\staging-database-safeguard.ps1" `
  -Mode Backup `
  -BackupPath $backup `
  -ReceiptPath $receipt `
  -CaCertificatePath $ca
```

Required status: `STAGING_BACKUP_ENCRYPTED`. Stop if the helper returns any error code. Do not retry authentication repeatedly. Correct the reviewed credential or identity mismatch first.

The source attestation must prove:

- TLS is active and hostname validation used the pinned CA.
- `current_database()` is `postgres` and `current_user` is `postgres`.
- PostgreSQL server version is at least 17.6.
- The latest migration is exactly `202610040080`.
- Migration 080 exists and migrations 081 through 084 are absent.
- `ap_manual_launch_schema_readiness()` reports version `202610040080` and `ready: true`.
- No invalid public index exists.
- The receipt includes the release SHA, envelope SHA-256, encrypted byte counts, CA hash, image digest, tool versions, safe schema/RLS/ledger counts, per-public-table row counts, and their deterministic SHA-256 only. Table names and counts are retained; row contents and identifiers are never selected.

## Isolated restore drill

Run the restore drill against the just-created encrypted file. Use a new receipt filename:

```powershell
$repo = 'C:\Users\mskir\Desktop\Apply_Pack\applypack-production-v2'
$restoreReceipt = "C:\ApplyPack-Staging-Evidence\applypack-staging-pre-081-$stamp.restore.json"

& pwsh -NoLogo -NoProfile -File "$repo\scripts\staging-database-safeguard.ps1" `
  -Mode Restore `
  -BackupPath $backup `
  -ReceiptPath $restoreReceipt
```

Required status: `STAGING_RESTORE_DRILL_VERIFIED`. Restore holds one non-shareable source handle across metadata authentication, safe archive-list validation, and streaming restore into a disposable container; each consumer authenticates the complete envelope before releasing plaintext. It compares aggregate schema, migration-ledger, RLS-policy, trigger, function, index, and readiness evidence plus exact per-public-table row counts and their deterministic SHA-256 with the authenticated source metadata. It never publishes a container port or enables container networking.

After success, independently verify that no container whose name starts with `applypack-staging-restore-` remains. The signed-off evidence packet contains the backup receipt, restore receipt, their SHA-256 values, the exact reviewed release SHA, operator and supervisor signatures, writer-quiescence proof, and the later migration/readiness receipts. Do not commit the `.apdb` file or receipts.

## Stop conditions

Stop without applying migrations when any of these occurs:

- Environment, project reference, endpoint, login, connected user, CA, image, or schema identity differs.
- Either checkout flag is not false.
- The Credential Manager user name differs or the password contains a line break.
- Authentication fails or SSL cannot be proven.
- Source migration ledger is not exactly pre-081.
- Output path is inside a Git worktree, crosses a reparse point, exists already, or has the wrong extension.
- Encryption, authentication, flush, hash, atomic move, restore, aggregate comparison, or container teardown fails.
- Any receipt contains a database URI, password, customer row, document content, job URL, or customer identifier.

On failure, preserve the controlled error code and sanitized operator timestamp only. Do not copy raw provider errors into evidence. Checkout remains locked and migrations remain unapplied.

## Recovery

- A backup failure removes the ciphertext partial file. Correct the cause, choose new output filenames, and rerun only after checking that writers are still quiesced.
- A receipt failure removes the completed backup so an unreceipted artifact cannot be mistaken for governed evidence.
- A restore failure removes the disposable container in `finally` and independently verifies absence. If restore and teardown both fail, the restore code remains primary and the teardown code is attached as `cleanupError`; if teardown alone fails, it is the primary controlled error. Remove the named container manually and document only the sanitized container name and result before any retry.
- A tampered, truncated, or wrong-Windows-user envelope fails authentication before plaintext is emitted. It is not recoverable from that copy; use another verified encrypted copy or the provider backup.
- Never weaken TLS, change the pinned identity, bypass the ledger check, decrypt to a file, or reverse a published migration to make a drill pass.

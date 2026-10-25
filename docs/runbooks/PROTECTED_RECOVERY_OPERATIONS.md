# Protected recovery copy, bootstrap and isolated restore

For new-policy orders, apply [One-off retention](ONE_OFF_RETENTION.md) before enabling a restored service. The latest trusted expiry/deletion overlay and database sanitization are required alongside file-version verification. A current hold protects recovery bytes without reopening expired customer access. Preserve historical entitlements; do not treat this requirement as permission to prune the protected archive.

Status: implemented source with offline tests; not provisioned, deployed, provider-verified or drilled. Purchasing remains locked. The current tools archive private files and their reference graph. They do not establish database PITR health, independently recoverable authentication/configuration, retained KMS access, or the 240-minute/15-minute recovery result by themselves.

## Continuous file checkpoint

The separate production service runs `node scripts/run-protected-recovery.mjs` without arguments every five minutes, using the reviewed web image and its exact release SHA. Configure:

- `APP_DEPLOYMENT_ENV=production`, `APP_BASE_URL=https://applypack.work` and identical full `APP_EXPECTED_RELEASE_SHA` / `RAILWAY_GIT_COMMIT_SHA`.
- Distinct sealed `APP_RECOVERY_READER_SECRET` and `APP_RECOVERY_COMPLETION_SECRET`. The server alone holds the distinct receipt-signing secret. The service refuses Supabase master keys, database credentials, the receipt secret and maintenance token.
- The dedicated `APP_BACKUP_AWS_RA_*` workload identity, `APP_AWS_ACCOUNT_ID=838445019912`, `AWS_REGION=us-east-1`, `APP_BACKUP_BUCKET=applypack-production-protected-recovery-838445019912` and the exact retained `APP_BACKUP_KMS_KEY_ARN`. The web identity and AWS default credential chain are forbidden.

The fixed internal API completely enumerates four private buckets and its finite current/historical reference tables. Unknown schemas, buckets, incomplete pagination, conflicting retention metadata or unresolved retained references fail closed. A cycle reads two complete inventories and requires identical canonical identities. Files are read with provider-version preconditions, bounded to32MiB each and10GiB per inventory, uploaded under SSE-KMS with explicit SHA256, and bound to the exact returned immutable S3 VersionId. No plaintext file is written to disk. Verified prior manifest versions can be reused.

The immutable private manifest is published last. Only a successful authenticated, monotonic server completion acknowledgement updates `protected_recovery`; its watermark is the first inventory start, never the upload finish. Failure, timeout, partial upload, stale scan, checksum mismatch or replay cannot manufacture a completion. An upload whose response was lost may leave an unreferenced immutable version; a retry writes another version without erasing history. The entire cycle is bounded to five minutes. Logs contain only status, release, digests and counts.

The file checkpoint must be combined with verified Supabase PITR, independent authentication/configuration custody and retained application/backup keys. Before launch, demonstrate a usable database recovery point consistent with the stable file interval, actual cycle timing, staleness/failure alerts and intake/checkout lock behavior. Provider project destruction is a separate scenario: a daily independent database export does not promise15-minute recovery if both the project and its provider PITR are destroyed.

## Initial archive before migration

The existing production application may not expose the new internal API. `node scripts/bootstrap-protected-recovery.mjs` therefore uses the same inventory builder through an operator-only fixed Supabase GET/list transport. Its existing provider credential remains a full-capability provider credential; the tool constrains its operations, rather than claiming the credential is read-only. It never enters the recurring service.

Run only after verifying writer controls and the protected database/provider recovery point. Set `APP_RECOVERY_BOOTSTRAP_WRITERS_LOCKED=true`, the actual pre-migration `APP_RECOVERY_BOOTSTRAP_SOURCE_SHA`, and `APP_RECOVERY_BOOTSTRAP_DATABASE_EVIDENCE_SHA256` binding the reviewed private database/writer evidence. These are reviewed input bindings, not automatic provider attestations. The archive identity uses the same dedicated AWS configuration above.

Supply exactly one JSON object containing `supabaseKey` through a private process pipe from existing sealed provider storage. Never place the value in command arguments, an evidence file, chat or logs. The input is bounded and held only in memory. The fixed source is `spjaaxndiduhrcleazwb`; arbitrary projects, REST tables/columns, RPCs, mutations, redirects and cookies are rejected. A missing historical schema fails rather than silently producing an incomplete archive.

The result is `BOOTSTRAP_ARCHIVED_WITHOUT_APPLICATION_CHECKPOINT`, with `applicationCheckpointCompleted=false`. Its operator receipt cannot authenticate to the server completion route. Preserve its exact manifest digest/VersionId with the protected database and custody evidence. Existing DPAPI safeguards remain useful local migration checks, but do not establish recovery after losing this computer or its credentials.

## Registered isolated restore

`node scripts/restore-protected-recovery.mjs <private-registration.json> <registration-canonical-sha256>` supports a fresh, empty, explicitly registered recovery project only. It refuses production and staging. No recovery project is currently registered by this source, and the tool must remain unused until the approved cost/access sequence and independent target isolation checks are complete.

The strict registration contains schemaVersion `applypack-protected-recovery-target-registration-v1`, targetProjectRef, exact targetOrigin, current sourceReleaseSha, exact manifestSha256 and manifestVersionId, archive bucket/KMS identity, registeredAt, providerEvidenceSha256, registeredBy, independentRecoveryRoleArn and the seven required lock flags. The timestamp must be within15 minutes. `registeredBy` identifies an independent owner IAM user; the ordinary staging operator is rejected. The role is `arn:aws:iam::838445019912:role/applypack/production/applypack-production-recovery-reader`.

Before registering, independently verify and privately record that customer access, checkout, intake, outbound mail, live payments, callbacks and scheduled writers are disabled. The registration binds those external provider checks; it cannot infer them from a database row or manufacture the evidence. The restore also checks the target's live checkout mode, disabled commerce, all four private buckets and empty Storage before writing.

On Windows, the command reads temporary credentials in memory from the installed AWS CLI's explicit `applypack-production-recovery` profile. It verifies the actual STS assumed-role identity; the role trust requires recent MFA. It rejects alternative credential/endpoint configuration. The source read capability stays separate. Supply the target Supabase key through the same bounded private `supabaseKey` input pipe; never reuse the original source/master key or write it to an evidence file.

After restoring the reviewed database point into the isolated target and applying its checkout locks, run the file restore against a fresh complete production inventory. It verifies each archived VersionId and SHA256. Before restoring bytes, it persists a private exclusion overlay and excludes expired/deleted/revoked files, removed legacy paths, cleared references with no surviving valid reference, and replaced provider versions. This handles legacy deletions that did not create durable tombstones. An unchanged surviving paid/held reference keeps its same-version bytes eligible. Every uploaded object is read back and hashed; overwrite is forbidden.

The command returns `FILES_RESTORED_ACCESS_LOCKED` with restored/excluded counts. This is not permission to expose the project or proof that the application is fully recovered. Review exclusions against the database, preserve the overlay, verify authentication and retained keys, reconcile all paid Stripe transactions, test a valid owner download and wrong-user denial, and record measured elapsed time/data loss from a second machine and independent login. The tools provide no unlock operation. A partial attempt remains isolated; use a separately reviewed fresh empty target for another attempt.

## Retention boundary

Source copies must follow their actual deletion deadlines and legal holds; historical active deliveries must not expire merely because seven days elapsed. Versioned S3 delete markers do not erase prior bytes. The read-only exact-version retention planner and its approval boundary are documented in [PROTECTED_RECOVERY_RETENTION_APPROVAL.md](PROTECTED_RECOVERY_RETENTION_APPROVAL.md). Archive deletion execution is not implemented or authorized by that planner. Until the deletion operation is authorized, implemented and provider-tested, this remains a launch gate and the new privacy deletion behavior must not be claimed operational.

Required hosted proof remains: paid-resource approval/provisioning, independent credential custody, complete real inventory, PITR/file-point consistency, actual successful cycles and delivered alerts, exact archive checksum/version semantics, retention execution, and the measured full recovery drill. Offline fixtures exercise failure behavior only.

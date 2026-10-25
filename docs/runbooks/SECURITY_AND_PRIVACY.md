# Security and privacy operations

## Data boundaries

- Customer source documents and delivered files stay in separate private Supabase Storage buckets.
- Browser clients never receive the Supabase secret key, Stripe secret key, Resend key, webhook secret, or cron secret.
- Customer file access is mediated by authenticated server routes that issue short-lived signed URLs.
- Email contains status and portal links only. Do not send resumes or cover letters as attachments.
- Logs, support tickets, analytics, and incident records must not contain resume text or other uploaded document contents.

## Access control

- Customer reads are restricted by row-level security to the authenticated owner.
- Operator and admin actions use server-side authorization. Admin access requires an allowed email, an admin/operator profile role, and Supabase AAL2 MFA.
- Capacity, payment conversion, rate-limit, webhook, and audit tables are not directly writable by browser roles.
- Review the admin allowlist quarterly and immediately remove departed users.

## Upload safety

- Intake accepts PDF and DOCX only and validates both extension and file signature.
- Keep all Storage buckets private. No uploaded source document may be opened by an operator until the configured document safety checks pass.
- The launch baseline validates file identity, structure, expansion, and active content but is not an antivirus engine. Preserve this wording in customer and operator surfaces.
- A future malware scanner requires cost, privacy, retention, data-region, and failure-path approval plus real clean and blocked-fixture evidence.

## Retention

- Follow [amendment18](../applypack/18_OCTOBER_24_ONE_OFF_RETENTION_AMENDMENT.md) and [One-off retention](ONE_OFF_RETENTION.md). For newly accepted orders, private results/files have 30-day access windows after their latest approved delivery. Starting an optional pack checkout and submitting a new covered match-conflict request close 30 days after the original search delivery; a valid checkout already started may finish before its original expiry. Preserve the existing three-calendar-day correction request rule.
- Saved drafts retain their seven-day expiry and unpaid sources their separate 30-day cleanup schedule. Paid families must not be deleted merely because an old upload date elapsed. Preserve unfinished paid work, timely requests, reconciliation, disputes, required holds, shared entitlements, and historical paid-order terms.
- Invoke `POST /api/cron/maintenance` with `Authorization: Bearer <CRON_SECRET>` every 15 minutes. Treat access expiry, eligible minimization, attempted object removal, successful removal, and retry failure as distinct states. Investigate overdue or failed cleanup; do not report deletion before it is verified.
- Minimize private answers, profile/work-history content, payloads, matching details, generated documents and prior copies after their obligations end. Preserve minimal financial and accepted-terms evidence, necessary account/contact details, and content-free retention records. No fixed financial-record retention period has been approved; do not invent one or retain full resumes as routine transaction evidence.

## Key rotation

1. Pause both capacity rows.
2. Rotate one provider credential at a time in its provider dashboard.
3. Update Railway variables without exposing values in chat, commits, screenshots, or logs.
4. Redeploy and verify `/api/health`, sign-in, a test checkout, webhook replay safety, email, and private-file denial.
5. Revoke the old credential only after the new path passes.
6. Reopen capacity and record the date, operator, provider, and release SHA.

## Backups and restore

- Enable Supabase production backups before launch and record the provider retention window.
- Before a migration, confirm the latest backup completed and test the migration in the separate test project.
- For the governed staging pre-081 snapshot, follow `STAGING_DATABASE_SAFEGUARD.md`. The Windows helper streams the custom-format dump directly into an authenticated DPAPI CurrentUser envelope; binds the initially approved output-directory identity to the long-lived write handle; repeats Git, worktree, `.git`, and reparse exclusion while that handle is held; terminates and drains failed dump processes; verifies named-container absence; and holds one non-shareable envelope handle across restore phases. Both backup and restore require clean helper bytes at the exact full current release SHA, and restore rejects an authenticated envelope from a different release before archive listing. It compares exact per-public-table row counts plus a deterministic digest and restores only into a disposable PostgreSQL 17.6 container with networking disabled and no published ports. DPAPI CurrentUser does not protect against a compromised same-user session, same-user malware, or an administrator acting as that user. Store only its sanitized receipts and hashes; never store a plaintext dump, password, URI, raw provider error, or customer content.
- Run a restore drill into a non-production project before launch and at least quarterly. Verify orders, capacity, RLS, private buckets, signed download behavior, and the immutable `ap_snapshot_legal_content_receipts` trigger. Confirm that the configured Terms, Privacy Policy, and acceptance-copy hashes match the release; the legal receipt and re-consent functions remain service-role-only; the supported v2 finalizer routes through the v3 content-bound contract; each later legal revision appends one hash-bound acceptance and receipt without changing or duplicating earlier episodes; and any migration-074 receipt reconciliation preserves the original receipt while adding exactly one immutable audit link to its matching acceptance.
- A backup is not proven until a restore has been completed and documented.
- A restore must apply current expiry/deletion and hold evidence and sanitize expired private database content before customer access opens. File exclusion is not erasure of archived bytes. Record the actual provider database backup window separately from the maximum seven-day superseded application archive cycle; the [protected archive deletion approval and execution gate](PROTECTED_RECOVERY_RETENTION_APPROVAL.md) remains unresolved until separately satisfied.

## Security incident

Use `INCIDENT_RESPONSE.md`. Pause purchases first when confidentiality, payment integrity, or delivery correctness may be affected. Preserve identifiers and timestamps, but never copy customer document contents into the incident record.

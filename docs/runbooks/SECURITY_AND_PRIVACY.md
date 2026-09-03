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

- Saved intake drafts expire after seven days. Source documents receive a deletion due date at intake and when the 10-match search is delivered. The default maximum is 30 days.
- Invoke `POST /api/cron/maintenance` with `Authorization: Bearer <CRON_SECRET>` at least hourly.
- The maintenance job removes due source objects, records `source_deleted_at`, and adds an audit event. Investigate any due record that remains undeleted.
- Delivery files, orders, payments, refunds, and audit records follow the approved legal/accounting retention policy; do not improvise deletion periods.

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
- Run a restore drill into a non-production project before launch and at least quarterly. Verify orders, capacity, RLS, private buckets, and signed download behavior.
- A backup is not proven until a restore has been completed and documented.

## Security incident

Use `INCIDENT_RESPONSE.md`. Pause purchases first when confidentiality, payment integrity, or delivery correctness may be affected. Preserve identifiers and timestamps, but never copy customer document contents into the incident record.

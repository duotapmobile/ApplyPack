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

## Job-match packet controls

- Generation and preview are server-side Node operations. Operator access requires the existing allowlist, role, and AAL2 MFA controls.
- The renderer accepts only the strict approved-content schema. Customer and posting text is inert, bounded, and cannot choose executable templates, URLs to fetch, or parser commands.
- Packet objects stay in `customer-deliveries`; access reuses the repository's 60-second signed URL policy. Cross-customer, pre-release, stale, superseded, and expired requests return not-found.
- Generated-artifact retention is fail closed: without approved `APP_GENERATED_ARTIFACT_RETENTION_DAYS`, packet generation returns unavailable. With it, access expires before private-object deletion; failed deletion is queued without restoring access.
- Artifact identity includes order, customer, content snapshot, renderer, template, pdfcn commit, Takumi version, and the order content revision. Database uniqueness, bounded leases, and per-attempt generation tokens prevent concurrent duplicate or stale-worker delivery.
- Approval revalidates all ten current job records under an order lock: active/open state, rejection, 24-hour freshness, direct HTTPS destination, Liveops exclusion, exact membership, and unchanged application URL. Corrections take the same order lock, advance the revision, clear customer visibility, and require reapproval.
- Candidate evidence references must resolve to the owning customer's current confirmed/verified facts; job evidence must name an allowlisted field on the exact selected job. Invalid, cross-customer, rejected, superseded, or dangling evidence fails closed.
- Audit events contain identifiers, states, revisions, versions, checksums, and bounded failure codes, never packet text. Upload/database interruptions recover an existing private object only after SHA-256 equality.
- Customer release remains blocked until the shared fresh-reauthentication control is implemented and proven.

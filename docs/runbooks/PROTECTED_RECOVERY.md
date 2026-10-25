# Production protected recovery

Current retention overlay: [amendment18](../applypack/18_OCTOBER_24_ONE_OFF_RETENTION_AMENDMENT.md) and [One-off retention](ONE_OFF_RETENTION.md) govern prospective 30-day access, obligation/hold protection, and mandatory private-row sanitization before restoring access. Historical deliveries keep their recorded terms. Read-only planning and restore exclusion do not establish physical archive erasure; the separate executor approval and hosted verification below remain required.

Status: prepared source and local verification only. No archive, keys, roles, credentials, schedules, backup, retention deletion, or recovery drill have been provisioned or executed. Production remains locked. The production Supabase project is verified as `spjaaxndiduhrcleazwb`; its current inactive state and missing verified database target still block hosted execution.

## Scope and recovery promise

The agreed loss scenario is loss of the original machine or its credentials. The target is recovery within 240 minutes and at most 15 minutes of recent application data requiring recovery or reconciliation. Stripe remains the independent payment ledger: reconcile every paid transaction before opening customer access. Database PITR, private object recovery, envelope-key custody, authentication, and configuration are separate dependencies. An object checkpoint alone proves neither database recovery nor a complete service restore.

Supabase PITR requires the approved paid database configuration and independently recoverable owner login/MFA. PITR does not contain Storage object bytes. Deleting the provider project can also delete its backups; the machine-loss promise must not be described as proof against total provider-account or project destruction. A daily portable database export can be added only if that broader loss scenario is separately selected and tested.

## Concrete resources and cost inputs

Use `infra/aws/protected-recovery/template.json` in account `838445019912`, region `us-east-1`, after the single consolidated quote is approved. It declares exactly 12 resources:

- One retained rotating KMS key and alias `alias/applypack-production-protected-recovery`.
- One private versioned S3 bucket `applypack-production-protected-recovery-838445019912` and bucket policy. This is separate from both temporary document-worker buckets.
- Three permissions boundaries and three roles: recovery writer, independent human recovery reader, and recovery retention.
- Two disabled Roles Anywhere profiles: recovery writer and recovery retention. Reuse the verified production public-CA trust anchor, with different leaf certificates and subjects. No paid certificate authority, NAT gateway, or new network is declared.

Two separate Railway services use the frozen web image: a five-minute copy/checkpoint service and a five-minute retention service. Each has one nonoverlapping bounded run, a five-minute hard run budget, a distinct certificate/capability, and no Supabase service key. Estimate 8,640 runs per service per 30-day month, with actual duration, CPU, memory, source bytes, KMS requests, and S3 requests measured before accepting the forecast. A provisional 10 GiB archive allowance is a sizing assumption, not an observed inventory. Include both archive requests and source egress in the one quote. Do not count budget alerts as a spending cap.

The independent recovery principal is an explicit verified IAM user with recoverable MFA, supplied to the template. The existing staging operator is explicitly rejected. Neither this principal nor independent custody has been verified yet. Actual permissions to create or execute these resources remain unverified; an unrelated denied inventory permission does not prove provisioning permission is denied.

## Source connection and credentials

The web service holds four distinct sealed capabilities, each at least 43 characters, different from `CRON_SECRET`:

| Name | Placement | Purpose |
| --- | --- | --- |
| `APP_RECOVERY_READER_SECRET` | Web and copy service | Complete inventory and bounded source-object reads |
| `APP_RECOVERY_COMPLETION_SECRET` | Web and copy service | Report a published and verified checkpoint |
| `APP_RECOVERY_RETENTION_SECRET` | Web and retention service | Inventory and retention-completion report only |
| `APP_RECOVERY_RECEIPT_SECRET` | Web only | Authenticate server-issued source-start receipts |

Supply credentials directly through provider storage. Never put values in source, evidence, command arguments, logs, or chat. The copy service uses the dedicated `APP_BACKUP_AWS_RA_*` certificate configuration, fixed writer role/CN/profile `applypack-production-recovery-writer`; the retention service uses `APP_RETENTION_AWS_RA_*` and fixed role/CN/profile `applypack-production-recovery-retention`. Shared production account, region, helper binary pin, CA fingerprint and leaf fingerprints must match the deployed template and actual provider identity. The source web service alone retains its existing Supabase admin credential.

All source routes require production identity, exact production Supabase origin, `https://applypack.work`, and actual full release SHA equal to `APP_EXPECTED_RELEASE_SHA`. They are private, no-store, and reject cookies. They expose no caller-selected tables, columns, SQL, or provider URLs:

- `GET /api/internal/protected-recovery/inventory`: reader or retention capability; no parameters. Fully enumerate all four buckets, including empty buckets, and every page of the finite current/historical reference graph. Missing/extra/public buckets, missing tables, unsafe paths, incomplete records, unknown retention state, shared-path deletion conflicts, oversized inventories, or unresolved references reject the entire scan.
- `GET /api/internal/protected-recovery/object?bucket=...&key=...&sourceVersion=...`: reader capability only. Check the actual provider version before and after a fixed authenticated Storage GET. Limit the response to 32 MiB, validate exact length, hash bytes, disallow redirects, and use memory only. Metadata reads and byte transport have deadlines.
- `POST /api/internal/protected-recovery/complete`: completion capability only. Verify two server-issued receipts with the same complete inventory digest, project, release, and counts. The second scan follows the first. A source-start watermark more than five minutes old or in the future is rejected.
- `POST /api/internal/protected-recovery/retention-complete`: retention capability only. Verify the same source-receipt pair, bounded version counts, deletion-plan digest and provider-verification digest. This endpoint cannot perform or establish deletion by itself.

The complete finite graph includes `ap_document_versions`, `ap_generated_file_versions`, `ap_generated_artifacts`, `ap_artifact_quality_reviews`, `source_documents`, `intakes`, `intake_drafts`, `apply_pack_items`, `apply_pack_delivery_revisions`, and `ap_unpaid_source_cleanup`. Preview files inherit their file version's artifact retention and revocation state. Select only file identity, digest, length, and retention fields. Customer emails, answers, extracted text, review notes, and claim provenance are excluded. Object keys and IDs remain private metadata and must not enter routine logs.

Two identical bounded scans are a consistency check, not a PostgreSQL transaction snapshot. The required hosted drill must exercise concurrent upload, replacement, deletion, and lost responses. If metadata cannot be proven complete, no checkpoint is published. Known schema versions lacking any required field need explicit reviewed compatibility work; never treat a missing table as empty history.

## Copy and publication

The copy service streams each retained source version into the durable bucket using the exact KMS key. Archive object keys are derived from source bucket, key and immutable provider version; the manifest binds original identity, byte length, SHA-256 and exact S3 VersionId. An S3 version acknowledgment and stored checksum must match the streamed bytes. An ETag is not a SHA-256 checksum.

Existing matching versions can be reused from a verified prior manifest. Lost upload responses may leave an unreferenced version; they cannot publish partial success. After copying, obtain a second complete source scan with an identical digest. Publish the immutable manifest last, then report completion. The writer may read manifests but cannot read archived customer blobs, delete archive versions, or change IAM or KMS policies.

`operational_heartbeats` records task `protected_recovery`. Its `last_succeeded_at` is the first scan's source-start time, never the finish time. Its versioned summary binds exact project/release, source start, completion, inventory digest, manifest digest/VersionId and counts. A conditional monotonic update rejects repeated and older completions, including concurrent races. Receipt HMACs authenticate the application source scan; they are not AWS or Supabase attestations. The completion caller is a trusted publisher whose actual upload behavior must pass hosted verification.

The application warns at ten minutes and stops new production intake and checkout at twelve minutes of stale object or retention evidence, leaving margin before the fifteen-minute target. Existing paid fulfillment, private delivery, refunds, signed webhooks and reconciliation continue. Deliver failure and staleness alerts through an independently functioning notification path; a configuration flag or unit test is not delivery proof.

## Retention and deletion boundary

The retention identity has only version listing and exact-version deletion for the archive's object and manifest prefixes. It cannot read customer archive bytes, write them, decrypt them, or use copy/completion capabilities. No blanket S3 expiration is configured for source blobs, because expiration could erase a still-retained or legally held current version. S3 delete markers do not erase previous versions. Remove every authorized exact version, including legacy null versions or markers only when their mapping and eligibility are proven.

The intended scheduled job compares two complete fresh source inventories, keeps currently retained source versions and legal holds, protects in-flight uploads, removes obsolete eligible versions, and keeps superseded manifest history for at most seven days. It verifies the resulting version listing before reporting `protected_recovery_retention`. It must fail closed on ambiguous names, incomplete pagination, unknown versions, shared-path retention conflicts or changed source evidence.

**Current approval block:** automatic approval review rejected writing the destructive exact-version pruning execution code because explicit trusted-user authorization for that deletion capability was missing. No provider deletion was attempted. The read-only retention plan, infrastructure policy and completion contract are preparation; they do not prove deletion or a successful cycle. Keep both profiles disabled and purchasing locked until this block is resolved, the reviewed executable path exists, and real scheduled cycles pass. Do not publish the prospective retention/privacy behavior as an already operating service.

The read-only planner can now map privately imported historical manifests to exact listed archive versions and reference-retention metadata. It also checks complete manifest coverage and fresh current-graph replacement metadata. This preparation retains every version and proposes no removals. `METADATA_VERIFIED_ONLY` explicitly excludes provider byte/checksum verification, application completion and hosted restore proof; those remain acceptance gates. The optional bounded import format and command are documented in [the retention review](PROTECTED_RECOVERY_RETENTION_APPROVAL.md). No additional provider permission, deletion operation or heartbeat was added.

## Before migrations: operator bootstrap

The new API cannot back up the older production service before it is deployed. Use the separate operator bootstrap transport with the existing sealed production Supabase credential, exact fixed origin, finite metadata selections, and GET/list-only requests. This credential remains a full-capability provider credential despite the transport restriction; keep it only in operator memory and outside the continuous copy service. The same inventory/checkpoint implementation covers current and historical references and rejects unsupported old schema. Record the actual old release identity and archive the bootstrap manifest without claiming an application heartbeat or new API proof.

Before any forward migration, also take a protected database backup/PITR checkpoint covering rows, envelope-key records, auth and configuration. Prove independent provider access and offline configuration/CA/envelope-key custody. A DPAPI-only secret on the original Windows machine does not satisfy machine-loss recovery. Record only custody identifiers, hashes and access test results; never include historical raw secrets in evidence.

## Restore and measured acceptance

Use the independent MFA recovery role to read each exact S3 version, hash every byte, and restore only into an explicitly registered isolated recovery target. The target must differ from production and staging and remain locked for checkout, intake, customer access, outbound email, callbacks and scheduled writers. Bind target credentials and provider isolation evidence before any restore write.

Overlay the latest complete retained inventory and deletion/revocation restrictions on the older database/object checkpoint before exposing anything. A legacy draft path cleared from the latest graph must not reappear merely because an older manifest contains it. A replaced provider version must not overwrite a valid current one. Every excluded or unavailable object is recorded by identifier/count and the target remains locked; partial file recovery is not complete recovery. Revalidate customer ownership, encryption context, auth redirects, private downloads and all paid obligations against Stripe before final access approval.

Acceptance evidence must include loss of the original machine or credentials, independent database restore/PITR, exact-version file verification, envelope-key decryptability through the recovered identity, independent authentication/configuration custody, and measured elapsed time no greater than 240 minutes. Show the recoverable database point and source watermark are no more than fifteen minutes behind the loss point, and reconcile every Stripe payment. Include one manual run plus actual scheduled copy and retention runs, delivered alert tests, deletion/replacement/concurrent-run failure tests, and a restored customer download. No drill has yet been performed.

## Provisioning review sequence

1. Complete the source candidate and required CI/image/security checks. Freeze the actual full SHA and keep the separate production database migration lock.
2. Finalize one itemized quote including PITR, both Railway schedules, durable archive, two distinct KMS keys (application envelope and archive), request/egress assumptions, independent custody and recovery target/drill costs. Record the approved quote digest and exact resource list.
3. Read actual account, region, trust anchor/public certificate, independent recovery principal, permissions and resource collisions. Verify the canonical template bytes and reviewed hash. `ValidateTemplate` is read-only and does not prove provisioning permission.
4. Prepare only the reviewed named CloudFormation CREATE change set with exact parameters, profiles disabled, named-IAM acknowledgment and retained data resources. Review every change, no replacement/import/nested stack, and enable stack termination protection before execution. Unknown changes or a source/quote/template mismatch stop the process. No new template was provisioned during preparation.
5. After approved execution, independently verify bucket privacy/versioning/key/roles and policy separation. Seal fresh distinct workload leaves and capabilities directly into each exact provider service. Keep CA private key and independent recovery access off the originating machine.
6. Perform bootstrap, database backup and recovery proof before migration; then deploy the frozen locked source, copy service and reviewed retention implementation. Register actual completion and alert evidence before any final launch activation.

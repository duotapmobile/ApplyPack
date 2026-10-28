import { z } from "zod";
import { draftReferenceBindingSchema, type DraftReferenceSourceBinding } from "./draft-reference-source";

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true });
export const draftReferencePermissionSchema = z.object({ id: uuid, customer_id: uuid, delivered_release_id: uuid,
  job_snapshot_id: uuid, job_snapshot_hash: hash, reference_record_version_id: uuid, attested_at: time,
  revoked_at: z.null(), contact_version_changed_at: z.null() }).strict();
export const draftReferenceMetadataSchema = z.object({
  permissions: z.array(draftReferencePermissionSchema).min(1).max(3),
  versions: z.array(z.object({ id: uuid, reference_record_id: uuid, version: z.number().int().positive(), encrypted_payload_id: uuid,
    payload_sha256: hash, payload_schema_version: z.literal("chunk5-reference-record-v1"), permission_status: z.literal("CONFIRMED"),
    permission_last_confirmed_at: time, superseded_at: z.null() }).strict()).min(1).max(3),
  records: z.array(z.object({ id: uuid, customer_id: uuid, current_version: z.number().int().positive(), removed_at: z.null(),
    retention_state: z.literal("ACTIVE") }).strict()).min(1).max(3),
  payloads: z.array(z.object({ id: uuid, customer_id: uuid, content_sha256: hash, retention_state: z.literal("ACTIVE"),
    encryption_context_hash: hash }).strict()).min(1).max(3),
}).strict();
export type DraftReferenceMetadata = z.infer<typeof draftReferenceMetadataSchema>;
export const draftReferenceScopeSchema = z.object({ customerId: uuid, deliveredReleaseId: uuid, jobSnapshotId: uuid, jobSha256: hash,
  permissionIds: z.array(uuid).min(1).max(3) }).strict();
export type DraftReferenceScope = z.infer<typeof draftReferenceScopeSchema>;

/** Finite, content-free evidence only. Does not authorize later persistence;
 * the durable workflow must recheck these identities in its transaction. */
export function bindDraftReferenceMetadata(raw: unknown, rawScope: DraftReferenceScope, now: Date): DraftReferenceSourceBinding[] {
  const evidence = draftReferenceMetadataSchema.parse(raw), scope = draftReferenceScopeSchema.parse(rawScope);
  const invalid = () => { throw new Error("DRAFT_REFERENCE_BINDING_INVALID"); };
  const count = scope.permissionIds.length;
  if (!Number.isFinite(now.getTime()) || new Set(scope.permissionIds).size !== count) invalid();
  for (const rows of [evidence.permissions, evidence.versions, evidence.records, evidence.payloads]) {
    if (rows.length !== count || new Set(rows.map((row) => row.id)).size !== count) invalid();
  }
  const bindings = [...scope.permissionIds].sort().map((id) => {
    const permission = evidence.permissions.find((row) => row.id === id);
    const version = evidence.versions.find((row) => row.id === permission?.reference_record_version_id);
    const record = evidence.records.find((row) => row.id === version?.reference_record_id);
    const payload = evidence.payloads.find((row) => row.id === version?.encrypted_payload_id);
    if (!permission || !version || !record || !payload || permission.customer_id !== scope.customerId || record.customer_id !== scope.customerId
      || payload.customer_id !== scope.customerId || permission.delivered_release_id !== scope.deliveredReleaseId
      || permission.job_snapshot_id !== scope.jobSnapshotId || permission.job_snapshot_hash !== scope.jobSha256
      || record.current_version !== version.version || payload.content_sha256 !== version.payload_sha256
      || Date.parse(permission.attested_at) > now.getTime() || Date.parse(version.permission_last_confirmed_at) > now.getTime()) return invalid();
    return draftReferenceBindingSchema.parse({ permissionId: id, recordId: record.id, recordVersionId: version.id, recordVersion: version.version,
      payloadId: payload.id, contentSha256: payload.content_sha256, permissionConfirmedAt: version.permission_last_confirmed_at,
      deliveredReleaseId: permission.delivered_release_id, jobSnapshotId: permission.job_snapshot_id, jobSha256: permission.job_snapshot_hash });
  });
  for (const key of ["recordId", "recordVersionId", "payloadId"] as const) if (new Set(bindings.map((binding) => binding[key])).size !== count) invalid();
  return bindings;
}

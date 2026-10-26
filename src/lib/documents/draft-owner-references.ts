import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/database.types";
import { parsePostgresBytea } from "@/lib/commerce/server";
import { remoteKmsAdapter } from "@/lib/security/remote-kms";
import { decryptSensitivePayload, sensitivePayloadConfiguration, sensitivePayloadEncryptionReady } from "@/lib/security/sensitive-payload";
import { draftReferenceBindingSchema, readDraftReferenceSources, type DraftReferenceInput } from "./draft-reference-source";
import { bindDraftReferenceMetadata, draftReferenceMetadataSchema, type DraftReferenceMetadata } from "./drafting-evidence-references";
import type { DraftingEvidencePacket } from "./drafting-evidence";

type Admin = SupabaseClient<Database>;
const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true });
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const bytea = (max: number) => z.string().regex(/^\\x(?:[a-fA-F0-9]{2})+$/).max(2 + max * 2);
const payloadSchema = draftReferenceMetadataSchema.shape.payloads.element.extend({ encryption_algorithm: z.literal("AES-256-GCM"),
  ciphertext: bytea(32_768), encrypted_data_key: bytea(16_384), nonce: bytea(12), authentication_tag: bytea(16),
  kms_key_identity: z.string().min(1).max(2048), kms_key_version: z.string().min(1).max(100) }).strict();
const requestedSchema = z.object({ customerId: uuid, materialLineId: uuid, revisionId: uuid, deliveredReleaseId: uuid,
  jobSnapshotId: uuid, jobSha256: hash, bindings: z.array(draftReferenceBindingSchema).min(1).max(3) }).strict();
export type DraftReferenceReadRequest = z.infer<typeof requestedSchema>;
export function draftReferenceRequest(packet: DraftingEvidencePacket): DraftReferenceReadRequest | null {
  if (!packet.binding.referencePermissions.length) return null;
  const bindings = packet.ownerEvidence.referenceBindings;
  ensure(bindings?.length, "BINDING_MISSING");
  return parse(requestedSchema, { customerId: packet.expected.customerId, materialLineId: packet.expected.materialLineId,
    revisionId: packet.expected.revisionId, deliveredReleaseId: bindings[0].deliveredReleaseId,
    jobSnapshotId: packet.binding.jobSnapshotId, jobSha256: packet.binding.jobSha256, bindings });
}
export class DraftOwnerReferencesError extends Error { constructor(readonly code: string) { super(`DRAFT_OWNER_REFERENCES_${code}`); } }
function ensure(value: unknown, code: string): asserts value { if (!value) throw new DraftOwnerReferencesError(code); }
function parse<T>(schema: z.ZodType<T>, raw: unknown): T { const value = schema.safeParse(raw); ensure(value.success, "INVALID"); return value.data; }
const sort = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));
async function result<T>(query: PromiseLike<{ data: T; error: unknown }>, signal: AbortSignal): Promise<NonNullable<T>> {
  ensure(!signal.aborted, "ABORTED"); const answer = await query; ensure(!signal.aborted, "ABORTED");
  ensure(!answer.error && answer.data !== null && answer.data !== undefined, "UNAVAILABLE"); return answer.data;
}

/** Metadata-only port for the packet loader, under that caller's bounded signal. */
export async function loadDraftReferenceMetadata(admin: Admin, rawIds: readonly string[], signal: AbortSignal): Promise<DraftReferenceMetadata> {
  const ids = parse(z.array(uuid).min(1).max(3), rawIds); ensure(new Set(ids).size === ids.length, "INVALID");
  const permissions = await result(admin.from("ap_reference_permissions")
    .select("id,customer_id,delivered_release_id,job_snapshot_id,job_snapshot_hash,reference_record_version_id,attested_at,revoked_at,contact_version_changed_at")
    .in("id", ids).limit(4).abortSignal(signal), signal);
  const versions = await result(admin.from("ap_reference_record_versions")
    .select("id,reference_record_id,version,encrypted_payload_id,payload_sha256,payload_schema_version,permission_status,permission_last_confirmed_at,superseded_at")
    .in("id", permissions.map((row) => row.reference_record_version_id)).limit(4).abortSignal(signal), signal);
  const [records, payloads] = await Promise.all([
    result(admin.from("ap_reference_records").select("id,customer_id,current_version,removed_at,retention_state")
      .in("id", versions.map((row) => row.reference_record_id)).limit(4).abortSignal(signal), signal),
    result(admin.from("ap_sensitive_payloads").select("id,customer_id,content_sha256,retention_state,encryption_context_hash")
      .in("id", versions.map((row) => row.encrypted_payload_id)).limit(4).abortSignal(signal), signal),
  ]);
  return parse(draftReferenceMetadataSchema, { permissions: sort(permissions), versions: sort(versions), records: sort(records), payloads: sort(payloads) });
}

/** Internal service reader, called only after owner MFA or a fenced worker claim.
 * Exact private reference bytes stay local. The caller owns successful buffers
 * and must clear each in finally. Optimistic re-reads do not replace the DB CAS. */
export async function readConfirmedDraftReferences(admin: Admin, raw: DraftReferenceReadRequest, external: AbortSignal,
  options: { now?: () => Date } = {}): Promise<DraftReferenceInput[]> {
  const request = parse(requestedSchema, raw), now = options.now ?? (() => new Date());
  const ids = request.bindings.map((binding) => binding.permissionId);
  ensure(new Set(ids).size === ids.length, "INVALID");
  const controller = new AbortController(), abort = () => controller.abort();
  external.addEventListener("abort", abort, { once: true }); if (external.aborted) abort();
  const owned: Array<DraftReferenceInput & { plaintext: Buffer }> = []; let transferred = false, interrupt: () => void = () => undefined;
  const stopped = new Promise<never>((_, reject) => { interrupt = () => reject(new DraftOwnerReferencesError("ABORTED"));
    controller.signal.addEventListener("abort", interrupt, { once: true }); if (controller.signal.aborted) interrupt(); });
  const timer = setTimeout(abort, 45_000), signal = controller.signal;
  const data = <T,>(query: PromiseLike<{ data: T; error: unknown }>) => result(query, signal);
  async function scope() {
    const line = parse(z.object({ id: uuid, purchase_id: uuid, active_revision: z.number().int().positive(), selected_reference_sheet: z.literal(true),
      fulfillment: z.enum(["PAID", "GENERATING", "HUMAN_REVIEW", "READY_TO_RELEASE"]) }).strict(),
    await data(admin.from("ap_material_lines").select("id,purchase_id,active_revision,selected_reference_sheet,fulfillment").eq("id", request.materialLineId).abortSignal(signal).single()));
    const revision = parse(z.object({ id: uuid, line_id: uuid, version: z.number().int().positive(), job_snapshot_id: uuid, reference_scope: z.json().nullable(),
      due_at: time, superseded_at: z.null() }).strict(), await data(admin.from("ap_material_line_revisions")
      .select("id,line_id,version,job_snapshot_id,reference_scope,due_at,superseded_at").eq("id", request.revisionId).abortSignal(signal).single()));
    const purchase = parse(z.object({ id: uuid, customer_id: uuid, checkout_intent_id: uuid }).strict(), await data(admin.from("ap_material_purchases")
      .select("id,customer_id,checkout_intent_id").eq("id", line.purchase_id).abortSignal(signal).single()));
    const intent = parse(z.object({ id: uuid, customer_id: uuid, purchase_id: uuid, delivered_release_id: uuid, state: z.literal("COMPLETED") }).strict(),
      await data(admin.from("ap_material_checkout_intents").select("id,customer_id,purchase_id,delivered_release_id,state").eq("id", purchase.checkout_intent_id).abortSignal(signal).single()));
    ensure(line.id === request.materialLineId && revision.id === request.revisionId && revision.line_id === line.id
      && revision.version === line.active_revision && revision.job_snapshot_id === request.jobSnapshotId && Date.parse(revision.due_at) > now().getTime()
      && purchase.id === line.purchase_id && purchase.customer_id === request.customerId && intent.id === purchase.checkout_intent_id
      && intent.purchase_id === purchase.id && intent.customer_id === request.customerId && intent.delivered_release_id === request.deliveredReleaseId, "SCOPE_MISMATCH");
    let selected: string[];
    if (revision.reference_scope !== null) selected = parse(z.object({ selected: z.literal(true), permissionIds: z.array(uuid).min(1).max(3) }).strict(), revision.reference_scope).permissionIds;
    else {
      const item = parse(z.object({ id: uuid, checkout_intent_id: uuid, material_line_id: uuid }).strict(), await data(admin.from("ap_material_checkout_items")
        .select("id,checkout_intent_id,material_line_id").eq("material_line_id", line.id).abortSignal(signal).single()));
      ensure(item.checkout_intent_id === intent.id && item.material_line_id === line.id, "SCOPE_MISMATCH");
      selected = parse(z.array(z.object({ reference_permission_id: uuid }).strict()).min(1).max(3), await data(admin.from("ap_material_checkout_references")
        .select("reference_permission_id").eq("checkout_item_id", item.id).limit(4).abortSignal(signal))).map((row) => row.reference_permission_id);
    }
    ensure(new Set(selected).size === selected.length && JSON.stringify([...selected].sort()) === JSON.stringify([...ids].sort()), "SCOPE_MISMATCH");
    return { line, revision, purchase, intent, selected: [...selected].sort() };
  }
  const operation = async () => {
    try {
      const beforeScope = await scope(), before = await loadDraftReferenceMetadata(admin, ids, signal);
      const bound = bindDraftReferenceMetadata(before, { customerId: request.customerId, deliveredReleaseId: request.deliveredReleaseId,
        jobSnapshotId: request.jobSnapshotId, jobSha256: request.jobSha256, permissionIds: ids }, now());
      ensure(JSON.stringify(bound) === JSON.stringify([...request.bindings].sort((a, b) => a.permissionId.localeCompare(b.permissionId))), "BINDING_CHANGED");
      const configuration = sensitivePayloadConfiguration(); ensure(sensitivePayloadEncryptionReady(configuration), "ENCRYPTION_UNAVAILABLE");
      for (const binding of bound) {
        const row = parse(payloadSchema, await data(admin.from("ap_sensitive_payloads")
          .select("id,customer_id,content_sha256,retention_state,encryption_context_hash,encryption_algorithm,ciphertext,encrypted_data_key,nonce,authentication_tag,kms_key_identity,kms_key_version")
          .eq("id", binding.payloadId).abortSignal(signal).single()));
        const prior = before.payloads.find((value) => value.id === binding.payloadId)!;
        ensure(row.id === binding.payloadId && row.customer_id === request.customerId && row.content_sha256 === binding.contentSha256
          && row.encryption_context_hash === prior.encryption_context_hash, "PAYLOAD_CHANGED");
        const plaintext = await decryptSensitivePayload({ configuration, kms: remoteKmsAdapter(),
          context: { customerId: request.customerId, payloadId: row.id, purpose: "REFERENCE_RECORD" }, envelope: {
            algorithm: row.encryption_algorithm, ciphertext: parsePostgresBytea(row.ciphertext), encryptedDataKey: parsePostgresBytea(row.encrypted_data_key),
            nonce: parsePostgresBytea(row.nonce), authenticationTag: parsePostgresBytea(row.authentication_tag), contentSha256: row.content_sha256,
            keyIdentity: row.kms_key_identity, keyVersion: row.kms_key_version, encryptionContextHash: row.encryption_context_hash } });
        owned.push({ permissionId: binding.permissionId, recordVersionId: binding.recordVersionId, payloadId: binding.payloadId, plaintext });
        ensure(!signal.aborted, "ABORTED"); ensure(plaintext.length > 0 && plaintext.length <= 32_768 && digest(plaintext) === binding.contentSha256, "PAYLOAD_INVALID");
      }
      readDraftReferenceSources(bound, owned, now());
      const after = await loadDraftReferenceMetadata(admin, ids, signal), afterScope = await scope();
      ensure(JSON.stringify(before) === JSON.stringify(after) && JSON.stringify(beforeScope) === JSON.stringify(afterScope), "READ_CHANGED");
      ensure(!signal.aborted, "ABORTED"); return owned;
    } finally { if (signal.aborted) owned.forEach((value) => value.plaintext.fill(0)); }
  };
  try { const value = await Promise.race([operation(), stopped]); ensure(!signal.aborted, "ABORTED"); transferred = true; return value; }
  catch (error) { throw error instanceof DraftOwnerReferencesError ? error : new DraftOwnerReferencesError("UNAVAILABLE"); }
  finally { clearTimeout(timer); external.removeEventListener("abort", abort); signal.removeEventListener("abort", interrupt); controller.abort();
    if (!transferred) owned.forEach((value) => value.plaintext.fill(0)); }
}

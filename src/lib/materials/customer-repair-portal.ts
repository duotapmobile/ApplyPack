import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/database.types";
import type { MaterialDeliveryView } from "@/components/portal/material-deliveries";
import { bindDraftReferenceMetadata } from "@/lib/documents/drafting-evidence-references";
import { draftReferenceBindingSchema } from "@/lib/documents/draft-reference-source";
import { boundedServiceErrorIo } from "./service-error-payload";
import { resolveServiceErrorContract } from "./service-error-contract";
import { privateAccessExpired } from "./retention-access";

type Admin = SupabaseClient<Database>;
const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true });
const fileSchema = z.object({ artifactId: uuid, originalFileVersionId: uuid, fileVersionId: uuid,
  artifactType: z.enum(["RESUME", "COVER_LETTER", "REFERENCE_SHEET"]), safeFilename: z.string().min(1).max(255).regex(/^[^/\\\x00-\x1f]+$/),
  checksumSha256: hash, releaseId: uuid, deliveredAt: time, accessExpiresAt: time }).strict();
const filesSchema = z.array(fileSchema).max(300);
function ensure(value: unknown): asserts value { if (!value) throw new Error("customer_material_delivery_unavailable"); }
async function read<T>(query: PromiseLike<{ data: T; error: unknown }>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted(); const result = await query; signal.throwIfAborted(); ensure(!result.error); return result.data;
}

async function supportPolicy(admin: Admin, customerId: string, lineId: string, signal: AbortSignal): Promise<"HISTORICAL" | "SERVICE_ERROR_ONLY"> {
  const line = await read(admin.from("ap_material_lines").select("id,purchase_id").eq("id", lineId).abortSignal(signal).single(), signal);
  ensure(line && line.id === lineId);
  const purchase = await read(admin.from("ap_material_purchases").select("id,customer_id,checkout_intent_id,legacy_cart_id")
    .eq("id", line.purchase_id).eq("customer_id", customerId).abortSignal(signal).single(), signal);
  ensure(purchase && purchase.id === line.purchase_id && purchase.customer_id === customerId);
  const contract = await read(admin.from("ap_service_error_contracts").select("*").eq("material_line_id", lineId).abortSignal(signal).maybeSingle(), signal);
  if (!purchase.checkout_intent_id) { ensure(purchase.legacy_cart_id && !contract); return "HISTORICAL"; }
  const intent = await read(admin.from("ap_material_checkout_intents").select("id,customer_id,purchase_id,source_snapshot_id")
    .eq("id", purchase.checkout_intent_id).abortSignal(signal).single(), signal);
  ensure(intent && intent.customer_id === customerId && intent.purchase_id === purchase.id);
  const acceptance = await read(admin.from("ap_snapshot_legal_acceptances").select("terms_version,privacy_version")
    .eq("snapshot_id", intent.source_snapshot_id).abortSignal(signal).single(), signal);
  ensure(acceptance);
  const normalized = contract && { materialLineId: contract.material_line_id, customerId: contract.customer_id,
    purchaseId: contract.purchase_id, sourceSnapshotId: contract.source_snapshot_id, legalReceiptId: contract.legal_receipt_id,
    intakeReviewId: contract.intake_review_id, intakeReviewSha256: contract.intake_review_sha256, contractVersion: contract.contract_version,
    termsVersion: contract.terms_version, termsContentSha256: contract.terms_content_sha256, privacyVersion: contract.privacy_version,
    privacyContentSha256: contract.privacy_content_sha256, confirmedIntakeVersion: contract.confirmed_intake_version,
    reportingTimeZone: contract.reporting_time_zone, boundAt: contract.bound_at };
  return resolveServiceErrorContract({ materialLineId: lineId, customerId, purchaseId: purchase.id, sourceSnapshotId: intent.source_snapshot_id,
    acceptedTermsVersion: acceptance.terms_version, acceptedPrivacyVersion: acceptance.privacy_version, contract: normalized }).kind;
}

async function referenceCurrent(admin: Admin, customerId: string, registration: unknown, signal: AbortSignal, now: Date) {
  const provenance = z.object({ p_claim_provenance: z.object({ referenceBindings: z.array(draftReferenceBindingSchema).min(1).max(3) }) }).parse(registration).p_claim_provenance;
  const bindings = provenance.referenceBindings, first = bindings[0], ids = bindings.map((binding) => binding.permissionId);
  const permissions = await read(admin.from("ap_reference_permissions")
    .select("id,customer_id,delivered_release_id,job_snapshot_id,job_snapshot_hash,reference_record_version_id,attested_at,revoked_at,contact_version_changed_at")
    .in("id", ids).eq("customer_id", customerId).abortSignal(signal), signal);
  const versions = await read(admin.from("ap_reference_record_versions")
    .select("id,reference_record_id,version,encrypted_payload_id,payload_sha256,payload_schema_version,permission_status,permission_last_confirmed_at,superseded_at")
    .in("id", bindings.map((binding) => binding.recordVersionId)).abortSignal(signal), signal);
  const [records, payloads] = await Promise.all([
    read(admin.from("ap_reference_records").select("id,customer_id,current_version,removed_at,retention_state")
      .in("id", bindings.map((binding) => binding.recordId)).eq("customer_id", customerId).abortSignal(signal), signal),
    read(admin.from("ap_sensitive_payloads").select("id,customer_id,content_sha256,retention_state,encryption_context_hash")
      .in("id", bindings.map((binding) => binding.payloadId)).eq("customer_id", customerId).abortSignal(signal), signal),
  ]);
  const actual = bindDraftReferenceMetadata({ permissions, versions, records, payloads }, { customerId,
    deliveredReleaseId: first.deliveredReleaseId, jobSnapshotId: first.jobSnapshotId, jobSha256: first.jobSha256, permissionIds: ids }, now);
  ensure(actual.length === bindings.length && actual.every((value) => {
    const saved = bindings.find((binding) => binding.permissionId === value.permissionId);
    return saved && Object.keys(value).every((key) => key === "permissionConfirmedAt"
      ? Date.parse(value.permissionConfirmedAt) === Date.parse(saved.permissionConfirmedAt)
      : value[key as keyof typeof value] === saved[key as keyof typeof saved]);
  }));
}

/** Server-authenticated customer identity only. This projection never signs a
 * URL, decrypts content, renews access, or authorizes a download. The existing
 * download RPC rechecks current consent/ownership and fresh authentication. */
export async function overlayCustomerRepairDeliveries(admin: Admin, trustedCustomerId: string, lines: MaterialDeliveryView[],
  options: { signal?: AbortSignal; now?: () => Date } = {}): Promise<MaterialDeliveryView[]> {
  const customerId = uuid.parse(trustedCustomerId), now = options.now ?? (() => new Date());
  ensure(lines.length <= 200 && new Set(lines.map((line) => line.lineId)).size === lines.length);
  return boundedServiceErrorIo(options.signal ?? new AbortController().signal, async (signal) => {
    const result: MaterialDeliveryView[] = [];
    for (const line of lines) {
      if (line.accessExpired || privateAccessExpired({ access_expired: false, access_expires_at: line.accessExpiresAt ?? null,
        material_line_id: line.lineId, order_id: line.lineId, policy_version: "one_off_30d_v1" }, now().getTime())) {
        result.push({ ...line, artifacts: [], supportPolicy: "UNAVAILABLE" }); continue;
      }
      if (!line.artifacts.length) { result.push({ ...line, supportPolicy: "UNAVAILABLE" }); continue; }
      uuid.parse(line.lineId);
      const policy = await supportPolicy(admin, customerId, line.lineId, signal);
      const list = async () => filesSchema.parse(await read(admin.rpc("ap_customer_service_repair_files", {
        p_customer_id: customerId, p_material_line_id: line.lineId }).abortSignal(signal), signal));
      const files = await list();
      ensure(new Set(files.map((file) => file.originalFileVersionId)).size === files.length
        && new Set(files.map((file) => file.fileVersionId)).size === files.length);
      const replacements = new Map<string, MaterialDeliveryView["artifacts"][number]>();
      for (const file of files) {
        const original = line.artifacts.find((artifact) => artifact.id === file.artifactId);
        ensure(original && original.type === file.artifactType && file.fileVersionId !== file.originalFileVersionId);
        const row = await read(admin.from("ap_service_repair_files").select("id,repair_version_id,customer_id,material_line_id,artifact_id,original_file_version_id,artifact_type,checksum_sha256,safe_filename,mime_type,storage_path,registration")
          .eq("id", file.fileVersionId).eq("customer_id", customerId).eq("material_line_id", line.lineId).abortSignal(signal).single(), signal);
        ensure(row && row.id === file.fileVersionId && row.customer_id === customerId && row.material_line_id === line.lineId
          && row.artifact_id === original.id && row.original_file_version_id === file.originalFileVersionId && row.artifact_type === original.type
          && row.checksum_sha256 === file.checksumSha256 && row.safe_filename === file.safeFilename && row.storage_path && row.mime_type === original.mimeType);
        const release = await read(admin.from("ap_service_repair_releases").select("id,repair_version_id,customer_id,material_line_id,committed_at,access_expires_at")
          .eq("id", file.releaseId).eq("customer_id", customerId).eq("material_line_id", line.lineId).abortSignal(signal).single(), signal);
        ensure(release && release.id === file.releaseId && release.customer_id === customerId && release.material_line_id === line.lineId
          && release.repair_version_id === row.repair_version_id && Date.parse(release.committed_at) === Date.parse(file.deliveredAt)
          && Date.parse(release.access_expires_at) === Date.parse(file.accessExpiresAt));
        if (original.fileVersionId !== file.originalFileVersionId) {
          // A later ordinary regeneration can supersede this original. Verify
          // that lineage before ignoring the older repair; never overlay by type.
          const [priorFile, artifact] = await Promise.all([
            read(admin.from("ap_generated_file_versions").select("id,artifact_id,version,superseded_at")
              .eq("id", file.originalFileVersionId).eq("artifact_id", original.id).abortSignal(signal).single(), signal),
            read(admin.from("ap_generated_artifacts").select("id,customer_id,material_line_id,artifact_type,current_file_version")
              .eq("id", original.id).eq("customer_id", customerId).eq("material_line_id", line.lineId).abortSignal(signal).single(), signal),
          ]);
          ensure(priorFile && priorFile.id === file.originalFileVersionId && priorFile.artifact_id === original.id && priorFile.superseded_at
            && priorFile.version < original.version && artifact && artifact.id === original.id && artifact.customer_id === customerId
            && artifact.material_line_id === line.lineId && artifact.artifact_type === original.type && artifact.current_file_version === original.version);
          continue;
        }
        const version = await read(admin.from("ap_service_repair_versions").select("id,customer_id,material_line_id,version,release_id,invalidated_at")
          .eq("id", row.repair_version_id).eq("customer_id", customerId).eq("material_line_id", line.lineId).abortSignal(signal).single(), signal);
        ensure(version && version.id === row.repair_version_id && version.customer_id === customerId && version.material_line_id === line.lineId
          && version.release_id === file.releaseId && Number.isSafeInteger(version.version) && version.version > 0);
        // Opening a successor invalidates its predecessor for further drafting,
        // not the immutable customer delivery that remains latest until Send.
        const clock = now().getTime(); ensure(Date.parse(file.deliveredAt) <= clock && Date.parse(file.accessExpiresAt) > Date.parse(file.deliveredAt));
        let blocked = false;
        if (file.artifactType === "REFERENCE_SHEET" && Date.parse(file.accessExpiresAt) > clock) {
          try { await referenceCurrent(admin, customerId, row.registration, signal, now()); }
          catch { signal.throwIfAborted(); blocked = true; }
        }
        replacements.set(original.fileVersionId, { ...original, fileVersionId: file.fileVersionId, filename: file.safeFilename,
          checksum: file.checksumSha256, mimeType: row.mime_type, version: version.version, createdAt: file.deliveredAt,
          downloadsRevokedAt: blocked ? file.deliveredAt : null, supersededAt: null,
          repair: { originalFileVersionId: original.fileVersionId, releaseId: file.releaseId, deliveredAt: file.deliveredAt, accessExpiresAt: file.accessExpiresAt } });
      }
      ensure(JSON.stringify(await list()) === JSON.stringify(files));
      const lastNow = now().getTime();
      for (const file of replacements.values()) file.repair!.accessExpired = Date.parse(file.repair!.accessExpiresAt) <= lastNow;
      ensure(!line.accessExpiresAt || Date.parse(line.accessExpiresAt) > lastNow);
      result.push({ ...line, supportPolicy: policy, artifacts: line.artifacts.map((file) => replacements.get(file.fileVersionId) ?? file) });
    }
    return result;
  }, 30_000);
}

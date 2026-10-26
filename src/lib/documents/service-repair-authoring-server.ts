import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { boundedServiceErrorIo } from "@/lib/materials/service-error-payload";
import { serviceErrorCanonicalJson, serviceErrorSha256 } from "@/lib/materials/service-error-contract";
import { createServiceRepairStore } from "@/lib/materials/service-repair-store";
import { serviceRepairJobSchema, validateServiceRepairInspection } from "@/lib/materials/service-repair-workflow";
import { readServiceRepairPayload, storeServiceRepairPayload } from "@/lib/materials/service-repair-payload";
import { draftOutputSchema } from "./draft-output";
import { buildRecordedDraftOwnerEditModel } from "./draft-owner-edit";
import { buildServiceRepairAuthoredSource, ServiceRepairAuthoringError } from "./service-repair-authoring";
import { loadServiceRepairOriginalEvidence } from "./service-repair-render-server";
import { serializeDraftRenderSource, type DraftRenderSource } from "./draft-render-source";
import { serializeServiceRepairEnvelope, type ServiceRepairSourceEnvelope } from "./service-repair-source";

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true });
export const serviceRepairAuthoringIdentitySchema = z.object({ caseId: uuid, materialLineId: uuid, versionId: uuid }).strict();
export const serviceRepairSaveSourceSchema = serviceRepairAuthoringIdentitySchema.extend({ requestId: uuid,
  acceptedScopeSha256: hash, contextSha256: hash, members: z.array(z.discriminatedUnion("repairMode", [
    z.object({ originalFileVersionId: uuid, repairMode: z.literal("SOURCE_CORRECTION"), output: draftOutputSchema }).strict(),
    z.object({ originalFileVersionId: uuid, repairMode: z.literal("SOURCE_PRESERVING_RERENDER") }).strict(),
  ])).min(1).max(3) }).strict();
export type ServiceRepairSaveSource = z.infer<typeof serviceRepairSaveSourceSchema>;
type Loaded = Awaited<ReturnType<typeof loadServiceRepairOriginalEvidence>>;
export class ServiceRepairAuthoringServerError extends Error { constructor(readonly code: string) { super(`SERVICE_REPAIR_AUTHORING_SERVER_${code}`); } }
function ensure(value: unknown, code: string): asserts value { if (!value) throw new ServiceRepairAuthoringServerError(code); }
const same = (a: unknown, b: unknown) => serviceErrorCanonicalJson(a) === serviceErrorCanonicalJson(b);
const clean = (loaded?: Loaded) => loaded?.originals.forEach(original => { original.packetBytes.fill(0); original.sourceBytes.fill(0); });
const rowSchema = z.object({ id: uuid, customer_id: uuid, content_sha256: hash, retention_state: z.literal("ACTIVE") }).strict();

/** Actual099 adapter. Entry points require a trusted fresh-MFA caller. Source
 * attachment is immutable; it never reviews wording, renders, approves or sends.
 * The request ID is also the exact payload ID, so an interrupted insert can be
 * read back and compared before any retry. Worker leases stay server-side. */
export function createServiceRepairAuthoringServer(admin: SupabaseClient<Database>, trustedReviewerId: string, options: { now?: () => Date } = {}) {
  const reviewerId = uuid.parse(trustedReviewerId), now = options.now ?? (() => new Date()), store = createServiceRepairStore(admin);
  const bounded = <T,>(signal: AbortSignal, operation: (child: AbortSignal) => Promise<T>) => boundedServiceErrorIo(signal, async child => {
    try { ensure(!child.aborted, "ABORTED"); return await operation(child); }
    catch (error) { throw error instanceof ServiceRepairAuthoringServerError ? error : new ServiceRepairAuthoringServerError("UNCONFIRMED"); }
  }, 60_000);
  async function inspect(identity: z.infer<typeof serviceRepairAuthoringIdentitySchema>, signal: AbortSignal) {
    const value = validateServiceRepairInspection(await store.inspect(identity.caseId, identity.materialLineId, reviewerId, signal),
      { caseId: identity.caseId, materialLineId: identity.materialLineId });
    const version = value.version;
    ensure(!signal.aborted && version && version.id === identity.versionId && value.job?.active_version_id === version.id
      && !version.invalidated_at && !version.release_id && version.accepted_scope_sha256 === value.scope.acceptedScopeSha256
      && version.context_sha256 === value.contextSha256 && same(version.originals, value.originals), "VERSION_CHANGED");
    return value;
  }
  function envelope(request: ServiceRepairSaveSource, loaded: Loaded, createdAt: string): ServiceRepairSourceEnvelope {
    const instant = new Date(time.parse(createdAt));
    ensure(instant.getTime() >= Date.parse(loaded.inspection.version!.created_at) && instant.getTime() <= now().getTime(), "CLOCK_INVALID");
    ensure(request.members.length === loaded.originals.length && new Set(request.members.map(member => member.originalFileVersionId)).size === loaded.originals.length, "SCOPE_CHANGED");
    const members = loaded.originals.map(original => {
      const selected = request.members.find(member => member.originalFileVersionId === original.member.fileVersionId);
      ensure(selected, "SCOPE_CHANGED");
      let source: DraftRenderSource = original.source;
      if (selected.repairMode === "SOURCE_CORRECTION") {
        ensure(original.member.artifactType !== "REFERENCE_SHEET", "LOCAL_FIELDS_IMMUTABLE");
        source = buildServiceRepairAuthoredSource({ source, packet: original.packet, reviewerId, request: {
          requestId: request.requestId, repairVersionId: request.versionId, originalFileVersionId: original.member.fileVersionId,
          originalDraftVersionId: original.member.draftVersionId, expectedSourceSha256: original.member.sourceSha256,
          artifactType: original.member.artifactType, output: selected.output,
        } }, instant);
      }
      return { repairMode: selected.repairMode, originalFileVersionId: original.member.fileVersionId,
        originalSourceSha256: original.member.sourceSha256, packetSha256: original.member.packetSha256,
        renderSourceSha256: source.renderSourceSha256, source: JSON.parse(serializeDraftRenderSource(source)) as unknown };
    });
    return { schemaVersion: "applypack-service-repair-source-v1", caseId: request.caseId, customerId: loaded.inspection.scope.customerId,
      materialLineId: request.materialLineId, repairVersionId: request.versionId, acceptedScopeSha256: request.acceptedScopeSha256,
      contextSha256: request.contextSha256, createdAt, members };
  }
  return {
    read: (raw: unknown, signal: AbortSignal) => bounded(signal, async child => {
      const identity = serviceRepairAuthoringIdentitySchema.parse(raw); let loaded: Loaded | undefined;
      try {
        loaded = await loadServiceRepairOriginalEvidence(admin, reviewerId, identity, child, { now });
        ensure(!child.aborted, "ABORTED");
        return { ...identity, acceptedScopeSha256: loaded.inspection.scope.acceptedScopeSha256, contextSha256: loaded.inspection.contextSha256,
          sourceSaved: Boolean(loaded.inspection.version!.encrypted_payload_id), members: loaded.originals.map(original => ({
            originalFileVersionId: original.member.fileVersionId, artifactType: original.member.artifactType,
            originalSourceSha256: original.member.sourceSha256, title: `${original.packet.ownerEvidence.targetJob.company} — ${original.packet.ownerEvidence.targetJob.exactTitle}`,
            model: original.member.artifactType === "REFERENCE_SHEET" ? null : buildRecordedDraftOwnerEditModel(original.source, original.packet),
          })) };
      } finally { clean(loaded); }
    }),
    save: (raw: unknown, signal: AbortSignal) => saveSource(raw, signal, false),
    check: (raw: unknown, signal: AbortSignal) => saveSource(raw, signal, true),
  };
  function saveSource(raw: unknown, signal: AbortSignal, readOnly: boolean) { return bounded(signal, async child => {
      const request = serviceRepairSaveSourceSchema.parse(raw), identity = { caseId: request.caseId, materialLineId: request.materialLineId, versionId: request.versionId };
      let loaded: Loaded | undefined, savedBytes: Buffer | undefined, bytes: Buffer | undefined;
      try {
        loaded = await loadServiceRepairOriginalEvidence(admin, reviewerId, identity, child, { now });
        ensure(!child.aborted, "ABORTED");
        const before = loaded.inspection, version = before.version!;
        ensure(before.scope.acceptedScopeSha256 === request.acceptedScopeSha256 && before.contextSha256 === request.contextSha256, "VERSION_CHANGED");
        ensure(!version.encrypted_payload_id || version.encrypted_payload_id === request.requestId, "SOURCE_ALREADY_SAVED");
        const found = await admin.from("ap_sensitive_payloads").select("id,customer_id,content_sha256,retention_state")
          .eq("id", request.requestId).abortSignal(child).maybeSingle();
        ensure(!child.aborted && !found.error, "UNCONFIRMED");
        let createdAt = now().toISOString();
        if (found.data !== null) {
          const row = rowSchema.parse(found.data);
          ensure(row.id === request.requestId && row.customer_id === before.scope.customerId, "REQUEST_CONFLICT");
          savedBytes = await readServiceRepairPayload(admin, { customerId: before.scope.customerId, caseId: request.caseId,
            repairVersionId: request.versionId, payloadId: request.requestId, purpose: "SERVICE_REPAIR_SOURCE", sha256: row.content_sha256 }, { signal: child });
          ensure(!child.aborted, "ABORTED");
          const saved: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(savedBytes));
          createdAt = z.object({ createdAt: time }).parse(saved).createdAt;
        } else ensure(!version.encrypted_payload_id, "PAYLOAD_UNAVAILABLE");
        let serialized: ReturnType<typeof serializeServiceRepairEnvelope>;
        try { serialized = serializeServiceRepairEnvelope(envelope(request, loaded, createdAt)); }
        catch (error) {
          // This invocation has performed reads only. A failed request cannot
          // authorize changes to an existing payload or attached source.
          if (!savedBytes && !version.encrypted_payload_id && error instanceof ServiceRepairAuthoringError) {
            throw new ServiceRepairAuthoringServerError("WORDING_INVALID");
          }
          throw error;
        }
        bytes = Buffer.from(serialized.body);
        if (savedBytes) ensure(savedBytes.equals(bytes), "REQUEST_CONFLICT");
        const result = { ...identity, requestId: request.requestId, sourceSha256: serialized.sourceSha256,
          acceptedScopeSha256: request.acceptedScopeSha256, contextSha256: request.contextSha256,
          state: "WORDING_REVIEW_REQUIRED" as const, renderingAuthorized: false as const, deliveryAuthorized: false as const };
        if (version.encrypted_payload_id) {
          ensure(version.source_sha256 === serialized.sourceSha256, "REQUEST_CONFLICT");
          const current = await inspect(identity, child);
          ensure(current.version!.encrypted_payload_id === request.requestId && current.version!.source_sha256 === serialized.sourceSha256, "VERSION_CHANGED");
          return { ...result, replayed: true, retryAllowed: false };
        }
        if (readOnly) {
          const current = await inspect(identity, child);
          ensure(current.contextSha256 === request.contextSha256 && current.scope.acceptedScopeSha256 === request.acceptedScopeSha256, "VERSION_CHANGED");
          if (current.version!.encrypted_payload_id) {
            ensure(current.version!.encrypted_payload_id === request.requestId && current.version!.source_sha256 === serialized.sourceSha256, "VERSION_CHANGED");
            return { ...result, replayed: true, retryAllowed: false };
          }
          return { ...result, state: savedBytes ? "SOURCE_STORED" as const : "NOT_SAVED" as const, replayed: Boolean(savedBytes), retryAllowed: true };
        }
        // Acquire at most once. A lost acquisition is reconciled by the exact
        // request owner and full job inspection; never silently take another lease.
        let current = await inspect(identity, child), job = current.job!;
        ensure(current.contextSha256 === request.contextSha256 && current.scope.acceptedScopeSha256 === request.acceptedScopeSha256, "VERSION_CHANGED");
        if (!(job.lease_owner === request.requestId && job.lease_token && job.lease_expires_at && Date.parse(job.lease_expires_at) > now().getTime())) {
          ensure(!job.lease_expires_at || Date.parse(job.lease_expires_at) <= now().getTime(), "REPAIR_BUSY");
          try {
            const claimed = await admin.rpc("ap_claim_service_repair", { p_version_id: request.versionId, p_owner: request.requestId }).abortSignal(child);
            if (!claimed.error) serviceRepairJobSchema.parse(claimed.data);
          } catch { /* Resolve an uncertain acquisition by its fixed owner. */ }
          current = await inspect(identity, child); job = current.job!;
        }
        ensure(!child.aborted && job.lease_owner === request.requestId && job.lease_token && job.lease_expires_at
          && Date.parse(job.lease_expires_at) > now().getTime() && Date.parse(job.lease_expires_at) <= now().getTime() + 300_000, "LEASE_UNCONFIRMED");
        const leaseToken = job.lease_token;
        const stored = await storeServiceRepairPayload(admin, { customerId: before.scope.customerId, caseId: request.caseId,
          repairVersionId: request.versionId, payloadId: request.requestId, purpose: "SERVICE_REPAIR_SOURCE", sha256: serialized.sourceSha256 }, bytes, { signal: child });
        ensure(!child.aborted && stored.payloadId === request.requestId && stored.sha256 === serviceErrorSha256(bytes), "PAYLOAD_UNCONFIRMED");
        current = await inspect(identity, child);
        ensure(current.job!.lease_owner === request.requestId && current.job!.lease_token === leaseToken
          && current.contextSha256 === request.contextSha256 && current.scope.acceptedScopeSha256 === request.acceptedScopeSha256, "VERSION_CHANGED");
        let acknowledged: unknown;
        try {
          const attached = await admin.rpc("ap_attach_service_repair_source", { p_version_id: request.versionId, p_lease_token: leaseToken,
            p_payload_id: request.requestId, p_source_sha256: serialized.sourceSha256 }).abortSignal(child);
          if (!attached.error) acknowledged = attached.data;
        } catch { /* The immutable version is the only success receipt. */ }
        current = await inspect(identity, child);
        ensure(current.version!.encrypted_payload_id === request.requestId && current.version!.source_sha256 === serialized.sourceSha256
          && (acknowledged === undefined || acknowledged === request.versionId), "ATTACH_UNCONFIRMED");
        return { ...result, replayed: false, retryAllowed: false };
      } finally { clean(loaded); savedBytes?.fill(0); bytes?.fill(0); }
    }); }
}

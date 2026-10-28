import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/database.types";
import { boundedServiceErrorIo } from "@/lib/materials/service-error-payload";
import { serviceErrorCanonicalJson } from "@/lib/materials/service-error-contract";
import { readServiceRepairPayload } from "@/lib/materials/service-repair-payload";
import { validateServiceRepairInspection } from "@/lib/materials/service-repair-workflow";
import { readEncryptedDraftPayload } from "./draft-packet-worker";
import { readConfirmedDraftContact } from "./draft-owner-contact";
import { readServiceRepairReferences } from "./draft-owner-references";
import { readHistoricalDraftingEvidencePacket } from "./drafting-evidence-storage";
import { readBoundDraftRenderEvidence } from "./draft-render-source-storage";
import { assertBoundServiceRepairMember, type ServiceRepairBoundMember, type ServiceRepairOriginalInput } from "./service-repair-source";
import { prepareServiceRepairRender, type ServiceRepairRenderIdentity, type ServiceRepairRenderPort } from "./service-repair-render";

const uuid = z.uuid(), identitySchema = z.object({ caseId: uuid, materialLineId: uuid, versionId: uuid, leaseToken: uuid }).strict();
type Inspection = ReturnType<typeof validateServiceRepairInspection>;
const same = (a: unknown, b: unknown) => serviceErrorCanonicalJson(a) === serviceErrorCanonicalJson(b);
export class ServiceRepairRenderServerError extends Error { constructor(readonly code: string) { super(`SERVICE_REPAIR_RENDER_SERVER_${code}`); } }
function ensure(value: unknown, code: string): asserts value { if (!value) throw new ServiceRepairRenderServerError(code); }
function parse<T>(schema: z.ZodType<T>, raw: unknown): T { const result = schema.safeParse(raw); ensure(result.success, "INPUT_INVALID"); return result.data; }

/** Historical content only, never rendering/dispatch authority. A caller may
 * inspect a newly opened repair before a corrected source or lease exists.
 * Successful byte buffers belong to the caller and must be cleared in finally. */
export async function loadServiceRepairOriginalEvidence(admin: SupabaseClient<Database>, trustedReviewerId: string,
  raw: { caseId: string; materialLineId: string; versionId: string }, signal: AbortSignal, options: { now?: () => Date } = {}) {
  const reviewerId = parse(uuid, trustedReviewerId), identity = parse(identitySchema.omit({ leaseToken: true }), raw), now = options.now ?? (() => new Date());
  return boundedServiceErrorIo(signal, async (child) => {
    const buffers: Buffer[] = []; let transferred = false;
    try {
      const inspect = async () => {
        ensure(!child.aborted, "ABORTED");
        const permission = await admin.rpc("ap_require_material_reviewer", { p_reviewer_id: reviewerId }).abortSignal(child);
        ensure(!child.aborted && !permission.error && permission.data === true, "REVIEWER_UNCONFIRMED");
        const answer = await admin.rpc("ap_inspect_service_repair", { p_case_id: identity.caseId,
          p_material_line_id: identity.materialLineId, p_reviewer_id: reviewerId }).abortSignal(child);
        ensure(!child.aborted && !answer.error, "UNCONFIRMED");
        const inspection = validateServiceRepairInspection(answer.data, { caseId: identity.caseId, materialLineId: identity.materialLineId }), { job, version } = inspection;
        ensure(job && version && job.active_version_id === identity.versionId && version.id === identity.versionId
          && !version.invalidated_at && !version.release_id && version.context_sha256 === inspection.contextSha256
          && version.accepted_scope_sha256 === inspection.scope.acceptedScopeSha256 && same(version.originals, inspection.originals), "VERSION_STALE");
        return inspection;
      };
      const before = await inspect(), originals: Array<ServiceRepairOriginalInput & { source: ReturnType<typeof readBoundDraftRenderEvidence> }> = [];
      const read = async (operation: Promise<Buffer>) => { const bytes = await operation; buffers.push(bytes); ensure(!child.aborted, "ABORTED"); return bytes; };
      for (const original of before.originals) {
        const packetBytes = await read(readEncryptedDraftPayload(admin, { customerId: before.scope.customerId, jobId: original.draftJobId,
          payloadId: original.packetPayloadId, purpose: "MATERIAL_DRAFT_PACKET", sha256: original.packetSha256 }, { signal: child }));
        const packet = readHistoricalDraftingEvidencePacket(packetBytes, original.packetSha256, now());
        ensure(packet.expected.customerId === before.scope.customerId && packet.expected.materialLineId === identity.materialLineId
          && packet.expected.revisionId === original.revisionId && packet.expected.revisionVersion === original.revisionVersion
          && packet.expected.bindingSha256 === original.bindingSha256 && packet.binding.snapshotId === original.sourceSnapshotId, "ORIGINAL_BINDING_CHANGED");
        const sourceBytes = await read(readEncryptedDraftPayload(admin, { customerId: before.scope.customerId, jobId: original.draftJobId,
          payloadId: original.sourcePayloadId, purpose: "MATERIAL_DRAFT_SOURCE", sha256: original.sourceSha256 }, { signal: child }));
        const body = new TextDecoder("utf-8", { fatal: true }).decode(sourceBytes);
        const source = readBoundDraftRenderEvidence({ body, value: JSON.parse(body) as unknown }, original.sourceSha256, packet, now);
        originals.push({ member: structuredClone(original), packet, packetBytes, sourceBytes, source });
      }
      ensure(same(await inspect(), before) && !child.aborted, "READ_CHANGED");
      transferred = true; return { inspection: before, originals };
    } catch (error) { throw error instanceof ServiceRepairRenderServerError ? error : new ServiceRepairRenderServerError("UNCONFIRMED"); }
    finally { if (!transferred) buffers.forEach((bytes) => bytes.fill(0)); }
  }, 20_000);
}

/** Construct only behind a fresh administrator-MFA boundary. The reviewer is
 * trusted session identity, never request JSON. Construction has no I/O, and
 * this factory neither claims a lease nor uploads/approves/sends output. */
export function createServiceRepairRenderServer(admin: SupabaseClient<Database>, trustedReviewerId: string, options: { now?: () => Date } = {}) {
  const reviewerId = parse(uuid, trustedReviewerId), now = options.now ?? (() => new Date());
  const issued = new Map<string, ServiceRepairRenderIdentity>();
  const bounded = <T,>(signal: AbortSignal, operation: (child: AbortSignal) => Promise<T>) => boundedServiceErrorIo(signal, async (child) => {
    try { return await operation(child); }
    catch (error) { throw error instanceof ServiceRepairRenderServerError ? error : new ServiceRepairRenderServerError("UNCONFIRMED"); }
  }, 20_000);
  async function data(query: PromiseLike<{ data: unknown; error: unknown }>, signal: AbortSignal) {
    ensure(!signal.aborted, "ABORTED"); const value = await query; ensure(!signal.aborted && !value.error, "UNCONFIRMED"); return value.data;
  }
  async function reviewer(signal: AbortSignal) {
    ensure(await data(admin.rpc("ap_require_material_reviewer", { p_reviewer_id: reviewerId }).abortSignal(signal), signal) === true, "REVIEWER_UNCONFIRMED");
    return true;
  }
  async function current(raw: ServiceRepairRenderIdentity, signal: AbortSignal): Promise<Inspection> {
    const identity = parse(identitySchema, raw); await reviewer(signal);
    const inspection = validateServiceRepairInspection(await data(admin.rpc("ap_inspect_service_repair", {
      p_case_id: identity.caseId, p_material_line_id: identity.materialLineId, p_reviewer_id: reviewerId,
    }).abortSignal(signal), signal), { caseId: identity.caseId, materialLineId: identity.materialLineId });
    const { job, version } = inspection, clock = now().getTime();
    ensure(Number.isFinite(clock) && job && version && job.active_version_id === identity.versionId && version.id === identity.versionId
      && job.lease_token === identity.leaseToken && job.lease_owner && job.lease_expires_at && Date.parse(job.lease_expires_at) > clock
      && Date.parse(job.lease_expires_at) <= clock + 300_000 && version.invalidated_at === null && version.release_id === null
      && version.context_sha256 === inspection.contextSha256 && version.accepted_scope_sha256 === inspection.scope.acceptedScopeSha256
      && same(version.originals, inspection.originals) && version.encrypted_payload_id && version.source_sha256
      && version.claim_review_encrypted_payload_id && version.claim_review_sha256 && version.claims_reviewed_at
      && Date.parse(version.claims_reviewed_at) <= clock && Date.parse(version.claims_reviewed_at) >= Date.parse(version.created_at)
      && version.claims_reviewed_by && version.claim_review_metadata
      && version.member_set_sha256 === null && version.approval_sha256 === null, "VERSION_STALE");
    issued.set(version.id, identity); return inspection;
  }
  async function memberCurrent(member: ServiceRepairBoundMember, signal: AbortSignal) {
    assertBoundServiceRepairMember(member);
    const identity = issued.get(member.serviceRepair.repairVersionId); ensure(identity, "MEMBER_NOT_ISSUED");
    const inspection = await current(identity, signal), version = inspection.version!;
    ensure(version.source_sha256 === member.serviceRepair.repairSourceSha256 && version.accepted_scope_sha256 === member.serviceRepair.acceptedScopeSha256
      && inspection.scope.customerId === member.packet.expected.customerId && identity.materialLineId === member.original.materialLineId
      && inspection.originals.some((original) => same(original, member.original)), "MEMBER_CHANGED");
    return { identity, inspection };
  }
  const port: ServiceRepairRenderPort = {
    requireReviewer: (requested, signal) => bounded(signal, async (child) => { ensure(requested === reviewerId, "REVIEWER_MISMATCH"); return reviewer(child); }),
    readCurrent: (identity, requested, signal) => bounded(signal, async (child) => { ensure(requested === reviewerId, "REVIEWER_MISMATCH"); return current(identity, child); }),
    loadEvidence: (raw, passed, signal) => bounded(signal, async (child) => {
      const identity = parse(identitySchema, raw), before = await current(identity, child);
      ensure(same(before, validateServiceRepairInspection(passed, { caseId: identity.caseId, materialLineId: identity.materialLineId })), "INSPECTION_CHANGED");
      const version = before.version!, buffers: Buffer[] = []; let transferred = false;
      try {
        const read = async (operation: Promise<Buffer>) => { const bytes = await operation; buffers.push(bytes); ensure(!child.aborted, "ABORTED"); return bytes; };
        const envelopeBytes = await read(readServiceRepairPayload(admin, { customerId: before.scope.customerId, caseId: identity.caseId,
          repairVersionId: version.id, payloadId: version.encrypted_payload_id!, purpose: "SERVICE_REPAIR_SOURCE", sha256: version.source_sha256! }, { signal: child }));
        // Metadata in the transactional099 wording receipt is authority. Reading
        // its exact purpose-bound payload also proves it is still ACTIVE and is
        // not an unrelated case's private review object. It is not a new approval.
        const review = await read(readServiceRepairPayload(admin, { customerId: before.scope.customerId, caseId: identity.caseId,
          repairVersionId: version.id, payloadId: version.claim_review_encrypted_payload_id!, purpose: "SERVICE_REPAIR_CLAIM_REVIEW", sha256: version.claim_review_sha256! }, { signal: child }));
        review.fill(0);
        const loaded = await loadServiceRepairOriginalEvidence(admin, reviewerId, { caseId: identity.caseId,
          materialLineId: identity.materialLineId, versionId: identity.versionId }, child, { now });
        loaded.originals.forEach((original) => buffers.push(original.packetBytes, original.sourceBytes));
        ensure(!child.aborted && same(loaded.inspection, before), "READ_CHANGED");
        const originals = loaded.originals;
        ensure(same(await current(identity, child), before), "READ_CHANGED"); ensure(!child.aborted, "ABORTED");
        transferred = true; return { envelopeBytes, originals };
      } finally { if (!transferred) buffers.forEach((bytes) => bytes.fill(0)); }
    }),
    loadContact: (member, signal) => bounded(signal, async (child) => {
      const before = await memberCurrent(member, child); let bytes: Buffer | undefined, transferred = false;
      try {
        bytes = await readConfirmedDraftContact(admin, { customerId: member.packet.expected.customerId,
          payloadId: member.packet.binding.contactPayloadId, sha256: member.packet.binding.contactSha256 }, child);
        ensure(!child.aborted && same((await memberCurrent(member, child)).inspection, before.inspection), "READ_CHANGED");
        transferred = true; return bytes;
      } finally { if (!transferred) bytes?.fill(0); }
    }),
    loadReferences: (member, signal) => bounded(signal, async (child) => {
      ensure(member.artifactType === "REFERENCE_SHEET", "UNSELECTED_REFERENCE");
      const before = await memberCurrent(member, child); const bytes = await readServiceRepairReferences(admin, member, child, { now });
      let transferred = false;
      try {
        ensure(!child.aborted && same((await memberCurrent(member, child)).inspection, before.inspection), "READ_CHANGED");
        transferred = true; return bytes;
      } finally { if (!transferred) bytes.forEach((item) => item.plaintext.fill(0)); }
    }),
  };
  return { port, prepare: (identity: ServiceRepairRenderIdentity, renderOptions: Parameters<typeof prepareServiceRepairRender>[3] = {}) =>
    prepareServiceRepairRender(port, reviewerId, identity, { ...renderOptions, now }) };
}

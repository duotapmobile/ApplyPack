import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/database.types";
import { readConfirmedDraftContact, DraftOwnerContactError } from "./draft-owner-contact";
import { draftClaimReviewRequestSchema, prepareDraftClaimReview } from "./draft-claim-review";
import { readEncryptedDraftPayload, storeEncryptedDraftPayload } from "./draft-packet-worker";
import { serializeDraftingEvidencePacket, type DraftingEvidencePacket } from "./drafting-evidence";
import { loadDraftingEvidencePacket } from "./drafting-evidence-server";
import { draftOutputSchema, serializeDraftProposal, validateDraftOutput } from "./draft-output";
import { buildDraftRenderSource, serializeDraftRenderSource } from "./draft-render-source";
import { readStoredDraftRenderSource, renderClaimSchema, DraftRenderSourceStorageError } from "./draft-render-source-storage";

type Admin = SupabaseClient<Database>;
const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true });
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const jobColumns = "id,customer_id,material_line_id,line_revision_id,source_snapshot_id,state,active_version_id";
const versionColumns = "id,job_id,customer_id,material_line_id,version,supersedes_id,packet_encrypted_payload_id,packet_sha256,context_sha256,encrypted_payload_id,source_sha256,invalidated_at,member_set_sha256,claim_review_encrypted_payload_id,claim_review_sha256,claim_review_metadata,claims_reviewed_by,claims_reviewed_at";
const jobSchema = z.object({ id: uuid, customer_id: uuid, material_line_id: uuid, line_revision_id: uuid, source_snapshot_id: uuid,
  state: z.literal("SOURCE_READY"), active_version_id: uuid }).strict();
const versionSchema = z.object({ id: uuid, job_id: uuid, customer_id: uuid, material_line_id: uuid, version: z.number().int().positive(), supersedes_id: uuid.nullable(),
  packet_encrypted_payload_id: uuid, packet_sha256: hash, context_sha256: hash, encrypted_payload_id: uuid, source_sha256: hash,
  invalidated_at: time.nullable(), member_set_sha256: z.null(), claim_review_encrypted_payload_id: uuid.nullable(), claim_review_sha256: hash.nullable(),
  claim_review_metadata: z.json(), claims_reviewed_by: uuid.nullable(), claims_reviewed_at: time.nullable() }).strict();
const revisionSchema = z.object({ id: uuid, line_id: uuid, source_snapshot_id: uuid, version: z.number().int().positive(), binding_sha256: hash,
  due_at: time, superseded_at: z.null() }).strict();
const promoteSchema = z.object({ jobId: uuid, expectedVersionId: uuid, expectedSourceSha256: hash, careerBreakFactId: uuid.optional() }).strict();
const reviewSchema = z.object({ jobId: uuid, request: draftClaimReviewRequestSchema }).strict();
const savedReviewSchema = z.object({ schemaVersion: z.literal("applypack-owner-wording-review-v1"), versionId: uuid, packetSha256: hash, sourceSha256: hash,
  reviewerId: uuid, reviewedAt: time, claims: z.array(renderClaimSchema.extend({ decision: z.literal("APPROVED") }).strict()).min(1).max(250) }).strict();
type State = { job: z.infer<typeof jobSchema>; version: z.infer<typeof versionSchema>; revision: z.infer<typeof revisionSchema> };
export class DraftOwnerServerError extends Error {
  constructor(readonly code: string) { super(`DRAFT_OWNER_${code}`); this.name = "DraftOwnerServerError"; }
}
function ensure(value: unknown, code: string): asserts value { if (!value) throw new DraftOwnerServerError(code); }
function parse<T>(schema: z.ZodType<T>, value: unknown, code = "RECEIPT_INVALID"): T {
  const result = schema.safeParse(value); ensure(result.success, code); return result.data;
}
// Exact JSON comparison preserves wording, including whitespace, without making
// property insertion order an authorization or retry requirement.
function exact(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(exact).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${exact(object[key])}`).join(",")}}`;
  }
  throw new DraftOwnerServerError("JSON_INVALID");
}

/** Internal owner data layer, not a client-callable Server Action. Instantiate
 * only after requireAdmin() fresh MFA, with that verified session's user ID.
 * The DB rechecks the reviewer before private reads and again inside each CAS.
 * No method approves a document pair, sends mail, or calls a model provider. */
export function createDraftOwnerServer(admin: Admin, trustedReviewerId: string, options: { now?: () => Date } = {}) {
  const reviewerId = parse(uuid, trustedReviewerId, "REVIEWER_INVALID"), now = options.now ?? (() => new Date());
  async function bounded<T>(external: AbortSignal, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    ensure(!external.aborted, "ABORTED");
    const controller = new AbortController(), abort = () => controller.abort();
    external.addEventListener("abort", abort, { once: true }); if (external.aborted) abort();
    const timer = setTimeout(abort, 60_000); let stop: () => void = () => undefined;
    const interrupted = new Promise<never>((_, reject) => {
      stop = () => reject(new DraftOwnerServerError("ABORTED"));
      if (controller.signal.aborted) stop(); else controller.signal.addEventListener("abort", stop, { once: true });
    });
    try { const result = await Promise.race([operation(controller.signal), interrupted]); ensure(!controller.signal.aborted, "ABORTED"); return result; }
    catch (error) { if (error instanceof DraftOwnerServerError) throw error; throw new DraftOwnerServerError("UNCONFIRMED"); }
    finally { clearTimeout(timer); external.removeEventListener("abort", abort); controller.signal.removeEventListener("abort", stop); controller.abort(); }
  }
  async function data(query: PromiseLike<{ data: unknown; error: unknown }>, signal: AbortSignal) {
    ensure(!signal.aborted, "ABORTED"); const result = await query;
    ensure(!signal.aborted, "ABORTED"); ensure(!result.error, "UNCONFIRMED"); return result.data;
  }
  const authorize = async (signal: AbortSignal) => { await data(admin.rpc("ap_require_material_reviewer", { p_reviewer_id: reviewerId }).abortSignal(signal), signal); };
  const readJob = async (id: string, signal: AbortSignal) => {
    const value = parse(jobSchema, await data(admin.from("ap_material_draft_jobs").select(jobColumns).eq("id", id).abortSignal(signal).single(), signal));
    ensure(value.id === id, "JOB_MISMATCH"); return value;
  };
  const readVersion = async (id: string, signal: AbortSignal) => {
    const value = parse(versionSchema, await data(admin.from("ap_material_draft_versions").select(versionColumns).eq("id", id).abortSignal(signal).single(), signal));
    ensure(value.id === id, "VERSION_MISMATCH"); return value;
  };
  const context = async (id: string, signal: AbortSignal) => parse(hash, await data(admin.rpc("ap_material_draft_context_sha256", { p_job_id: id }).abortSignal(signal), signal));
  async function state(jobId: string, versionId: string, sourceSha256: string, signal: AbortSignal): Promise<State> {
    const job = await readJob(jobId, signal), version = await readVersion(versionId, signal);
    ensure(job.active_version_id === version.id && version.job_id === job.id && version.customer_id === job.customer_id && version.material_line_id === job.material_line_id
      && version.invalidated_at === null && version.source_sha256 === sourceSha256, "VERSION_STALE");
    const revision = parse(revisionSchema, await data(admin.from("ap_material_line_revisions").select("id,line_id,source_snapshot_id,version,binding_sha256,due_at,superseded_at")
      .eq("id", job.line_revision_id).abortSignal(signal).single(), signal));
    ensure(revision.id === job.line_revision_id && revision.line_id === job.material_line_id && revision.source_snapshot_id === job.source_snapshot_id
      && Date.parse(revision.due_at) > now().getTime() && await context(job.id, signal) === version.context_sha256, "CONTEXT_STALE");
    return { job, version, revision };
  }
  async function unchanged(prior: State, signal: AbortSignal) {
    const current = await state(prior.job.id, prior.version.id, prior.version.source_sha256, signal);
    ensure(exact(current) === exact(prior), "STATE_CHANGED"); return current;
  }
  async function payload(state: State, id: string, sha256: string, purpose: "MATERIAL_DRAFT_PACKET" | "MATERIAL_DRAFT_SOURCE" | "MATERIAL_DRAFT_CLAIM_REVIEW", signal: AbortSignal) {
    let bytes: Buffer | undefined;
    try {
      bytes = await readEncryptedDraftPayload(admin, { customerId: state.job.customer_id, jobId: state.job.id, payloadId: id, sha256, purpose }, { signal });
      ensure(!signal.aborted, "ABORTED"); ensure(bytes.length > 0 && bytes.length <= 4_000_000 && digest(bytes) === sha256, "PAYLOAD_INVALID");
      const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes); return { body, value: JSON.parse(body) as unknown };
    } finally { bytes?.fill(0); }
  }
  async function packetFor(current: State, signal: AbortSignal) {
    const saved = await payload(current, current.version.packet_encrypted_payload_id, current.version.packet_sha256, "MATERIAL_DRAFT_PACKET", signal);
    const expected = { customerId: current.job.customer_id, materialLineId: current.job.material_line_id, revisionId: current.revision.id,
      revisionVersion: current.revision.version, bindingSha256: current.revision.binding_sha256 };
    const packet = await loadDraftingEvidencePacket(admin, expected, { signal, now });
    ensure(!signal.aborted && packet.packetSha256 === current.version.packet_sha256 && serializeDraftingEvidencePacket(packet) === saved.body
      && packet.binding.snapshotId === current.job.source_snapshot_id && packet.binding.dueAt === current.revision.due_at, "PACKET_CHANGED");
    return packet;
  }
  async function contactFor(current: State, packet: DraftingEvidencePacket, signal: AbortSignal) {
    try { return await readConfirmedDraftContact(admin, { customerId: current.job.customer_id, payloadId: packet.binding.contactPayloadId, sha256: packet.binding.contactSha256 }, signal); }
    catch (error) { throw new DraftOwnerServerError(error instanceof DraftOwnerContactError ? error.code : "CONTACT_INVALID"); }
  }
  function readSource(saved: { body: string; value: unknown }, current: State, packet: DraftingEvidencePacket) {
    try { return readStoredDraftRenderSource(saved, current.version.source_sha256, packet, now); }
    catch (error) { throw new DraftOwnerServerError(error instanceof DraftRenderSourceStorageError ? error.code : "SOURCE_INVALID"); }
  }
  return {
    promoteSource: (raw: unknown, signal: AbortSignal) => bounded(signal, async (child) => {
      const request = parse(promoteSchema, raw, "INPUT_INVALID"); await authorize(child);
      const current = await state(request.jobId, request.expectedVersionId, request.expectedSourceSha256, child);
      ensure(current.version.claim_review_sha256 === null, "ALREADY_REVIEWED");
      const packet = await packetFor(current, child), saved = await payload(current, current.version.encrypted_payload_id, current.version.source_sha256, "MATERIAL_DRAFT_SOURCE", child);
      const envelope = parse(z.object({ schemaVersion: z.literal("applypack-draft-proposal-v1"), output: draftOutputSchema }).passthrough(), saved.value, "PROPOSAL_REQUIRED");
      const proposal = validateDraftOutput(envelope.output, packet, now());
      ensure(proposal.sourceSha256 === current.version.source_sha256 && serializeDraftProposal(proposal) === saved.body, "PROPOSAL_CHANGED");
      let contact: Buffer | undefined;
      try {
        contact = await contactFor(current, packet, child);
        const source = buildDraftRenderSource({ packet, proposal, contact: { payloadId: packet.binding.contactPayloadId, plaintext: contact },
          finalVersionAt: now().toISOString(), ...(request.careerBreakFactId ? { careerBreakFactId: request.careerBreakFactId } : {}) }, now());
        contact.fill(0); contact = undefined;
        const body = serializeDraftRenderSource(source), payloadId = randomUUID();
        await unchanged(current, child);
        const receipt = await storeEncryptedDraftPayload(admin, { customerId: current.job.customer_id, jobId: current.job.id, payloadId,
          purpose: "MATERIAL_DRAFT_SOURCE", body, sha256: source.renderSourceSha256 }, { signal: child });
        ensure(receipt.payloadId === payloadId && receipt.sha256 === source.renderSourceSha256, "PERSIST_MISMATCH");
        await unchanged(current, child);
        let reported: string | null = null;
        try { reported = parse(uuid, await data(admin.rpc("ap_revise_material_draft_source", { p_version_id: current.version.id,
          p_expected_source_sha256: current.version.source_sha256, p_source_payload_id: payloadId, p_source_sha256: source.renderSourceSha256, p_reviewer_id: reviewerId }).abortSignal(child), child)); }
        catch { ensure(!child.aborted, "RESULT_UNKNOWN"); }
        // A lost response is read back once. Never replay the mutation or delete
        // a payload whose commit status is unknown.
        const job = await readJob(current.job.id, child), next = await readVersion(job.active_version_id, child), prior = await readVersion(current.version.id, child);
        ensure((reported === null || reported === next.id) && next.id !== prior.id && next.supersedes_id === prior.id && next.version === prior.version + 1
          && next.job_id === current.job.id && next.customer_id === current.job.customer_id && next.material_line_id === current.job.material_line_id
          && next.encrypted_payload_id === payloadId && next.source_sha256 === source.renderSourceSha256 && next.invalidated_at === null && prior.invalidated_at !== null
          && next.packet_encrypted_payload_id === current.version.packet_encrypted_payload_id && next.packet_sha256 === current.version.packet_sha256
          && next.context_sha256 === current.version.context_sha256 && next.claim_review_sha256 === null, "RESULT_UNKNOWN");
        await state(job.id, next.id, next.source_sha256, child);
        return { jobId: job.id, versionId: next.id, packetSha256: next.packet_sha256, sourceSha256: next.source_sha256,
          state: "OWNER_REVIEW_REQUIRED" as const, reconciled: reported === null, deliveryAuthorized: false as const };
      } finally { contact?.fill(0); }
    }),
    recordWordingReview: (raw: unknown, signal: AbortSignal) => bounded(signal, async (child) => {
      const { jobId, request } = parse(reviewSchema, raw, "INPUT_INVALID"); await authorize(child);
      const current = await state(jobId, request.versionId, request.sourceSha256, child), packet = await packetFor(current, child);
      const saved = await payload(current, current.version.encrypted_payload_id, current.version.source_sha256, "MATERIAL_DRAFT_SOURCE", child);
      const source = readSource(saved, current, packet), binding = { versionId: current.version.id, packetSha256: current.version.packet_sha256,
        sourceSha256: current.version.source_sha256, customerId: current.job.customer_id, materialLineId: current.job.material_line_id, revisionId: current.revision.id };
      const review = prepareDraftClaimReview({ source, binding, reviewerId, request }, now());
      if (current.version.claim_review_sha256 !== null) {
        ensure(current.version.claim_review_encrypted_payload_id && current.version.claims_reviewed_by === reviewerId && current.version.claims_reviewed_at, "REVIEW_CONFLICT");
        const stored = await payload(current, current.version.claim_review_encrypted_payload_id, current.version.claim_review_sha256, "MATERIAL_DRAFT_CLAIM_REVIEW", child);
        const receipt = parse(savedReviewSchema, stored.value, "REVIEW_INVALID");
        ensure(receipt.versionId === binding.versionId && receipt.sourceSha256 === binding.sourceSha256 && receipt.packetSha256 === binding.packetSha256
          && receipt.reviewerId === reviewerId && Date.parse(receipt.reviewedAt) <= now().getTime()
          && exact(receipt.claims) === exact(source.ownerReviewClaims.map((claim) => ({ ...claim, decision: "APPROVED" })))
          && exact(current.version.claim_review_metadata) === exact(review.metadata), "REVIEW_CONFLICT");
        await unchanged(current, child);
        return { versionId: current.version.id, reviewSha256: current.version.claim_review_sha256, reconciled: true, deliveryAuthorized: false as const };
      }
      ensure(current.version.claim_review_encrypted_payload_id === null && current.version.claims_reviewed_by === null && current.version.claims_reviewed_at === null, "REVIEW_INVALID");
      const payloadId = randomUUID(); await unchanged(current, child);
      const stored = await storeEncryptedDraftPayload(admin, { customerId: current.job.customer_id, jobId, payloadId, purpose: "MATERIAL_DRAFT_CLAIM_REVIEW",
        body: review.body, sha256: review.reviewSha256 }, { signal: child });
      ensure(stored.payloadId === payloadId && stored.sha256 === review.reviewSha256, "PERSIST_MISMATCH"); await unchanged(current, child);
      let reported: string | null = null;
      try { reported = parse(hash, await data(admin.rpc("ap_record_material_draft_claim_review", { p_version_id: current.version.id,
        p_packet_sha256: current.version.packet_sha256, p_source_sha256: current.version.source_sha256, p_review_payload_id: payloadId,
        p_review_sha256: review.reviewSha256, p_claims: review.metadata, p_reviewer_id: reviewerId }).abortSignal(child), child)); }
      catch { ensure(!child.aborted, "RESULT_UNKNOWN"); }
      const latest = await state(jobId, current.version.id, current.version.source_sha256, child);
      ensure((reported === null || reported === review.reviewSha256) && latest.version.claim_review_sha256 === review.reviewSha256
        && latest.version.claim_review_encrypted_payload_id === payloadId && latest.version.claims_reviewed_by === reviewerId && latest.version.claims_reviewed_at
        && exact(latest.version.claim_review_metadata) === exact(review.metadata), "RESULT_UNKNOWN");
      return { versionId: current.version.id, reviewSha256: review.reviewSha256, reconciled: reported === null, deliveryAuthorized: false as const };
    }),
  };
}

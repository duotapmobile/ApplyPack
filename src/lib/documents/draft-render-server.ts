import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { materialContactSchema } from "@/lib/materials/server";
import { checkDocumentRendererReadiness } from "@/lib/operations/renderer-readiness";
import { selectDocumentDelivery } from "./requirements";
import { readEncryptedDraftPayload } from "./draft-packet-worker";
import { loadDraftingEvidencePacket } from "./drafting-evidence-server";
import { serializeDraftingEvidencePacket } from "./drafting-evidence";
import { readStoredDraftRenderSource, renderClaimSchema } from "./draft-render-source-storage";
import { prepareDraftClaimReview } from "./draft-claim-review";
import { readConfirmedDraftContact } from "./draft-owner-contact";
import { draftReferenceRequest, readConfirmedDraftReferences } from "./draft-owner-references";
import { validateDraftReferenceSource, type DraftReferenceInput } from "./draft-reference-source";
import { prepareDraftRender } from "./draft-render";
import { draftRenderClaimSchema, draftRenderStateSchema, clearDraftRenderedPair, type DraftRenderServices, type DraftRenderState,
  type DraftRenderClaim, type DraftRenderRegistration } from "./draft-render-worker";

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true });
const jobColumns = "id,customer_id,material_line_id,line_revision_id,source_snapshot_id,state,active_version_id,lease_owner,lease_token,lease_generation,lease_expires_at";
const jobSchema = z.object({ id: uuid, customer_id: uuid, material_line_id: uuid, line_revision_id: uuid, source_snapshot_id: uuid,
  state: z.string().min(1).max(30), active_version_id: uuid.nullable(), lease_owner: uuid.nullable(), lease_token: uuid.nullable(),
  lease_generation: z.number().int().nonnegative(), lease_expires_at: time.nullable() }).strict();
const versionColumns = "id,job_id,customer_id,material_line_id,packet_encrypted_payload_id,packet_sha256,context_sha256,encrypted_payload_id,source_sha256,invalidated_at,member_set_sha256,claim_review_encrypted_payload_id,claim_review_sha256,claim_review_metadata,claims_reviewed_by,claims_reviewed_at";
const versionSchema = z.object({ id: uuid, job_id: uuid, customer_id: uuid, material_line_id: uuid, packet_encrypted_payload_id: uuid,
  packet_sha256: hash, context_sha256: hash, encrypted_payload_id: uuid, source_sha256: hash, invalidated_at: time.nullable(), member_set_sha256: hash.nullable(),
  claim_review_encrypted_payload_id: uuid, claim_review_sha256: hash, claim_review_metadata: z.json(), claims_reviewed_by: uuid, claims_reviewed_at: time }).strict();
const revisionSchema = z.object({ id: uuid, line_id: uuid, source_snapshot_id: uuid, job_snapshot_id: uuid, employer_rule_snapshot_id: uuid,
  version: z.number().int().positive(), binding_sha256: hash, due_at: time, superseded_at: z.null() }).strict();
const savedReviewSchema = z.object({ schemaVersion: z.literal("applypack-owner-wording-review-v1"), versionId: uuid, packetSha256: hash, sourceSha256: hash,
  reviewerId: uuid, reviewedAt: time, claims: z.array(renderClaimSchema.extend({ decision: z.literal("APPROVED") }).strict()).min(1).max(250) }).strict();
const memberSchema = z.object({ customer_id: uuid, material_line_id: uuid, draft_version_id: uuid, artifact_type: z.enum(["RESUME", "COVER_LETTER", "REFERENCE_SHEET"]),
  artifact_id: uuid, file_version_id: uuid, file_sha256: hash, preview_sha256: hash, source_sha256: hash, editable_source_sha256: hash, editable_source_path_sha256: hash }).strict();
const exact = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(exact).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${exact(entry)}`).join(",")}}`;
};
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function ensure(value: unknown): asserts value { if (!value) throw new Error("DRAFT_RENDER_UNCONFIRMED"); }
function parse<T>(schema: z.ZodType<T>, value: unknown): T { const parsed = schema.safeParse(value); ensure(parsed.success); return parsed.data; }

/** Internal worker ports. Constructor performs no access or scheduling. Runtime
 * switch is independent of provider drafting. Existing immutable wording review
 * authorizes rendering only; pair visual approval and send remain separate. */
export function createDraftRenderServer(admin: SupabaseClient<Database>, options: {
  now?: () => Date;
  // The composition root supplies an isolated client for the same approved
  // target, with its public fetch transport bound to this operation signal.
  uploadClientFactory: (signal: AbortSignal) => SupabaseClient<Database> | null;
}): DraftRenderServices {
  const now = options.now ?? (() => new Date()), enabled = () => process.env.APP_MATERIAL_DRAFT_RENDERING_ENABLED === "true";
  async function bounded<T>(external: AbortSignal, operation: (signal: AbortSignal) => Promise<T>) {
    ensure(!external.aborted && enabled()); const controller = new AbortController(), abort = () => controller.abort();
    external.addEventListener("abort", abort, { once: true }); if (external.aborted) abort();
    let stop: () => void = () => undefined;
    const stopped = new Promise<never>((_, reject) => { stop = () => reject(new Error("DRAFT_RENDER_INTERRUPTED")); controller.signal.addEventListener("abort", stop, { once: true }); });
    const timer = setTimeout(abort, 20_000);
    try { const value = await Promise.race([operation(controller.signal), stopped]); ensure(!controller.signal.aborted && enabled()); return value; }
    finally { clearTimeout(timer); external.removeEventListener("abort", abort); controller.signal.removeEventListener("abort", stop); controller.abort(); }
  }
  async function data(query: PromiseLike<{ data: unknown; error: unknown }>, signal: AbortSignal) {
    ensure(!signal.aborted && enabled()); const result = await query; ensure(!signal.aborted && enabled() && !result.error); return result.data;
  }
  const job = async (id: string, signal: AbortSignal) => { const row = parse(jobSchema, await data(admin.from("ap_material_draft_jobs").select(jobColumns).eq("id", id).abortSignal(signal).single(), signal)); ensure(row.id === id); return row; };
  const version = async (id: string, signal: AbortSignal) => { const row = parse(versionSchema, await data(admin.from("ap_material_draft_versions").select(versionColumns).eq("id", id).abortSignal(signal).single(), signal)); ensure(row.id === id); return row; };
  const context = async (id: string, signal: AbortSignal) => parse(hash, await data(admin.rpc("ap_material_draft_context_sha256", { p_job_id: id }).abortSignal(signal), signal));
  async function state(claim: DraftRenderClaim, signal: AbortSignal) {
    const j = await job(claim.jobId, signal);
    ensure(["SOURCE_READY", "RENDERING"].includes(j.state) && j.active_version_id && j.lease_owner === claim.ownerId && j.lease_token === claim.leaseToken
      && j.lease_expires_at && Date.parse(j.lease_expires_at) > now().getTime());
    const v = await version(j.active_version_id, signal);
    ensure(v.job_id === j.id && v.customer_id === j.customer_id && v.material_line_id === j.material_line_id && v.invalidated_at === null && v.member_set_sha256 === null
      && Date.parse(v.claims_reviewed_at) <= now().getTime());
    const r = parse(revisionSchema, await data(admin.from("ap_material_line_revisions").select("id,line_id,source_snapshot_id,job_snapshot_id,employer_rule_snapshot_id,version,binding_sha256,due_at,superseded_at")
      .eq("id", j.line_revision_id).abortSignal(signal).single(), signal));
    ensure(r.id === j.line_revision_id && r.line_id === j.material_line_id && r.source_snapshot_id === j.source_snapshot_id && Date.parse(r.due_at) > now().getTime());
    const line = parse(z.object({ id: uuid, selected_reference_sheet: z.boolean(), active_revision: z.number().int().positive() }).strict(),
      await data(admin.from("ap_material_lines").select("id,selected_reference_sheet,active_revision").eq("id", j.material_line_id).abortSignal(signal).single(), signal));
    ensure(line.id === j.material_line_id && line.active_revision === r.version);
    const rule = parse(z.object({ id: uuid, job_snapshot_id: uuid, allowed_formats: z.array(z.enum(["PDF", "DOCX"])).min(1).max(2), is_current: z.literal(true), hard_block_reason: z.null(), injection_scan_state: z.literal("CLEAR") }).strict(),
      await data(admin.from("ap_employer_submission_rules").select("id,job_snapshot_id,allowed_formats,is_current,hard_block_reason,injection_scan_state").eq("id", r.employer_rule_snapshot_id).abortSignal(signal).single(), signal));
    ensure(rule.id === r.employer_rule_snapshot_id && rule.job_snapshot_id === r.job_snapshot_id);
    const configuration = parse(z.object({ material_output_formats: z.array(z.enum(["PDF", "DOCX"])).min(1).max(2), document_renderer_identity: z.string().min(1).max(255) }).strict(),
      await data(admin.from("ap_commerce_configuration").select("material_output_formats,document_renderer_identity").eq("singleton", true).abortSignal(signal).single(), signal));
    const request = parse(z.object({ id: uuid, customer_id: uuid, material_line_id: uuid, delivery_format: z.literal("DOCX"), request_reference_sha256: hash, recorded_at: time }).strict().nullable(),
      await data(admin.from("ap_applicant_document_format_requests").select("id,customer_id,material_line_id,delivery_format,request_reference_sha256,recorded_at")
        .eq("material_line_id", j.material_line_id).abortSignal(signal).maybeSingle(), signal));
    ensure(!request || request.customer_id === j.customer_id && request.material_line_id === j.material_line_id && Date.parse(request.recorded_at) <= now().getTime());
    const existing = parse(z.array(z.object({ id: uuid, customer_id: uuid, material_line_id: uuid, source_line_revision_id: uuid,
      source_snapshot_id: uuid, job_snapshot_id: uuid, artifact_type: z.enum(["RESUME", "COVER_LETTER", "REFERENCE_SHEET"]) }).strict()).max(3),
      await data(admin.from("ap_generated_artifacts").select("id,customer_id,material_line_id,source_line_revision_id,source_snapshot_id,job_snapshot_id,artifact_type")
        .eq("material_line_id", j.material_line_id).eq("source_line_revision_id", r.id).in("artifact_type", ["RESUME", "COVER_LETTER", "REFERENCE_SHEET"]).abortSignal(signal), signal));
    ensure(new Set(existing.map((row) => row.artifact_type)).size === existing.length && new Set(existing.map((row) => row.id)).size === existing.length
      && existing.every((row) => row.customer_id === j.customer_id && row.material_line_id === j.material_line_id && row.source_line_revision_id === r.id
        && row.source_snapshot_id === r.source_snapshot_id && row.job_snapshot_id === r.job_snapshot_id));
    const decision = selectDocumentDelivery(rule.allowed_formats, configuration.material_output_formats, Boolean(request)); ensure(decision);
    ensure(decision.reason !== "EMPLOYER_REQUIREMENT" || !rule.allowed_formats.includes("PDF"));
    ensure(await context(j.id, signal) === v.context_sha256);
    parse(z.literal(true), await data(admin.rpc("ap_require_material_reviewer", { p_reviewer_id: v.claims_reviewed_by }).abortSignal(signal), signal));
    ensure(exact(await job(j.id, signal)) === exact(j) && exact(await version(v.id, signal)) === exact(v));
    return draftRenderStateSchema.parse({ jobId: j.id, ownerId: claim.ownerId, leaseToken: claim.leaseToken, customerId: j.customer_id, materialLineId: j.material_line_id,
      revisionId: r.id, revisionVersion: r.version, bindingSha256: r.binding_sha256, snapshotId: r.source_snapshot_id, jobSnapshotId: r.job_snapshot_id,
      ruleId: rule.id, dueAt: r.due_at, leaseGeneration: j.lease_generation, leaseExpiresAt: j.lease_expires_at, versionId: v.id,
      packetPayloadId: v.packet_encrypted_payload_id, packetSha256: v.packet_sha256, contextSha256: v.context_sha256, sourcePayloadId: v.encrypted_payload_id, sourceSha256: v.source_sha256,
      reviewPayloadId: v.claim_review_encrypted_payload_id, reviewSha256: v.claim_review_sha256, reviewerId: v.claims_reviewed_by, reviewedAt: v.claims_reviewed_at,
      selectedReferenceSheet: line.selected_reference_sheet, rendererIdentity: configuration.document_renderer_identity,
      existingArtifactIds: { RESUME: existing.find((row) => row.artifact_type === "RESUME")?.id ?? null, COVER_LETTER: existing.find((row) => row.artifact_type === "COVER_LETTER")?.id ?? null,
        REFERENCE_SHEET: existing.find((row) => row.artifact_type === "REFERENCE_SHEET")?.id ?? null },
      delivery: { ...decision, employerRuleId: rule.id, applicantRequestId: request?.id ?? null, requestReferenceSha256: request?.request_reference_sha256 ?? null } });
  }
  async function same(expected: DraftRenderState, signal: AbortSignal) {
    const current = await state({ jobId: expected.jobId, ownerId: expected.ownerId, leaseToken: expected.leaseToken }, signal);
    const fixed = ({ leaseExpiresAt: _expiry, ...value }: DraftRenderState) => { void _expiry; return value; };
    ensure(exact(fixed(current)) === exact(fixed(expected))); return true as const;
  }
  async function payload(s: DraftRenderState, id: string, sha256: string, purpose: "MATERIAL_DRAFT_PACKET" | "MATERIAL_DRAFT_SOURCE" | "MATERIAL_DRAFT_CLAIM_REVIEW", signal: AbortSignal) {
    let bytes: Buffer | undefined;
    try { bytes = await readEncryptedDraftPayload(admin, { customerId: s.customerId, jobId: s.jobId, payloadId: id, sha256, purpose }, { signal });
      ensure(!signal.aborted && bytes.length > 0 && bytes.length <= 4_000_000 && digest(bytes) === sha256);
      const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes); return { body, value: JSON.parse(body) as unknown }; }
    finally { bytes?.fill(0); }
  }
  return {
    enabled,
    readState: (raw, signal) => bounded(signal, async (child) => {
      const claim = parse(draftRenderClaimSchema, raw); ensure(await checkDocumentRendererReadiness(admin)); ensure(!child.aborted); return state(claim, child);
    }),
    recheck: (raw, signal) => bounded(signal, async (child) => {
      const s = parse(draftRenderStateSchema, raw); ensure(await checkDocumentRendererReadiness(admin)); ensure(!child.aborted); return same(s, child);
    }),
    renewLease: (raw, signal) => bounded(signal, async (child) => {
      const claim = parse(draftRenderClaimSchema, raw); const lease = parse(time, await data(admin.rpc("ap_renew_material_draft_lease", { p_job_id: claim.jobId, p_lease_token: claim.leaseToken }).abortSignal(child), child));
      ensure(Date.parse(lease) > now().getTime()); return lease;
    }),
    loadEvidence: (raw, signal) => bounded(signal, async (child) => {
      const s = parse(draftRenderStateSchema, raw); await same(s, child);
      const saved = await payload(s, s.packetPayloadId, s.packetSha256, "MATERIAL_DRAFT_PACKET", child);
      const packet = await loadDraftingEvidencePacket(admin, { customerId: s.customerId, materialLineId: s.materialLineId, revisionId: s.revisionId,
        revisionVersion: s.revisionVersion, bindingSha256: s.bindingSha256 }, { signal: child, now });
      ensure(!child.aborted && packet.packetSha256 === s.packetSha256 && serializeDraftingEvidencePacket(packet) === saved.body && packet.binding.snapshotId === s.snapshotId
        && packet.binding.jobSnapshotId === s.jobSnapshotId && packet.binding.ruleId === s.ruleId && packet.binding.dueAt === s.dueAt);
      const source = readStoredDraftRenderSource(await payload(s, s.sourcePayloadId, s.sourceSha256, "MATERIAL_DRAFT_SOURCE", child), s.sourceSha256, packet, now);
      const reviewBytes = await payload(s, s.reviewPayloadId, s.reviewSha256, "MATERIAL_DRAFT_CLAIM_REVIEW", child), review = parse(savedReviewSchema, reviewBytes.value);
      ensure(review.versionId === s.versionId && review.packetSha256 === s.packetSha256 && review.sourceSha256 === s.sourceSha256
        && review.reviewerId === s.reviewerId && Date.parse(review.reviewedAt) <= now().getTime()
        && exact(review.claims) === exact(source.ownerReviewClaims.map((claim) => ({ ...claim, decision: "APPROVED" }))));
      const rebuilt = prepareDraftClaimReview({ source, binding: { versionId: s.versionId, packetSha256: s.packetSha256, sourceSha256: s.sourceSha256,
        customerId: s.customerId, materialLineId: s.materialLineId, revisionId: s.revisionId }, reviewerId: s.reviewerId,
        request: { versionId: s.versionId, packetSha256: s.packetSha256, sourceSha256: s.sourceSha256,
          claims: review.claims.map((claim) => ({ claimId: claim.claimId, wordingSha256: claim.wordingSha256, decision: claim.decision })) } }, new Date(review.reviewedAt));
      const v = await version(s.versionId, child);
      ensure(rebuilt.body === reviewBytes.body && rebuilt.reviewSha256 === s.reviewSha256 && exact(rebuilt.metadata) === exact(v.claim_review_metadata));
      let contactBytes: Buffer | undefined; let references: DraftReferenceInput[] = [];
      try {
        contactBytes = await readConfirmedDraftContact(admin, { customerId: s.customerId, payloadId: packet.binding.contactPayloadId, sha256: packet.binding.contactSha256 }, child);
        ensure(!child.aborted); const contact = materialContactSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(contactBytes)));
        for (const claim of source.ownerReviewClaims.filter((claim) => claim.origin === "LOCAL_CONTACT")) {
          ensure(claim.contactBinding?.payloadId === packet.binding.contactPayloadId && claim.contactBinding.contentSha256 === packet.binding.contactSha256 && claim.contactBinding.fields.length === 1);
          const field = claim.contactBinding.fields[0]; ensure(Object.hasOwn(contact, field) && claim.text === contact[field as keyof typeof contact]);
        }
        const request = draftReferenceRequest(packet);
        ensure(Boolean(request) === s.selectedReferenceSheet && Boolean(source.referenceSheet) === s.selectedReferenceSheet);
        if (request) references = await readConfirmedDraftReferences(admin, request, child, { now });
        ensure(!child.aborted);
        validateDraftReferenceSource(source.referenceSheet, packet.ownerEvidence.referenceBindings, references, now());
      } finally { contactBytes?.fill(0); references.forEach((reference) => reference.plaintext.fill(0)); }
      await same(s, child); return { source, packet };
    }),
    render: async (input, signal) => {
      ensure(!signal.aborted && enabled()); const pair = await prepareDraftRender(input, { now });
      if (signal.aborted || !enabled()) { clearDraftRenderedPair(pair); throw new Error("DRAFT_RENDER_INTERRUPTED"); } return pair;
    },
    persistUploadIntents: (raw, signal) => bounded(signal, async (child) => {
      const uploads = parse(z.array(z.object({ bucket: z.enum(["operator-drafts", "operator-render-previews", "customer-deliveries"]), path: z.string().min(1).max(600) }).strict()).refine((items) => items.length === 6 || items.length === 9), raw);
      ensure(new Set(uploads.map((item) => `${item.bucket}/${item.path}`)).size === uploads.length);
      await data(admin.from("storage_cleanup_queue").upsert(uploads.map((upload) => ({ bucket: upload.bucket, storage_path: upload.path,
        reason: "material_sensitive_upload_intent", attempts: 0, last_error: null, last_attempt_at: null, not_before: new Date(now().getTime() + 3_600_000).toISOString() })), { onConflict: "bucket,storage_path" }).abortSignal(child), child);
    }),
    upload: (input, signal) => bounded(signal, async (child) => {
      ensure(input.bytes.length > 0 && input.bytes.length <= 10 * 1024 * 1024 && !child.aborted);
      // Storage's upload options omit AbortSignal. Bind cancellation through an
      // isolated client's public fetch hook; never mutate the shared client.
      const uploadClient = options.uploadClientFactory(child); ensure(uploadClient && !child.aborted);
      const result = await uploadClient.storage.from(input.bucket).upload(input.path, input.bytes, { contentType: input.mimeType, cacheControl: "0", upsert: false });
      // `path` is echoed by the SDK. Id and Key must also have been returned by
      // Storage, rather than treating an empty 2xx body as a successful upload.
      ensure(!child.aborted && !result.error && result.data?.path === input.path && uuid.safeParse(result.data.id).success
        && result.data.fullPath === `${input.bucket}/${input.path}`);
    }),
    commit: (raw, registrations, signal) => bounded(signal, async (child) => {
      const s = parse(draftRenderStateSchema, raw); await same(s, child);
      return data(admin.rpc("ap_commit_material_draft_pair", { p_job_id: s.jobId, p_lease_token: s.leaseToken, p_version_id: s.versionId,
        p_packet_sha256: s.packetSha256, p_source_sha256: s.sourceSha256, p_registrations: registrations as Json }).abortSignal(child), child);
    }),
    readCommitted: (raw, registrations, signal) => bounded(signal, async (child) => {
      const s = parse(draftRenderStateSchema, raw), v = await version(s.versionId, child), j = await job(s.jobId, child);
      ensure(j.id === v.job_id && j.customer_id === s.customerId && j.material_line_id === s.materialLineId && j.active_version_id === v.id && j.state === "REVIEW_READY"
        && j.line_revision_id === s.revisionId && j.source_snapshot_id === s.snapshotId && v.customer_id === s.customerId && v.material_line_id === s.materialLineId
        && v.packet_encrypted_payload_id === s.packetPayloadId && v.packet_sha256 === s.packetSha256 && v.context_sha256 === s.contextSha256
        && v.encrypted_payload_id === s.sourcePayloadId && v.source_sha256 === s.sourceSha256 && v.claim_review_encrypted_payload_id === s.reviewPayloadId
        && v.claim_review_sha256 === s.reviewSha256 && v.claims_reviewed_by === s.reviewerId && v.claims_reviewed_at === s.reviewedAt && v.member_set_sha256 && !v.invalidated_at);
      const expectedTypes = ["RESUME", "COVER_LETTER", ...(s.selectedReferenceSheet ? ["REFERENCE_SHEET"] : [])].sort();
      const members = parse(z.array(memberSchema).length(expectedTypes.length), await data(admin.from("ap_material_draft_members")
        .select("customer_id,material_line_id,draft_version_id,artifact_type,artifact_id,file_version_id,file_sha256,preview_sha256,source_sha256,editable_source_sha256,editable_source_path_sha256")
        .eq("draft_version_id", s.versionId).abortSignal(child), child));
      ensure(exact(registrations.map((registration) => registration.p_artifact_type).sort()) === exact(expectedTypes)
        && exact(members.map((member) => member.artifact_type).sort()) === exact(expectedTypes)
        && new Set(members.map((member) => member.artifact_id)).size === expectedTypes.length
        && new Set(members.map((member) => member.file_version_id)).size === expectedTypes.length);
      for (const registration of registrations) await verifyMember(s, registration, members, child);
      ensure(await context(s.jobId, child) === s.contextSha256 && exact(await version(v.id, child)) === exact(v) && exact(await job(j.id, child)) === exact(j));
      return { jobId: s.jobId, versionId: v.id, packetSha256: v.packet_sha256, sourceSha256: v.source_sha256, reviewSha256: v.claim_review_sha256,
        memberSetSha256: v.member_set_sha256, current: true };
    }),
  };

  async function verifyMember(s: DraftRenderState, expected: DraftRenderRegistration, members: z.infer<typeof memberSchema>[], signal: AbortSignal) {
    const member = members.find((row) => row.artifact_type === expected.p_artifact_type); ensure(member);
    const provenance = expected.p_claim_provenance as Record<string, Json>, editable = provenance.editableSource as Record<string, string>;
    // PostgreSQL jsonb array text inserts one separator space. Paths are exact
    // JSON strings; do not normalize their spelling or Unicode bytes.
    const pathDigest = digest(`[${JSON.stringify(editable.storageBucket)}, ${JSON.stringify(editable.storagePath)}]`);
    ensure(member.customer_id === s.customerId && member.material_line_id === s.materialLineId && member.draft_version_id === s.versionId
      && member.artifact_id === expected.p_artifact_id && member.file_version_id === expected.p_file_version_id && member.file_sha256 === expected.p_checksum_sha256
      && member.preview_sha256 === expected.p_render_preview_sha256 && member.source_sha256 === s.sourceSha256 && member.editable_source_sha256 === editable.checksumSha256
      && member.editable_source_path_sha256 === pathDigest);
    const artifact = await data(admin.from("ap_generated_artifacts").select("id,customer_id,material_line_id,source_line_revision_id,source_snapshot_id,job_snapshot_id,artifact_type,generator_version,claim_provenance,current_file_version")
      .eq("id", member.artifact_id).abortSignal(signal).single(), signal) as Record<string, unknown>;
    ensure(artifact && artifact.id === member.artifact_id && artifact.customer_id === s.customerId && artifact.material_line_id === s.materialLineId
      && artifact.source_line_revision_id === s.revisionId && artifact.source_snapshot_id === s.snapshotId && artifact.job_snapshot_id === s.jobSnapshotId
      && artifact.artifact_type === expected.p_artifact_type && artifact.generator_version === expected.p_generator_version && exact(artifact.claim_provenance) === exact(provenance));
    const file = await data(admin.from("ap_generated_file_versions").select("id,artifact_id,version,checksum_sha256,storage_bucket,storage_path,safe_filename,mime_type,size_bytes,package_qa_sha256,binding_sha256,superseded_at,downloads_revoked_at")
      .eq("id", member.file_version_id).abortSignal(signal).single(), signal) as Record<string, unknown>;
    ensure(file && file.id === member.file_version_id && file.artifact_id === member.artifact_id && file.version === artifact.current_file_version
      && file.checksum_sha256 === expected.p_checksum_sha256 && file.storage_bucket === expected.p_storage_bucket && file.storage_path === expected.p_storage_path
      && file.safe_filename === expected.p_safe_filename && file.mime_type === expected.p_mime_type && file.size_bytes === expected.p_size_bytes
      && file.package_qa_sha256 === expected.p_package_qa_sha256 && file.binding_sha256 === s.bindingSha256 && file.superseded_at === null && file.downloads_revoked_at === null);
    const qa = await data(admin.from("ap_artifact_quality_reviews").select("file_version_id,automated_passed_at,invalidated_at,render_preview_bucket,render_preview_path,render_preview_sha256,extracted_text_sha256,structural_checks,provenance_checks")
      .eq("file_version_id", member.file_version_id).abortSignal(signal).single(), signal) as Record<string, unknown>;
    ensure(qa && qa.file_version_id === member.file_version_id && time.safeParse(qa.automated_passed_at).success && qa.invalidated_at === null
      && qa.render_preview_bucket === expected.p_render_preview_bucket && qa.render_preview_path === expected.p_render_preview_path && qa.render_preview_sha256 === expected.p_render_preview_sha256
      && qa.extracted_text_sha256 === expected.p_extracted_text_sha256 && exact(qa.structural_checks) === exact(expected.p_structural_checks) && exact(qa.provenance_checks) === exact(expected.p_provenance_checks));
  }
}

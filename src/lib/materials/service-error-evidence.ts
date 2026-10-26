import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/database.types";
import { draftingEvidenceExpectationSchema, draftingEvidenceRecordsSchema, DRAFTING_EVIDENCE_VERSION } from "@/lib/documents/drafting-evidence";
import { renderClaimSchema } from "@/lib/documents/draft-render-source-storage";
import { readEncryptedDraftPayload } from "@/lib/documents/draft-packet-worker";
import { readConfirmedDraftContact } from "@/lib/documents/draft-owner-contact";
import { confirmationReceiptSchema } from "@/lib/intake/confirmed-review";
import { materialContactSchema } from "./server";
import { boundedServiceErrorIo } from "./service-error-payload";
import { ServiceErrorContractError, serviceErrorCanonicalJson, serviceErrorMemberSchema, serviceErrorSha256 } from "./service-error-contract";

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true });
const memberColumns = "customer_id,material_line_id,draft_version_id,artifact_type,artifact_id,file_version_id,file_sha256,preview_sha256,source_sha256";
const memberSchema = z.object({ customer_id: uuid, material_line_id: uuid, draft_version_id: uuid,
  artifact_type: z.enum(["RESUME", "COVER_LETTER", "REFERENCE_SHEET"]), artifact_id: uuid, file_version_id: uuid,
  file_sha256: hash, preview_sha256: hash, source_sha256: hash }).strict();
const versionColumns = "id,job_id,customer_id,material_line_id,packet_encrypted_payload_id,packet_sha256,encrypted_payload_id,source_sha256,release_id,approved_at,approved_by";
const versionSchema = z.object({ id: uuid, job_id: uuid, customer_id: uuid, material_line_id: uuid,
  packet_encrypted_payload_id: uuid, packet_sha256: hash, encrypted_payload_id: uuid, source_sha256: hash,
  release_id: uuid, approved_at: time, approved_by: uuid }).strict();
const fileColumns = "id,artifact_id,checksum_sha256,safe_filename,version,binding_sha256";
const fileSchema = z.object({ id: uuid, artifact_id: uuid, checksum_sha256: hash, safe_filename: z.string().min(1).max(255),
  version: z.number().int().positive(), binding_sha256: hash }).strict();
const artifactColumns = "id,customer_id,material_line_id,source_line_revision_id,source_snapshot_id,artifact_type,retention_state";
const artifactSchema = z.object({ id: uuid, customer_id: uuid, material_line_id: uuid, source_line_revision_id: uuid,
  source_snapshot_id: uuid, artifact_type: memberSchema.shape.artifact_type, retention_state: z.literal("ACTIVE") }).strict();
const releaseColumns = "id,customer_id,material_line_id,committed_at,version_bundle";
const releaseSchema = z.object({ id: uuid, customer_id: uuid, material_line_id: uuid, committed_at: time, version_bundle: z.json() }).strict();
const packetProjectionSchema = z.object({ schemaVersion: z.literal(DRAFTING_EVIDENCE_VERSION),
  expected: draftingEvidenceExpectationSchema, validUntil: time,
  binding: z.object({ snapshotId: uuid, snapshotSha256: hash, contactPayloadId: uuid, contactSha256: hash,
    confirmationReceipt: confirmationReceiptSchema }).passthrough(),
  ownerEvidence: z.object({ contactFact: draftingEvidenceRecordsSchema.shape.contactFact,
    facts: draftingEvidenceRecordsSchema.shape.facts, sourceFacts: draftingEvidenceRecordsSchema.shape.sourceFacts,
    sourceReviews: draftingEvidenceRecordsSchema.shape.factReviews, documents: draftingEvidenceRecordsSchema.shape.documents,
    targetJob: z.object({ id: uuid, company: z.string().max(1000), exactTitle: z.string().max(1000), contentSha256: hash }).passthrough(),
  }).passthrough(),
}).passthrough();
const sourceProjectionSchema = z.object({ schemaVersion: z.literal("applypack-draft-render-source-v1"), expected: draftingEvidenceExpectationSchema,
  packetSha256: hash, contactPayloadId: uuid, contactSha256: hash, ownerReviewClaims: z.array(renderClaimSchema).max(250) }).passthrough();
function ensure(value: unknown, code = "DELIVERY_EVIDENCE_UNAVAILABLE"): asserts value { if (!value) throw new ServiceErrorContractError(code); }
function parse<T>(schema: z.ZodType<T>, raw: unknown): T { const result = schema.safeParse(raw); ensure(result.success); return result.data; }
function decode(bytes: Buffer, digest: string): unknown {
  ensure(serviceErrorSha256(bytes) === digest);
  const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes), value: unknown = JSON.parse(body);
  ensure(serviceErrorCanonicalJson(value) === body); return value;
}

/** A strict read projection of the exact bytes used for a delivered file.
 * Expired employer checks are preserved as historical facts. This function
 * never refreshes or extends their authority and returns no renderer input. */
export function readHistoricalServiceErrorEvidence(input: {
  packetBytes: Buffer; sourceBytes: Buffer; packetSha256: string; sourceSha256: string;
  customerId: string; materialLineId: string; revisionId: string; bindingSha256: string; snapshotId: string;
  contactBytes: Buffer; artifactType: "RESUME" | "COVER_LETTER" | "REFERENCE_SHEET";
}) {
  const packet = parse(packetProjectionSchema, decode(input.packetBytes, input.packetSha256));
  const source = parse(sourceProjectionSchema, decode(input.sourceBytes, input.sourceSha256));
  ensure(packet.expected.customerId === input.customerId && packet.expected.materialLineId === input.materialLineId
    && packet.expected.revisionId === input.revisionId && packet.expected.bindingSha256 === input.bindingSha256 && packet.binding.snapshotId === input.snapshotId
    && serviceErrorCanonicalJson(source.expected) === serviceErrorCanonicalJson(packet.expected) && source.packetSha256 === input.packetSha256
    && source.contactPayloadId === packet.binding.contactPayloadId && source.contactSha256 === packet.binding.contactSha256);
  const contactFact = packet.ownerEvidence.contactFact;
  ensure(contactFact.customer_id === input.customerId && contactFact.id === packet.binding.contactPayloadId
    && contactFact.typed_value.protectedPayloadId === packet.binding.contactPayloadId && contactFact.typed_value.contentSha256 === packet.binding.contactSha256
    && serviceErrorSha256(input.contactBytes) === packet.binding.contactSha256);
  const contact = parse(materialContactSchema, JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input.contactBytes)));
  const facts = packet.ownerEvidence.facts, sourceFacts = packet.ownerEvidence.sourceFacts;
  ensure(facts.every((fact) => fact.snapshot_id === packet.binding.snapshotId && (fact.customer_id === null || fact.customer_id === input.customerId))
    && new Set(facts.map((fact) => fact.id)).size === facts.length
    && source.ownerReviewClaims.every((claim) => serviceErrorSha256(Buffer.from(claim.text, "utf8")) === claim.wordingSha256)
    && new Set(source.ownerReviewClaims.map((claim) => claim.claimId)).size === source.ownerReviewClaims.length);
  const prefix = input.artifactType === "RESUME" ? "resume." : input.artifactType === "COVER_LETTER" ? "coverLetter." : "referenceSheet.";
  return { evidenceMode: "HISTORICAL_DELIVERY_REVIEW" as const, renderingAuthorized: false as const,
    confirmation: packet.binding.confirmationReceipt, snapshotId: packet.binding.snapshotId, contactFactId: contactFact.id, contact,
    facts, sourceFacts, sourceReviews: packet.ownerEvidence.sourceReviews, documents: packet.ownerEvidence.documents,
    targetJob: { company: packet.ownerEvidence.targetJob.company, title: packet.ownerEvidence.targetJob.exactTitle },
    originalEvidenceValidUntil: packet.validUntil, claims: source.ownerReviewClaims.filter((claim) => claim.placement.startsWith(prefix)) };
}

/** Fresh MFA is required by the page/route caller. Exact role verification and
 * immutable member/release joins precede decryption. Historical currentness is
 * checked by exact reread, not by pretending the original paid deadline moved. */
export function createServiceErrorEvidenceReader(admin: SupabaseClient<Database>, trustedReviewerId: string) {
  const reviewerId = parse(uuid, trustedReviewerId);
  async function data(query: PromiseLike<{ data: unknown; error: unknown }>, signal: AbortSignal) {
    ensure(!signal.aborted); const result = await query; ensure(!signal.aborted && !result.error); return result.data;
  }
  return (customerIdRaw: string, memberRaw: unknown, external: AbortSignal) => boundedServiceErrorIo(external, async (signal) => {
    const customerId = parse(uuid, customerIdRaw), selected = parse(serviceErrorMemberSchema, memberRaw);
    parse(z.literal(true), await data(admin.rpc("ap_require_material_reviewer", { p_reviewer_id: reviewerId }).abortSignal(signal), signal));
    const load = async () => {
      const members = parse(z.array(memberSchema).min(1).max(30), await data(admin.from("ap_material_draft_members").select(memberColumns)
        .eq("artifact_id", selected.artifactId).eq("file_version_id", selected.fileVersionId).eq("customer_id", customerId).limit(31).abortSignal(signal), signal));
      const versions = parse(z.array(versionSchema).min(1).max(30), await data(admin.from("ap_material_draft_versions").select(versionColumns)
        .in("id", members.map((member) => member.draft_version_id)).eq("release_id", selected.releaseId).eq("customer_id", customerId).limit(31).abortSignal(signal), signal));
      ensure(versions.length === 1); const version = versions[0], member = members.find((entry) => entry.draft_version_id === version.id); ensure(member);
      const artifact = parse(artifactSchema, await data(admin.from("ap_generated_artifacts").select(artifactColumns).eq("id", selected.artifactId).abortSignal(signal).single(), signal));
      const file = parse(fileSchema, await data(admin.from("ap_generated_file_versions").select(fileColumns).eq("id", selected.fileVersionId).abortSignal(signal).single(), signal));
      const release = parse(releaseSchema, await data(admin.from("ap_releases").select(releaseColumns).eq("id", selected.releaseId).abortSignal(signal).single(), signal));
      const quality = parse(z.object({ file_version_id: uuid, render_preview_bucket: z.literal("operator-render-previews"), render_preview_sha256: hash }).strict(),
        await data(admin.from("ap_artifact_quality_reviews").select("file_version_id,render_preview_bucket,render_preview_sha256").eq("file_version_id", selected.fileVersionId).abortSignal(signal).single(), signal));
      const releaseMembers = parse(z.array(z.object({ member_id: uuid }).strict()).length(1), await data(admin.from("ap_release_members").select("member_id")
        .eq("release_id", selected.releaseId).eq("member_type", "GENERATED_ARTIFACT").eq("member_id", selected.artifactId).limit(2).abortSignal(signal), signal));
      ensure(releaseMembers[0].member_id === artifact.id && artifact.id === selected.artifactId && file.id === selected.fileVersionId
        && file.artifact_id === artifact.id && member.artifact_id === artifact.id && member.file_version_id === file.id
        && member.file_sha256 === file.checksum_sha256 && member.source_sha256 === version.source_sha256
        && quality.file_version_id === file.id && quality.render_preview_sha256 === member.preview_sha256
        && artifact.customer_id === customerId && version.customer_id === customerId && release.customer_id === customerId
        && release.id === selected.releaseId && version.release_id === release.id && artifact.material_line_id === version.material_line_id
        && member.material_line_id === version.material_line_id && release.material_line_id === version.material_line_id
        && artifact.artifact_type === member.artifact_type);
      return { member, version, artifact, file, release, quality };
    };
    const saved = await load(); const buffers: Buffer[] = [];
    try {
      const packetBytes = await readEncryptedDraftPayload(admin, { customerId, jobId: saved.version.job_id,
        payloadId: saved.version.packet_encrypted_payload_id, purpose: "MATERIAL_DRAFT_PACKET", sha256: saved.version.packet_sha256 }, { signal }); buffers.push(packetBytes);
      const packet = parse(packetProjectionSchema, decode(packetBytes, saved.version.packet_sha256));
      ensure(packet.expected.customerId === customerId && packet.expected.materialLineId === saved.version.material_line_id);
      const sourceBytes = await readEncryptedDraftPayload(admin, { customerId, jobId: saved.version.job_id,
        payloadId: saved.version.encrypted_payload_id, purpose: "MATERIAL_DRAFT_SOURCE", sha256: saved.version.source_sha256 }, { signal }); buffers.push(sourceBytes);
      const contactBytes = await readConfirmedDraftContact(admin, { customerId, payloadId: packet.binding.contactPayloadId, sha256: packet.binding.contactSha256 }, signal); buffers.push(contactBytes);
      const evidence = readHistoricalServiceErrorEvidence({ packetBytes, sourceBytes, contactBytes, packetSha256: saved.version.packet_sha256, sourceSha256: saved.version.source_sha256,
        customerId, materialLineId: saved.version.material_line_id, revisionId: saved.artifact.source_line_revision_id,
        bindingSha256: saved.file.binding_sha256, snapshotId: saved.artifact.source_snapshot_id, artifactType: saved.member.artifact_type });
      ensure(serviceErrorCanonicalJson(await load()) === serviceErrorCanonicalJson(saved), "DELIVERY_EVIDENCE_CHANGED");
      parse(z.literal(true), await data(admin.rpc("ap_require_material_reviewer", { p_reviewer_id: reviewerId }).abortSignal(signal), signal));
      return { ...selected, materialLineId: saved.version.material_line_id, type: saved.member.artifact_type, filename: saved.file.safe_filename,
        deliveredAt: saved.release.committed_at, approvedAt: saved.version.approved_at, checksumSha256: saved.file.checksum_sha256,
        previewUrl: `/api/admin/material-files/${saved.file.id}/render-preview`, evidence };
    } catch (error) {
      if (error instanceof ServiceErrorContractError) throw error;
      throw new ServiceErrorContractError("DELIVERY_EVIDENCE_UNAVAILABLE");
    } finally { buffers.forEach((bytes) => bytes.fill(0)); }
  });
}

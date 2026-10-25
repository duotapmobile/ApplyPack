import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database, Json } from "@/lib/database.types";
import { deterministicUuid } from "@/lib/commerce/server";
import { materialFilename, safeFilename } from "@/lib/materials/contract";
import { prepareDraftRender } from "./draft-render";
import { serializeDraftRenderSource, type DraftRenderSource } from "./draft-render-source";
import { serializeDraftingEvidencePacket, type DraftingEvidencePacket } from "./drafting-evidence";

const uuid = z.uuid(), hashSchema = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true });
export const draftRenderClaimSchema = z.object({ jobId: uuid, ownerId: uuid, leaseToken: uuid }).strict();
export const draftRenderStateSchema = draftRenderClaimSchema.extend({ customerId: uuid, materialLineId: uuid, revisionId: uuid,
  revisionVersion: z.number().int().positive(), bindingSha256: hashSchema, snapshotId: uuid, jobSnapshotId: uuid, ruleId: uuid,
  dueAt: time, leaseGeneration: z.number().int().positive(), leaseExpiresAt: time, versionId: uuid, packetPayloadId: uuid,
  packetSha256: hashSchema, contextSha256: hashSchema, sourcePayloadId: uuid, sourceSha256: hashSchema,
  reviewPayloadId: uuid, reviewSha256: hashSchema, reviewerId: uuid, reviewedAt: time,
  selectedReferenceSheet: z.boolean(), rendererIdentity: z.string().min(1).max(255),
  existingArtifactIds: z.object({ RESUME: uuid.nullable(), COVER_LETTER: uuid.nullable() }).strict(),
  delivery: z.object({ format: z.enum(["PDF", "DOCX"]), reason: z.enum(["DEFAULT_PDF", "EMPLOYER_REQUIREMENT", "APPLICANT_REQUEST"]),
    employerRuleId: uuid, applicantRequestId: uuid.nullable(), requestReferenceSha256: hashSchema.nullable() }).strict(),
}).strict();
export type DraftRenderClaim = z.infer<typeof draftRenderClaimSchema>;
export type DraftRenderState = z.infer<typeof draftRenderStateSchema>;
export type DraftRenderRegistration = Omit<Database["public"]["Functions"]["ap_register_material_artifact_version"]["Args"], "p_reviewer_id" | "p_reference_regeneration_id"> & {
  p_reviewer_id: null; p_reference_regeneration_id: null;
};
export type DraftRenderUpload = { bucket: "operator-drafts" | "operator-render-previews" | "customer-deliveries"; path: string; bytes: Buffer; mimeType: string };
export type DraftRenderedPair = Awaited<ReturnType<typeof prepareDraftRender>>;
export type DraftRenderServices = {
  enabled(): boolean;
  readState(claim: DraftRenderClaim, signal: AbortSignal): Promise<unknown>;
  loadEvidence(state: DraftRenderState, signal: AbortSignal): Promise<{ source: DraftRenderSource; packet: DraftingEvidencePacket }>;
  renewLease(claim: DraftRenderClaim, signal: AbortSignal): Promise<unknown>;
  recheck(state: DraftRenderState, signal: AbortSignal): Promise<unknown>;
  render(input: { source: DraftRenderSource; packet: DraftingEvidencePacket }, signal: AbortSignal): Promise<DraftRenderedPair>;
  persistUploadIntents(uploads: Array<Pick<DraftRenderUpload, "bucket" | "path">>, signal: AbortSignal): Promise<void>;
  upload(input: DraftRenderUpload, signal: AbortSignal): Promise<void>;
  commit(state: DraftRenderState, registrations: DraftRenderRegistration[], signal: AbortSignal): Promise<unknown>;
  readCommitted(state: DraftRenderState, registrations: DraftRenderRegistration[], signal: AbortSignal): Promise<unknown>;
};
export type DraftRenderResult = { status: "DISABLED" } | { status: "HELD"; code: "CLAIM_INVALID" | "CLAIM_STALE" | "DEPENDENCIES_UNAVAILABLE" | "REVIEW_REQUIRED" | "REFERENCE_GENERATOR_REQUIRED" | "EVIDENCE_STALE" | "FORMAT_UNAVAILABLE" | "RENDER_FAILED" | "UPLOAD_UNCONFIRMED" | "INTERRUPTED" | "UNCONFIRMED" }
  | { status: "RESULT_UNKNOWN"; code: "REGISTRATION_UNCONFIRMED" | "INTERRUPTED" }
  | { status: "REVIEW_READY"; jobId: string; versionId: string; memberSetSha256: string; reconciled: boolean; ownerReviewRequired: true; deliveryAuthorized: false };
const recordedSchema = z.object({ jobId: uuid, versionId: uuid, packetSha256: hashSchema, sourceSha256: hashSchema,
  reviewSha256: hashSchema, memberSetSha256: hashSchema, current: z.literal(true) }).strict();
class WorkerError extends Error { constructor(readonly code: Extract<DraftRenderResult, { status: "HELD" }>["code"]) { super(code); } }
function ensure(value: unknown, code: WorkerError["code"]): asserts value { if (!value) throw new WorkerError(code); }
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const exact = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(exact).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${exact(entry)}`).join(",")}}`;
};
export function clearDraftRenderedPair(pair: DraftRenderedPair) {
  for (const artifact of [pair.resume, pair.coverLetter]) {
    artifact.buffer.fill(0); artifact.render.searchablePdf.fill(0); artifact.render.pageImages.forEach((page) => page.bytes.fill(0));
  }
}

function planPair(state: DraftRenderState, input: { source: DraftRenderSource; packet: DraftingEvidencePacket }, pair: DraftRenderedPair) {
  ensure(pair.state === "OWNER_REVIEW_REQUIRED" && !pair.deliveryAuthorized && pair.renderSourceSha256 === input.source.renderSourceSha256, "RENDER_FAILED");
  const uploads: DraftRenderUpload[] = [], registrations: DraftRenderRegistration[] = [];
  const person = input.source.resume.header.find((claim) => claim.placement === "resume.contact.displayName")?.text;
  ensure(person, "RENDER_FAILED");
  const target = input.packet.ownerEvidence.targetJob, rules = input.packet.ownerEvidence.employerInstructions;
  for (const [kind, artifact] of [["RESUME", pair.resume], ["COVER_LETTER", pair.coverLetter]] as const) {
    const { inspection, render } = artifact;
    const checks: Record<string, boolean> = inspection.checks;
    ensure(inspection.passed && render.rendererIdentity === state.rendererIdentity && artifact.provenance.artifact === kind
      && artifact.provenance.generatorVersion === pair.generatorVersion && artifact.provenance.draftSource.renderSourceSha256 === input.source.renderSourceSha256
      && artifact.provenance.draftSource.packetSha256 === state.packetSha256 && artifact.provenance.draftSource.proposalSourceSha256 === input.source.proposalSourceSha256
      && render.draftPdf?.docxSha256 === hash(artifact.buffer) && render.searchablePdfSha256 === hash(render.searchablePdf), "RENDER_FAILED");
    const extension = state.delivery.format === "PDF" ? "pdf" : "docx", bytes = extension === "pdf" ? render.searchablePdf : artifact.buffer;
    const filename = materialFilename({ displayName: person, artifact: kind === "RESUME" ? "Resume" : "Cover_Letter", company: target.company,
      position: target.exactTitle, extension, employerInstruction: kind === "RESUME" ? rules.resume_filename_instruction : rules.cover_letter_filename_instruction });
    ensure(safeFilename(filename) && safeFilename(artifact.filename), "FORMAT_UNAVAILABLE");
    const artifactId = state.existingArtifactIds[kind] ?? deterministicUuid(`chunk5-artifact:${state.materialLineId}:${state.revisionId}:${kind}`), fileId = randomUUID();
    const prefix = `${state.customerId}/materials/${state.materialLineId}/${fileId}`;
    const editable = { storageBucket: "operator-drafts" as const, storagePath: `${prefix}/editable-source/${artifact.filename}`,
      safeFilename: artifact.filename, checksumSha256: hash(artifact.buffer), sizeBytes: artifact.buffer.length, mimeType: artifact.mimeType };
    const previewPath = `${prefix}/render-preview.pdf`, path = `${prefix}/${filename}`, mimeType = extension === "pdf" ? "application/pdf" : artifact.mimeType;
    const currentUploads: DraftRenderUpload[] = [{ bucket: editable.storageBucket, path: editable.storagePath, bytes: artifact.buffer, mimeType: artifact.mimeType },
      { bucket: "operator-render-previews", path: previewPath, bytes: render.searchablePdf, mimeType: "application/pdf" },
      { bucket: "customer-deliveries", path, bytes, mimeType }];
    uploads.push(...currentUploads);
    const structuralChecks = { noMacros: checks.noForbiddenParts, noHiddenText: checks.noHiddenOrWhiteText, noComments: checks.noTrackedChangesOrComments,
      noTrackedChanges: checks.noTrackedChangesOrComments, noCustomXml: checks.noForbiddenParts, noExternalRelationships: checks.noExternalRelationships,
      noLayoutTables: checks.singleColumnLinearLayout, nativeBullets: checks.nativeBullets, linearText: checks.singleColumnLinearLayout,
      noPlaceholders: checks.noPlaceholdersOrPromptArtifacts, noMetadataLeak: checks.noCustomOrGeneratorMetadata && checks.noVisibleInternalIdentifiers,
      noPromptArtifacts: checks.noPlaceholdersOrPromptArtifacts, filenameValid: filename.endsWith(`.${extension}`), mimeValid: true, checksumValid: hash(bytes).length === 64,
      pageGeometryValid: checks.usLetter && checks.exactMargins, textExtracted: Boolean(inspection.extractedText),
      twoPageExceptionApproved: artifact.expectedPageCount === 1 || artifact.provenance.fitActions.includes("substantive_two_page_resume"),
      metadataValid: checks.metadataPresent && checks.languageMetadata && checks.keywordsEmpty && checks.editorIdentityEmpty && render.metadataVerified,
      taggedPdf: render.taggedPdf, pdfStructureValid: Boolean(render.draftPdf) };
    const provenance = artifact.provenance;
    const provenanceChecks = { factsBound: provenance.sourceBinding.candidateFactIds.length > 0, jobEvidenceBound: provenance.sourceBinding.jobEvidenceIds.length > 0,
      narrativeTyped: provenance.claims.filter((claim) => claim.kind === "NARRATIVE").every((claim) => !claim.candidateFactIds.length && !claim.jobEvidenceIds.length),
      historicalTitlesPreserved: checks.exactReviewedText, injectionReviewed: checks.noPlaceholdersOrPromptArtifacts,
      noUnsupportedClaims: provenance.claims.every((claim) => claim.kind === "NARRATIVE" || claim.candidateFactIds.length > 0 || claim.jobEvidenceIds.length > 0 || claim.referencePermissionIds.length > 0),
      sameCurrentBinding: true, completeRequirementMap: provenance.requirementMappings.length > 0 && new Set(provenance.requirementMappings.map((row) => row.jobEvidenceId)).size === provenance.requirementMappings.length,
      postingContentBound: provenance.postingContentSha256 === input.packet.binding.jobSha256, versionTupleBound: exact(provenance.versions) === exact(artifact.versions),
      directApplicationUrlBound: provenance.jobBinding.canonicalApplicationUrl === target.canonicalApplicationUrl && provenance.jobBinding.retrievedAt === target.retrievedAt,
      cacheIdentityBound: hashSchema.safeParse(provenance.cacheIdentitySha256).success };
    ensure(Object.values(structuralChecks).every(Boolean) && Object.values(provenanceChecks).every(Boolean), "RENDER_FAILED");
    const packageChecks = Object.fromEntries(["exactContactLinks", "exactHeadingCount", "exactMetadata", "exactParagraphCount", "exactParagraphStructure", "exactParagraphText", "exactReviewedText", "nativeBullets"].map((key) => [key, checks[key as keyof typeof checks]]));
    ensure(Object.values(packageChecks).every((value) => value === true), "RENDER_FAILED");
    registrations.push({ p_artifact_id: artifactId, p_file_version_id: fileId, p_material_line_id: state.materialLineId, p_reviewer_id: null,
      p_artifact_type: kind, p_source_snapshot_id: state.snapshotId, p_source_line_revision_id: state.revisionId, p_job_snapshot_id: state.jobSnapshotId,
      p_reference_regeneration_id: null, p_reference_permission_ids: [], p_generator_version: pair.generatorVersion,
      p_claim_provenance: { ...provenance, documentFontAttestation: { family: render.documentFontFamily, version: render.documentFontVersion,
        manifestSha256: render.documentFontManifestSha256, styleSha256: render.documentFontStyleSha256 }, editableSource: editable,
        uploadCleanup: currentUploads.map((upload) => ({ storageBucket: upload.bucket, storagePath: upload.path })), deliveryFormatDecision: state.delivery,
        draftPair: { versionId: state.versionId, packetSha256: state.packetSha256, sourceSha256: state.sourceSha256, claimReviewSha256: state.reviewSha256 },
        sourceAwareQa: { schemaVersion: "applypack-source-aware-document-qa-v1", generatorVersion: pair.generatorVersion, packageQaSha256: inspection.packageQaSha256,
          extractedTextSha256: inspection.extractedTextSha256, metadataSha256: hash(JSON.stringify(artifact.metadata)), packageChecks, pdf: render.draftPdf } } as Json,
      p_storage_bucket: "customer-deliveries", p_storage_path: path, p_safe_filename: filename, p_checksum_sha256: hash(bytes), p_mime_type: mimeType, p_size_bytes: bytes.length,
      p_binding_sha256: state.bindingSha256, p_package_qa_sha256: inspection.packageQaSha256, p_structural_checks: structuralChecks, p_provenance_checks: provenanceChecks,
      p_extracted_text_sha256: inspection.extractedTextSha256, p_rendered_page_count: render.pageCount, p_renderer_identity: render.rendererIdentity,
      p_arial_font_sha256: render.documentFontSha256, p_malware_scanner_identity: "NOT_SCANNED:generated-structural-v1", p_render_preview_bucket: "operator-render-previews",
      p_render_preview_path: previewPath, p_render_preview_sha256: render.searchablePdfSha256, p_rendered_page_sha256: render.pageImages.map((page) => page.sha256), p_arial_resolved: render.documentFontResolved });
  }
  return { uploads, registrations };
}

/** One claimed render stage; no model call, retry loop, approval or customer send.
 * All upload intents precede uploads. An uncertain atomic commit preserves every
 * object for exact readback and guarded cleanup, never speculative deletion. */
export async function renderDraftForClaim(services: DraftRenderServices, raw: DraftRenderClaim,
  options: { enabled: boolean; signal?: AbortSignal; now?: () => Date }): Promise<DraftRenderResult> {
  if (!options.enabled || !services.enabled()) return { status: "DISABLED" };
  const controller = new AbortController(), signal = controller.signal, now = options.now ?? (() => new Date());
  const abort = () => controller.abort(); options.signal?.addEventListener("abort", abort, { once: true }); if (options.signal?.aborted) abort();
  const timer = setTimeout(abort, 120_000); let pair: DraftRenderedPair | undefined, committing = false;
  const check = () => ensure(!signal.aborted && Number.isFinite(now().getTime()) && services.enabled(), "INTERRUPTED");
  async function call<T>(operation: () => Promise<T>, late?: (value: T) => void) {
    check(); let interrupt: () => void = () => undefined;
    const stopped = new Promise<never>((_, reject) => { interrupt = () => reject(new WorkerError("INTERRUPTED")); signal.addEventListener("abort", interrupt, { once: true }); });
    try { const pending = operation().then((value) => { if (signal.aborted) late?.(value); return value; }); const value = await Promise.race([pending, stopped]); check(); return value; }
    finally { signal.removeEventListener("abort", interrupt); }
  }
  try {
    const parsed = draftRenderClaimSchema.safeParse(raw); ensure(parsed.success, "CLAIM_INVALID"); const claim = parsed.data;
    const parsedState = draftRenderStateSchema.safeParse(await call(() => services.readState(claim, signal))); ensure(parsedState.success, "CLAIM_STALE"); const state = parsedState.data;
    ensure(state.jobId === claim.jobId && state.ownerId === claim.ownerId && state.leaseToken === claim.leaseToken
      && Date.parse(state.leaseExpiresAt) > now().getTime() && Date.parse(state.dueAt) > now().getTime(), "CLAIM_STALE");
    ensure(!state.selectedReferenceSheet, "REFERENCE_GENERATOR_REQUIRED");
    const input = structuredClone(await call(() => services.loadEvidence(state, signal)));
    ensure(hash(serializeDraftingEvidencePacket(input.packet)) === state.packetSha256 && input.packet.packetSha256 === state.packetSha256
      && hash(serializeDraftRenderSource(input.source)) === state.sourceSha256 && input.source.packetSha256 === state.packetSha256
      && input.source.expected.customerId === state.customerId && input.source.expected.materialLineId === state.materialLineId
      && input.source.expected.revisionId === state.revisionId && input.source.expected.revisionVersion === state.revisionVersion
      && input.source.expected.bindingSha256 === state.bindingSha256 && input.packet.binding.snapshotId === state.snapshotId
      && input.packet.binding.jobSnapshotId === state.jobSnapshotId && input.packet.binding.ruleId === state.ruleId
      && input.packet.binding.dueAt === state.dueAt && Date.parse(input.source.validUntil) > now().getTime(), "EVIDENCE_STALE");
    ensure(!input.packet.binding.referencePermissions.length, "REFERENCE_GENERATOR_REQUIRED");
    const fresh = () => ensure(Date.parse(input.source.validUntil) > now().getTime() && Date.parse(state.dueAt) > now().getTime(), "EVIDENCE_STALE");
    const renew = async () => { const lease = time.safeParse(await call(() => services.renewLease(claim, signal))); ensure(lease.success && Date.parse(lease.data) > now().getTime(), "CLAIM_STALE"); };
    await renew(); ensure(await call(() => services.recheck(state, signal)) === true, "CLAIM_STALE"); fresh();
    try { pair = await call(() => services.render(input, signal), clearDraftRenderedPair); }
    catch (error) { if (error instanceof WorkerError) throw error; throw new WorkerError("RENDER_FAILED"); }
    check(); fresh(); const plan = planPair(state, input, pair);
    await renew(); ensure(await call(() => services.recheck(state, signal)) === true, "CLAIM_STALE"); fresh();
    try {
      await call(() => services.persistUploadIntents(plan.uploads.map(({ bucket, path }) => ({ bucket, path })), signal));
      for (const upload of plan.uploads) { fresh(); await call(() => services.upload(upload, signal)); }
    } catch (error) { if (error instanceof WorkerError) throw error; throw new WorkerError("UPLOAD_UNCONFIRMED"); }
    await renew(); ensure(await call(() => services.recheck(state, signal)) === true, "CLAIM_STALE"); fresh();
    committing = true; let reported: unknown;
    try { reported = await call(() => services.commit(state, plan.registrations, signal)); } catch { check(); }
    const receipt = recordedSchema.safeParse(await call(() => services.readCommitted(state, plan.registrations, signal)));
    if (!receipt.success || receipt.data.jobId !== state.jobId || receipt.data.versionId !== state.versionId || receipt.data.packetSha256 !== state.packetSha256
      || receipt.data.sourceSha256 !== state.sourceSha256 || receipt.data.reviewSha256 !== state.reviewSha256) return { status: "RESULT_UNKNOWN", code: "REGISTRATION_UNCONFIRMED" };
    const acknowledged = z.object({ draftVersionId: uuid, memberSetSha256: hashSchema }).passthrough().safeParse(reported);
    if (reported !== undefined && (!acknowledged.success || acknowledged.data.draftVersionId !== state.versionId || acknowledged.data.memberSetSha256 !== receipt.data.memberSetSha256)) return { status: "RESULT_UNKNOWN", code: "REGISTRATION_UNCONFIRMED" };
    return { status: "REVIEW_READY", jobId: state.jobId, versionId: state.versionId, memberSetSha256: receipt.data.memberSetSha256,
      reconciled: reported === undefined, ownerReviewRequired: true, deliveryAuthorized: false };
  } catch (error) {
    if (committing) return { status: "RESULT_UNKNOWN", code: signal.aborted ? "INTERRUPTED" : "REGISTRATION_UNCONFIRMED" };
    return { status: "HELD", code: error instanceof WorkerError ? error.code : "UNCONFIRMED" };
  } finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); controller.abort(); if (pair) clearDraftRenderedPair(pair); }
}

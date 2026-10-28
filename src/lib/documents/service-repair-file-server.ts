import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database, Json } from "@/lib/database.types";
import { deterministicUuid } from "@/lib/commerce/server";
import { safeFilename } from "@/lib/materials/contract";
import { boundedServiceErrorIo } from "@/lib/materials/service-error-payload";
import { serviceErrorCanonicalJson } from "@/lib/materials/service-error-contract";
import { serviceRepairJobSchema, serviceRepairVersionSchema, validateServiceRepairInspection, type ServiceRepairVersion } from "@/lib/materials/service-repair-workflow";
import { repairFileExpectedSchema, repairFileIdentitySchema, repairFileRequestSchema, readRepairFileView,
  type RepairFileExpected, type RepairFileRequest, type RepairFileResult } from "@/lib/materials/service-repair-file-client";
import { checkDocumentRendererReadiness } from "@/lib/operations/renderer-readiness";
import { createServiceRepairRenderServer } from "./service-repair-render-server";
import { draftRenderStateSchema, type DraftRenderRegistration, type DraftRenderUpload } from "./draft-render-worker";
import type { prepareServiceRepairRender } from "./service-repair-render";

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const equal = (a: unknown, b: unknown) => serviceErrorCanonicalJson(a) === serviceErrorCanonicalJson(b);
const digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
type Admin = SupabaseClient<Database>;
type Inspection = ReturnType<typeof validateServiceRepairInspection>;
type Identity = z.infer<typeof repairFileIdentitySchema>;
type Rendered = Awaited<ReturnType<typeof prepareServiceRepairRender>>;
type Registration = { originalFileVersionId: string; registration: DraftRenderRegistration };
const originalFileSchema = z.object({ id: uuid, artifact_id: uuid, checksum_sha256: hash, binding_sha256: hash,
  mime_type: z.enum(["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]) }).strict();
const artifactSchema = z.object({ id: uuid, customer_id: uuid, material_line_id: uuid, job_snapshot_id: uuid,
  claim_provenance: z.object({ deliveryFormatDecision: draftRenderStateSchema.shape.delivery, postingContentSha256: hash,
    jobBinding: z.object({ canonicalApplicationUrl: z.url(), retrievedAt: z.iso.datetime({ offset: true }), postedOn: z.string().nullable() }).strict() }).passthrough() }).strict();
const fileSchema = z.object({ id: uuid, repair_version_id: uuid, customer_id: uuid, material_line_id: uuid, artifact_id: uuid,
  original_file_version_id: uuid, source_snapshot_id: uuid, artifact_type: z.enum(["RESUME", "COVER_LETTER", "REFERENCE_SHEET"]),
  checksum_sha256: hash, render_source_sha256: hash, preview_sha256: hash, editable_sha256: hash,
  registration: z.record(z.string(), z.unknown()) }).strict();
const fileColumns = "id,repair_version_id,customer_id,material_line_id,artifact_id,original_file_version_id,source_snapshot_id,artifact_type,checksum_sha256,render_source_sha256,preview_sha256,editable_sha256,registration";
export class ServiceRepairFileError extends Error { constructor(readonly code: string) { super(`SERVICE_REPAIR_FILES_${code}`); } }
function ensure(value: unknown, code = "UNCONFIRMED"): asserts value { if (!value) throw new ServiceRepairFileError(code); }
function parse<T>(schema: z.ZodType<T>, value: unknown): T { const result = schema.safeParse(value); ensure(result.success); return result.data; }
function clear(rendered: Rendered) { for (const member of rendered.members) {
  member.buffer.fill(0); member.render.searchablePdf.fill(0); member.render.pageImages.forEach(page => page.bytes.fill(0));
} }
const fileId = (request: RepairFileRequest, original: string) => deterministicUuid(`service-repair-file-v1:${request.requestId}:${request.expected.versionId}:${original}`);
const prefix = (customer: string, request: RepairFileRequest) => `${customer}/materials/${request.expected.materialLineId}/repairs/${request.expected.versionId}/${request.requestId}/`;
function expectedVersion(v: ServiceRepairVersion): RepairFileExpected | null {
  if (!v.source_sha256 || !v.claim_review_sha256 || !v.claim_review_encrypted_payload_id || !v.claims_reviewed_by || !v.claims_reviewed_at || !v.claim_review_metadata) return null;
  const review = parse(z.array(z.object({ originalFileVersionId: uuid, renderSourceSha256: hash, claims: z.array(z.unknown()).min(1).max(250) }).strict()).min(1).max(3), v.claim_review_metadata);
  ensure(review.length === v.originals.length && new Set(review.map(row => row.originalFileVersionId)).size === v.originals.length);
  return parse(repairFileExpectedSchema, { caseId: v.case_id, materialLineId: v.material_line_id, versionId: v.id,
    sourceSha256: v.source_sha256, reviewSha256: v.claim_review_sha256, contextSha256: v.context_sha256, acceptedScopeSha256: v.accepted_scope_sha256,
    members: [...v.originals].sort((a, b) => a.fileVersionId.localeCompare(b.fileVersionId)).map(original => {
      const row = review.find(item => item.originalFileVersionId === original.fileVersionId); ensure(row);
      return { originalFileVersionId: original.fileVersionId, artifactType: original.artifactType,
        originalSourceSha256: original.sourceSha256, packetSha256: original.packetSha256, renderSourceSha256: row.renderSourceSha256 };
    }) });
}
const expected = (inspection: Inspection) => expectedVersion(inspection.version!);

/** One owner-requested render/registration. CHECK is read-only. An absent row
 * never authorizes rerendering potentially uploaded bytes. Existing authoring
 * leases are respected;099 supplies no lease renewal or takeover operation. */
export function createServiceRepairFiles(admin: Admin, trustedReviewerId: string, options: {
  uploadClientFactory: (signal: AbortSignal) => Admin | null; now?: () => Date;
  ready?: () => Promise<boolean>; prepare?: ReturnType<typeof createServiceRepairRenderServer>["prepare"];
} ) {
  const reviewerId = parse(uuid, trustedReviewerId), now = options.now ?? (() => new Date());
  const enabled = () => process.env.APP_MATERIAL_DRAFT_RENDERING_ENABLED === "true";
  const prepare = options.prepare ?? createServiceRepairRenderServer(admin, reviewerId, { now }).prepare;
  const ready = options.ready ?? (() => checkDocumentRendererReadiness(admin));
  async function data(query: PromiseLike<{ data: unknown; error: unknown }>, signal: AbortSignal) {
    ensure(!signal.aborted); const result = await query; ensure(!signal.aborted && !result.error); return result.data;
  }
  async function permission(signal: AbortSignal) {
    parse(z.literal(true), await data(admin.rpc("ap_require_material_reviewer", { p_reviewer_id: reviewerId }).abortSignal(signal), signal));
  }
  async function inspect(identity: Identity, signal: AbortSignal) {
    await permission(signal);
    const read = validateServiceRepairInspection(await data(admin.rpc("ap_inspect_service_repair", { p_case_id: identity.caseId,
      p_material_line_id: identity.materialLineId, p_reviewer_id: reviewerId }).abortSignal(signal), signal),
    { caseId: identity.caseId, materialLineId: identity.materialLineId }), v = read.version;
    ensure(v && read.job?.active_version_id === identity.versionId && v.id === identity.versionId && !v.invalidated_at && !v.release_id
      && v.context_sha256 === read.contextSha256 && v.accepted_scope_sha256 === read.scope.acceptedScopeSha256
      && equal(v.originals, read.originals), "CHANGED"); return read;
  }
  async function readyBound(signal: AbortSignal) { return enabled() && await boundedServiceErrorIo(signal, async child => {
    const value = await ready(); ensure(!child.aborted); return enabled() && value;
  }, 20_000); }
  function result(request: RepairFileRequest, status: RepairFileResult["status"], memberSetSha256: string | null = null, busyUntil: string | null = null): RepairFileResult {
    return { ...request, status, memberSetSha256, busyUntil, retryAllowed: status === "BUSY" || status === "DISABLED", renderingAuthorized: false, deliveryAuthorized: false };
  }
  async function recorded(request: RepairFileRequest, signal: AbortSignal, registrations?: Registration[]) {
    await permission(signal);
    const readVersion = async () => {
      const v = parse(serviceRepairVersionSchema, await data(admin.from("ap_service_repair_versions").select("*").eq("id", request.expected.versionId).abortSignal(signal).single(), signal));
      ensure(v.id === request.expected.versionId && v.case_id === request.expected.caseId && v.material_line_id === request.expected.materialLineId
        && equal(expectedVersion(v), request.expected), "CHANGED"); return v;
    };
    // A historical exact receipt remains readable after a later Send or source
    // version. This does not acquire a lease or make that history mutable.
    const v = await readVersion();
    const files = parse(z.array(fileSchema).max(3), await data(admin.from("ap_service_repair_files").select(fileColumns)
      .eq("repair_version_id", v.id).order("original_file_version_id").limit(4).abortSignal(signal), signal));
    ensure(equal(await readVersion(), v), "CHANGED"); await permission(signal);
    if (!v.member_set_sha256) { ensure(files.length === 0); return result(request, "ABSENT"); }
    ensure(files.length === v.originals.length && new Set(files.map(row => row.original_file_version_id)).size === files.length);
    for (const file of files) {
      const original = v.originals.find(row => row.fileVersionId === file.original_file_version_id), entry = request.expected.members.find(row => row.originalFileVersionId === file.original_file_version_id);
      ensure(original && entry && file.id === fileId(request, original.fileVersionId) && file.repair_version_id === v.id
        && file.customer_id === v.customer_id && file.material_line_id === v.material_line_id && file.artifact_id === original.artifactId
        && file.source_snapshot_id === original.sourceSnapshotId && file.artifact_type === original.artifactType && file.render_source_sha256 === entry.renderSourceSha256);
      const registration = file.registration, provenance = parse(z.object({ draftPair: z.object({ versionId: uuid, packetSha256: hash, sourceSha256: hash, claimReviewSha256: hash }).strict(),
        serviceRepair: z.object({ schemaVersion: z.literal("applypack-service-repair-render-binding-v1"), repairVersionId: uuid, repairSourceSha256: hash,
          acceptedScopeSha256: hash, originalFileVersionId: uuid, originalSourceSha256: hash }).strict(),
        editableSource: z.object({ storageBucket: z.literal("operator-drafts"), storagePath: z.string(), checksumSha256: hash }).passthrough() }).passthrough(), registration.p_claim_provenance);
      ensure(equal(provenance.draftPair, { versionId: v.id, packetSha256: original.packetSha256, sourceSha256: entry.renderSourceSha256, claimReviewSha256: v.claim_review_sha256 })
        && equal(provenance.serviceRepair, { schemaVersion: "applypack-service-repair-render-binding-v1", repairVersionId: v.id,
          repairSourceSha256: v.source_sha256, acceptedScopeSha256: v.accepted_scope_sha256, originalFileVersionId: original.fileVersionId, originalSourceSha256: original.sourceSha256 })
        && registration.p_file_version_id === file.id && registration.p_artifact_id === original.artifactId && registration.p_source_snapshot_id === original.sourceSnapshotId
        && registration.p_source_line_revision_id === original.revisionId && registration.p_material_line_id === v.material_line_id
        && registration.p_checksum_sha256 === file.checksum_sha256 && registration.p_render_preview_sha256 === file.preview_sha256
        && provenance.editableSource.checksumSha256 === file.editable_sha256 && registration.p_storage_bucket === "customer-deliveries"
        && registration.p_render_preview_bucket === "operator-render-previews");
      const root = prefix(v.customer_id, request) + file.id + "/";
      for (const path of [registration.p_storage_path, registration.p_render_preview_path, provenance.editableSource.storagePath]) {
        ensure(typeof path === "string" && path.startsWith(root) && !/[\\%?#\u0000-\u001f\u007f]/u.test(path)
          && path.split("/").every(part => part && part !== "." && part !== ".."));
      }
      if (registrations) ensure(equal(file.registration, registrations.find(row => row.originalFileVersionId === original.fileVersionId)?.registration));
    }
    return result(request, "REVIEW_READY", v.member_set_sha256);
  }
  async function formats(inspection: Inspection, signal: AbortSignal) {
    const result = new Map<string, { jobSnapshotId: string; mimeType: z.infer<typeof originalFileSchema>["mime_type"];
      postingContentSha256: string; jobBinding: z.infer<typeof artifactSchema>["claim_provenance"]["jobBinding"]; decision: z.infer<typeof draftRenderStateSchema.shape.delivery> }>();
    for (const original of inspection.originals) {
      const file = parse(originalFileSchema, await data(admin.from("ap_generated_file_versions").select("id,artifact_id,checksum_sha256,binding_sha256,mime_type")
        .eq("id", original.fileVersionId).abortSignal(signal).single(), signal));
      const artifact = parse(artifactSchema, await data(admin.from("ap_generated_artifacts").select("id,customer_id,material_line_id,job_snapshot_id,claim_provenance")
        .eq("id", original.artifactId).abortSignal(signal).single(), signal));
      ensure(file.id === original.fileVersionId && file.artifact_id === original.artifactId && artifact.id === original.artifactId
        && file.checksum_sha256 === original.checksumSha256 && file.binding_sha256 === original.bindingSha256
        && artifact.customer_id === inspection.scope.customerId && artifact.material_line_id === original.materialLineId);
      const decision = artifact.claim_provenance.deliveryFormatDecision;
      ensure((decision.format === "PDF") === (file.mime_type === "application/pdf"));
      result.set(original.fileVersionId, { jobSnapshotId: artifact.job_snapshot_id, mimeType: file.mime_type, decision,
        postingContentSha256: artifact.claim_provenance.postingContentSha256, jobBinding: artifact.claim_provenance.jobBinding });
    }
    return result;
  }
  async function recheck(request: RepairFileRequest, leaseToken: string, signal: AbortSignal) {
    ensure(enabled() && !signal.aborted); const current = await inspect(request.expected, signal), job = current.job!;
    ensure(equal(expected(current), request.expected) && job.lease_owner === request.requestId && job.lease_token === leaseToken
      && job.lease_expires_at && Date.parse(job.lease_expires_at) > now().getTime() && !current.version!.member_set_sha256 && !current.version!.approval_sha256);
    return current;
  }
  function plan(request: RepairFileRequest, inspection: Inspection, rendered: Rendered, delivery: Awaited<ReturnType<typeof formats>>) {
    ensure(rendered.versionId === request.expected.versionId && rendered.sourceSha256 === request.expected.sourceSha256
      && rendered.contextSha256 === request.expected.contextSha256 && rendered.acceptedScopeSha256 === request.expected.acceptedScopeSha256
      && !rendered.deliveryAuthorized && rendered.state === "OWNER_REVIEW_REQUIRED" && rendered.members.length === inspection.originals.length
      && new Set(rendered.members.map(row => row.originalFileVersionId)).size === rendered.members.length);
    const uploads: DraftRenderUpload[] = [], registrations: Registration[] = [];
    for (const artifact of rendered.members) {
      const original = inspection.originals.find(row => row.fileVersionId === artifact.originalFileVersionId), bound = request.expected.members.find(row => row.originalFileVersionId === artifact.originalFileVersionId);
      const format = delivery.get(artifact.originalFileVersionId); ensure(original && bound && format);
      const { render, inspection: qa, provenance } = artifact, checks: Record<string, boolean> = qa.checks;
      ensure(artifact.artifactType === original.artifactType && qa.passed && provenance.artifact === original.artifactType
        && provenance.draftSource.renderSourceSha256 === bound.renderSourceSha256 && provenance.draftSource.packetSha256 === original.packetSha256
        && render.draftPdf?.docxSha256 === digest(artifact.buffer) && render.draftPdf.renderSourceSha256 === bound.renderSourceSha256
        && render.searchablePdfSha256 === digest(render.searchablePdf) && render.pageImages.every(page => digest(page.bytes) === page.sha256)
        && equal(provenance.serviceRepair, { schemaVersion: "applypack-service-repair-render-binding-v1", repairVersionId: request.expected.versionId,
          repairSourceSha256: request.expected.sourceSha256, acceptedScopeSha256: request.expected.acceptedScopeSha256,
          originalFileVersionId: original.fileVersionId, originalSourceSha256: original.sourceSha256 }));
      const id = fileId(request, original.fileVersionId), root = prefix(inspection.scope.customerId, request) + id + "/";
      const filename = format.decision.format === "PDF" ? artifact.pdfFilename : artifact.filename, bytes = format.decision.format === "PDF" ? render.searchablePdf : artifact.buffer;
      ensure(safeFilename(filename) && safeFilename(artifact.filename) && bytes.length > 0 && bytes.length <= 10 * 1024 * 1024);
      const editable = { storageBucket: "operator-drafts" as const, storagePath: root + "editable/" + artifact.filename,
        safeFilename: artifact.filename, checksumSha256: digest(artifact.buffer), sizeBytes: artifact.buffer.length, mimeType: artifact.mimeType };
      const current: DraftRenderUpload[] = [{ bucket: editable.storageBucket, path: editable.storagePath, bytes: artifact.buffer, mimeType: artifact.mimeType },
        { bucket: "operator-render-previews", path: root + "preview.pdf", bytes: render.searchablePdf, mimeType: "application/pdf" },
        { bucket: "customer-deliveries", path: root + filename, bytes, mimeType: format.mimeType }]; uploads.push(...current);
      const structuralChecks = { noMacros: checks.noForbiddenParts, noHiddenText: checks.noHiddenOrWhiteText, noComments: checks.noTrackedChangesOrComments,
        noTrackedChanges: checks.noTrackedChangesOrComments, noCustomXml: checks.noForbiddenParts, noExternalRelationships: checks.noExternalRelationships,
        noLayoutTables: checks.singleColumnLinearLayout, nativeBullets: checks.nativeBullets, linearText: checks.singleColumnLinearLayout,
        noPlaceholders: checks.noPlaceholdersOrPromptArtifacts, noMetadataLeak: checks.noCustomOrGeneratorMetadata && checks.noVisibleInternalIdentifiers,
        noPromptArtifacts: checks.noPlaceholdersOrPromptArtifacts, filenameValid: true, mimeValid: true, checksumValid: true,
        pageGeometryValid: checks.usLetter && checks.exactMargins, textExtracted: Boolean(qa.extractedText),
        twoPageExceptionApproved: artifact.expectedPageCount === 1 || provenance.fitActions.includes("substantive_two_page_resume"),
        metadataValid: checks.metadataPresent && checks.languageMetadata && checks.keywordsEmpty && checks.editorIdentityEmpty && render.metadataVerified,
        taggedPdf: render.taggedPdf, pdfStructureValid: Boolean(render.draftPdf) };
      const provenanceChecks = { factsBound: provenance.sourceBinding.candidateFactIds.length > 0, jobEvidenceBound: provenance.sourceBinding.jobEvidenceIds.length > 0,
        narrativeTyped: provenance.claims.filter(claim => claim.kind === "NARRATIVE").every(claim => !claim.candidateFactIds.length && !claim.jobEvidenceIds.length),
        historicalTitlesPreserved: checks.exactReviewedText, injectionReviewed: checks.noPlaceholdersOrPromptArtifacts,
        noUnsupportedClaims: provenance.claims.every(claim => claim.kind === "NARRATIVE" || claim.candidateFactIds.length > 0 || claim.jobEvidenceIds.length > 0 || claim.referencePermissionIds.length > 0),
        sameCurrentBinding: true, completeRequirementMap: provenance.requirementMappings.length > 0 && new Set(provenance.requirementMappings.map(row => row.jobEvidenceId)).size === provenance.requirementMappings.length,
        postingContentBound: provenance.postingContentSha256 === format.postingContentSha256, versionTupleBound: equal(provenance.versions, artifact.versions),
        directApplicationUrlBound: equal(provenance.jobBinding, format.jobBinding), cacheIdentityBound: hash.safeParse(provenance.cacheIdentitySha256).success };
      const packageChecks = Object.fromEntries(["exactContactLinks", "exactHeadingCount", "exactMetadata", "exactParagraphCount", "exactParagraphStructure", "exactParagraphText", "exactReviewedText", "nativeBullets"].map(key => [key, checks[key]]));
      ensure([...Object.values(structuralChecks), ...Object.values(provenanceChecks), ...Object.values(packageChecks)].every(value => value === true));
      const registration: DraftRenderRegistration = { p_artifact_id: original.artifactId, p_file_version_id: id, p_material_line_id: original.materialLineId,
        p_reviewer_id: null, p_artifact_type: original.artifactType, p_source_snapshot_id: original.sourceSnapshotId, p_source_line_revision_id: original.revisionId,
        p_job_snapshot_id: format.jobSnapshotId, p_reference_regeneration_id: null, p_reference_permission_ids: provenance.sourceBinding.referencePermissionIds,
        p_generator_version: provenance.generatorVersion, p_claim_provenance: { ...provenance,
          documentFontAttestation: { family: render.documentFontFamily, version: render.documentFontVersion, manifestSha256: render.documentFontManifestSha256, styleSha256: render.documentFontStyleSha256 },
          editableSource: editable, uploadCleanup: current.map(upload => ({ storageBucket: upload.bucket, storagePath: upload.path })), deliveryFormatDecision: format.decision,
          draftPair: { versionId: request.expected.versionId, packetSha256: original.packetSha256, sourceSha256: bound.renderSourceSha256, claimReviewSha256: request.expected.reviewSha256 },
          sourceAwareQa: { schemaVersion: "applypack-source-aware-document-qa-v1", generatorVersion: provenance.generatorVersion, packageQaSha256: qa.packageQaSha256,
            extractedTextSha256: qa.extractedTextSha256, metadataSha256: digest(JSON.stringify(artifact.metadata)), packageChecks, pdf: render.draftPdf } } as Json,
        p_storage_bucket: "customer-deliveries", p_storage_path: current[2].path, p_safe_filename: filename, p_checksum_sha256: digest(bytes), p_mime_type: format.mimeType, p_size_bytes: bytes.length,
        p_binding_sha256: original.bindingSha256, p_package_qa_sha256: qa.packageQaSha256, p_structural_checks: structuralChecks, p_provenance_checks: provenanceChecks,
        p_extracted_text_sha256: qa.extractedTextSha256, p_rendered_page_count: render.pageCount, p_renderer_identity: render.rendererIdentity,
        p_arial_font_sha256: render.documentFontSha256, p_malware_scanner_identity: "NOT_SCANNED:generated-structural-v1", p_render_preview_bucket: "operator-render-previews",
        p_render_preview_path: current[1].path, p_render_preview_sha256: render.searchablePdfSha256, p_rendered_page_sha256: render.pageImages.map(page => page.sha256), p_arial_resolved: render.documentFontResolved };
      registrations.push({ originalFileVersionId: original.fileVersionId, registration });
    }
    ensure(Buffer.byteLength(JSON.stringify(registrations, null, 2), "utf8") <= 2_000_000);
    return { uploads, registrations };
  }
  return {
    inspect: (raw: unknown, signal: AbortSignal) => boundedServiceErrorIo(signal, async child => {
      const identity = parse(repairFileIdentitySchema, raw), before = await inspect(identity, child), value = expected(before), job = before.job!, v = before.version!;
      const busyUntil = job.lease_expires_at && Date.parse(job.lease_expires_at) > now().getTime() ? job.lease_expires_at : null;
      const available = value && !v.member_set_sha256 && !busyUntil ? await readyBound(child) : false;
      ensure(equal(await inspect(identity, child), before), "CHANGED");
      return readRepairFileView({ ...identity, expected: value, status: !value ? "WORDING_REQUIRED" : v.member_set_sha256 ? "REVIEW_READY" : busyUntil ? "BUSY" : available ? "READY" : "DISABLED",
        busyUntil: value && !v.member_set_sha256 ? busyUntil : null, memberSetSha256: v.member_set_sha256, deliveryAuthorized: false }, identity);
    }, 30_000),
    check: (raw: unknown, signal: AbortSignal) => boundedServiceErrorIo(signal, child => recorded(parse(repairFileRequestSchema, raw), child), 20_000),
    render: (raw: unknown, signal: AbortSignal) => {
      const request = parse(repairFileRequestSchema, raw);
      return boundedServiceErrorIo(signal, async child => {
        let rendered: Rendered | undefined;
        const clearInterrupted = () => { if (rendered) clear(rendered); };
        child.addEventListener("abort", clearInterrupted, { once: true });
        try {
          const prior = await recorded(request, child); if (prior.status === "REVIEW_READY") return prior;
          const before = await inspect(request.expected, child), job = before.job!;
          if (job.lease_owner === request.requestId) return result(request, "RESULT_UNKNOWN");
          if (job.lease_expires_at && Date.parse(job.lease_expires_at) > now().getTime()) return result(request, "BUSY", null, job.lease_expires_at);
          const intents = parse(z.array(z.object({ storage_path: z.string() }).strict()).max(1), await data(admin.from("storage_cleanup_queue")
            .select("storage_path").like("storage_path", prefix(before.scope.customerId, request) + "%").limit(1).abortSignal(child), child));
          if (intents.length) return result(request, "RESULT_UNKNOWN");
          if (!await readyBound(child)) return result(request, "DISABLED");
          const delivery = await formats(before, child); ensure(equal(await inspect(request.expected, child), before), "CHANGED");
          const claim = parse(serviceRepairJobSchema, await data(admin.rpc("ap_claim_service_repair", { p_version_id: request.expected.versionId, p_owner: request.requestId }).abortSignal(child), child));
          ensure(claim.id === before.job!.id && claim.active_version_id === request.expected.versionId && claim.customer_id === before.scope.customerId
            && claim.case_id === request.expected.caseId && claim.material_line_id === request.expected.materialLineId
            && claim.lease_owner === request.requestId && claim.lease_token && claim.lease_expires_at
            && Date.parse(claim.lease_expires_at) > now().getTime() && Date.parse(claim.lease_expires_at) <= now().getTime() + 300_000);
          const leaseToken = claim.lease_token, current = await recheck(request, leaseToken, child);
          rendered = await prepare({ leaseToken, caseId: request.expected.caseId,
            materialLineId: request.expected.materialLineId, versionId: request.expected.versionId }, { signal: child, timeoutMs: 150_000 });
          ensure(!child.aborted); const planned = plan(request, current, rendered, delivery);
          await recheck(request, leaseToken, child);
          await data(admin.from("storage_cleanup_queue").upsert(planned.uploads.map(upload => ({ bucket: upload.bucket, storage_path: upload.path,
            reason: "material_sensitive_upload_intent", attempts: 0, last_error: null, last_attempt_at: null,
            not_before: new Date(now().getTime() + 3_600_000).toISOString() })), { onConflict: "bucket,storage_path" }).abortSignal(child), child);
          // At most three private uploads run together; all intents already exist.
          for (let offset = 0; offset < planned.uploads.length; offset += 3) {
            await recheck(request, leaseToken, child);
            const results = await Promise.allSettled(planned.uploads.slice(offset, offset + 3).map(upload => boundedServiceErrorIo(child, async uploadSignal => {
              ensure(enabled() && upload.bytes.length > 0 && upload.bytes.length <= 10 * 1024 * 1024);
              const client = options.uploadClientFactory(uploadSignal); ensure(client);
              const sent = await client.storage.from(upload.bucket).upload(upload.path, upload.bytes, { contentType: upload.mimeType, cacheControl: "0", upsert: false });
              ensure(!uploadSignal.aborted && enabled() && !sent.error && sent.data?.path === upload.path && uuid.safeParse(sent.data.id).success
                && sent.data.fullPath === `${upload.bucket}/${upload.path}`);
            }, 20_000)));
            ensure(results.every(item => item.status === "fulfilled"));
          }
          await recheck(request, leaseToken, child); ensure(await readyBound(child));
          let returned: unknown;
          try { returned = await data(admin.rpc("ap_register_service_repair_files", { p_version_id: request.expected.versionId, p_lease_token: leaseToken,
            p_source_sha256: request.expected.sourceSha256, p_registrations: planned.registrations as unknown as Json }).abortSignal(child), child); } catch { /* Read once; never repeat or delete uncertain output. */ }
          ensure(!child.aborted); const saved = await recorded(request, child, planned.registrations);
          return saved.status === "REVIEW_READY" && (returned === undefined || returned === saved.memberSetSha256) ? saved : result(request, "RESULT_UNKNOWN");
        } catch { return result(request, "RESULT_UNKNOWN"); }
        finally { child.removeEventListener("abort", clearInterrupted); if (rendered) clear(rendered); }
      }, 230_000).catch(() => result(request, "RESULT_UNKNOWN"));
    },
  };
}

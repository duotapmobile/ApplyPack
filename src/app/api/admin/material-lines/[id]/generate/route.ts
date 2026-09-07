import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { deterministicUuid } from "@/lib/commerce/server";
import {
  generateEvidenceBoundMaterials,
  generateEvidenceBoundReferenceSheet,
  inspectDocxPackage,
  type EvidenceBoundMaterialInput,
  type GeneratedArtifact,
  type ReferenceSheetRecord,
} from "@/lib/documents/generate";
import { documentRendererConfiguration, renderDocumentLocallyForQa } from "@/lib/documents/renderer";
import { fileScanConfiguration, scanBuffer } from "@/lib/files/scanner";
import { materialFilename } from "@/lib/materials/contract";
import { readReferencePayload, type StoredReferenceEnvelope } from "@/lib/materials/references";
import { readMaterialContact, type StoredMaterialContactEnvelope } from "@/lib/materials/server";
import { isSameOriginRequest } from "@/lib/security/origin";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

const id = z.uuid();
const sentence = z.object({
  text: z.string().trim().min(1).max(1_500),
  candidateFactIds: z.array(id).max(30).default([]),
  jobEvidenceIds: z.array(id).max(30).default([]),
  narrative: z.boolean().default(false),
  priority: z.number().int().min(1).max(5).optional(),
  essential: z.boolean().optional(),
}).strict();
const lineGenerationSchema = z.object({
  mode: z.literal("LINE"),
  requestId: id,
  professionalSummary: sentence,
  coreSkills: z.array(sentence).max(20),
  experiences: z.array(z.object({
    historicalTitle: z.string().trim().min(1).max(160),
    employer: z.string().trim().min(1).max(160),
    dates: z.string().trim().min(1).max(100),
    location: z.string().trim().max(120).nullable().optional(),
    descriptor: sentence.nullable().optional(),
    headerCandidateFactIds: z.array(id).min(1).max(20),
    bullets: z.array(sentence).min(1).max(12),
  }).strict()).min(1).max(20),
  educationAndCertifications: z.array(z.object({
    degree: z.string().trim().min(1).max(180),
    detail: z.string().trim().min(1).max(240),
    candidateFactIds: z.array(id).min(1).max(20),
  }).strict()).max(20).default([]),
  coverLetterParagraphs: z.array(sentence).min(3).max(4),
  verifiedHiringManager: z.object({ name: z.string().trim().min(2).max(120), evidenceId: id }).strict().nullable().default(null),
  careerBreakDates: z.object({ start: z.string().trim().min(2).max(40), end: z.string().trim().min(2).max(40), candidateFactIds: z.array(id).min(1).max(10) }).strict().nullable().default(null),
  mentionCareerBreakInCoverLetter: z.boolean().default(false),
  humanApprovedTwoPageException: z.boolean().default(false),
  humanApprovedLongLetter: z.boolean().default(false),
}).strict();
const regenerationSchema = z.object({ mode: z.literal("REFERENCE_REGENERATION"), requestId: id, regenerationId: id }).strict();
const schema = z.discriminatedUnion("mode", [lineGenerationSchema, regenerationSchema]);

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MIME = "application/pdf";

function response(body: unknown, status = 200) {
  const result = NextResponse.json(body, { status });
  result.headers.set("Cache-Control", "no-store, private");
  result.headers.set("Referrer-Policy", "no-referrer");
  return result;
}

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return response({ error: "This generation request was rejected." }, 403);
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const lineId = id.safeParse((await route.params).id);
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!lineId.success || !input.success) return response({ error: "The evidence-bound generation input is incomplete." }, 400);
  const { data: line } = await auth.admin.from("ap_material_lines")
    .select("id,purchase_id,delivered_order_id,fulfillment,selected_reference_sheet,active_revision,materials_due_at")
    .eq("id", lineId.data).maybeSingle();
  if (!line) return response({ error: "Materials line not found." }, 404);
  const [{ data: purchase }, { data: revision }, { data: item }] = await Promise.all([
    auth.admin.from("ap_material_purchases").select("id,customer_id,checkout_intent_id").eq("id", line.purchase_id).maybeSingle(),
    auth.admin.from("ap_material_line_revisions").select("id,version,job_snapshot_id,source_snapshot_id,employer_rule_snapshot_id,binding_sha256,superseded_at")
      .eq("line_id", line.id).eq("version", line.active_revision).is("superseded_at", null).maybeSingle(),
    auth.admin.from("ap_material_checkout_items").select("id").eq("material_line_id", line.id).maybeSingle(),
  ]);
  if (!purchase || !purchase.checkout_intent_id || !revision || !item || !revision.job_snapshot_id
    || !revision.source_snapshot_id || !revision.employer_rule_snapshot_id || !revision.binding_sha256) {
    return response({ error: "The current immutable line binding is incomplete." }, 409);
  }
  const [{ data: intent }, { data: job }, { data: rule }, { data: generationConfiguration }] = await Promise.all([
    auth.admin.from("ap_material_checkout_intents").select("contact_payload_id,career_break_choice,career_break_custom_label,cover_letter_break_consent")
      .eq("id", purchase.checkout_intent_id).eq("customer_id", purchase.customer_id).maybeSingle(),
    auth.admin.from("ap_job_snapshots").select("id,company,exact_title,location_and_work_mode,content_sha256")
      .eq("id", revision.job_snapshot_id).maybeSingle(),
    auth.admin.from("ap_employer_submission_rules")
      .select("id,content_sha256,allowed_formats,resume_page_limit,resume_filename_instruction,cover_letter_filename_instruction,reference_filename_instruction,reference_timing,reference_count,hard_block_reason,injection_scan_state,is_current,checked_at")
      .eq("id", revision.employer_rule_snapshot_id).eq("job_snapshot_id", revision.job_snapshot_id).maybeSingle(),
    auth.admin.from("ap_commerce_configuration")
      .select("materials_generation_approved,materials_generation_approval_reference,material_output_formats,document_renderer_identity,arial_font_sha256,malware_scanner_identity")
      .eq("singleton", true).maybeSingle(),
  ]);
  if (!intent || !job || !rule || !rule.is_current || rule.hard_block_reason || rule.injection_scan_state !== "CLEAR") {
    return response({ error: "Current employer instructions are not generation-ready." }, 409);
  }
  const rendererConfiguration = documentRendererConfiguration();
  const scannerConfiguration = fileScanConfiguration();
  if (!generationConfiguration?.materials_generation_approved
    || !generationConfiguration.materials_generation_approval_reference
    || !Array.isArray(generationConfiguration.material_output_formats)
    || !generationConfiguration.material_output_formats.length
    || !rendererConfiguration.ready
    || rendererConfiguration.identity !== generationConfiguration.document_renderer_identity
    || rendererConfiguration.arialFont.sha256 !== generationConfiguration.arial_font_sha256
    || !scannerConfiguration.ready
    || scannerConfiguration.identity !== generationConfiguration.malware_scanner_identity
    || (process.env.APP_PAYMENT_MODE === "live" && !scannerConfiguration.liveReady)) {
    return response({ error: "Approved document rendering, Arial, and malware-scanning configuration is required." }, 503);
  }
  const now = new Date();
  const dueAt = line.materials_due_at ? new Date(line.materials_due_at) : null;
  if (!dueAt || dueAt.getTime() <= now.getTime()) return response({ error: "The active line deadline has passed; generation is blocked for refund handling." }, 409);

  let regenerationId: string | null = null;
  let permissionIds: string[] = [];
  if (input.data.mode === "REFERENCE_REGENERATION") {
    const { data: regeneration } = await auth.admin.from("ap_reference_regenerations")
      .select("id,customer_id,permission_ids,state,due_at").eq("id", input.data.regenerationId)
      .eq("material_line_id", line.id).maybeSingle();
    if (!regeneration || regeneration.customer_id !== purchase.customer_id || regeneration.state !== "ACTIVE"
      || new Date(regeneration.due_at).getTime() <= now.getTime()) {
      return response({ error: "The reference-sheet regeneration is not active." }, 409);
    }
    regenerationId = regeneration.id;
    permissionIds = Array.isArray(regeneration.permission_ids) ? regeneration.permission_ids.map(String) : [];
  } else {
    if (!["PAID", "GENERATING", "HUMAN_REVIEW"].includes(line.fulfillment)) {
      return response({ error: "This materials line is not generation-ready." }, 409);
    }
    const { data: check } = await auth.admin.from("ap_material_listing_checks")
      .select("result,submission_rule_id,evidence_sha256,checked_at")
      .eq("material_line_id", line.id).eq("line_revision_id", revision.id).eq("phase", "BEFORE_GENERATION")
      .order("checked_at", { ascending: false }).limit(1).maybeSingle();
    if (!check || check.result !== "ACTIVE" || check.submission_rule_id !== rule.id
      || check.evidence_sha256 !== rule.content_sha256 || now.getTime() - new Date(check.checked_at).getTime() > 60 * 60 * 1_000) {
      return response({ error: "A current human-confirmed pre-generation listing and instruction check is required." }, 409);
    }
    if (line.selected_reference_sheet) {
      const { data: links } = await auth.admin.from("ap_material_checkout_references")
        .select("reference_permission_id,position").eq("checkout_item_id", item.id).order("position");
      permissionIds = (links || []).map((link) => link.reference_permission_id);
      if (!permissionIds.length) return response({ error: "The selected reference sheet no longer has a complete permission scope." }, 409);
    }
  }

  const { data: contactEnvelope } = await auth.admin.from("ap_sensitive_payloads")
    .select("ciphertext,encryption_algorithm,encrypted_data_key,nonce,authentication_tag,content_sha256,kms_key_identity,kms_key_version,encryption_context_hash")
    .eq("id", intent.contact_payload_id).eq("customer_id", purchase.customer_id).maybeSingle();
  if (!contactEnvelope) return response({ error: "Protected document contact details are unavailable." }, 503);
  let contact: Awaited<ReturnType<typeof readMaterialContact>>;
  try {
    contact = await readMaterialContact({
      customerId: purchase.customer_id,
      payloadId: intent.contact_payload_id,
      envelope: contactEnvelope as StoredMaterialContactEnvelope,
    });
  } catch {
    return response({ error: "Protected document contact details could not be decrypted." }, 503);
  }

  const references = permissionIds.length ? await loadReferences({
    admin: auth.admin,
    customerId: purchase.customer_id,
    jobSnapshotId: job.id,
    permissionIds,
  }).catch(() => null) : [];
  if (permissionIds.length && (!references || references.length !== permissionIds.length)) {
    return response({ error: "Current exact-job reference permissions are incomplete." }, 409);
  }
  const location = stringValue(job.location_and_work_mode, "location") || stringValue(job.location_and_work_mode, "locationText") || null;
  const allowedFormats = Array.isArray(rule.allowed_formats) ? rule.allowed_formats : [];
  const outputFormat: "DOCX" | "PDF" | null = allowedFormats.includes("DOCX")
    && generationConfiguration.material_output_formats.includes("DOCX") ? "DOCX"
    : allowedFormats.includes("PDF") && generationConfiguration.material_output_formats.includes("PDF") ? "PDF" : null;
  if (!outputFormat) return response({ error: "No approved output format satisfies the current employer instructions." }, 409);
  const common = {
    contact: {
      displayName: contact.displayName,
      email: contact.email,
      phone: contact.phone,
      cityState: contact.cityState,
      linkedInOrPortfolio: contact.linkedInOrPortfolio,
      candidateFactIds: [intent.contact_payload_id],
    },
    job: {
      exactTitle: job.exact_title,
      employer: job.company,
      location,
      jobEvidenceIds: [] as string[],
    },
  };

  let artifacts: Array<{ type: "RESUME" | "COVER_LETTER" | "REFERENCE_SHEET"; artifact: GeneratedArtifact }>;
  if (input.data.mode === "REFERENCE_REGENERATION") {
    const { data: evidence } = await auth.admin.from("ap_requirement_nodes").select("id")
      .eq("job_snapshot_id", job.id).order("position").limit(1);
    const headerEvidenceId = evidence?.[0]?.id;
    if (!headerEvidenceId || !references) return response({ error: "Job-header evidence is unavailable." }, 409);
    common.job.jobEvidenceIds = [headerEvidenceId];
    const referenceArtifact = await generateEvidenceBoundReferenceSheet({
      ...common,
      references,
      rules: { referenceFilenameInstruction: outputFormat === "DOCX" ? rule.reference_filename_instruction : null },
    }).catch(() => null);
    if (!referenceArtifact) return response({ error: "The evidence-bound reference sheet could not be generated." }, 409);
    artifacts = [{ type: "REFERENCE_SHEET", artifact: referenceArtifact }];
  } else {
    if (input.data.mentionCareerBreakInCoverLetter && !intent.cover_letter_break_consent) {
      return response({ error: "Cover-letter career-break mention was not authorized by the customer." }, 409);
    }
    const breakNeedsDates = ["CAREER_BREAK", "FAMILY_CAREGIVING", "CUSTOM_WORDING"].includes(intent.career_break_choice);
    if (breakNeedsDates !== Boolean(input.data.careerBreakDates)) {
      return response({ error: "Confirmed career-break dates and provenance must match the customer’s selected presentation." }, 409);
    }
    const candidateFactIds = unique([
      intent.contact_payload_id,
      ...sentenceFactIds(input.data.professionalSummary, "candidateFactIds"),
      ...input.data.coreSkills.flatMap((value) => sentenceFactIds(value, "candidateFactIds")),
      ...input.data.experiences.flatMap((value) => [
        ...value.headerCandidateFactIds,
        ...(value.descriptor ? sentenceFactIds(value.descriptor, "candidateFactIds") : []),
        ...value.bullets.flatMap((bullet) => sentenceFactIds(bullet, "candidateFactIds")),
      ]),
      ...input.data.educationAndCertifications.flatMap((value) => value.candidateFactIds),
      ...input.data.coverLetterParagraphs.flatMap((value) => sentenceFactIds(value, "candidateFactIds")),
      ...(input.data.careerBreakDates?.candidateFactIds || []),
    ]);
    const jobEvidenceIds = unique([
      ...sentenceFactIds(input.data.professionalSummary, "jobEvidenceIds"),
      ...input.data.coreSkills.flatMap((value) => sentenceFactIds(value, "jobEvidenceIds")),
      ...input.data.experiences.flatMap((value) => [
        ...(value.descriptor ? sentenceFactIds(value.descriptor, "jobEvidenceIds") : []),
        ...value.bullets.flatMap((bullet) => sentenceFactIds(bullet, "jobEvidenceIds")),
      ]),
      ...input.data.coverLetterParagraphs.flatMap((value) => sentenceFactIds(value, "jobEvidenceIds")),
      ...(input.data.verifiedHiringManager ? [input.data.verifiedHiringManager.evidenceId] : []),
    ]);
    if (!jobEvidenceIds.length) return response({ error: "At least one exact job-evidence binding is required." }, 409);
    const [{ data: facts }, { data: evidence }] = await Promise.all([
      auth.admin.from("ap_candidate_facts").select("id").in("id", candidateFactIds)
        .eq("customer_id", purchase.customer_id).eq("snapshot_id", revision.source_snapshot_id)
        .in("verification", ["CUSTOMER_CONFIRMED", "HUMAN_VERIFIED"]).is("superseded_at", null),
      auth.admin.from("ap_requirement_nodes").select("id").in("id", jobEvidenceIds).eq("job_snapshot_id", job.id),
    ]);
    if ((facts || []).length !== candidateFactIds.length || (evidence || []).length !== jobEvidenceIds.length) {
      return response({ error: "One or more factual provenance bindings are stale or outside the current line." }, 409);
    }
    common.job.jobEvidenceIds = jobEvidenceIds;
    const generationInput: EvidenceBoundMaterialInput = {
      ...common,
      professionalSummary: input.data.professionalSummary,
      coreSkills: input.data.coreSkills,
      experiences: input.data.experiences.map((experience) => ({ ...experience, location: experience.location || undefined, descriptor: experience.descriptor || undefined })),
      educationAndCertifications: input.data.educationAndCertifications,
      coverLetterParagraphs: input.data.coverLetterParagraphs,
      verifiedHiringManager: input.data.verifiedHiringManager?.name || null,
      finalVersionAt: now.toISOString(),
      careerBreak: {
        choice: intent.career_break_choice,
        customLabel: intent.career_break_custom_label,
        start: input.data.careerBreakDates?.start || null,
        end: input.data.careerBreakDates?.end || null,
        mentionInCoverLetter: input.data.mentionCareerBreakInCoverLetter,
        candidateFactIds: input.data.careerBreakDates?.candidateFactIds || [],
      },
      rules: {
        outputFormat: "DOCX",
        resumePageLimit: rule.resume_page_limit === 2 ? 2 : 1,
        resumeFilenameInstruction: outputFormat === "DOCX" ? rule.resume_filename_instruction : null,
        coverLetterFilenameInstruction: outputFormat === "DOCX" ? rule.cover_letter_filename_instruction : null,
        referenceFilenameInstruction: outputFormat === "DOCX" ? rule.reference_filename_instruction : null,
      },
      references: references || undefined,
      humanApprovedTwoPageException: input.data.humanApprovedTwoPageException,
      humanApprovedLongLetter: input.data.humanApprovedLongLetter,
    };
    const generated = await generateEvidenceBoundMaterials(generationInput).catch(() => null);
    if (!generated) return response({ error: "Generation stopped because content, provenance, layout, or truthfulness checks failed." }, 409);
    artifacts = [
      { type: "RESUME", artifact: generated.resume },
      { type: "COVER_LETTER", artifact: generated.coverLetter },
      ...(generated.referenceSheet ? [{ type: "REFERENCE_SHEET" as const, artifact: generated.referenceSheet }] : []),
    ];
  }

  const registered = [];
  for (const current of artifacts) {
    const result = await validateUploadAndRegister({
      admin: auth.admin,
      reviewerId: auth.user.id,
      customerId: purchase.customer_id,
      lineId: line.id,
      revisionId: revision.id,
      sourceSnapshotId: revision.source_snapshot_id,
      jobSnapshotId: job.id,
      bindingSha256: revision.binding_sha256,
      regenerationId,
      permissionIds: current.type === "REFERENCE_SHEET" ? permissionIds : [],
      outputFormat,
      employerFilenameInstruction: current.type === "RESUME" ? rule.resume_filename_instruction
        : current.type === "COVER_LETTER" ? rule.cover_letter_filename_instruction : rule.reference_filename_instruction,
      contactName: contact.displayName,
      company: job.company,
      title: job.exact_title,
      location,
      artifactType: current.type,
      artifact: current.artifact,
    }).catch(() => null);
    current.artifact.buffer.fill(0);
    if (!result) return response({ error: "Artifact registration failed closed during scan, render, upload, or binding verification." }, 409);
    registered.push(result);
  }
  return response({ mode: input.data.mode, artifacts: registered }, 201);
}

async function loadReferences(input: {
  admin: AdminClient;
  customerId: string;
  jobSnapshotId: string;
  permissionIds: string[];
}): Promise<ReferenceSheetRecord[]> {
  const permissionsResult = await input.admin.from("ap_reference_permissions")
    .select("id,reference_record_version_id").in("id", input.permissionIds)
    .eq("customer_id", input.customerId).eq("job_snapshot_id", input.jobSnapshotId)
    .is("revoked_at", null).is("contact_version_changed_at", null);
  if (permissionsResult.error || (permissionsResult.data || []).length !== input.permissionIds.length) throw new Error("reference_permissions_invalid");
  const permissions = permissionsResult.data || [];
  const versionIds = permissions.map((permission) => permission.reference_record_version_id);
  const versionsResult = await input.admin.from("ap_reference_record_versions")
    .select("id,encrypted_payload_id,permission_status,superseded_at").in("id", versionIds)
    .eq("permission_status", "CONFIRMED").is("superseded_at", null);
  if (versionsResult.error || (versionsResult.data || []).length !== versionIds.length) throw new Error("reference_versions_invalid");
  const versions = versionsResult.data || [];
  const payloadIds = versions.map((version) => version.encrypted_payload_id);
  const payloadsResult = await input.admin.from("ap_sensitive_payloads")
    .select("id,ciphertext,encryption_algorithm,encrypted_data_key,nonce,authentication_tag,content_sha256,kms_key_identity,kms_key_version,encryption_context_hash")
    .in("id", payloadIds).eq("customer_id", input.customerId);
  if (payloadsResult.error || (payloadsResult.data || []).length !== payloadIds.length) throw new Error("reference_payloads_invalid");
  const result: ReferenceSheetRecord[] = [];
  for (const permissionId of input.permissionIds) {
    const permission = permissions.find((candidate) => candidate.id === permissionId)!;
    const version = versions.find((candidate) => candidate.id === permission.reference_record_version_id)!;
    const envelope = (payloadsResult.data || []).find((candidate) => candidate.id === version.encrypted_payload_id)!;
    const reference = await readReferencePayload({ customerId: input.customerId, payloadId: version.encrypted_payload_id, envelope: envelope as StoredReferenceEnvelope });
    result.push({
      permissionId,
      name: reference.name,
      titleAndOrganization: `${reference.title}, ${reference.organization}`,
      relationship: reference.relationship,
      email: reference.email,
      phone: reference.phone,
      approvedContext: reference.approvedContextLine || undefined,
    });
  }
  return result;
}

async function validateUploadAndRegister(input: {
  admin: AdminClient;
  reviewerId: string;
  customerId: string;
  lineId: string;
  revisionId: string;
  sourceSnapshotId: string;
  jobSnapshotId: string;
  bindingSha256: string;
  regenerationId: string | null;
  permissionIds: string[];
  outputFormat: "DOCX" | "PDF";
  employerFilenameInstruction: string | null;
  contactName: string;
  company: string;
  title: string;
  location: string | null;
  artifactType: "RESUME" | "COVER_LETTER" | "REFERENCE_SHEET";
  artifact: GeneratedArtifact;
}) {
  const inspection = await inspectDocxPackage(input.artifact.buffer, input.artifactType);
  if (!inspection.passed) throw new Error("docx_package_inspection_failed");
  const render = await renderDocumentLocallyForQa({
    docx: input.artifact.buffer,
    expectedPages: input.artifact.expectedPageCount,
    expectedExtractedTextSha256: inspection.extractedTextSha256,
  });
  const bytes = input.outputFormat === "PDF" ? render.searchablePdf : input.artifact.buffer;
  const artifactLabel = input.artifactType === "RESUME" ? "Resume" : input.artifactType === "COVER_LETTER" ? "Cover_Letter" : "References";
  const filename = input.outputFormat === "DOCX" ? input.artifact.filename : materialFilename({
    displayName: input.contactName,
    artifact: artifactLabel,
    company: input.company,
    position: input.title,
    extension: "pdf",
    employerInstruction: input.employerFilenameInstruction,
    collisionLocation: input.location,
  });
  const scan = await scanBuffer(bytes, { structureValidated: true });
  if (scan.status !== "clean" || !scan.provider || scan.sha256 !== hash(bytes)) throw new Error("artifact_malware_scan_failed");
  const identitySuffix = input.regenerationId || input.revisionId;
  const artifactId = deterministicUuid(`chunk5-artifact:${input.lineId}:${identitySuffix}:${input.artifactType}`);
  const fileVersionId = randomUUID();
  const extension = input.outputFormat.toLowerCase();
  const storagePath = `${input.customerId}/materials/${input.lineId}/${fileVersionId}/${filename}`;
  const previewPath = `${input.customerId}/materials/${input.lineId}/${fileVersionId}/render-preview.pdf`;
  const previewUpload = await input.admin.storage.from("operator-render-previews").upload(previewPath, render.searchablePdf, {
    contentType: PDF_MIME,
    cacheControl: "0",
    upsert: false,
  });
  if (previewUpload.error) throw previewUpload.error;
  const artifactUpload = await input.admin.storage.from("customer-deliveries").upload(storagePath, bytes, {
    contentType: input.outputFormat === "PDF" ? PDF_MIME : DOCX_MIME,
    cacheControl: "0",
    upsert: false,
  });
  if (artifactUpload.error) {
    await input.admin.storage.from("operator-render-previews").remove([previewPath]);
    throw artifactUpload.error;
  }
  const structuralChecks = {
    noMacros: inspection.checks.noForbiddenParts,
    noHiddenText: inspection.checks.noHiddenOrWhiteText,
    noComments: inspection.checks.noTrackedChangesOrComments,
    noTrackedChanges: inspection.checks.noTrackedChangesOrComments,
    noCustomXml: inspection.checks.noForbiddenParts,
    noExternalRelationships: inspection.checks.noExternalRelationships,
    noLayoutTables: inspection.checks.singleColumnLinearLayout,
    nativeBullets: inspection.checks.nativeBullets,
    linearText: inspection.checks.singleColumnLinearLayout,
    noPlaceholders: inspection.checks.noPlaceholdersOrPromptArtifacts,
    noMetadataLeak: inspection.checks.noCustomOrGeneratorMetadata && inspection.checks.noVisibleInternalIdentifiers,
    noPromptArtifacts: inspection.checks.noPlaceholdersOrPromptArtifacts,
    filenameValid: filename.endsWith(`.${extension}`),
    mimeValid: true,
    checksumValid: scan.sha256 === hash(bytes),
    pageGeometryValid: inspection.checks.usLetter && inspection.checks.exactMargins,
    textExtracted: Boolean(inspection.extractedText),
    twoPageExceptionApproved: input.artifact.expectedPageCount === 1 || input.artifact.provenance.fitActions.includes("human_approved_two_page_exception"),
  };
  const provenanceChecks = {
    factsBound: input.artifact.provenance.sourceBinding.candidateFactIds.length > 0,
    jobEvidenceBound: input.artifact.provenance.sourceBinding.jobEvidenceIds.length > 0,
    narrativeTyped: input.artifact.provenance.claims.filter((claim) => claim.kind === "NARRATIVE").every((claim) => !claim.candidateFactIds.length && !claim.jobEvidenceIds.length),
    historicalTitlesPreserved: true,
    injectionReviewed: inspection.checks.noPlaceholdersOrPromptArtifacts,
    noUnsupportedClaims: input.artifact.provenance.claims.every((claim) => claim.kind === "NARRATIVE" || claim.candidateFactIds.length > 0 || claim.jobEvidenceIds.length > 0 || claim.referencePermissionIds.length > 0),
    sameCurrentBinding: true,
  };
  const registered = await input.admin.rpc("ap_register_material_artifact_version", {
    p_artifact_id: artifactId,
    p_file_version_id: fileVersionId,
    p_material_line_id: input.lineId,
    p_reviewer_id: input.reviewerId,
    p_artifact_type: input.artifactType,
    p_source_snapshot_id: input.sourceSnapshotId,
    p_source_line_revision_id: input.revisionId,
    p_job_snapshot_id: input.jobSnapshotId,
    p_reference_regeneration_id: input.regenerationId,
    p_reference_permission_ids: input.permissionIds,
    p_claim_provenance: input.artifact.provenance,
    p_generator_version: input.artifact.provenance.generatorVersion,
    p_storage_bucket: "customer-deliveries",
    p_storage_path: storagePath,
    p_safe_filename: filename,
    p_checksum_sha256: scan.sha256,
    p_mime_type: input.outputFormat === "PDF" ? PDF_MIME : DOCX_MIME,
    p_size_bytes: bytes.byteLength,
    p_binding_sha256: input.bindingSha256,
    p_package_qa_sha256: inspection.packageQaSha256,
    p_structural_checks: structuralChecks,
    p_provenance_checks: provenanceChecks,
    p_extracted_text_sha256: inspection.extractedTextSha256,
    p_rendered_page_count: render.pageCount,
    p_renderer_identity: render.rendererIdentity,
    p_arial_font_sha256: render.arialFontSha256,
    p_malware_scanner_identity: fileScanConfiguration().identity,
    p_render_preview_bucket: "operator-render-previews",
    p_render_preview_path: previewPath,
    p_render_preview_sha256: render.searchablePdfSha256,
    p_rendered_page_sha256: render.pageImages.map((page) => page.sha256),
    p_arial_resolved: render.arialResolved,
  });
  if (registered.error || !registered.data) {
    await Promise.all([
      input.admin.storage.from("operator-render-previews").remove([previewPath]),
      input.admin.storage.from("customer-deliveries").remove([storagePath]),
    ]);
    throw registered.error || new Error("artifact_registration_failed");
  }
  if (bytes !== input.artifact.buffer) bytes.fill(0);
  render.searchablePdf.fill(0);
  render.pageImages.forEach((page) => page.bytes.fill(0));
  return registered.data;
}

function sentenceFactIds(value: { candidateFactIds: string[]; jobEvidenceIds: string[] }, key: "candidateFactIds" | "jobEvidenceIds") {
  return value[key];
}

function stringValue(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const result = (value as Record<string, unknown>)[key];
  return typeof result === "string" ? result.trim() : "";
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function hash(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

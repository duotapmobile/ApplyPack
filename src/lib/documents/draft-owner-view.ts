import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/database.types";
import { loadDraftingEvidencePacket } from "./drafting-evidence-server";
import { draftingEvidenceRecordsSchema, serializeDraftingEvidencePacket, type DraftingEvidencePacket } from "./drafting-evidence";
import { readEncryptedDraftPayload } from "./draft-packet-worker";
import { validateDraftOutput, serializeDraftProposal, draftOutputSchema } from "./draft-output";
import { readStoredDraftRenderSource } from "./draft-render-source-storage";
import { supportedDocumentFontFamily } from "./requirements";
import { readConfirmedDraftContact } from "./draft-owner-contact";
import { draftReferenceRequest, readConfirmedDraftReferences } from "./draft-owner-references";
import { readDraftReferenceSources, validateDraftReferenceSource, type DraftReferenceInput } from "./draft-reference-source";
import { materialContactSchema } from "@/lib/materials/server";
import { createMaterialRuleOwnerServer } from "./material-rule-owner-server";
import type { materialRuleBasisSchema } from "./material-rule-evidence";
import { buildEmployerQuestionInsights } from "./employer-question-evidence";
import { getEmployerSource } from "@/lib/jobs/source-registry";
import { buildDraftOwnerEditModel, type DraftOwnerEditModel } from "./draft-owner-edit";
import type { DraftChangePort } from "./draft-change-port";
import { loadDraftChangeForVersion } from "./draft-change-loader";

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true });
const states = ["EVIDENCE_PENDING", "PREPARING", "READY", "DRAFTING", "SOURCE_READY", "RENDERING", "REVIEW_READY", "APPROVED", "RELEASED", "RESULT_UNKNOWN", "OWNER_EXCEPTION", "SUPERSEDED", "CANCELED"] as const;
const jobColumns = "id,customer_id,material_line_id,line_revision_id,source_snapshot_id,state,active_version_id,error_code,created_at,updated_at";
const jobSchema = z.object({ id: uuid, customer_id: uuid, material_line_id: uuid, line_revision_id: uuid, source_snapshot_id: uuid,
  state: z.enum(states), active_version_id: uuid.nullable(), error_code: z.enum(["EVIDENCE_INCOMPLETE", "EVIDENCE_STALE", "PROVIDER_UNAVAILABLE", "PROVIDER_RESULT_UNKNOWN", "RENDER_FAILED", "ATTEMPTS_EXHAUSTED", "OWNER_REJECTED"]).nullable(), created_at: time, updated_at: time }).strict();
const versionColumns = "id,job_id,customer_id,material_line_id,version,packet_encrypted_payload_id,packet_sha256,context_sha256,encrypted_payload_id,source_sha256,invalidated_at,member_set_sha256,claim_review_sha256,claims_reviewed_at,approval_sha256,approved_at,release_id";
const versionSchema = z.object({ id: uuid, job_id: uuid, customer_id: uuid, material_line_id: uuid, version: z.number().int().positive(),
  packet_encrypted_payload_id: uuid, packet_sha256: hash, context_sha256: hash, encrypted_payload_id: uuid.nullable(), source_sha256: hash.nullable(), invalidated_at: time.nullable(),
  member_set_sha256: hash.nullable(), claim_review_sha256: hash.nullable(), claims_reviewed_at: time.nullable(), approval_sha256: hash.nullable(), approved_at: time.nullable(), release_id: uuid.nullable() }).strict();
const revisionSchema = z.object({ id: uuid, line_id: uuid, source_snapshot_id: uuid, version: z.number().int().positive(), binding_sha256: hash, due_at: time, superseded_at: time.nullable() }).strict();
const memberSchema = z.object({ customer_id: uuid, material_line_id: uuid, draft_version_id: uuid, artifact_type: z.enum(["RESUME", "COVER_LETTER", "REFERENCE_SHEET"]), artifact_id: uuid, file_version_id: uuid, file_sha256: hash, preview_sha256: hash, source_sha256: hash }).strict();
const artifactSchema = z.object({ id: uuid, customer_id: uuid, material_line_id: uuid, source_line_revision_id: uuid, artifact_type: z.enum(["RESUME", "COVER_LETTER", "REFERENCE_SHEET"]), current_file_version: z.number().int().positive(), generator_version: z.string().min(1).max(2048), retention_state: z.literal("ACTIVE") }).strict();
const fileSchema = z.object({ id: uuid, artifact_id: uuid, version: z.number().int().positive(), checksum_sha256: hash, safe_filename: z.string().min(1).max(255), superseded_at: z.null(), downloads_revoked_at: z.null() }).strict();
const qualitySchema = z.object({ file_version_id: uuid, automated_passed_at: time.nullable(), render_preview_bucket: z.string().nullable(), render_preview_sha256: hash.nullable(), document_font_family: z.string().nullable(), document_font_resolved: z.boolean(), invalidated_at: time.nullable() }).strict();
const cursorSchema = z.object({ at: time, id: uuid }).strict();

export type DraftOwnerQueueItem = { id: string; shortId: string; state: typeof states[number]; errorCode: string | null; updatedAt: string; versionId: string | null };
export type DraftOwnerQueue = { status: "AVAILABLE"; jobs: DraftOwnerQueueItem[]; nextCursor: string | null } | { status: "UNAVAILABLE"; jobs: []; nextCursor: null };
export type DraftOwnerLine = { text: string; claimId: string | null; bullet: boolean };
export type DraftOwnerDocument = { title: string; sections: { heading: string; lines: DraftOwnerLine[] }[] };
export type DraftOwnerClaim = { id: string; wordingSha256: string; text: string; placement: string; qualification: string; sources: { label: string; value: string }[]; jobEvidence: string[]; questionIds: string[] };
export type SavedDraftInstructions = { checkedAt: string; resumeRequirement: string; letterRequirement: string; resumeFilename: string | null; letterFilename: string | null; referenceTiming: string; referenceCount: number | null; formats: string[]; resumePageLimit: number | null; letterPageLimit: number | null };
export type DraftEvidenceRecovery = { jobId: string; expectedVersionId: string | null; expectedPacketSha256: string | null;
  basis: z.infer<typeof materialRuleBasisSchema>; basisIdentity: string; company: string; title: string; applicationUrl: string | null;
  instructions: SavedDraftInstructions; originalCheckedAt: string; effectiveCheckedAt: string; ruleCurrent: boolean;
  currentContextSha256: string | null; latestReceiptId: string | null; canRefresh: boolean;
  questions: { status: string; verification: string; comparisonAvailable: boolean; items: { id: string; prompt: string; required: boolean | null; wordLimit: number | null; characterLimit: number | null }[] } };
const savedRuleFields = { checked_at: time, resume_requirement: z.string().min(1).max(100), cover_letter_requirement: z.string().min(1).max(100), resume_filename_instruction: z.string().max(2000).nullable(), cover_letter_filename_instruction: z.string().max(2000).nullable(), reference_timing: z.string().min(1).max(100), reference_count: z.number().int().min(0).max(99).nullable(), allowed_formats: z.array(z.enum(["PDF", "DOCX"])).min(1).max(2), resume_page_limit: z.number().int().positive().nullable(), cover_letter_page_limit: z.number().int().positive().nullable() };
function savedInstructions(rule: z.infer<z.ZodObject<typeof savedRuleFields>>): SavedDraftInstructions { return { checkedAt: rule.checked_at, resumeRequirement: rule.resume_requirement, letterRequirement: rule.cover_letter_requirement, resumeFilename: rule.resume_filename_instruction, letterFilename: rule.cover_letter_filename_instruction, referenceTiming: rule.reference_timing, referenceCount: rule.reference_count, formats: rule.allowed_formats, resumePageLimit: rule.resume_page_limit, letterPageLimit: rule.cover_letter_page_limit }; }
export type DraftOwnerDetail = {
  status: "AVAILABLE"; jobId: string; state: typeof states[number]; versionId: string; version: number; lineId: string; revisionId: string;
  packetSha256: string; sourceSha256: string; ruleSha256: string; memberSetSha256: string | null; approvalSha256: string | null; dueAt: string; validUntil: string;
  kind: "PROPOSAL" | "RENDER_SOURCE"; company: string; title: string; applicationUrl: string | null;
  documents: DraftOwnerDocument[]; claims: DraftOwnerClaim[]; facts: { id: string; label: string; disposition: string; fields: { label: string; value: string }[]; provenance: { kind: string; verification: string; locator: string; confirmedAt: string | null; document: { kind: string; version: number } | null } }[];
  instructions: { emphasis: string; doNotMention: string; saved: SavedDraftInstructions };
  references?: { permissionId: string; version: number; confirmedAt: string; fields: { label: string; value: string }[] }[];
  referenceFilenameInstruction?: string | null;
  editing?: DraftOwnerEditModel;
  canRequestChanges?: boolean;
  revisionRequest?: { instructions: string; priorVersionId: string; priorSourceSha256: string };
  questions: { status: string; verification: string; issues: string[]; items: { id: string; prompt: string; required: boolean | null; wordLimit: number | null; characterLimit: number | null; sourceUrl: string | null; observedAt: string; eligible: boolean }[] };
  requiredFileTypes: string[]; files: { type: string; filename: string; fileVersionId: string; checksumSha256: string; previewUrl: string | null }[];
  wordingReviewed: boolean; canPromote: boolean; canReviewWording: boolean; canApprove: boolean; canSend: boolean;
} | { status: "UNAVAILABLE" | "REFRESH_REQUIRED" | "PENDING" | "RELEASED"; jobId: string; message: string; recovery?: DraftEvidenceRecovery; initialListing?: { ruleSha256: string; applicationUrl: string | null; company: string; title: string; revisionId: string; instructions: SavedDraftInstructions } };

class ViewError extends Error { constructor(readonly code: string) { super(code); } }
function ensure(value: unknown, code = "UNAVAILABLE"): asserts value { if (!value) throw new ViewError(code); }
function parse<T>(schema: z.ZodType<T>, value: unknown): T { const result = schema.safeParse(value); ensure(result.success); return result.data; }
function safeUrl(value: string): string | null {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.hash &&
    ![...url.searchParams.keys()].some((key) => /token|password|secret|session|email|phone|authorization/i.test(key)) ? url.href : null; } catch { return null; }
}
const sha = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const label = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ");
function display(value: unknown): string { return value === null ? "Not supplied" : typeof value === "string" ? value : typeof value === "boolean" ? value ? "Yes" : "No" : typeof value === "number" ? String(value) : Array.isArray(value) ? value.map(display).join("; ") : "See confirmed source detail"; }
function fields(value: unknown): { label: string; value: string }[] {
  return value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value).filter(([key]) => !["clientId", "employmentFactId", "sourceDocumentFactId", "sourceFactIds", "protectedPayloadId", "contentSha256"].includes(key)).map(([key, item]) => ({ label: label(key), value: display(item) })) : [];
}

/** Server-only private reader. The page must first requireAdmin() with fresh MFA.
 * Only the selected current job is decrypted. Read consistency is optimistic;
 * mutation authority remains the separate transactional owner RPCs. */
export function createDraftOwnerView(admin: SupabaseClient<Database>, trustedReviewerId: string, options: { now?: () => Date; changePort?: DraftChangePort } = {}) {
  const reviewerId = parse(uuid, trustedReviewerId), now = options.now ?? (() => new Date());
  async function run<T>(external: AbortSignal, operation: (signal: AbortSignal) => Promise<T>) {
    const controller = new AbortController(), abort = () => controller.abort();
    external.addEventListener("abort", abort, { once: true }); if (external.aborted) abort();
    let stop: () => void = () => undefined;
    const interrupted = new Promise<never>((_, reject) => { stop = () => reject(new ViewError("UNAVAILABLE")); controller.signal.addEventListener("abort", stop, { once: true }); if (controller.signal.aborted) stop(); });
    const timer = setTimeout(abort, 45_000);
    try { const value = await Promise.race([operation(controller.signal), interrupted]); ensure(!controller.signal.aborted); return value; }
    finally { clearTimeout(timer); external.removeEventListener("abort", abort); controller.signal.removeEventListener("abort", stop); controller.abort(); }
  }
  async function data(query: PromiseLike<{ data: unknown; error: unknown }>, signal: AbortSignal) {
    ensure(!signal.aborted); const value = await query; ensure(!signal.aborted && !value.error); return value.data;
  }
  const authorize = async (signal: AbortSignal) => parse(z.literal(true), await data(admin.rpc("ap_require_material_reviewer", { p_reviewer_id: reviewerId }).abortSignal(signal), signal));
  const job = async (id: string, signal: AbortSignal) => {
    const row = parse(jobSchema, await data(admin.from("ap_material_draft_jobs").select(jobColumns).eq("id", id).abortSignal(signal).single(), signal)); ensure(row.id === id); return row;
  };
  const version = async (id: string, signal: AbortSignal) => {
    const row = parse(versionSchema, await data(admin.from("ap_material_draft_versions").select(versionColumns).eq("id", id).abortSignal(signal).single(), signal)); ensure(row.id === id); return row;
  };
  async function readPayload(current: z.infer<typeof jobSchema>, payloadId: string, digest: string, purpose: "MATERIAL_DRAFT_PACKET" | "MATERIAL_DRAFT_SOURCE", signal: AbortSignal) {
    let bytes: Buffer | undefined;
    try {
      bytes = await readEncryptedDraftPayload(admin, { customerId: current.customer_id, jobId: current.id, payloadId, sha256: digest, purpose }, { signal });
      ensure(!signal.aborted && bytes.length > 0 && bytes.length <= 4_000_000 && sha(bytes) === digest);
      const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes); return { body, value: JSON.parse(body) as unknown };
    } finally { bytes?.fill(0); }
  }
  async function recovery(jobId: string, signal: AbortSignal): Promise<DraftEvidenceRecovery> {
    await authorize(signal); const current = await job(jobId, signal);
    ensure(!["RELEASED", "SUPERSEDED", "CANCELED", "RESULT_UNKNOWN"].includes(current.state));
    const inspector = createMaterialRuleOwnerServer(admin, reviewerId, { now });
    const inspected = await inspector.inspectRuleEvidence({ jobId }, signal), basis = inspected.evidence.basis;
    ensure(inspected.jobId === current.id && inspected.customerId === current.customer_id && inspected.materialLineId === current.material_line_id
      && inspected.lineRevisionId === current.line_revision_id && inspected.sourceSnapshotId === current.source_snapshot_id
      && inspected.evidence.activeVersionId === current.active_version_id);
    const v = current.active_version_id ? await version(current.active_version_id, signal) : null;
    ensure(!v || v.job_id === current.id && v.customer_id === current.customer_id && v.material_line_id === current.material_line_id && !v.invalidated_at && !v.release_id);
    const rule = parse(z.object({ id: uuid, job_snapshot_id: uuid, content_sha256: hash, is_current: z.literal(true), superseded_at: z.null(), ...savedRuleFields }).strict(),
      await data(admin.from("ap_employer_submission_rules").select("id,job_snapshot_id,content_sha256,is_current,superseded_at,checked_at,resume_requirement,cover_letter_requirement,resume_filename_instruction,cover_letter_filename_instruction,reference_timing,reference_count,allowed_formats,resume_page_limit,cover_letter_page_limit").eq("id", basis.ruleId).abortSignal(signal).single(), signal));
    const target = parse(z.object({ id: uuid, content_sha256: hash, company: z.string().min(1).max(1000), exact_title: z.string().min(1).max(1000), canonical_application_url: z.string().max(4000) }).strict(),
      await data(admin.from("ap_job_snapshots").select("id,content_sha256,company,exact_title,canonical_application_url").eq("id", basis.jobSnapshotId).abortSignal(signal).single(), signal));
    ensure(rule.id === basis.ruleId && rule.content_sha256 === basis.ruleSha256 && rule.job_snapshot_id === target.id && target.id === basis.jobSnapshotId
      && target.content_sha256 === basis.jobContentSha256 && Date.parse(rule.checked_at) === Date.parse(inspected.evidence.originalCheckedAt));
    // Public source metadata only: expired customer packets are never decrypted
    // to recover the employer-question baseline.
    const sourceJob = parse(draftingEvidenceRecordsSchema.shape.job, await data(admin.from("ap_job_snapshots")
      .select("id,legacy_job_id,content_sha256,company,exact_title,canonical_application_url,source_url,captured_listing,retrieved_at,live_verified_at,discovery_source,external_job_id,source_run_id,source_authorization_id,listing_activity_result,application_path_result,legitimacy_result")
      .eq("id", target.id).abortSignal(signal).single(), signal));
    const sourceRule = parse(draftingEvidenceRecordsSchema.shape.rule, await data(admin.from("ap_employer_submission_rules")
      .select("id,job_snapshot_id,content_sha256,checked_at,human_confirmed_at,human_confirmed_by,is_current,superseded_at,injection_scan_state,hard_block_reason,allowed_formats,resume_page_limit,cover_letter_page_limit,resume_requirement,cover_letter_requirement,resume_filename_instruction,cover_letter_filename_instruction,reference_timing,reference_count,source_evidence_ids,application_questions")
      .eq("id", rule.id).abortSignal(signal).single(), signal));
    ensure(sourceJob.id === target.id && sourceJob.content_sha256 === target.content_sha256 && sourceRule.id === rule.id && sourceRule.content_sha256 === rule.content_sha256 && sourceRule.job_snapshot_id === target.id);
    ensure(Buffer.byteLength(JSON.stringify(sourceJob.captured_listing)) <= 1_000_000 && Buffer.byteLength(JSON.stringify(sourceRule.application_questions)) <= 128_000);
    const nodes = parse(draftingEvidenceRecordsSchema.shape.questionSourceNodes, await data(admin.from("ap_requirement_nodes")
      .select("id,job_snapshot_id,source_excerpt").eq("job_snapshot_id", target.id).in("id", sourceRule.source_evidence_ids).limit(101).abortSignal(signal), signal));
    let captureBinding = null;
    let verifyAuthority: (() => Promise<void>) | undefined;
    const source = getEmployerSource(sourceJob.discovery_source);
    if (source?.adapterKind === "greenhouse" && source.adapterKey && sourceJob.external_job_id && sourceJob.source_run_id && sourceJob.source_authorization_id) {
      const authority = parse(draftingEvidenceRecordsSchema.shape.questionSourceAuthority, {
        run: await data(admin.from("job_source_runs").select("id,source_id,adapter_version,source_authorization_id,authorization_head_revision,scope_sha256,status,enumeration_status").eq("id", sourceJob.source_run_id).abortSignal(signal).single(), signal),
        authorization: await data(admin.from("ap_source_authorizations").select("id,source_id,authorization_version,allowed_actions,state").eq("id", sourceJob.source_authorization_id).abortSignal(signal).single(), signal),
        head: await data(admin.from("ap_source_authorization_heads").select("source_id,current_authorization_id,revision").eq("source_id", sourceJob.discovery_source).abortSignal(signal).single(), signal),
      });
      verifyAuthority = async () => {
        const afterAuthority = parse(draftingEvidenceRecordsSchema.shape.questionSourceAuthority, {
          run: await data(admin.from("job_source_runs").select("id,source_id,adapter_version,source_authorization_id,authorization_head_revision,scope_sha256,status,enumeration_status").eq("id", sourceJob.source_run_id!).abortSignal(signal).single(), signal),
          authorization: await data(admin.from("ap_source_authorizations").select("id,source_id,authorization_version,allowed_actions,state").eq("id", sourceJob.source_authorization_id!).abortSignal(signal).single(), signal),
          head: await data(admin.from("ap_source_authorization_heads").select("source_id,current_authorization_id,revision").eq("source_id", sourceJob.discovery_source).abortSignal(signal).single(), signal),
        });
        ensure(JSON.stringify(afterAuthority) === JSON.stringify(authority));
      };
      if (authority && authority.run.id === sourceJob.source_run_id && authority.run.source_id === sourceJob.discovery_source
        && authority.run.source_authorization_id === sourceJob.source_authorization_id && authority.run.status === "succeeded" && authority.run.enumeration_status === "complete"
        && authority.run.adapter_version && authority.run.scope_sha256 && authority.authorization.id === sourceJob.source_authorization_id
        && authority.authorization.source_id === sourceJob.discovery_source && authority.authorization.state === "AUTHORIZED_AUTOMATED"
        && authority.authorization.allowed_actions.includes("READ_APPLICATION_QUESTIONS") && authority.head.source_id === sourceJob.discovery_source
        && authority.head.current_authorization_id === authority.authorization.id && authority.head.revision === authority.run.authorization_head_revision) {
        captureBinding = { sourceId: sourceJob.discovery_source, boardToken: source.adapterKey, externalJobId: sourceJob.external_job_id,
          sourceRunId: authority.run.id, authorizationId: authority.authorization.id, authorizationVersion: authority.authorization.authorization_version,
          authorizationHeadRevision: authority.head.revision, scopeSha256: authority.run.scope_sha256, adapterVersion: authority.run.adapter_version };
      }
    }
    const questions = buildEmployerQuestionInsights(sourceRule.application_questions, { jobSnapshotId: target.id, jobSha256: target.content_sha256,
      ruleId: rule.id, ruleSha256: rule.content_sha256, ruleCheckedAt: sourceRule.checked_at, humanConfirmedAt: sourceRule.human_confirmed_at,
      ruleSourceEvidenceIds: sourceRule.source_evidence_ids, rawSource: { sourceUrl: sourceJob.source_url, observedAt: sourceJob.retrieved_at, value: sourceJob.captured_listing }, nodes, captureBinding }, now());
    const after = await inspector.inspectRuleEvidence({ jobId }, signal);
    await verifyAuthority?.();
    ensure(JSON.stringify(after) === JSON.stringify(inspected) && JSON.stringify(await job(jobId, signal)) === JSON.stringify(current)
      && (!v || JSON.stringify(await version(v.id, signal)) === JSON.stringify(v)));
    return { jobId, expectedVersionId: v?.id ?? null, expectedPacketSha256: v?.packet_sha256 ?? null, basis,
      basisIdentity: sha(Buffer.from(JSON.stringify(basis))), company: target.company, title: target.exact_title, applicationUrl: safeUrl(target.canonical_application_url),
      instructions: savedInstructions(rule), originalCheckedAt: inspected.evidence.originalCheckedAt, effectiveCheckedAt: inspected.evidence.effectiveCheckedAt,
      ruleCurrent: inspected.ruleCurrent, currentContextSha256: inspected.contextSha256, latestReceiptId: inspected.evidence.revalidation?.id ?? null,
      canRefresh: !!v && inspected.ruleCurrent && inspected.contextSha256 !== null,
      questions: { status: questions.status, verification: questions.verification,
        comparisonAvailable: questions.verification === "BOUND_SOURCE_EVIDENCE" && ["OBSERVED", "NONE_OBSERVED"].includes(questions.status),
        items: questions.questions.map(({ id, prompt, required, wordLimit, characterLimit }) => ({ id, prompt, required, wordLimit, characterLimit })) } };
  }
  return {
    async list(cursor: string | null, signal: AbortSignal): Promise<DraftOwnerQueue> {
      try { return await run(signal, async (child) => {
        await authorize(child);
        let query = admin.from("ap_material_draft_jobs").select(jobColumns).in("state", states.filter((state) => !["RELEASED", "SUPERSEDED", "CANCELED"].includes(state)))
          .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(21);
        if (cursor !== null) { ensure(cursor.length < 300); const parsed = parse(cursorSchema, JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
          query = query.or(`created_at.lt.${parsed.at},and(created_at.eq.${parsed.at},id.lt.${parsed.id})`); }
        const rows = parse(z.array(jobSchema).max(21), await data(query.abortSignal(child), child));
        ensure(new Set(rows.map((row) => row.id)).size === rows.length && rows.every((row) => !["RELEASED", "SUPERSEDED", "CANCELED"].includes(row.state)));
        const page = rows.slice(0, 20), last = page.at(-1);
        return { status: "AVAILABLE", jobs: page.map((row) => ({ id: row.id, shortId: row.id.slice(0, 8).toUpperCase(), state: row.state, errorCode: row.error_code, updatedAt: row.updated_at, versionId: row.active_version_id })),
          nextCursor: rows.length > 20 && last ? Buffer.from(JSON.stringify({ at: last.created_at, id: last.id })).toString("base64url") : null };
      }); } catch { return { status: "UNAVAILABLE", jobs: [], nextCursor: null }; }
    },
    async detail(jobId: string, signal: AbortSignal): Promise<DraftOwnerDetail> {
      try { return await run(signal, async (child): Promise<DraftOwnerDetail> => {
        parse(uuid, jobId); await authorize(child); const current = await job(jobId, child);
        if (current.state === "RELEASED") return { status: "RELEASED", jobId, message: "This pair has been sent. Customer delivery remains available through the existing delivery records." };
        if (["SUPERSEDED", "CANCELED"].includes(current.state)) throw new ViewError("UNAVAILABLE");
        if (!current.active_version_id) {
          if (!["EVIDENCE_PENDING", "PREPARING", "OWNER_EXCEPTION"].includes(current.state)) return { status: "PENDING", jobId, message: "A complete saved draft is not available yet. Review the queue state; no document is ready for approval or sending." };
          const revision = parse(z.object({ id: uuid, line_id: uuid, source_snapshot_id: uuid, job_snapshot_id: uuid, employer_rule_snapshot_id: uuid, superseded_at: z.null() }).strict(),
            await data(admin.from("ap_material_line_revisions").select("id,line_id,source_snapshot_id,job_snapshot_id,employer_rule_snapshot_id,superseded_at").eq("id", current.line_revision_id).abortSignal(child).single(), child));
          ensure(revision.id === current.line_revision_id && revision.line_id === current.material_line_id && revision.source_snapshot_id === current.source_snapshot_id);
          const rule = parse(z.object({ id: uuid, job_snapshot_id: uuid, content_sha256: hash, is_current: z.literal(true), superseded_at: z.null(), ...savedRuleFields }).strict(), await data(admin.from("ap_employer_submission_rules").select("id,job_snapshot_id,content_sha256,is_current,superseded_at,checked_at,resume_requirement,cover_letter_requirement,resume_filename_instruction,cover_letter_filename_instruction,reference_timing,reference_count,allowed_formats,resume_page_limit,cover_letter_page_limit").eq("id", revision.employer_rule_snapshot_id).abortSignal(child).single(), child));
          const target = parse(z.object({ id: uuid, company: z.string().min(1).max(1000), exact_title: z.string().min(1).max(1000), canonical_application_url: z.string().max(4000) }).strict(), await data(admin.from("ap_job_snapshots").select("id,company,exact_title,canonical_application_url").eq("id", revision.job_snapshot_id).abortSignal(child).single(), child));
          ensure(rule.id === revision.employer_rule_snapshot_id && rule.job_snapshot_id === target.id && target.id === revision.job_snapshot_id && JSON.stringify(await job(jobId, child)) === JSON.stringify(current), "REFRESH_REQUIRED");
          if (Date.parse(rule.checked_at) <= now().getTime() - 3_600_000) throw new ViewError("REFRESH_REQUIRED");
          return { status: "PENDING", jobId, message: "No document proposal is saved yet. The owner can record the initial listing check; this does not draft, approve, or send anything.", initialListing: { ruleSha256: rule.content_sha256, applicationUrl: safeUrl(target.canonical_application_url), company: target.company, title: target.exact_title, revisionId: revision.id, instructions: savedInstructions(rule) } };
        }
        const v = await version(current.active_version_id, child);
        ensure(v.job_id === current.id && v.customer_id === current.customer_id && v.material_line_id === current.material_line_id && !v.invalidated_at, "REFRESH_REQUIRED");
        const revision = parse(revisionSchema, await data(admin.from("ap_material_line_revisions").select("id,line_id,source_snapshot_id,version,binding_sha256,due_at,superseded_at").eq("id", current.line_revision_id).abortSignal(child).single(), child));
        ensure(revision.id === current.line_revision_id && revision.line_id === current.material_line_id && revision.source_snapshot_id === current.source_snapshot_id && !revision.superseded_at && Date.parse(revision.due_at) > now().getTime(), "REFRESH_REQUIRED");
        let context: unknown;
        try {
          ensure(!child.aborted); const receipt = await admin.rpc("ap_material_draft_context_sha256", { p_job_id: jobId }).abortSignal(child);
          ensure(!child.aborted);
          if (receipt.error?.message === "required_reference_clarification") throw new ViewError("REFERENCE_CLARIFICATION");
          ensure(!receipt.error, "REFRESH_REQUIRED"); context = receipt.data;
        } catch (error) { if (error instanceof ViewError && error.code === "REFERENCE_CLARIFICATION") throw error; throw new ViewError("REFRESH_REQUIRED"); }
        ensure(context === v.context_sha256, "REFRESH_REQUIRED");
        let packet: DraftingEvidencePacket;
        try { packet = await loadDraftingEvidencePacket(admin, { customerId: current.customer_id, materialLineId: current.material_line_id, revisionId: revision.id, revisionVersion: revision.version, bindingSha256: revision.binding_sha256 }, { signal: child, now }); }
        catch (error) { if (error instanceof Error && error.message === "DRAFTING_EVIDENCE_REQUIRED_REFERENCE_CLARIFICATION") throw new ViewError("REFERENCE_CLARIFICATION"); throw new ViewError("REFRESH_REQUIRED"); }
        const savedPacket = await readPayload(current, v.packet_encrypted_payload_id, v.packet_sha256, "MATERIAL_DRAFT_PACKET", child);
        ensure(packet.packetSha256 === v.packet_sha256 && serializeDraftingEvidencePacket(packet) === savedPacket.body && packet.binding.snapshotId === current.source_snapshot_id && packet.binding.dueAt === revision.due_at, "REFRESH_REQUIRED");
        if (!v.encrypted_payload_id || !v.source_sha256) return { status: "PENDING", jobId, message: "Evidence is saved, but a complete document proposal has not been recorded. No approval is available." };
        const saved = await readPayload(current, v.encrypted_payload_id, v.source_sha256, "MATERIAL_DRAFT_SOURCE", child);
        const change = options.changePort ? await loadDraftChangeForVersion(admin, options.changePort, { jobId: current.id,
          versionId: v.id, customerId: current.customer_id, materialLineId: current.material_line_id }, packet, child, now) : null;
        const facts = packet.ownerEvidence.facts.map((fact) => {
          const document = packet.ownerEvidence.documents.find((item) => item.id === fact.document_version_id);
          return { id: fact.id, label: fact.customer_display_label || label(fact.value_kind), disposition: packet.providerView.facts.find((item) => item.id === fact.id)?.disposition ?? "Do not infer a qualification", fields: fields(fact.typed_value),
            provenance: { kind: fact.source_kind, verification: fact.verification, locator: fact.source_locator, confirmedAt: fact.confirmed_or_corrected_at, document: document ? { kind: document.kind, version: document.version } : null } };
        });
        const sourceEnvelope = z.object({ schemaVersion: z.literal("applypack-draft-render-source-v1") }).passthrough().safeParse(saved.value);
        const storedSource = sourceEnvelope.success ? readStoredDraftRenderSource(saved, v.source_sha256, packet, now) : undefined;
        if (storedSource) ensure(JSON.stringify(storedSource.changeRequest ?? null) === JSON.stringify(change?.lineage ?? null));
        const references = await (async () => {
          const request = draftReferenceRequest(packet); if (!request) return [];
          let bytes: DraftReferenceInput[] = [];
          try {
            bytes = await readConfirmedDraftReferences(admin, request, child, { now });
            if (storedSource) validateDraftReferenceSource(storedSource.referenceSheet, packet.ownerEvidence.referenceBindings, bytes, now());
            return readDraftReferenceSources(request.bindings, bytes, now()).map(({ binding, fields }) => ({ permissionId: binding.permissionId,
              version: binding.recordVersion, confirmedAt: binding.permissionConfirmedAt, fields: fields.map((field) => ({ label: label(field.field), value: field.value })) }));
          } finally { bytes.forEach((value) => value.plaintext.fill(0)); }
        })();
        const documents: DraftOwnerDocument[] = [], claims: DraftOwnerClaim[] = [];
        let kind: "PROPOSAL" | "RENDER_SOURCE" = "PROPOSAL";
        if (storedSource) {
          const source = storedSource; kind = "RENDER_SOURCE";
          let contactBytes: Buffer | undefined;
          const confirmedContact = await (async () => {
            try {
              contactBytes = await readConfirmedDraftContact(admin, { customerId: current.customer_id, payloadId: packet.binding.contactPayloadId, sha256: packet.binding.contactSha256 }, child);
              ensure(!child.aborted); return materialContactSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(contactBytes)));
            } finally { contactBytes?.fill(0); }
          })();
          const lines = (items: readonly { text: string; claimId: string }[], bullet = false) => items.map((item) => ({ text: item.text, claimId: item.claimId, bullet }));
          documents.push({ title: "Resume", sections: [{ heading: "Contact", lines: lines(source.resume.header) }, { heading: "Summary", lines: lines(source.resume.summary) }, { heading: "Skills", lines: lines(source.resume.skills, true) },
            ...source.resume.sections.map((section) => ({ heading: section.heading, lines: [...lines(section.header), ...lines(section.bullets, true)] })), ...source.resume.education.map((section) => ({ heading: section.heading, lines: lines(section.header) })),
            ...(source.resume.careerBreak ? [{ heading: "Career break", lines: lines([source.resume.careerBreak.label, source.resume.careerBreak.dates]) }] : [])].filter((section) => section.lines.length) });
          documents.push({ title: "Cover letter", sections: [{ heading: "Contact", lines: lines(source.coverLetter.header) }, { heading: "Letter", lines: [
            { text: source.coverLetter.date, claimId: null, bullet: false }, ...lines([source.coverLetter.recipient, source.coverLetter.subject]), { text: source.coverLetter.salutation, claimId: null, bullet: false },
            ...lines([source.coverLetter.introduction]), ...source.coverLetter.body.map((paragraph) => ({ text: paragraph.map((item) => item.text).join(" "), claimId: null, bullet: false })),
            ...lines([source.coverLetter.closing]), { text: source.coverLetter.signoff, claimId: null, bullet: false }, ...lines([source.coverLetter.signature])] }] });
          if (source.referenceSheet) documents.push({ title: "Reference sheet", sections: [{ heading: "Contact", lines: lines(source.referenceSheet.header) },
            ...source.referenceSheet.records.map((record, index) => ({ heading: `Reference ${index + 1}`, lines: lines(record.fields) }))] });
          for (const claim of source.ownerReviewClaims) claims.push({ id: claim.claimId, wordingSha256: claim.wordingSha256, text: claim.text, placement: label(claim.placement), qualification: label(claim.qualification),
            sources: claim.contactBinding ? claim.contactBinding.fields.map((field) => {
              ensure(claim.origin === "LOCAL_CONTACT" && claim.contactBinding?.fields.length === 1 && claim.contactBinding.payloadId === packet.binding.contactPayloadId && claim.contactBinding.contentSha256 === packet.binding.contactSha256
                && ["displayName", "email", "phone", "cityState", "linkedInOrPortfolio"].includes(field));
              const value = confirmedContact[field as keyof typeof confirmedContact]; ensure(typeof value === "string" && claim.text === value);
              return { label: `Confirmed checkout ${label(field)}`, value };
            }) : claim.referenceBinding ? (() => {
              const reference = references.find((value) => value.permissionId === claim.referenceBinding?.permissionId);
              const field = reference?.fields.find((value) => value.label === label(claim.referenceBinding!.field));
              ensure(field && claim.origin === "LOCAL_REFERENCE"); return [{ label: `Confirmed reference ${field.label}`, value: field.value }];
            })() : claim.factRefs.map((ref) => {
              const fact = packet.ownerEvidence.facts.find((item) => item.id === ref.factId); const value = ref.field.split(".").reduce<unknown>((parent, key) => parent && typeof parent === "object" ? (parent as Record<string, unknown>)[key] : undefined, fact?.typed_value);
              ensure(fact && value !== undefined && sha(Buffer.from(JSON.stringify(value))) === ref.valueSha256); return { label: `${fact.customer_display_label || label(fact.value_kind)} · ${label(ref.field)}`, value: display(value) };
            }), jobEvidence: claim.jobEvidenceIds.map((id) => packet.ownerEvidence.requirements.find((node) => node.id === id)?.source_excerpt ?? "Source unavailable"), questionIds: claim.questionInsights.map((item) => item.questionId) });
        } else {
          const envelope = parse(z.object({ schemaVersion: z.literal("applypack-draft-proposal-v1"), output: draftOutputSchema }).passthrough(), saved.value);
          const proposal = validateDraftOutput(envelope.output, packet, now(), change?.lineage); ensure(proposal.sourceSha256 === v.source_sha256 && serializeDraftProposal(proposal) === saved.body);
          const lines = (items: readonly { text: string }[], bullet = false) => items.map((item) => ({ text: item.text, claimId: null, bullet }));
          documents.push({ title: "Resume proposal", sections: [{ heading: "Summary", lines: lines(proposal.output.resume.summary) }, { heading: "Skills", lines: lines(proposal.output.resume.skills, true) }, ...proposal.output.resume.sections.map((section) => ({ heading: facts.find((fact) => fact.id === section.anchorFactId)?.fields.map((field) => field.value).slice(0, 3).join(" · ") || "Confirmed experience", lines: lines(section.bullets, true) }))].filter((section) => section.lines.length) });
          documents.push({ title: "Cover letter proposal", sections: [{ heading: "Body", lines: proposal.output.coverLetter.body.map((paragraph) => ({ text: paragraph.sentences.map((item) => item.text).join(" "), claimId: null, bullet: false })) }] });
        }
        const members = parse(z.array(memberSchema).max(3), await data(admin.from("ap_material_draft_members").select("customer_id,material_line_id,draft_version_id,artifact_type,artifact_id,file_version_id,file_sha256,preview_sha256,source_sha256").eq("draft_version_id", v.id).abortSignal(child), child));
        ensure(new Set(members.map((member) => member.artifact_type)).size === members.length && members.every((member) => member.customer_id === current.customer_id && member.material_line_id === current.material_line_id && member.draft_version_id === v.id && member.source_sha256 === v.source_sha256));
        const files: Extract<DraftOwnerDetail, { status: "AVAILABLE" }>["files"] = [];
        for (const member of members) {
          const artifact = parse(artifactSchema, await data(admin.from("ap_generated_artifacts").select("id,customer_id,material_line_id,source_line_revision_id,artifact_type,current_file_version,generator_version,retention_state").eq("id", member.artifact_id).abortSignal(child).single(), child));
          const file = parse(fileSchema, await data(admin.from("ap_generated_file_versions").select("id,artifact_id,version,checksum_sha256,safe_filename,superseded_at,downloads_revoked_at").eq("id", member.file_version_id).abortSignal(child).single(), child));
          const quality = parse(qualitySchema, await data(admin.from("ap_artifact_quality_reviews").select("file_version_id,automated_passed_at,render_preview_bucket,render_preview_sha256,document_font_family,document_font_resolved,invalidated_at").eq("file_version_id", file.id).abortSignal(child).single(), child));
          ensure(artifact.id === member.artifact_id && artifact.customer_id === current.customer_id && artifact.material_line_id === current.material_line_id && artifact.source_line_revision_id === revision.id && artifact.artifact_type === member.artifact_type && file.id === member.file_version_id && file.artifact_id === artifact.id && file.version === artifact.current_file_version && file.checksum_sha256 === member.file_sha256 && quality.file_version_id === file.id && quality.render_preview_sha256 === member.preview_sha256);
          const font = supportedDocumentFontFamily(artifact.generator_version);
          files.push({ type: member.artifact_type, filename: file.safe_filename, fileVersionId: file.id, checksumSha256: file.checksum_sha256, previewUrl: quality.automated_passed_at && !quality.invalidated_at && font && quality.document_font_resolved && quality.document_font_family === font && quality.render_preview_bucket === "operator-render-previews" ? `/api/admin/material-files/${file.id}/render-preview` : null });
        }
        const after = await job(jobId, child), afterVersion = await version(v.id, child);
        ensure(JSON.stringify(after) === JSON.stringify(current) && JSON.stringify(afterVersion) === JSON.stringify(v) && await data(admin.rpc("ap_material_draft_context_sha256", { p_job_id: jobId }).abortSignal(child), child) === context && Date.parse(packet.validUntil) > now().getTime(), "REFRESH_REQUIRED");
        const expectedTypes = packet.binding.referencePermissions.length ? ["RESUME", "COVER_LETTER", "REFERENCE_SHEET"] : ["RESUME", "COVER_LETTER"];
        const complete = !!v.member_set_sha256 && files.length === expectedTypes.length && expectedTypes.every((type) => files.some((file) => file.type === type)) && files.every((file) => file.previewUrl !== null);
        return { status: "AVAILABLE", jobId, state: current.state, versionId: v.id, version: v.version, lineId: current.material_line_id, revisionId: revision.id, packetSha256: v.packet_sha256, sourceSha256: v.source_sha256,
          ruleSha256: packet.binding.ruleSha256, memberSetSha256: v.member_set_sha256, approvalSha256: v.approval_sha256, dueAt: revision.due_at, validUntil: packet.validUntil, kind,
          canRequestChanges: Boolean(options.changePort) && kind === "RENDER_SOURCE" && ["SOURCE_READY", "REVIEW_READY", "APPROVED"].includes(current.state),
          ...(change ? { revisionRequest: { instructions: change.ownerInstructions, priorVersionId: change.lineage.priorVersionId, priorSourceSha256: change.lineage.priorSourceSha256 } } : {}),
          company: packet.ownerEvidence.targetJob.company, title: packet.ownerEvidence.targetJob.exactTitle, applicationUrl: safeUrl(packet.ownerEvidence.targetJob.canonicalApplicationUrl), documents, claims, facts,
          ...(references.length ? { references, referenceFilenameInstruction: packet.ownerEvidence.referenceFilenameInstruction ?? null } : {}),
          ...(storedSource && ["SOURCE_READY", "REVIEW_READY", "APPROVED"].includes(current.state) ? { editing: buildDraftOwnerEditModel(storedSource, packet, now()) } : {}),
          instructions: { emphasis: packet.ownerEvidence.customerInstructions.emphasis_note ?? "", doNotMention: packet.ownerEvidence.customerInstructions.do_not_mention_note ?? "", saved: savedInstructions(packet.ownerEvidence.employerInstructions) },
          questions: { status: packet.employerQuestionInsights.status, verification: packet.employerQuestionInsights.verification, issues: packet.employerQuestionInsights.issues.map((item) => item.code), items: packet.employerQuestionInsights.questions.map((question) => ({ id: question.id, prompt: question.prompt, required: question.required, wordLimit: question.wordLimit, characterLimit: question.characterLimit, sourceUrl: safeUrl(question.sourceUrl), observedAt: question.sourceObservedAt, eligible: question.providerEligible })) }, requiredFileTypes: expectedTypes, files,
          wordingReviewed: !!v.claim_review_sha256 && !!v.claims_reviewed_at, canPromote: kind === "PROPOSAL" && current.state === "SOURCE_READY" && !v.claim_review_sha256,
          canReviewWording: kind === "RENDER_SOURCE" && current.state === "SOURCE_READY" && !v.claim_review_sha256,
          canApprove: kind === "RENDER_SOURCE" && current.state === "REVIEW_READY" && complete && !!v.claim_review_sha256 && !!v.claims_reviewed_at,
          canSend: kind === "RENDER_SOURCE" && current.state === "APPROVED" && complete && !!v.approval_sha256 && !!v.approved_at };
      }); } catch (error) { const status = error instanceof ViewError && error.code === "REFRESH_REQUIRED" ? "REFRESH_REQUIRED" : "UNAVAILABLE";
        if (error instanceof ViewError && error.code === "REFERENCE_CLARIFICATION") return { status: "UNAVAILABLE", jobId,
          message: "The employer requires more references than this paid document set includes. Clarify the reference selection with the customer before preparing, approving, or sending it. No extra references have been added." };
        if (status === "REFRESH_REQUIRED") {
          try { const inspected = await run(signal, (child) => recovery(jobId, child));
            return { status, jobId, recovery: inspected, message: "The saved draft evidence is not current. Review the original employer instructions below before recording any new check. These steps do not generate, approve, or send documents." }; }
          catch { /* Unverifiable metadata never enables a recovery action. */ }
        }
        return { status, jobId, message: status === "REFRESH_REQUIRED" ? "Evidence or the active version has changed or expired. The current source could not be verified, so review and refresh controls are unavailable. Confirm source access and reload." : "This draft could not be verified or loaded. No private content or approval controls are available. Refresh after confirming administrator MFA." }; }
    },
  };
}

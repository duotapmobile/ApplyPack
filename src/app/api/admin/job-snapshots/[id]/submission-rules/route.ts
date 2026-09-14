import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { isSameOriginRequest } from "@/lib/security/origin";

const schema = z.object({
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  sourceEvidenceIds: z.array(z.uuid()).min(1).max(100),
  resumeRequirement: z.enum(["REQUIRED", "OPTIONAL", "PROHIBITED"]),
  coverLetterRequirement: z.enum(["REQUIRED", "OPTIONAL", "PROHIBITED"]),
  allowedFormats: z.array(z.enum(["DOCX", "PDF"])).min(1).max(2),
  resumePageLimit: z.union([z.literal(1), z.literal(2)]).nullable(),
  coverLetterPageLimit: z.literal(1).nullable(),
  resumeFilenameInstruction: z.string().trim().max(180).nullable(),
  coverLetterFilenameInstruction: z.string().trim().max(180).nullable(),
  referenceFilenameInstruction: z.string().trim().max(180).nullable(),
  referenceTiming: z.enum(["OPTIONAL_NOW", "REQUIRED_NOW", "PROHIBITED_NOW", "LATER_OR_UNKNOWN"]),
  referenceCount: z.number().int().min(1).max(99).nullable(),
  submissionChannel: z.enum(["HTTPS_UPLOAD", "EMAIL", "OTHER_SUPPORTED", "UNSUPPORTED"]),
  portfolioInstruction: z.string().trim().max(1_000).nullable(),
  workSampleInstruction: z.string().trim().max(1_000).nullable(),
  applicationQuestions: z.array(z.record(z.string(), z.unknown())).max(100),
  parserVersion: z.string().trim().min(3).max(100),
  injectionScanState: z.enum(["CLEAR", "BLOCKED", "REVIEW_REQUIRED"]),
  hardBlockReason: z.string().trim().min(3).max(500).nullable(),
  checkedAt: z.iso.datetime(),
}).strict();

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "This rule review was rejected." }, { status: 403 });
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const jobSnapshotId = z.uuid().safeParse((await route.params).id);
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!jobSnapshotId.success || !input.success || new Set(input.data.sourceEvidenceIds).size !== input.data.sourceEvidenceIds.length
    || new Set(input.data.allowedFormats).size !== input.data.allowedFormats.length) {
    return NextResponse.json({ error: "The human-confirmed employer rule record is incomplete." }, { status: 400 });
  }
  const value = input.data;
  const result = await auth.admin.rpc("ap_upsert_employer_submission_rules", {
    p_reviewer_id: auth.user.id,
    p_job_snapshot_id: jobSnapshotId.data,
    p_content_sha256: value.contentSha256,
    p_source_evidence_ids: value.sourceEvidenceIds,
    p_resume_requirement: value.resumeRequirement,
    p_cover_letter_requirement: value.coverLetterRequirement,
    p_allowed_formats: value.allowedFormats,
    p_resume_page_limit: value.resumePageLimit,
    p_cover_letter_page_limit: value.coverLetterPageLimit,
    p_resume_filename_instruction: value.resumeFilenameInstruction,
    p_cover_letter_filename_instruction: value.coverLetterFilenameInstruction,
    p_reference_filename_instruction: value.referenceFilenameInstruction,
    p_reference_timing: value.referenceTiming,
    p_reference_count: value.referenceCount,
    p_submission_channel: value.submissionChannel,
    p_portfolio_instruction: value.portfolioInstruction,
    p_work_sample_instruction: value.workSampleInstruction,
    p_application_questions: value.applicationQuestions,
    p_parser_version: value.parserVersion,
    p_injection_scan_state: value.injectionScanState,
    p_hard_block_reason: value.hardBlockReason,
    p_checked_at: value.checkedAt,
  });
  if (result.error || typeof result.data !== "string") {
    return NextResponse.json({ error: "The rule record failed evidence, source, or reviewer validation." }, { status: 409 });
  }
  return NextResponse.json({ ruleId: result.data }, { status: 201, headers: { "cache-control": "no-store" } });
}

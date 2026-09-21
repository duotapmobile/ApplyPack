import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { loadSyntheticBoardReviewJobs } from "@/lib/job-board/staging-review";
import { isSameOriginRequest } from "@/lib/security/origin";

export const dynamic = "force-dynamic";

const schema = z.object({
  jobId: z.uuid(),
  attestation: z.string().trim().min(30).max(1_000),
  resumeRequirement: z.enum(["REQUIRED", "OPTIONAL"]),
  coverLetterRequirement: z.enum(["REQUIRED", "OPTIONAL"]),
  allowedFormats: z.array(z.enum(["DOCX", "PDF"])).min(1).max(2),
  submissionChannel: z.enum(["HTTPS_UPLOAD", "EMAIL", "OTHER_SUPPORTED"]),
}).strict();

function stagingEnabled() {
  return process.env.APP_STAGING_SYNTHETIC_JOBS === "true"
    && process.env.APP_PAYMENT_MODE !== "live"
    && process.env.APP_LIVE_PAYMENTS_ENABLED !== "true";
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (!stagingEnabled()) return NextResponse.json({ jobs: [], enabled: false }, { headers: { "cache-control": "no-store, private" } });
  try {
    return NextResponse.json({ enabled: true, jobs: await loadSyntheticBoardReviewJobs(auth.admin) },
      { headers: { "cache-control": "no-store, private" } });
  } catch {
    return NextResponse.json({ error: "Synthetic board review inventory is unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "This review request was rejected." }, { status: 403 });
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (!stagingEnabled()) return NextResponse.json({ error: "Synthetic board review is disabled outside protected staging." }, { status: 409 });
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success || new Set(input.data.allowedFormats).size !== input.data.allowedFormats.length) {
    return NextResponse.json({ error: "Complete the fictional listing and employer-instruction review." }, { status: 400 });
  }
  const jobResult = await auth.admin.from("jobs")
    .select("id,company,title,description,source_url,official_application_url,external_job_id,location_text,salary_text,posted_at,last_verified_at,content_hash")
    .eq("id", input.data.jobId).eq("source_id", "synthetic-staging")
    .eq("is_active", true).eq("listing_status", "open").eq("source_freshness_status", "fresh").maybeSingle();
  if (jobResult.error || !jobResult.data) return NextResponse.json({ error: "The fictional listing is no longer current." }, { status: 409 });
  const job = jobResult.data;
  const applicationUrl = job.official_application_url || job.source_url;
  try {
    const application = new URL(applicationUrl);
    const app = new URL(process.env.NEXT_PUBLIC_APP_URL || "");
    if (application.protocol !== "https:" || application.origin !== app.origin || application.pathname !== "/staging/synthetic-application") {
      return NextResponse.json({ error: "The fictional application path failed staging validation." }, { status: 409 });
    }
  } catch {
    return NextResponse.json({ error: "The fictional application path failed staging validation." }, { status: 409 });
  }
  const now = new Date();
  const canonical = JSON.stringify({ jobId: job.id, contentHash: job.content_hash, applicationUrl,
    attestation: input.data.attestation, resumeRequirement: input.data.resumeRequirement,
    coverLetterRequirement: input.data.coverLetterRequirement, allowedFormats: input.data.allowedFormats,
    submissionChannel: input.data.submissionChannel, reviewedAt: now.toISOString() });
  const contentSha256 = createHash("sha256").update(canonical).digest("hex");
  const previous = await auth.admin.from("ap_job_snapshots").select("id")
    .eq("legacy_job_id", job.id).order("retrieved_at", { ascending: false }).limit(1).maybeSingle();
  if (previous.error) return NextResponse.json({ error: "Existing review provenance could not be checked." }, { status: 503 });
  const snapshot = await auth.admin.from("ap_job_snapshots").insert({
    legacy_job_id: job.id, origin: "APPLYPACK_FOUND", discovery_source: "ApplyPack synthetic staging inventory",
    external_job_id: job.external_job_id, canonical_application_url: applicationUrl,
    application_host_type: "APPROVED_THIRD_PARTY", canonical_employer_listing_url: job.source_url,
    source_url: job.source_url, company: job.company, exact_title: job.title,
    normalized_fingerprint: createHash("sha256").update(`${job.company}:${job.title}:${applicationUrl}`).digest("hex"),
    captured_listing: { syntheticStaging: true, title: job.title, company: job.company,
      description: job.description, applicationUrl, reviewerAttestation: input.data.attestation },
    retrieved_at: now.toISOString(), posted_on: job.posted_at ? job.posted_at.slice(0, 10) : null,
    posted_date_unknown: !job.posted_at, live_verified_at: now.toISOString(),
    compensation_text: job.salary_text, compensation_source: job.salary_text ? "SYNTHETIC_FIXTURE" : null,
    location_and_work_mode: { display: job.location_text, syntheticStaging: true },
    parser_version: "synthetic-board-material-review-v1", content_sha256: contentSha256,
    source_authorization_id: null, first_seen_at: job.posted_at || now.toISOString(),
    canonical_employer_domain: new URL(applicationUrl).hostname, employer_identity_result: "PASS",
    application_path_result: "PASS", listing_activity_result: "PASS", legitimacy_result: "PASS",
    requirement_completeness: 100, compensation_completeness: job.salary_text ? 100 : 0,
    canonicalization_version: "synthetic-board-material-review-v1", legacy_compatibility: true,
    supersedes_job_snapshot_id: previous.data?.id || null, material_restrictions: { syntheticStaging: true },
    material_source_qualities: [1],
  }).select("id").single();
  if (snapshot.error || !snapshot.data) return NextResponse.json({ error: "The reviewed fictional listing snapshot could not be recorded." }, { status: 409 });
  const evidenceId = randomUUID();
  const evidence = await auth.admin.from("ap_requirement_nodes").insert({
    id: evidenceId, job_snapshot_id: snapshot.data.id, parent_id: null, position: 0,
    node_kind: "CRITERION", criterion_type: "LISTING_APPLICATION_PATH", stable_criterion_id: randomUUID(),
    semantic_key: "listing_application_path:synthetic_staging", requirement_strength: "INFORMATIONAL",
    source_locator: "captured_listing.applicationUrl", parser_certainty: 1,
    criterion_version: "synthetic-board-material-review-v1",
    typed_value: { applicationUrl, syntheticStaging: true }, source_excerpt: applicationUrl,
    classification_method: "HUMAN_CONFIRMED_SYNTHETIC_STAGING", importance: 3,
    human_correction_history: [{ reviewerId: auth.user.id, reviewedAt: now.toISOString(),
      attestationSha256: createHash("sha256").update(input.data.attestation).digest("hex") }],
  });
  if (evidence.error) return NextResponse.json({ error: "The reviewed instruction evidence could not be recorded." }, { status: 409 });
  const rule = await auth.admin.rpc("ap_upsert_employer_submission_rules", {
    p_reviewer_id: auth.user.id, p_job_snapshot_id: snapshot.data.id, p_content_sha256: contentSha256,
    p_source_evidence_ids: [evidenceId], p_resume_requirement: input.data.resumeRequirement,
    p_cover_letter_requirement: input.data.coverLetterRequirement, p_allowed_formats: input.data.allowedFormats,
    p_resume_page_limit: 2, p_cover_letter_page_limit: 1,
    p_resume_filename_instruction: null, p_cover_letter_filename_instruction: null,
    p_reference_filename_instruction: null, p_reference_timing: "LATER_OR_UNKNOWN", p_reference_count: null,
    p_submission_channel: input.data.submissionChannel, p_portfolio_instruction: null,
    p_work_sample_instruction: null, p_application_questions: [], p_parser_version: "synthetic-board-material-review-v1",
    p_injection_scan_state: "CLEAR", p_hard_block_reason: null, p_checked_at: now.toISOString(),
  });
  if (rule.error || typeof rule.data !== "string") {
    return NextResponse.json({ error: "The employer-instruction review failed its evidence or reviewer guard." }, { status: 409 });
  }
  return NextResponse.json({ jobId: job.id, snapshotId: snapshot.data.id, ruleId: rule.data,
    syntheticStaging: true, reviewedAt: now.toISOString() }, { status: 201, headers: { "cache-control": "no-store" } });
}

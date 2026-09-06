import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { canonicalSha256, semanticComparisonKey } from "@/lib/domain/foundation";
import { assertAuthorizedSource } from "@/lib/matching/retrieval";
import { loadPersistedEvaluationsForSnapshot, persistedFitSummary, selectAndPersistEvaluations } from "@/lib/matching/persisted-runtime";
import { LISTING_PARSER_VERSION, parseListingRequirements, requirementPersistenceRows } from "@/lib/matching/listing-parser";
import { normalizeJob } from "@/lib/jobs/normalize";
import { persistNormalizedJob } from "@/lib/jobs/persistence";
import { stableNormalizedJobId } from "@/lib/matching/deduplication";
import { isSameOriginRequest } from "@/lib/security/origin";

export const dynamic = "force-dynamic";

const getSchema = z.object({ snapshotId: z.string().uuid() });
const postSchema = z.object({
  snapshotId: z.string().uuid(),
  company: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  sourceUrl: z.url().regex(/^https:\/\//u),
  officialApplicationUrl: z.url().regex(/^https:\/\//u),
  externalJobId: z.string().trim().min(1).max(300).nullable(),
  listingText: z.string().trim().min(1).max(100_000),
  postedAt: z.iso.datetime().nullable(),
  checkedAt: z.iso.datetime(),
  manualReview: z.object({
    employerIdentityConfirmed: z.literal(true),
    applicationPathConfirmed: z.literal(true),
    listingActiveConfirmed: z.literal(true),
    legitimacyConfirmed: z.literal(true),
  }),
}).strict();

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const parsed = getSchema.safeParse({ snapshotId: new URL(request.url).searchParams.get("snapshotId") });
  if (!parsed.success) return NextResponse.json({ error: "A valid immutable criteria snapshot is required." }, { status: 400 });
  try {
    const evaluations = await loadPersistedEvaluationsForSnapshot(auth.admin, parsed.data.snapshotId);
    const ranked = (await selectAndPersistEvaluations(auth.admin, evaluations, 500, "ADMIN_PREVIEW", parsed.data.snapshotId)).selected;
    return NextResponse.json({
      snapshotId: parsed.data.snapshotId,
      jobs: ranked.map((evaluation) => ({
        evaluationId: evaluation.id,
        jobSnapshotId: evaluation.job_snapshot_id,
        company: evaluation.job_snapshot.company,
        title: evaluation.job_snapshot.exact_title,
        applicationUrl: evaluation.job_snapshot.canonical_application_url,
        fitSummary: persistedFitSummary(evaluation),
        ranking: { fit: evaluation.fit_score, preference: evaluation.preference_alignment, confidence: evaluation.evidence_confidence, confidenceLabel: evaluation.confidence_label },
      })),
    }, { headers: { "cache-control": "no-store, private" } });
  } catch {
    return NextResponse.json({ error: "Persisted match evaluations could not be loaded." }, { status: 502 });
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "This listing request was rejected." }, { status: 403 });
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A complete manually verified listing is required.", details: parsed.error.flatten() }, { status: 400 });
  const { data: authorization, error: authorizationError } = await auth.admin.from("ap_source_authorizations")
    .select("id,state,evidence_reference").eq("source_id", "manual-reviewed").eq("authorization_version", "source-auth-v1").maybeSingle();
  if (authorizationError || !authorization) return NextResponse.json({ error: "The manual source authorization is unavailable." }, { status: 503 });
  try {
    assertAuthorizedSource({ sourceId: "manual-reviewed", sourceName: "Manual reviewed source", url: parsed.data.sourceUrl, state: authorization.state, evidenceId: authorization.evidence_reference, path: "MANUAL" });
  } catch {
    return NextResponse.json({ error: "The source is not authorized for manual research." }, { status: 409 });
  }
  const jobSnapshotId = randomUUID();
  const parser = parseListingRequirements({ jobSnapshotId, listingText: parsed.data.listingText });
  const normalized = normalizeJob({
    sourceId: "manual-reviewed",
    sourceName: "Manual reviewed source",
    employerName: parsed.data.company,
    externalJobId: parsed.data.externalJobId ?? undefined,
    title: parsed.data.title,
    description: parsed.data.listingText,
    sourceJobUrl: parsed.data.sourceUrl,
    officialApplicationUrl: parsed.data.officialApplicationUrl,
    postedAt: parsed.data.postedAt,
    lastVerifiedAt: parsed.data.checkedAt,
  });
  if (normalized.rejectionReason || !normalized.isActive) return NextResponse.json({ error: "The listing failed source and safety normalization." }, { status: 409 });
  const [{ data: snapshot }, { data: coveragePlan }] = await Promise.all([
    auth.admin.from("ap_intake_snapshots").select("id").eq("id", parsed.data.snapshotId).maybeSingle(),
    auth.admin.from("ap_feasibility_coverage_plans").select("id,inventory_version_id").eq("snapshot_id", parsed.data.snapshotId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!snapshot || !coveragePlan) return NextResponse.json({ error: "The immutable criteria snapshot and coverage inventory must exist before listing ingestion." }, { status: 409 });
  const stableJobId = stableNormalizedJobId(normalized);
  const { data: existingMembers, error: memberQueryError } = await auth.admin.from("ap_inventory_members").select("id,stable_normalized_job_id,job_snapshot:ap_job_snapshots!inner(external_job_id,canonical_application_url,canonical_employer_listing_url,canonical_employer_domain)").eq("inventory_version_id", coveragePlan.inventory_version_id);
  if (memberQueryError) return NextResponse.json({ error: "The current inventory could not be checked for duplicates." }, { status: 502 });
  const duplicate = (existingMembers || []).some((member) => {
    const existing = Array.isArray(member.job_snapshot) ? member.job_snapshot[0] : member.job_snapshot;
    return member.stable_normalized_job_id === stableJobId
      || existing?.canonical_application_url === parsed.data.officialApplicationUrl
      || existing?.canonical_employer_listing_url === parsed.data.sourceUrl
      || (Boolean(parsed.data.externalJobId) && existing?.external_job_id === parsed.data.externalJobId && existing?.canonical_employer_domain === new URL(parsed.data.officialApplicationUrl).hostname.toLocaleLowerCase("en-US"));
  });
  if (duplicate) return NextResponse.json({ error: "The listing duplicates a current inventory member under the requisition-or-canonical-URL rule." }, { status: 409 });
  try {
    const legacyJobId = await persistNormalizedJob(auth.admin, normalized);
    const applicationHost = new URL(parsed.data.officialApplicationUrl).hostname.toLocaleLowerCase("en-US");
    const listingHost = new URL(parsed.data.sourceUrl).hostname.toLocaleLowerCase("en-US");
    const materialSourceQualities = listingHost === applicationHost ? [1] : [0.8, 1];
    const capturedListing = { text: parsed.data.listingText, parserIssues: parser.issues };
    const snapshotRow = {
      id: jobSnapshotId,
      legacy_job_id: legacyJobId,
      origin: "APPLYPACK_FOUND" as const,
      discovery_source: "manual-reviewed",
      external_job_id: parsed.data.externalJobId,
      canonical_application_url: parsed.data.officialApplicationUrl,
      application_host_type: "EMPLOYER_HOSTED",
      canonical_employer_listing_url: parsed.data.sourceUrl,
      source_url: parsed.data.sourceUrl,
      company: parsed.data.company,
      exact_title: parsed.data.title,
      normalized_fingerprint: canonicalSha256({ employer: semanticComparisonKey(parsed.data.company), title: semanticComparisonKey(parsed.data.title), applicationUrl: parsed.data.officialApplicationUrl }),
      captured_listing: capturedListing,
      retrieved_at: parsed.data.checkedAt,
      posted_on: parsed.data.postedAt?.slice(0, 10) ?? null,
      posted_date_unknown: parsed.data.postedAt == null,
      live_verified_at: parsed.data.checkedAt,
      compensation_text: parser.criteria.find((criterion) => criterion.kind === "COMPENSATION")?.semanticKey ?? null,
      compensation_source: parser.criteria.some((criterion) => criterion.kind === "COMPENSATION") ? "EMPLOYER_LISTING" : null,
      location_and_work_mode: { applicationHost },
      parser_version: LISTING_PARSER_VERSION,
      content_sha256: canonicalSha256(capturedListing),
      source_authorization_id: authorization.id,
      first_seen_at: parsed.data.checkedAt,
      canonical_employer_domain: applicationHost,
      employer_identity_result: "PASS",
      application_path_result: "PASS",
      listing_activity_result: "PASS",
      legitimacy_result: "PASS",
      requirement_completeness: parser.status === "COMPLETE" ? 100 : 0,
      compensation_completeness: parser.criteria.some((criterion) => criterion.kind === "COMPENSATION") ? 100 : 0,
      canonicalization_version: "applypack-c14n-v1",
      legacy_compatibility: false,
      material_source_qualities: materialSourceQualities,
    };
    const requirementNodes = requirementPersistenceRows(parser, parsed.data.listingText);
    const { data: memberId, error: memberError } = await auth.admin.rpc("ap_persist_parsed_inventory_job", { p_criteria_snapshot_id: parsed.data.snapshotId, p_inventory_version_id: coveragePlan.inventory_version_id, p_stable_normalized_job_id: stableJobId, p_job_snapshot: snapshotRow, p_requirement_nodes: requirementNodes });
    if (memberError || !memberId) throw memberError || new Error("inventory_member_not_persisted");
    return NextResponse.json({ jobSnapshotId, inventoryMemberId: memberId, legacyJobId, parserStatus: parser.status, issues: parser.issues }, { status: parser.status === "COMPLETE" ? 201 : 202 });
  } catch {
    return NextResponse.json({ error: "The parsed listing snapshot could not be persisted." }, { status: 502 });
  }
}

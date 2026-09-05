import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { bindPacketEvidence } from "@/lib/documents/job-match-packet/evidence";
import { deduplicateJobs } from "@/lib/jobs/deduplicate";
import { normalizeJob } from "@/lib/jobs/normalize";
import { persistNormalizedJob, rankingDatabaseValues } from "@/lib/jobs/persistence";
import { jobPayloadSchema, payloadToRawJob } from "@/lib/jobs/schemas";
import { isSameOriginRequest } from "@/lib/security/origin";

const schema = z.object({
  reviewChecklist: z.object({
    criteriaCompared: z.literal(true),
    allListingsRechecked: z.literal(true),
    exactlyTenApplicationWorthy: z.literal(true),
    noPadding: z.literal(true),
    humanReleaseApproved: z.literal(true),
    reviewerNote: z.string().trim().min(20).max(2000),
  }),
  matches: z.array(jobPayloadSchema).length(10),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "This delivery request was rejected." }, { status: 403 });
  const orderId = (await context.params).id;
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Exactly 10 complete, current matches are required.", details: parsed.error.flatten() }, { status: 400 });
  const { data: order, error: orderError } = await auth.admin.from("orders").select("id,customer_id,intake_id,product_kind,status").eq("id", orderId).maybeSingle();
  if (orderError) return NextResponse.json({ error: "The search order could not be loaded." }, { status: 502 });
  if (!order || order.product_kind !== "job_search" || !["paid", "in_fulfillment"].includes(order.status)) {
    return NextResponse.json({ error: "Search order is not deliverable." }, { status: 409 });
  }
  const freshnessMs = Number(process.env.APP_JOB_FRESHNESS_HOURS || 24) * 60 * 60 * 1000;
  if (parsed.data.matches.some((match) => Date.now() - new Date(match.checkedAt).getTime() > freshnessMs)) {
    return NextResponse.json({ error: "Every listing must be rechecked within the configured freshness window." }, { status: 409 });
  }
  const normalized = parsed.data.matches.map((match) => normalizeJob(payloadToRawJob(match)));
  const excluded = normalized.find((job) => job.rejectionReason);
  if (excluded) return NextResponse.json({ error: "An excluded or held employer/source cannot be saved.", reason: excluded.rejectionReason }, { status: 400 });
  const deduplicated = deduplicateJobs(normalized);
  if (deduplicated.length !== 10) {
    return NextResponse.json({ error: "The 10 delivered matches must be distinct after canonical employer and cross-source deduplication." }, { status: 409 });
  }
  const { data: claimed, error: claimError } = await auth.admin.rpc("claim_order_delivery", {
    p_order_id: orderId,
    p_kind: "job_search",
  });
  if (claimError || !claimed) {
    return NextResponse.json({ error: "The order is already being delivered, refunded, or is no longer eligible." }, { status: 409 });
  }
  const releaseClaim = () => auth.admin.rpc("release_order_delivery", { p_order_id: orderId });
  const { count, error: countError } = await auth.admin.from("job_matches").select("id", { count: "exact", head: true }).eq("search_order_id", orderId);
  if (countError) {
    await releaseClaim();
    return NextResponse.json({ error: "Existing delivery state could not be verified." }, { status: 502 });
  }
  if (count) {
    await releaseClaim();
    return NextResponse.json({ error: "Matches already exist for this order." }, { status: 409 });
  }
  const jobIds: string[] = [];
  try {
    for (let index = 0; index < normalized.length; index += 1) {
      jobIds.push(await persistNormalizedJob(auth.admin, normalized[index], parsed.data.matches[index].salary || null));
    }
  } catch {
    await releaseClaim();
    return NextResponse.json({ error: "Jobs could not be normalized and saved." }, { status: 502 });
  }
  if (new Set(jobIds).size !== 10) {
    await releaseClaim();
    return NextResponse.json({ error: "Duplicate jobs cannot occupy more than one delivered position." }, { status: 409 });
  }
  const jobMatchIds = parsed.data.matches.map(() => randomUUID());
  const rows = parsed.data.matches.map((match, index) => ({
    job_match_id: jobMatchIds[index],
    job_id: jobIds[index],
    position: index + 1,
    fit_summary: match.fitSummary,
    matching_experience: match.matchingExperience,
    primary_outcome: match.primaryOutcome,
    core_responsibilities: match.coreResponsibilities,
    requirements: match.requirements,
    hidden_job_functions: match.hiddenJobFunctions,
    concerns: match.concerns,
    match_category: match.matchCategory,
    packet_strong_connections: bindPacketEvidence(jobMatchIds[index], jobIds[index], "strong", match.packetStrongConnections),
    packet_things_to_consider: bindPacketEvidence(jobMatchIds[index], jobIds[index], "consideration", match.packetThingsToConsider),
    packet_unknown_warnings: bindPacketEvidence(jobMatchIds[index], jobIds[index], "unknown", match.packetUnknownWarnings),
    criteria_checks: match.criteriaChecks,
    ...rankingDatabaseValues(normalized[index]),
  }));
  const deliveredAt = new Date();
  const retentionDays = Math.max(1, Number(process.env.APP_SOURCE_DOCUMENT_RETENTION_DAYS || 30));
  const { data: completed, error: completeError } = await auth.admin.rpc("stage_search_delivery", {
    p_order_id: orderId,
    p_actor_id: auth.user.id,
    p_matches: rows,
    p_review_checklist: parsed.data.reviewChecklist,
    p_delivered_at: deliveredAt.toISOString(),
    p_retention_due_at: new Date(deliveredAt.getTime() + retentionDays * 24 * 60 * 60 * 1000).toISOString(),
  });
  if (completeError || !completed) {
    await releaseClaim();
    return NextResponse.json({ error: "The reviewed matches could not be committed atomically." }, { status: 502 });
  }
  return NextResponse.json({ ok: true, packetApprovalRequired: true });
}

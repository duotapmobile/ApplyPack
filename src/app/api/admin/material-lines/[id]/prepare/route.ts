import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { prepareMaterialDraft } from "@/lib/documents/draft-preparation";
import type { EvidenceBoundMaterialInput } from "@/lib/documents/generate";
import { isSameOriginRequest } from "@/lib/security/origin";

const headers = { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" };
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return response({ error: "This staff request was rejected." }, 403);
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const id = z.uuid().safeParse((await context.params).id);
  if (!id.success) return response({ error: "Material line not found." }, 404);
  const { data: line, error: lineError } = await auth.admin.from("ap_material_lines")
    .select("id,purchase_id,active_revision,fulfillment,materials_due_at").eq("id", id.data).maybeSingle();
  if (lineError) return response({ error: "Material evidence is temporarily unavailable." }, 503);
  if (!line) return response({ error: "Material line not found." }, 404);
  if (!["PAID", "GENERATING", "HUMAN_REVIEW"].includes(line.fulfillment)
    || !line.materials_due_at || Date.parse(line.materials_due_at) <= Date.now()) {
    return response({ error: "The active paid material line is not available for draft preparation." }, 409);
  }
  const [purchase, revision] = await Promise.all([
    auth.admin.from("ap_material_purchases").select("customer_id,checkout_intent_id").eq("id", line.purchase_id).maybeSingle(),
    auth.admin.from("ap_material_line_revisions").select("id,source_snapshot_id,job_snapshot_id")
      .eq("line_id", line.id).eq("version", line.active_revision).is("superseded_at", null).maybeSingle(),
  ]);
  if (purchase.error || revision.error) return response({ error: "Material evidence is temporarily unavailable." }, 503);
  if (!purchase.data?.checkout_intent_id || !revision.data?.source_snapshot_id || !revision.data.job_snapshot_id) {
    return response({ error: "The current material evidence binding is incomplete." }, 409);
  }
  const customerId = purchase.data.customer_id;
  const snapshotId = revision.data.source_snapshot_id;
  const jobId = revision.data.job_snapshot_id;
  const [facts, nodes, reviews, job, successor, intent] = await Promise.all([
    auth.admin.from("ap_candidate_facts").select("id,typed_value,capability_status").eq("customer_id", customerId)
      .eq("snapshot_id", snapshotId).in("verification", ["CUSTOMER_CONFIRMED", "HUMAN_VERIFIED"]).is("superseded_at", null).limit(501),
    auth.admin.from("ap_requirement_nodes").select("id,stable_criterion_id,source_excerpt").eq("job_snapshot_id", jobId).eq("node_kind", "CRITERION").order("position").limit(201),
    auth.admin.from("ap_human_review_records").select("decision").eq("customer_id", customerId)
      .eq("snapshot_id", snapshotId).eq("job_snapshot_id", jobId).eq("review_kind", "MATCH_EVIDENCE").is("invalidated_at", null).limit(201),
    auth.admin.from("ap_job_snapshots").select("company,exact_title,content_sha256").eq("id", jobId).maybeSingle(),
    auth.admin.from("ap_job_snapshots").select("id").eq("supersedes_job_snapshot_id", jobId).limit(1),
    auth.admin.from("ap_material_checkout_intents").select("career_break_choice").eq("id", purchase.data.checkout_intent_id).eq("customer_id", customerId).maybeSingle(),
  ]);
  if ([facts, nodes, reviews, job, successor, intent].some((result) => result.error)) {
    return response({ error: "Verified drafting evidence is temporarily unavailable." }, 503);
  }
  if (!job.data || !intent.data || successor.data?.length || (facts.data?.length || 0) > 500
    || (nodes.data?.length || 0) > 200 || (reviews.data?.length || 0) > 200) {
    return response({ error: "The evidence binding is stale or exceeds the reviewed draft bounds." }, 409);
  }
  try {
    const draft = prepareMaterialDraft({ facts: facts.data || [], requirements: nodes.data || [], reviews: reviews.data || [],
      job: { employer: job.data.company, exactTitle: job.data.exact_title, postingContentSha256: job.data.content_sha256,
        jobEvidenceIds: (nodes.data || []).map((node) => node.id) },
      careerBreakChoice: intent.data.career_break_choice as EvidenceBoundMaterialInput["careerBreak"]["choice"],
    });
    return response({ draft, revisionId: revision.data.id, status: "DRAFT_FOR_HUMAN_REVIEW" });
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Verified evidence needs review before drafting." }, 409);
  }
}

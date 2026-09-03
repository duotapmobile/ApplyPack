import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendTransactionalEmail } from "@/lib/email/send";
import { generateApplyPackDrafts } from "@/lib/documents/generate";
import { scanBuffer } from "@/lib/files/scanner";
import { validateDocumentBytes } from "@/lib/files/document-safety";
import { docxMimeType } from "@/lib/files/signatures";
import { createSourceAdapter } from "@/lib/jobs/adapters";
import { deduplicateJobs } from "@/lib/jobs/deduplicate";
import { filterJobs } from "@/lib/jobs/filter";
import { normalizeJob } from "@/lib/jobs/normalize";
import { fromJobDatabaseRow, persistNormalizedJob } from "@/lib/jobs/persistence";
import { rankJobs } from "@/lib/jobs/rank";
import { jobSources } from "@/lib/jobs/source-registry";
import type { RankedJob } from "@/lib/jobs/types";
import { workflowErrorCode } from "@/lib/workflow/errors";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
type WorkflowTask = {
  id: string;
  task_kind: "search_discovery" | "document_draft";
  reference_id: string;
  order_id: string;
  attempt_count: number;
};


export async function processWorkflowTasks(admin: AdminClient, limit = 2) {
  const { data, error } = await admin.rpc("claim_workflow_tasks", { p_limit: limit });
  if (error) throw error;
  const tasks = (data || []) as WorkflowTask[];
  const results: Array<{ id: string; status: string; count?: number }> = [];
  for (const task of tasks) {
    try {
      results.push(task.task_kind === "search_discovery"
        ? await processSearchDiscovery(admin, task)
        : await processDocumentDraft(admin, task));
    } catch (error) {
      const retryMinutes = Math.min(60, 2 ** Math.max(0, task.attempt_count - 1));
      await admin.from("workflow_tasks").update({
        status: "failed",
        last_error_code: workflowErrorCode(error),
        locked_at: null,
        not_before: new Date(Date.now() + retryMinutes * 60_000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", task.id).eq("status", "processing");
      results.push({ id: task.id, status: "failed" });
    }
  }
  return results;
}

async function processSearchDiscovery(admin: AdminClient, task: WorkflowTask) {
  await admin.from("orders").update({ status: "in_fulfillment", updated_at: new Date().toISOString() })
    .eq("id", task.order_id).eq("status", "paid");

  let fetched = 0;
  if (process.env.APP_JOB_SOURCE_SYNC_ENABLED === "true") {
    for (const source of jobSources.filter((item) => item.automationStatus === "automated" && item.isActive)) {
      try {
        const raw = await createSourceAdapter(source.id).fetchJobs();
        fetched += raw.length;
        const normalized = raw.map((job) => normalizeJob(job)).filter((job) => !job.rejectionReason && job.isActive);
        for (const candidate of deduplicateJobs(normalized)) await persistNormalizedJob(admin, candidate.job);
      } catch {
        await admin.from("job_source_runs").insert({
          source_id: source.id,
          status: "failed",
          completed_at: new Date().toISOString(),
          error_code: "workflow_source_sync_failed",
        });
      }
    }
  }

  const state = await stateForOrder(admin, task.order_id);
  const { data: rows, error: jobsError } = await admin.from("jobs")
    .select("*").eq("is_active", true).neq("review_status", "rejected").limit(500);
  if (jobsError) throw jobsError;
  const idByJob = new WeakMap<object, string>();
  const normalizedJobs = (rows || []).map((row) => {
    const job = fromJobDatabaseRow(row as Record<string, unknown>);
    idByJob.set(job, String(row.id));
    return job;
  });
  const ranked = rankJobs(filterJobs(normalizedJobs, {
    workerRelationship: "w2",
    includeSales: false,
    includeMarketing: false,
    includeApplicantCost: false,
    includeStale: false,
    state: state || undefined,
  }), { state: state || undefined }).slice(0, 30);

  await admin.from("search_candidates").delete().eq("search_order_id", task.order_id).eq("review_status", "proposed");
  if (ranked.length) {
    const { error: candidateError } = await admin.from("search_candidates").upsert(
      ranked.map((candidate) => candidateRow(task.order_id, idByJob.get(candidate.job)!, candidate)),
      { onConflict: "search_order_id,job_id" },
    );
    if (candidateError) throw candidateError;
  }

  await admin.from("workflow_tasks").update({
    status: "awaiting_review",
    locked_at: null,
    last_error_code: ranked.length < 10 ? "fewer_than_ten_candidates" : null,
    summary: { fetched, candidates: ranked.length, state: state || null },
    updated_at: new Date().toISOString(),
  }).eq("id", task.id).eq("status", "processing");
  await notifyAdmin(admin, task.order_id, "search_qa_ready", "ApplyPack search candidates need review", [
    `Automated discovery collected ${ranked.length} reviewable candidate${ranked.length === 1 ? "" : "s"}.`,
    ranked.length < 10 ? "Add verified manual candidates until the reviewed delivery contains exactly 10 jobs." : "Review every listing and approve exactly 10 before customer release.",
  ]);
  return { id: task.id, status: "awaiting_review", count: ranked.length };
}

async function processDocumentDraft(admin: AdminClient, task: WorkflowTask) {
  await admin.from("orders").update({ status: "in_fulfillment", updated_at: new Date().toISOString() })
    .eq("id", task.order_id).eq("status", "paid");
  const { data: item, error: itemError } = await admin.from("apply_pack_items")
    .select("id,order_id,job_match_id,emphasis_notes,do_not_mention_notes,customer_update_notes")
    .eq("id", task.reference_id).maybeSingle();
  if (itemError || !item) throw itemError || new Error("apply_pack_item_missing");
  const { data: order } = await admin.from("orders").select("customer_id,parent_order_id").eq("id", item.order_id).maybeSingle();
  if (!order?.customer_id || !order.parent_order_id) throw new Error("apply_pack_order_link_missing");
  const { data: searchOrder } = await admin.from("orders").select("intake_id").eq("id", order.parent_order_id).maybeSingle();
  if (!searchOrder?.intake_id) throw new Error("search_intake_link_missing");
  const [{ data: intake }, { data: profile }, { data: match }] = await Promise.all([
    admin.from("intakes").select("email,direction,location_preference,experience_summary,intake_answers(answers)").eq("id", searchOrder.intake_id).maybeSingle(),
    admin.from("profiles").select("display_name").eq("id", order.customer_id).maybeSingle(),
    admin.from("job_matches").select("job:jobs(company,title,employer_display_name,raw_title)").eq("id", item.job_match_id).maybeSingle(),
  ]);
  const answerRow = Array.isArray(intake?.intake_answers) ? intake.intake_answers[0] : intake?.intake_answers;
  const answers = answerRow?.answers && typeof answerRow.answers === "object" ? answerRow.answers as Record<string, unknown> : {};
  const job = Array.isArray(match?.job) ? match.job[0] : match?.job;
  if (!intake || !profile?.display_name || !job) throw new Error("document_source_data_missing");
  const drafts = await generateApplyPackDrafts({
    fullName: profile.display_name,
    email: intake.email,
    location: intake.location_preference,
    jobTitle: job.raw_title || job.title,
    employer: job.employer_display_name || job.company,
    direction: intake.direction,
    backgroundDetails: String(answers.backgroundDetails || intake.experience_summary || ""),
    backgroundTypes: Array.isArray(answers.backgroundTypes) ? answers.backgroundTypes.map(String) : [],
    tools: String(answers.tools || ""),
    credentials: String(answers.credentials || ""),
    emphasisNotes: item.emphasis_notes || "",
  });
  const resumeSafety = validateDocumentBytes(drafts.resume, docxMimeType);
  const coverSafety = validateDocumentBytes(drafts.coverLetter, docxMimeType);
  if (!resumeSafety.safe || !coverSafety.safe) throw new Error("generated_draft_structure_invalid");
  const [resumeScan, coverScan] = await Promise.all([
    scanBuffer(drafts.resume, { structureValidated: true }),
    scanBuffer(drafts.coverLetter, { structureValidated: true }),
  ]);
  if (resumeScan.status !== "clean" || coverScan.status !== "clean") throw new Error("generated_draft_scan_failed");
  const base = order.customer_id + "/orders/" + item.order_id + "/items/" + item.id + "/drafts";
  const resumePath = base + "/resume.docx";
  const coverPath = base + "/cover-letter.docx";
  const first = await admin.storage.from("operator-drafts").upload(resumePath, drafts.resume, { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", upsert: true });
  if (first.error) throw first.error;
  const second = await admin.storage.from("operator-drafts").upload(coverPath, drafts.coverLetter, { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", upsert: true });
  if (second.error) {
    await admin.storage.from("operator-drafts").remove([resumePath]);
    throw second.error;
  }
  const generatedAt = new Date().toISOString();
  const { error: updateError } = await admin.from("apply_pack_items").update({ status: "draft_ready", draft_resume_path: resumePath, draft_cover_letter_path: coverPath, draft_generated_at: generatedAt, draft_generator_version: drafts.generatorVersion }).eq("id", item.id);
  if (updateError) throw updateError;
  await admin.from("workflow_tasks").update({ status: "awaiting_review", locked_at: null, last_error_code: null, summary: { generator: drafts.generatorVersion, generated_at: generatedAt }, updated_at: generatedAt }).eq("id", task.id).eq("status", "processing");
  await notifyAdmin(admin, task.order_id, "document_qa_ready", "ApplyPack document drafts need review", ["Private first-party drafts are ready for factual and job-specific review.", "Download both drafts, edit as needed, and use the reviewed delivery upload before anything reaches the customer."]);
  return { id: task.id, status: "awaiting_review" };
}

function candidateRow(orderId: string, jobId: string, candidate: RankedJob) {
  return {
    search_order_id: orderId,
    job_id: jobId,
    ranking_score: candidate.score,
    ranking_reason_codes: candidate.reasonCodes,
    fit_summary: candidateFitSummary(candidate),
    requirements: [],
    concerns: candidate.reasonCodes.filter((reason) => reason.points < 0).map((reason) => reason.explanation),
  };
}

export function candidateFitSummary(candidate: RankedJob): string {
  const positives = candidate.reasonCodes.filter((reason) => reason.points > 0).slice(0, 3).map((reason) => reason.explanation);
  return positives.length
    ? positives.join(" ")
    : "This posting requires operator review against the customer's approved search criteria before delivery.";
}

async function stateForOrder(admin: AdminClient, orderId: string): Promise<string | null> {
  const { data } = await admin.from("orders").select("intake:intakes(intake_answers(answers))").eq("id", orderId).maybeSingle();
  const intake = Array.isArray(data?.intake) ? data.intake[0] : data?.intake;
  const answerRow = Array.isArray(intake?.intake_answers) ? intake.intake_answers[0] : intake?.intake_answers;
  const value = answerRow?.answers && typeof answerRow.answers === "object" && "state" in answerRow.answers
    ? String(answerRow.answers.state || "").toUpperCase()
    : "";
  return /^[A-Z]{2}$/.test(value) ? value : null;
}

async function notifyAdmin(admin: AdminClient, orderId: string, template: string, subject: string, lines: string[]) {
  const recipient = process.env.APP_ADMIN_ALERT_EMAIL;
  if (!recipient) return;
  const idempotencyKey = `${template}/${orderId}`;
  const { data: existing } = await admin.from("email_events").select("status").eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existing && ["sent", "skipped"].includes(existing.status)) return;
  try {
    const sent = await sendTransactionalEmail({
      to: recipient,
      subject,
      lines,
      idempotencyKey,
      actionUrl: `${process.env.NEXT_PUBLIC_APP_URL || "https://applypack.work"}/admin#order-${orderId}`,
      actionLabel: "Open the operator review queue",
    });
    await admin.from("email_events").upsert({
      order_id: orderId,
      recipient,
      template,
      status: sent.skipped ? "skipped" : "sent",
      provider_message_id: sent.providerMessageId || null,
      idempotency_key: idempotencyKey,
    }, { onConflict: "idempotency_key" });
  } catch {
    await admin.from("email_events").upsert({ order_id: orderId, recipient, template, status: "failed", idempotency_key: idempotencyKey }, { onConflict: "idempotency_key" });
  }
}

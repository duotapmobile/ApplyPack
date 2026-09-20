import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { sendTransactionalEmail } from "@/lib/email/send";
import { loadPersistedEvaluationsForOrder, searchCandidateRow, selectAndPersistEvaluations } from "@/lib/matching/persisted-runtime";
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
  const orderUpdate = await admin.from("orders").update({ status: "in_fulfillment", updated_at: new Date().toISOString() })
    .eq("id", task.order_id).eq("status", "paid");
  if (orderUpdate.error) throw orderUpdate.error;

  const evaluations = await loadPersistedEvaluationsForOrder(admin, task.order_id);
  const ranked = (await selectAndPersistEvaluations(admin, evaluations, 30, "SEARCH_WORKFLOW", task.order_id)).selected;

  const cleared = await admin.from("search_candidates").delete().eq("search_order_id", task.order_id).eq("review_status", "proposed");
  if (cleared.error) throw cleared.error;
  if (ranked.length) {
    const { error: candidateError } = await admin.from("search_candidates").upsert(
      ranked.map((evaluation) => searchCandidateRow(task.order_id, evaluation)),
      // A concurrent human approval/rejection must survive worker replay.
      { onConflict: "search_order_id,job_id", ignoreDuplicates: true },
    );
    if (candidateError) throw candidateError;
  }

  const reviewUpdate = await admin.from("workflow_tasks").update({
    status: "awaiting_review",
    locked_at: null,
    last_error_code: ranked.length < 10 ? "fewer_than_ten_candidates" : null,
    summary: {
      candidates: ranked.length,
      evaluationSource: "PERSISTED_MATCH_EVALUATIONS",
      sourceCollection: "INDEPENDENT_SCHEDULED_ROTATION",
      researchEscalationRequired: ranked.length < 10,
      remainingCandidateMinimum: Math.max(0, 10 - ranked.length),
      deliveryRequiresHumanApprovedCount: 10,
    },
    updated_at: new Date().toISOString(),
  }).eq("id", task.id).eq("status", "processing");
  if (reviewUpdate.error) throw reviewUpdate.error;
  await notifyAdmin(admin, task.order_id, "search_qa_ready", "ApplyPack search candidates need review", [
    `Automated discovery collected ${ranked.length} reviewable candidate${ranked.length === 1 ? "" : "s"}.`,
    ranked.length < 10 ? "Add verified manual candidates until the reviewed delivery contains exactly 10 jobs." : "Review every listing and approve exactly 10 before customer release.",
  ]);
  return { id: task.id, status: "awaiting_review", count: ranked.length };
}

async function processDocumentDraft(admin: AdminClient, task: WorkflowTask) {
  // Legacy orders lack immutable candidate/job bindings. Do not fabricate them
  // from free-text intake or stamp weaker output with the current policy version.
  const result = await admin.from("workflow_tasks").update({
    status: "awaiting_review",
    locked_at: null,
    last_error_code: "evidence_bound_material_line_required",
    summary: { action: "MIGRATE_TO_MATERIAL_LINE", generation: "BLOCKED_MISSING_EVIDENCE_BINDING" },
    updated_at: new Date().toISOString(),
  }).eq("id", task.id).eq("status", "processing");
  if (result.error) throw result.error;
  await notifyAdmin(admin, task.order_id, "document_evidence_required", "ApplyPack document evidence needs review", [
    "This legacy order requires a current candidate snapshot, verified job snapshot and materials line before generation.",
    "Use the evidence-bound materials workflow; existing customer files and order history are preserved.",
  ]);
  return { id: task.id, status: "awaiting_review" };
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

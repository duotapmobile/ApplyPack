import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sendTransactionalEmail } from "@/lib/email/send";
import { retryFailedEmails } from "@/lib/email/retry";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { processWorkflowTasks } from "@/lib/workflow/process";
import { processPendingFileScans } from "@/lib/files/process-scans";
import { fileScanConfiguration } from "@/lib/files/scanner";
import { processPendingDocumentExtractions } from "@/lib/files/isolated-extraction";
import { processUnpaidSourceRetention } from "@/lib/files/unpaid-retention";
import { processPendingFeasibilityRequests } from "@/lib/matching/supabase-feasibility-store";
import { processChunk4Workers } from "@/lib/commerce/workers";
import { reconcileBoardSubscriptions } from "@/lib/job-board/stripe-events";
import { processBoardRecomputeJobs } from "@/lib/job-board/recompute";
import { createStripeOperationalClient } from "@/lib/stripe/server";
import { collectOperationsSummary } from "@/lib/operations/summary";
import {
  recordMaintenanceDiagnosis,
  recordMaintenanceFailure,
  recordMaintenanceOutcome,
  type DiagnosticCode,
  type MaintenanceActionCode,
  type MaintenanceActionEvidence,
} from "@/lib/operations/maintenance-observability";

export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!secret || !provided) return false;
  const expectedBytes = Buffer.from(secret);
  const providedBytes = Buffer.from(provided);
  return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes);
}

export async function POST(request: Request) {
  const response = (body: Record<string, unknown>, status: number) => NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
  if (!authorized(request)) return response({ error: "Unauthorized." }, 401);
  const admin = createSupabaseAdminClient();
  if (!admin) return response({ error: "Database is not configured." }, 503);
  const now = new Date();
  const actions: MaintenanceActionEvidence[] = [];
  const beforeSummary = await collectOperationsSummary(admin).catch(() => null);
  if (!beforeSummary) {
    await recordMaintenanceFailure(admin, null, "MAINTENANCE_DIAGNOSIS_FAILED", actions, now).catch(() => null);
    return response({ error: "Maintenance diagnosis unavailable.", code: "MAINTENANCE_DIAGNOSIS_FAILED" }, 503);
  }
  let beforeDiagnostic;
  try {
    beforeDiagnostic = await recordMaintenanceDiagnosis(admin, beforeSummary, now);
  } catch {
    return response({ error: "Maintenance diagnosis evidence unavailable.", code: "MAINTENANCE_DIAGNOSIS_FAILED" }, 503);
  }
  const globalStops = beforeDiagnostic.failClosedCodes.filter((code) => ["DATABASE_NOT_READY", "CRITICAL_SECURITY_OR_INTEGRITY_ALERT_OPEN"].includes(code));
  if (globalStops.length) {
    return response({
      error: "Maintenance stopped by a fail-closed condition.",
      codes: globalStops,
    }, 503);
  }
  const fail = async (
    code: DiagnosticCode,
    actionCode: MaintenanceActionCode | null,
    message: string,
  ) => {
    if (actionCode) actions.push({ code: actionCode, status: "FAILED" });
    await recordMaintenanceFailure(admin, beforeSummary, code, actions, now).catch(() => null);
    return response({ error: message, code }, 503);
  };
  const staleDraftClaims = await admin.from("apply_pack_items").update({ status: "draft_ready", delivery_claimed_at: null })
    .eq("status", "delivery_processing").not("draft_resume_path", "is", null)
    .lt("delivery_claimed_at", new Date(now.getTime() - 15 * 60_000).toISOString());
  const staleQueueClaims = await admin.from("apply_pack_items").update({ status: "queued", delivery_claimed_at: null })
    .eq("status", "delivery_processing").is("draft_resume_path", null)
    .lt("delivery_claimed_at", new Date(now.getTime() - 15 * 60_000).toISOString());
  if (staleDraftClaims.error || staleQueueClaims.error) {
    return fail("EXPIRED_LEASE_RECOVERY_FAILED", "EXPIRED_LEASE_RECOVERY", "Delivery-claim recovery failed.");
  }
  const nowIso = now.toISOString();
  const { data: staleOrderClaims, error: staleOrderError } = await admin.from("orders")
    .select("id").eq("status", "delivery_processing")
    .lt("processing_started_at", new Date(now.getTime() - 15 * 60_000).toISOString());
  if (staleOrderError) return fail("EXPIRED_LEASE_RECOVERY_FAILED", "EXPIRED_LEASE_RECOVERY", "Order-claim recovery failed.");
  for (const order of staleOrderClaims || []) {
    const released = await admin.rpc("release_order_delivery", { p_order_id: order.id });
    if (released.error) return fail("EXPIRED_LEASE_RECOVERY_FAILED", "EXPIRED_LEASE_RECOVERY", "Order-claim recovery failed.");
  }
  actions.push({ code: "EXPIRED_LEASE_RECOVERY", status: "SUCCEEDED" });

  const { error: rateLimitCleanupError, count: removedRateLimits } = await admin
    .from("api_rate_limits")
    .delete({ count: "exact" })
    .lt("window_started_at", new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString());
  if (rateLimitCleanupError) {
    return fail("EXPIRATION_CLEANUP_FAILED", "EXPIRATION_CLEANUP", "Rate-limit retention maintenance failed.");
  }

  const [reservationResult, cartResult] = await Promise.all([
    admin.from("capacity_reservations").update({ status: "expired" }).eq("status", "reserved").lt("expires_at", nowIso).select("id"),
    admin.from("apply_pack_carts").update({ status: "expired" }).eq("status", "checkout_pending")
      .lt("expires_at", new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()).select("id"),
  ]);
  if (reservationResult.error || cartResult.error) {
    return fail("EXPIRATION_CLEANUP_FAILED", "EXPIRATION_CLEANUP", "Expiration maintenance failed.");
  }
  const staleHours = Math.max(24, Math.min(720, Number(process.env.APP_JOB_STALE_AFTER_HOURS || 72)));
  const { data: staleJobs, error: staleError } = await admin.rpc("mark_stale_jobs_inactive", { p_stale_hours: staleHours });
  if (staleError) return fail("EXPIRATION_CLEANUP_FAILED", "EXPIRATION_CLEANUP", "Job freshness maintenance failed.");

  const { data: dueIntakes, error: retentionQueryError } = await admin.from("intakes")
    .select("id")
    .is("source_deleted_at", null)
    .lte("source_retention_due_at", nowIso)
    .limit(100);
  if (retentionQueryError) return fail("EXPIRATION_CLEANUP_FAILED", "EXPIRATION_CLEANUP", "Retention maintenance failed.");
  let deletedSources = 0;
  let expirationCleanupFailed = false;
  for (const intake of dueIntakes || []) {
    const { data: documents, error: documentQueryError } = await admin.from("source_documents")
      .select("id,storage_path").eq("intake_id", intake.id).is("deleted_at", null);
    if (documentQueryError) {
      expirationCleanupFailed = true;
      continue;
    }
    const paths = (documents || []).map((document) => document.storage_path);
    if (paths.length) {
      const { error } = await admin.storage.from("customer-source-documents").remove(paths);
      if (error) {
        expirationCleanupFailed = true;
        continue;
      }
    }
    const finalized = await admin.rpc("finalize_intake_source_retention", {
      p_intake_id: intake.id,
      p_document_count: paths.length,
      p_deleted_at: nowIso,
    });
    if (finalized.error || !finalized.data) {
      expirationCleanupFailed = true;
      continue;
    }
    deletedSources += 1;
  }

  const { data: expiredDrafts, error: draftQueryError } = await admin.from("intake_drafts")
    .select("id,resume_document,cover_letter_document").lt("expires_at", nowIso).limit(100);
  if (draftQueryError) return fail("EXPIRATION_CLEANUP_FAILED", "EXPIRATION_CLEANUP", "Draft retention maintenance failed.");
  let deletedDrafts = 0;
  for (const draft of expiredDrafts || []) {
    const documents = [draft.resume_document, draft.cover_letter_document] as Array<{ path?: string } | null>;
    const paths = documents.map((document) => document?.path).filter((path): path is string => Boolean(path));
    if (paths.length) {
      const removal = await admin.storage.from("customer-source-documents").remove(paths);
      if (removal.error) {
        expirationCleanupFailed = true;
        continue;
      }
    }
    const deletion = await admin.from("intake_drafts").delete().eq("id", draft.id);
    if (!deletion.error) deletedDrafts += 1;
    else expirationCleanupFailed = true;
  }

  const { data: cleanupRows, error: cleanupQueryError } = await admin.from("storage_cleanup_queue")
    .select("id,bucket,storage_path,attempts").lt("attempts", 20).order("created_at").limit(50);
  if (cleanupQueryError) return fail("EXPIRATION_CLEANUP_FAILED", "EXPIRATION_CLEANUP", "Storage cleanup queue could not be loaded.");
  let recoveredStorageObjects = 0;
  for (const row of cleanupRows || []) {
    const removal = await admin.storage.from(row.bucket).remove([row.storage_path]);
    if (!removal.error) {
      const deletion = await admin.from("storage_cleanup_queue").delete().eq("id", row.id);
      if (!deletion.error) recoveredStorageObjects += 1;
    } else {
      expirationCleanupFailed = true;
      await admin.from("storage_cleanup_queue").update({
        attempts: Number(row.attempts || 0) + 1,
        last_error: "storage_remove_failed",
        last_attempt_at: nowIso,
      }).eq("id", row.id);
    }
  }
  if (expirationCleanupFailed) {
    return fail("EXPIRATION_CLEANUP_FAILED", "EXPIRATION_CLEANUP", "Expiration cleanup was incomplete.");
  }
  actions.push({ code: "EXPIRATION_CLEANUP", status: "SUCCEEDED" });

  const alertEmail = process.env.APP_ADMIN_ALERT_EMAIL;
  let alerts = 0;
  if (alertEmail && !beforeDiagnostic.codes.includes("EMAIL_NOT_READY")) {
    const warningCutoff = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
    const { data: dueOrders, error: dueOrdersError } = await admin.from("orders")
      .select("id,product_kind,delivery_deadline,status")
      .in("status", ["paid", "in_fulfillment"])
      .lte("delivery_deadline", warningCutoff)
      .order("delivery_deadline")
      .limit(100);
    if (dueOrdersError) {
      return fail("BOUNDED_QUEUE_PROCESSING_FAILED", "BOUNDED_QUEUE_PROCESSING", "Deadline queue processing failed.");
    }
    for (const order of dueOrders || []) {
      if (!order.delivery_deadline) continue;
      const missed = new Date(order.delivery_deadline).getTime() < now.getTime();
      const template = missed ? "admin_deadline_missed" : "admin_deadline_warning";
      const key = template + "/" + order.id;
      const { data: existing } = await admin.from("email_events").select("status").eq("idempotency_key", key).maybeSingle();
      if (existing && ["sent", "skipped"].includes(existing.status)) continue;
      try {
        const sent = await sendTransactionalEmail({
          to: alertEmail,
          subject: missed ? "ApplyPack deadline missed" : "ApplyPack deadline approaching",
          lines: [
            "Order: " + order.id,
            "Product: " + order.product_kind,
            "Status: " + order.status,
            "Deadline: " + order.delivery_deadline,
          ],
          idempotencyKey: key,
        });
        await admin.from("email_events").upsert({
          order_id: order.id, recipient: alertEmail, template,
          status: sent.skipped ? "skipped" : "sent",
          provider_message_id: sent.providerMessageId || null,
          idempotency_key: key,
        }, { onConflict: "idempotency_key" });
        alerts += 1;
      } catch {
        await admin.from("email_events").upsert({
          order_id: order.id, recipient: alertEmail, template, status: "failed", idempotency_key: key,
        }, { onConflict: "idempotency_key" });
      }
    }
  }
  const blocked = new Set<DiagnosticCode>(beforeDiagnostic.codes);
  // A purchasing hold does not prevent cleanup, isolated parsing, or reconciliation
  // of obligations already paid. Each processor still enforces its own authorization.
  const fileReady = !blocked.has("FILE_SAFETY_NOT_READY");
  const encryptionReady = !blocked.has("ENCRYPTION_NOT_READY");
  const sourcesReady = !blocked.has("SOURCE_PERMISSION_COVERAGE_MISSING");
  const emailReady = !blocked.has("EMAIL_NOT_READY");
  let documentExtractions;
  if (fileReady) {
    try {
      documentExtractions = await processPendingDocumentExtractions(admin, 2);
      actions.push({ code: "DOCUMENT_PROCESSING", status: documentExtractions.succeeded === documentExtractions.processed ? "SUCCEEDED" : "FAILED" });
    } catch { actions.push({ code: "DOCUMENT_PROCESSING", status: "FAILED" }); }
  } else actions.push({ code: "DOCUMENT_PROCESSING", status: "SKIPPED" });

  let fileScans;
  const queueStages: Record<string, "SUCCEEDED" | "FAILED" | "SKIPPED"> = {};
  async function processQueue<T>(name: string, enabled: boolean, processor: () => Promise<T>): Promise<T | undefined> {
    if (!enabled) { queueStages[name] = "SKIPPED"; return; }
    try { const result = await processor(); queueStages[name] = "SUCCEEDED"; return result; }
    catch { queueStages[name] = "FAILED"; }
  }
  if (fileScanConfiguration().mode === "clamav") {
    fileScans = await processQueue("malware", fileReady, () => processPendingFileScans(admin, 5));
    if (fileScans && fileScans.errors > 0) queueStages.malware = "FAILED";
  } else fileScans = { status: "DEFERRED_V2", malwareVerdict: "NOT_SCANNED", processed: 0 };
  const feasibility = await processQueue("feasibility", encryptionReady && sourcesReady, () => processPendingFeasibilityRequests(admin, 5));
  const unpaidSourceRetention = await processQueue("unpaidSourceRetention", true, () => processUnpaidSourceRetention(admin, 10));
  if (unpaidSourceRetention && unpaidSourceRetention.failed > 0) queueStages.unpaidSourceRetention = "FAILED";
  const workflow = await processQueue("workflow", encryptionReady && sourcesReady, () => processWorkflowTasks(admin, 2));
  const emailRetries = await processQueue("email", encryptionReady && emailReady, () => retryFailedEmails(admin, 10));
  const chunk4 = await processQueue("commerce", encryptionReady, () => processChunk4Workers(admin, 20));
  if (chunk4 && chunk4.status !== "enabled") queueStages.commerce = "FAILED";
  const queueStates = Object.values(queueStages);
  actions.push({ code: "BOUNDED_QUEUE_PROCESSING", status: queueStates.includes("FAILED") ? "FAILED" : queueStates.includes("SKIPPED") ? "SKIPPED" : "SUCCEEDED" });

  const stripe = createStripeOperationalClient();
  let boardSubscriptionsReconciled;
  if (stripe) {
    try {
      boardSubscriptionsReconciled = await reconcileBoardSubscriptions(stripe, admin);
      actions.push({ code: "STRIPE_RECONCILIATION", status: boardSubscriptionsReconciled >= 0 ? "SUCCEEDED" : "FAILED" });
    } catch { actions.push({ code: "STRIPE_RECONCILIATION", status: "FAILED" }); }
  } else actions.push({ code: "STRIPE_RECONCILIATION", status: "SKIPPED" });

  let boardAdmissions;
  if (sourcesReady) {
    try {
      boardAdmissions = await processBoardRecomputeJobs(admin, 10);
      actions.push({ code: "BOARD_RECOMPUTATION", status: boardAdmissions.status === "enabled" ? "SUCCEEDED" : "FAILED" });
    } catch { actions.push({ code: "BOARD_RECOMPUTATION", status: "FAILED" }); }
  } else actions.push({ code: "BOARD_RECOMPUTATION", status: "SKIPPED" });
  const afterSummary = await collectOperationsSummary(admin).catch(() => null);
  if (!afterSummary) {
    return fail("MAINTENANCE_VERIFICATION_FAILED", null, "Maintenance verification unavailable.");
  }
  const diagnostics = await recordMaintenanceOutcome(admin, beforeSummary, afterSummary, actions, now).catch(() => null);
  if (!diagnostics) {
    return response({ error: "Maintenance evidence could not be recorded.", code: "MAINTENANCE_VERIFICATION_FAILED" }, 503);
  }
  const healthy = diagnostics.unresolvedCodes.length === 0 && actions.every((action) => action.status === "SUCCEEDED");
  return NextResponse.json({
    ok: healthy,
    expiredReservations: reservationResult.data?.length || 0,
    expiredCarts: cartResult.data?.length || 0,
    removedRateLimits: removedRateLimits || 0,
    deletedSources,
    deletedDrafts,
    recoveredStorageObjects,
    staleJobs: Number(staleJobs || 0),
    alerts,
    workflow,
    feasibility,
    fileScans,
    documentExtractions,
    queueStages,
    unpaidSourceRetention,
    emailRetries,
    chunk4,
    boardSubscriptionsReconciled,
    boardAdmissions,
    diagnostics,
  }, { status: healthy ? 200 : 503, headers: { "cache-control": "no-store" } });
}

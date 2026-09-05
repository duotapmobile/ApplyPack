import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sendTransactionalEmail } from "@/lib/email/send";
import { retryFailedEmails } from "@/lib/email/retry";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { processWorkflowTasks } from "@/lib/workflow/process";
import { processPendingFileScans } from "@/lib/files/process-scans";

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
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const admin = createSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  const now = new Date();
  const staleDraftClaims = await admin.from("apply_pack_items").update({ status: "draft_ready", delivery_claimed_at: null })
    .eq("status", "delivery_processing").not("draft_resume_path", "is", null)
    .lt("delivery_claimed_at", new Date(now.getTime() - 15 * 60_000).toISOString());
  const staleQueueClaims = await admin.from("apply_pack_items").update({ status: "queued", delivery_claimed_at: null })
    .eq("status", "delivery_processing").is("draft_resume_path", null)
    .lt("delivery_claimed_at", new Date(now.getTime() - 15 * 60_000).toISOString());
  if (staleDraftClaims.error || staleQueueClaims.error) {
    return NextResponse.json({ error: "Delivery-claim recovery failed." }, { status: 500 });
  }
  const nowIso = now.toISOString();
  const { data: staleOrderClaims, error: staleOrderError } = await admin.from("orders")
    .select("id").eq("status", "delivery_processing")
    .lt("processing_started_at", new Date(now.getTime() - 15 * 60_000).toISOString());
  if (staleOrderError) return NextResponse.json({ error: "Order-claim recovery failed." }, { status: 500 });
  for (const order of staleOrderClaims || []) {
    const released = await admin.rpc("release_order_delivery", { p_order_id: order.id });
    if (released.error) return NextResponse.json({ error: "Order-claim recovery failed." }, { status: 500 });
  }

  const { error: rateLimitCleanupError, count: removedRateLimits } = await admin
    .from("api_rate_limits")
    .delete({ count: "exact" })
    .lt("window_started_at", new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString());
  if (rateLimitCleanupError) {
    return NextResponse.json({ error: "Rate-limit retention maintenance failed." }, { status: 500 });
  }

  const [reservationResult, cartResult] = await Promise.all([
    admin.from("capacity_reservations").update({ status: "expired" }).eq("status", "reserved").lt("expires_at", nowIso).select("id"),
    admin.from("apply_pack_carts").update({ status: "expired" }).eq("status", "checkout_pending")
      .lt("expires_at", new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString()).select("id"),
  ]);
  if (reservationResult.error || cartResult.error) {
    return NextResponse.json({ error: "Expiration maintenance failed." }, { status: 500 });
  }
  const staleHours = Math.max(24, Math.min(720, Number(process.env.APP_JOB_STALE_AFTER_HOURS || 72)));
  const { data: staleJobs, error: staleError } = await admin.rpc("mark_stale_jobs_inactive", { p_stale_hours: staleHours });
  if (staleError) return NextResponse.json({ error: "Job freshness maintenance failed." }, { status: 500 });

  const { data: dueIntakes, error: retentionQueryError } = await admin.from("intakes")
    .select("id")
    .is("source_deleted_at", null)
    .lte("source_retention_due_at", nowIso)
    .limit(100);
  if (retentionQueryError) return NextResponse.json({ error: "Retention maintenance failed." }, { status: 500 });
  let deletedSources = 0;
  for (const intake of dueIntakes || []) {
    const { data: documents, error: documentQueryError } = await admin.from("source_documents")
      .select("id,storage_path").eq("intake_id", intake.id).is("deleted_at", null);
    if (documentQueryError) continue;
    const paths = (documents || []).map((document) => document.storage_path);
    if (paths.length) {
      const { error } = await admin.storage.from("customer-source-documents").remove(paths);
      if (error) continue;
    }
    const finalized = await admin.rpc("finalize_intake_source_retention", {
      p_intake_id: intake.id,
      p_document_count: paths.length,
      p_deleted_at: nowIso,
    });
    if (finalized.error || !finalized.data) continue;
    deletedSources += 1;
  }

  const { data: duePackets, error: packetRetentionError } = await admin.from("job_match_packet_artifacts")
    .select("id,storage_bucket,storage_path")
    .in("status", ["PREVIEW_READY", "APPROVED", "SUPERSEDED"])
    .lte("retention_due_at", nowIso)
    .limit(100);
  if (packetRetentionError) return NextResponse.json({ error: "Packet retention maintenance failed." }, { status: 500 });
  let expiredPackets = 0;
  for (const packet of duePackets || []) {
    const expired = await admin.rpc("expire_job_match_packet_artifact", {
      p_artifact_id: packet.id,
      p_expired_at: nowIso,
    });
    if (expired.error || !expired.data) continue;
    if (packet.storage_bucket && packet.storage_path) {
      const removal = await admin.storage.from(packet.storage_bucket).remove([packet.storage_path]);
      if (removal.error) {
        await admin.from("storage_cleanup_queue").upsert({
          bucket: packet.storage_bucket,
          storage_path: packet.storage_path,
          reason: "expired_job_match_packet",
          attempts: 1,
          last_error: "storage_remove_failed",
          last_attempt_at: nowIso,
        }, { onConflict: "bucket,storage_path" });
      }
    }
    expiredPackets += 1;
  }

  const { data: expiredDrafts, error: draftQueryError } = await admin.from("intake_drafts")
    .select("id,resume_document,cover_letter_document").lt("expires_at", nowIso).limit(100);
  if (draftQueryError) return NextResponse.json({ error: "Draft retention maintenance failed." }, { status: 500 });
  let deletedDrafts = 0;
  for (const draft of expiredDrafts || []) {
    const documents = [draft.resume_document, draft.cover_letter_document] as Array<{ path?: string } | null>;
    const paths = documents.map((document) => document?.path).filter((path): path is string => Boolean(path));
    if (paths.length) {
      const removal = await admin.storage.from("customer-source-documents").remove(paths);
      if (removal.error) continue;
    }
    const deletion = await admin.from("intake_drafts").delete().eq("id", draft.id);
    if (!deletion.error) deletedDrafts += 1;
  }

  const { data: cleanupRows, error: cleanupQueryError } = await admin.from("storage_cleanup_queue")
    .select("id,bucket,storage_path,attempts").lt("attempts", 20).order("created_at").limit(50);
  if (cleanupQueryError) return NextResponse.json({ error: "Storage cleanup queue could not be loaded." }, { status: 500 });
  let recoveredStorageObjects = 0;
  for (const row of cleanupRows || []) {
    const removal = await admin.storage.from(row.bucket).remove([row.storage_path]);
    if (!removal.error) {
      const deletion = await admin.from("storage_cleanup_queue").delete().eq("id", row.id);
      if (!deletion.error) recoveredStorageObjects += 1;
    } else {
      await admin.from("storage_cleanup_queue").update({
        attempts: Number(row.attempts || 0) + 1,
        last_error: "storage_remove_failed",
        last_attempt_at: nowIso,
      }).eq("id", row.id);
    }
  }

  const alertEmail = process.env.APP_ADMIN_ALERT_EMAIL;
  let alerts = 0;
  if (alertEmail) {
    const warningCutoff = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
    const { data: dueOrders } = await admin.from("orders")
      .select("id,product_kind,delivery_deadline,status")
      .in("status", ["paid", "in_fulfillment"])
      .lte("delivery_deadline", warningCutoff)
      .order("delivery_deadline")
      .limit(100);
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
  const fileScans = await processPendingFileScans(admin, 5);
  const workflow = await processWorkflowTasks(admin, 2);
  const emailRetries = await retryFailedEmails(admin, 10);
  return NextResponse.json({
    ok: true,
    expiredReservations: reservationResult.data?.length || 0,
    expiredCarts: cartResult.data?.length || 0,
    removedRateLimits: removedRateLimits || 0,
    deletedSources,
    expiredPackets,
    deletedDrafts,
    recoveredStorageObjects,
    staleJobs: Number(staleJobs || 0),
    alerts,
    workflow,
    fileScans,
    emailRetries,
  });
}

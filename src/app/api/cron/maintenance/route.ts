import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sendTransactionalEmail } from "@/lib/email/send";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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
  const nowIso = now.toISOString();

  const [reservationResult, cartResult] = await Promise.all([
    admin.from("capacity_reservations").update({ status: "expired" }).eq("status", "reserved").lt("expires_at", nowIso).select("id"),
    admin.from("apply_pack_carts").update({ status: "expired" }).eq("status", "checkout_pending").lt("expires_at", nowIso).select("id"),
  ]);
  if (reservationResult.error || cartResult.error) {
    return NextResponse.json({ error: "Expiration maintenance failed." }, { status: 500 });
  }

  const { data: dueIntakes, error: retentionQueryError } = await admin.from("intakes")
    .select("id,resume_path,cover_letter_path")
    .is("source_deleted_at", null)
    .lte("source_retention_due_at", nowIso)
    .limit(100);
  if (retentionQueryError) return NextResponse.json({ error: "Retention maintenance failed." }, { status: 500 });
  let deletedSources = 0;
  for (const intake of dueIntakes || []) {
    const paths = [intake.resume_path, intake.cover_letter_path].filter((value): value is string => Boolean(value));
    if (paths.length) {
      const { error } = await admin.storage.from("customer-source-documents").remove(paths);
      if (error) continue;
    }
    await admin.from("intakes").update({ source_deleted_at: nowIso }).eq("id", intake.id).is("source_deleted_at", null);
    await admin.from("audit_logs").insert({ action: "source_documents_deleted", entity_type: "intake", entity_id: intake.id });
    deletedSources += 1;
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
  return NextResponse.json({
    ok: true,
    expiredReservations: reservationResult.data?.length || 0,
    expiredCarts: cartResult.data?.length || 0,
    deletedSources,
    alerts,
  });
}

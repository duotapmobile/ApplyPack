import "server-only";
import { sendOrderReceipt, sendTransactionalEmail } from "./send";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

const messages: Record<string, { subject: string; lines: string[] }> = {
  search_delivery: {
    subject: "Your 10 ApplyPack job matches are ready",
    lines: ["Your researched job matches are ready in My ApplyPack.", "Review each employer listing before deciding whether to apply."],
  },
  apply_pack_delivery: {
    subject: "Your ApplyPack documents are ready",
    lines: ["Your tailored resume and cover letter are ready in My ApplyPack.", "Download and review both editable files before submitting them to an employer."],
  },
  correction_delivery: {
    subject: "Your corrected ApplyPack files are ready",
    lines: ["The factual correction you requested has been completed.", "The new files replace the prior download links in My ApplyPack."],
  },
  conflict_review_resolved: {
    subject: "Your ApplyPack criteria review is complete",
    lines: ["The criteria conflict you reported has been reviewed.", "Open My ApplyPack for the recorded resolution."],
  },
  conflict_review_received: {
    subject: "ApplyPack criteria-conflict review received",
    lines: ["A customer criteria-conflict request needs operator review."],
  },
  correction_request_received: {
    subject: "ApplyPack factual correction requested",
    lines: ["A customer factual-correction request needs operator review."],
  },
};

export async function retryFailedEmails(admin: AdminClient, limit = 10) {
  const { data: events, error } = await admin.from("email_events")
    .select("id,order_id,apply_pack_cart_id,recipient,template,idempotency_key,attempt_count")
    .eq("status", "failed")
    .lt("attempt_count", 5)
    .order("updated_at")
    .limit(Math.max(1, Math.min(limit, 25)));
  if (error) throw error;
  let sentCount = 0;
  for (const event of events || []) {
    try {
      let result: Awaited<ReturnType<typeof sendTransactionalEmail>> | Awaited<ReturnType<typeof sendOrderReceipt>>;
      if (event.template === "search_purchase_confirmation" && event.order_id) {
        const { data: order, error: orderError } = await admin.from("orders")
          .select("amount_cents,delivery_deadline").eq("id", event.order_id).maybeSingle();
        if (orderError || !order?.delivery_deadline) throw new Error("order_receipt_state_missing");
        result = await sendOrderReceipt({ to: event.recipient, orderId: event.order_id, amountCents: order.amount_cents, deadline: order.delivery_deadline });
      } else if (event.template === "apply_pack_purchase_confirmation" && event.apply_pack_cart_id) {
        const { data: cart, error: cartError } = await admin.from("apply_pack_carts")
          .select("total_cents,delivery_deadline").eq("id", event.apply_pack_cart_id).maybeSingle();
        if (cartError || !cart?.delivery_deadline) throw new Error("cart_receipt_state_missing");
        result = await sendOrderReceipt({ to: event.recipient, orderId: event.apply_pack_cart_id, amountCents: cart.total_cents, deadline: cart.delivery_deadline });
      } else {
        const message = messages[event.template];
        if (!message) throw new Error("unsupported_email_template");
        result = await sendTransactionalEmail({ to: event.recipient, ...message, idempotencyKey: event.idempotency_key });
      }
      const update = await admin.from("email_events").update({
        status: result.skipped ? "skipped" : "sent",
        provider_message_id: result.providerMessageId || null,
        attempt_count: Number(event.attempt_count || 0) + 1,
        last_attempt_at: new Date().toISOString(),
        last_error_code: null,
        updated_at: new Date().toISOString(),
      }).eq("id", event.id).eq("status", "failed");
      if (update.error) throw update.error;
      sentCount += 1;
    } catch (sendError) {
      await admin.from("email_events").update({
        attempt_count: Number(event.attempt_count || 0) + 1,
        last_attempt_at: new Date().toISOString(),
        last_error_code: sendError instanceof Error ? sendError.message.slice(0, 100) : "provider_send_failed",
        updated_at: new Date().toISOString(),
      }).eq("id", event.id).eq("status", "failed");
    }
  }
  return { attempted: (events || []).length, sent: sentCount };
}

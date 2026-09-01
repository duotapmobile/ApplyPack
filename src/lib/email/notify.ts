import "server-only";
import { sendTransactionalEmail } from "@/lib/email/send";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function notifyCustomer(input: {
  customerId: string;
  orderId: string;
  template: string;
  subject: string;
  lines: string[];
  keySuffix?: string;
}) {
  const admin = createSupabaseAdminClient();
  if (!admin) return;
  const idempotencyKey = input.template + "/" + input.orderId + (input.keySuffix ? "/" + input.keySuffix : "");
  const { data: existing } = await admin.from("email_events").select("id").eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existing) return;
  const { data } = await admin.auth.admin.getUserById(input.customerId);
  const email = data.user?.email;
  if (!email) return;
  try {
    const sent = await sendTransactionalEmail({
      to: email,
      subject: input.subject,
      lines: input.lines,
      idempotencyKey,
    });
    await admin.from("email_events").upsert({
      order_id: input.orderId,
      recipient: email,
      template: input.template,
      status: sent.skipped ? "skipped" : "sent",
      provider_message_id: sent.providerMessageId || null,
      idempotency_key: idempotencyKey,
    }, { onConflict: "idempotency_key" });
  } catch {
    await admin.from("email_events").upsert({
      order_id: input.orderId, recipient: email, template: input.template,
      status: "failed", idempotency_key: idempotencyKey,
    }, { onConflict: "idempotency_key" });
  }
}

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
  const { data: existing, error: existingError } = await admin.from("email_events").select("id,status,attempt_count").eq("idempotency_key", idempotencyKey).maybeSingle();
  if (existingError) throw existingError;
  if (existing && ["sent", "skipped"].includes(existing.status)) return;
  const { data, error: userError } = await admin.auth.admin.getUserById(input.customerId);
  if (userError) throw userError;
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
      attempt_count: Number(existing?.attempt_count || 0) + 1,
      last_attempt_at: new Date().toISOString(),
      last_error_code: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "idempotency_key" });
  } catch {
    await admin.from("email_events").upsert({
      order_id: input.orderId, recipient: email, template: input.template,
      status: "failed", idempotency_key: idempotencyKey,
      attempt_count: Number(existing?.attempt_count || 0) + 1,
      last_attempt_at: new Date().toISOString(),
      last_error_code: "provider_send_failed",
      updated_at: new Date().toISOString(),
    }, { onConflict: "idempotency_key" });
  }
}

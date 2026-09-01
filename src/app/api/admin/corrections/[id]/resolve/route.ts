import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { docxMimeType, extensionMatchesMimeType, hasExpectedFileSignature } from "@/lib/files/signatures";
import { notifyCustomer } from "@/lib/email/notify";

const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = (await context.params).id;
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const form = await request.formData();
  const resume = form.get("resume");
  const coverLetter = form.get("coverLetter");
  const qualityConfirmed = form.get("qualityConfirmed") === "true";
  const resolution = String(form.get("resolution") || "").trim();
  if (!(resume instanceof File) || !(coverLetter instanceof File) || !qualityConfirmed || resolution.length < 10 || resolution.length > 2000) {
    return NextResponse.json({ error: "Two reviewed DOCX files, quality confirmation, and an operator note are required." }, { status: 400 });
  }
  const valid = (await Promise.all([resume, coverLetter].map(async (file) =>
    file.type === docxMimeType && file.size > 0 && file.size <= MAX_BYTES &&
    extensionMatchesMimeType(file.name, file.type) && hasExpectedFileSignature(file)
  ))).every(Boolean);
  if (!valid) return NextResponse.json({ error: "Each corrected delivery must be a valid DOCX no larger than 10 MB." }, { status: 400 });

  const { data: correction } = await auth.admin.from("correction_requests")
    .select("id,status,apply_pack_item_id,apply_pack_item:apply_pack_items(order_id,orders!inner(customer_id,status))")
    .eq("id", requestId).maybeSingle();
  const item = Array.isArray(correction?.apply_pack_item) ? correction?.apply_pack_item[0] : correction?.apply_pack_item;
  const order = Array.isArray(item?.orders) ? item.orders[0] : item?.orders;
  if (!correction || correction.status !== "submitted" || !item || !order || order.status !== "delivered") {
    return NextResponse.json({ error: "This correction request is not deliverable." }, { status: 409 });
  }
  const base = order.customer_id + "/orders/" + item.order_id + "/items/" + correction.apply_pack_item_id + "/corrections/" + requestId;
  const resumePath = base + "/resume.docx";
  const coverPath = base + "/cover-letter.docx";
  const first = await auth.admin.storage.from("customer-deliveries").upload(resumePath, resume, { contentType: docxMimeType, upsert: false });
  if (first.error) return NextResponse.json({ error: "The corrected resume could not be stored." }, { status: 502 });
  const second = await auth.admin.storage.from("customer-deliveries").upload(coverPath, coverLetter, { contentType: docxMimeType, upsert: false });
  if (second.error) {
    await auth.admin.storage.from("customer-deliveries").remove([resumePath]);
    return NextResponse.json({ error: "The corrected cover letter could not be stored." }, { status: 502 });
  }
  const resolvedAt = new Date().toISOString();
  const itemUpdate = await auth.admin.from("apply_pack_items").update({
    resume_path: resumePath, cover_letter_path: coverPath, delivered_at: resolvedAt,
  }).eq("id", correction.apply_pack_item_id);
  if (itemUpdate.error) {
    await auth.admin.storage.from("customer-deliveries").remove([resumePath, coverPath]);
    return NextResponse.json({ error: "The corrected file records could not be saved." }, { status: 502 });
  }
  const correctionUpdate = await auth.admin.from("correction_requests").update({
    status: "resolved", admin_notes: resolution, resolved_at: resolvedAt,
  }).eq("id", requestId).eq("status", "submitted");
  if (correctionUpdate.error) return NextResponse.json({ error: "The correction status could not be saved." }, { status: 502 });
  await auth.admin.from("audit_logs").insert({ actor_id: auth.user.id, action: "correction_delivered", entity_type: "correction_request", entity_id: requestId });
  await notifyCustomer({
    customerId: order.customer_id,
    orderId: item.order_id,
    template: "correction_delivery",
    subject: "Your corrected ApplyPack files are ready",
    lines: ["The factual correction you requested has been completed.", "The new resume and cover letter now replace the prior download links in My ApplyPack."],
    keySuffix: requestId,
  });
  return NextResponse.json({ ok: true });
}

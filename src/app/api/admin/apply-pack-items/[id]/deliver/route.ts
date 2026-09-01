import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { docxMimeType, extensionMatchesMimeType, hasExpectedFileSignature } from "@/lib/files/signatures";
import { notifyCustomer } from "@/lib/email/notify";

const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const itemId = (await context.params).id;
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const form = await request.formData();
  const resume = form.get("resume");
  const coverLetter = form.get("coverLetter");
  const qualityConfirmed = form.get("qualityConfirmed") === "true";
  if (!(resume instanceof File) || !(coverLetter instanceof File) || !qualityConfirmed) {
    return NextResponse.json({ error: "Two reviewed DOCX files and quality confirmation are required." }, { status: 400 });
  }
  const filesAreValid = (await Promise.all([resume, coverLetter].map(async (file) =>
    file.type === docxMimeType && file.size <= MAX_BYTES && file.size > 0 && extensionMatchesMimeType(file.name, file.type) && hasExpectedFileSignature(file)
  ))).every(Boolean);
  if (!filesAreValid) {
    return NextResponse.json({ error: "Each delivery must be a DOCX file no larger than 10 MB." }, { status: 400 });
  }
  const { data: item } = await auth.admin.from("apply_pack_items").select("id,order_id,orders!inner(customer_id,status)").eq("id", itemId).maybeSingle();
  const order = Array.isArray(item?.orders) ? item?.orders[0] : item?.orders;
  if (!item || !order || !["paid", "in_fulfillment"].includes(order.status)) {
    return NextResponse.json({ error: "Apply Pack item is not deliverable." }, { status: 409 });
  }
  const base = order.customer_id + "/orders/" + item.order_id + "/items/" + itemId;
  const resumePath = base + "/resume.docx";
  const coverPath = base + "/cover-letter.docx";
  const first = await auth.admin.storage.from("customer-deliveries").upload(resumePath, resume, { contentType: docxMimeType, upsert: false });
  if (first.error) return NextResponse.json({ error: "The resume could not be stored." }, { status: 502 });
  const second = await auth.admin.storage.from("customer-deliveries").upload(coverPath, coverLetter, { contentType: docxMimeType, upsert: false });
  if (second.error) {
    await auth.admin.storage.from("customer-deliveries").remove([resumePath]);
    return NextResponse.json({ error: "The cover letter could not be stored." }, { status: 502 });
  }
  const deliveredAt = new Date().toISOString();
  const { error: updateError } = await auth.admin.from("apply_pack_items").update({
    status: "delivered",
    resume_path: resumePath,
    cover_letter_path: coverPath,
    delivered_at: deliveredAt,
  }).eq("id", itemId);
  if (updateError) {
    await auth.admin.storage.from("customer-deliveries").remove([resumePath, coverPath]);
    return NextResponse.json({ error: "Delivery records could not be saved." }, { status: 502 });
  }
  const { data: remaining } = await auth.admin.from("apply_pack_items").select("id").eq("order_id", item.order_id).neq("status", "delivered");
  if (!remaining?.length) {
    await auth.admin.from("orders").update({ status: "delivered", delivered_at: deliveredAt }).eq("id", item.order_id);
  }
  await auth.admin.from("audit_logs").insert({ actor_id: auth.user.id, action: "apply_pack_delivered", entity_type: "apply_pack_item", entity_id: itemId });
  await notifyCustomer({
    customerId: order.customer_id,
    orderId: item.order_id,
    template: "apply_pack_delivery",
    subject: "Your ApplyPack documents are ready",
    lines: ["Your tailored resume and cover letter are ready in My ApplyPack.", "Download and review both editable files before submitting them to an employer."],
    keySuffix: itemId,
  });
  return NextResponse.json({ ok: true });
}

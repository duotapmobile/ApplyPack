import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { validateDocumentSafety } from "@/lib/files/document-safety";
import { docxMimeType, extensionMatchesMimeType, hasExpectedFileSignature } from "@/lib/files/signatures";
import { scanFile } from "@/lib/files/scanner";
import { notifyCustomer } from "@/lib/email/notify";
import { isSameOriginRequest } from "@/lib/security/origin";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_REQUEST_BYTES = 22 * 1024 * 1024;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "This correction request was rejected." }, { status: 403 });
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_REQUEST_BYTES) return NextResponse.json({ error: "The correction upload is too large." }, { status: 413 });
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
  const safety = await Promise.all([validateDocumentSafety(resume), validateDocumentSafety(coverLetter)]);
  if (safety.some((result) => !result.safe)) return NextResponse.json({ error: "A corrected file contains an unsupported or unsafe document feature." }, { status: 400 });
  const scans = await Promise.all([
    scanFile(resume, { structureValidated: true }),
    scanFile(coverLetter, { structureValidated: true }),
  ]);
  if (scans.some((scan) => scan.status !== "clean")) return NextResponse.json({ error: "Both corrected files must pass the configured private document safety checks before delivery." }, { status: 409 });

  const { data: correction, error: correctionError } = await auth.admin.from("correction_requests")
    .select("id,status,apply_pack_item_id,apply_pack_item:apply_pack_items(order_id,orders!inner(customer_id,status))")
    .eq("id", requestId).maybeSingle();
  const item = Array.isArray(correction?.apply_pack_item) ? correction?.apply_pack_item[0] : correction?.apply_pack_item;
  const order = Array.isArray(item?.orders) ? item.orders[0] : item?.orders;
  if (correctionError) return NextResponse.json({ error: "The correction request could not be loaded." }, { status: 502 });
  if (!correction || correction.status !== "submitted" || !item || !order || !["delivered", "delivered_refunded"].includes(order.status)) {
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
  const { data: completed, error: completionError } = await auth.admin.rpc("complete_correction_delivery", {
    p_request_id: requestId,
    p_actor_id: auth.user.id,
    p_resume_path: resumePath,
    p_cover_letter_path: coverPath,
    p_resolution: resolution,
    p_resolved_at: resolvedAt,
  });
  if (completionError || !completed) {
    await auth.admin.storage.from("customer-deliveries").remove([resumePath, coverPath]);
    return NextResponse.json({ error: "The corrected delivery could not be committed atomically." }, { status: 502 });
  }
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

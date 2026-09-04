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
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "This delivery request was rejected." }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    return NextResponse.json({ error: "The delivery request is too large." }, { status: 413 });
  }
  const itemId = (await context.params).id;
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const form = await request.formData();
  const resume = form.get("resume");
  const coverLetter = form.get("coverLetter");
  const qualityConfirmed = form.get("qualityConfirmed") === "true";
  const reviewNote = String(form.get("reviewNote") || "").trim();
  if (!(resume instanceof File) || !(coverLetter instanceof File) || !qualityConfirmed || reviewNote.length < 20 || reviewNote.length > 2000) {
    return NextResponse.json({ error: "Two reviewed DOCX files, the quality attestation, and an operator note are required." }, { status: 400 });
  }
  const filesAreValid = (await Promise.all([resume, coverLetter].map(async (file) =>
    file.type === docxMimeType && file.size <= MAX_BYTES && file.size > 0 && extensionMatchesMimeType(file.name, file.type) && hasExpectedFileSignature(file)
  ))).every(Boolean);
  if (!filesAreValid) {
    return NextResponse.json({ error: "Each delivery must be a DOCX file no larger than 10 MB." }, { status: 400 });
  }
  const safety = await Promise.all([validateDocumentSafety(resume), validateDocumentSafety(coverLetter)]);
  if (safety.some((result) => !result.safe)) {
    return NextResponse.json({ error: "A delivery contains an unsupported or unsafe document feature." }, { status: 400 });
  }
  const scans = await Promise.all([
    scanFile(resume, { structureValidated: true }),
    scanFile(coverLetter, { structureValidated: true }),
  ]);
  if (scans.some((scan) => scan.status !== "clean")) {
    return NextResponse.json({ error: "Both reviewed files must pass the configured document safety checks before delivery." }, { status: 409 });
  }
  const { data: item } = await auth.admin.from("apply_pack_items").select("id,order_id,status,orders!inner(customer_id,status)").eq("id", itemId).maybeSingle();
  const order = Array.isArray(item?.orders) ? item?.orders[0] : item?.orders;
  if (!item || !order || !["paid", "in_fulfillment"].includes(order.status) || !["queued", "draft_ready", "ready_to_deliver"].includes(item.status)) {
    return NextResponse.json({ error: "Apply Pack item is not deliverable." }, { status: 409 });
  }
  const { data: orderClaim, error: orderClaimError } = await auth.admin.rpc("claim_order_delivery", {
    p_order_id: item.order_id,
    p_kind: "apply_pack",
  });
  if (orderClaimError || !orderClaim) {
    return NextResponse.json({ error: "The order is already being delivered, refunded, or is no longer eligible." }, { status: 409 });
  }
  const priorStatus = item.status;
  const { data: claim, error: claimError } = await auth.admin.from("apply_pack_items").update({ status: "delivery_processing", delivery_claimed_at: new Date().toISOString() })
    .eq("id", itemId).eq("status", priorStatus).select("id").maybeSingle();
  if (claimError || !claim) {
    await auth.admin.rpc("release_order_delivery", { p_order_id: item.order_id });
    return NextResponse.json({ error: "Another operator is already delivering this Tailored Resume + Cover Letter set." }, { status: 409 });
  }
  const releaseClaim = () => auth.admin.from("apply_pack_items").update({ status: priorStatus, delivery_claimed_at: null }).eq("id", itemId).eq("status", "delivery_processing");
  const releaseAllClaims = async () => {
    await releaseClaim();
    await auth.admin.rpc("release_order_delivery", { p_order_id: item.order_id });
  };
  const base = order.customer_id + "/orders/" + item.order_id + "/items/" + itemId;
  const resumePath = base + "/resume.docx";
  const coverPath = base + "/cover-letter.docx";
  const first = await auth.admin.storage.from("customer-deliveries").upload(resumePath, resume, { contentType: docxMimeType, upsert: false });
  if (first.error) { await releaseAllClaims(); return NextResponse.json({ error: "The resume could not be stored." }, { status: 502 }); }
  const second = await auth.admin.storage.from("customer-deliveries").upload(coverPath, coverLetter, { contentType: docxMimeType, upsert: false });
  if (second.error) {
    await auth.admin.storage.from("customer-deliveries").remove([resumePath]);
    await releaseAllClaims();
    return NextResponse.json({ error: "The cover letter could not be stored." }, { status: 502 });
  }
  const deliveredAt = new Date().toISOString();
  const reviewChecklist = {
    factsVerified: true,
    jobTargetConfirmed: true,
    noInventedClaims: true,
    resumeReviewed: true,
    coverLetterReviewed: true,
    humanReleaseApproved: true,
    reviewerNote: reviewNote,
  };
  const { data: completed, error: updateError } = await auth.admin.rpc("complete_apply_pack_item_delivery", {
    p_item_id: itemId,
    p_actor_id: auth.user.id,
    p_resume_path: resumePath,
    p_cover_letter_path: coverPath,
    p_review_checklist: reviewChecklist,
    p_delivered_at: deliveredAt,
  });
  if (updateError || !completed) {
    await auth.admin.storage.from("customer-deliveries").remove([resumePath, coverPath]);
    await releaseAllClaims();
    return NextResponse.json({ error: "Delivery records could not be saved." }, { status: 502 });
  }
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

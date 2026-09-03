import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { validateDocumentSafety } from "@/lib/files/document-safety";
import { docxMimeType, extensionMatchesMimeType, hasExpectedFileSignature, pdfMimeType } from "@/lib/files/signatures";
import { scanFile } from "@/lib/files/scanner";
import { notifyCustomer } from "@/lib/email/notify";
import { isSameOriginRequest } from "@/lib/security/origin";

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_REQUEST_BYTES = 42 * 1024 * 1024;

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
  const resumePdf = form.get("resumePdf");
  const coverLetter = form.get("coverLetter");
  const coverLetterPdf = form.get("coverLetterPdf");
  const qualityConfirmed = form.get("qualityConfirmed") === "true";
  const reviewNote = String(form.get("reviewNote") || "").trim();
  if (!(resume instanceof File) || !(resumePdf instanceof File) || !(coverLetter instanceof File) || !(coverLetterPdf instanceof File) || !qualityConfirmed || reviewNote.length < 20 || reviewNote.length > 2000) {
    return NextResponse.json({ error: "Reviewed Word and PDF versions of both documents, the quality attestation, and an operator note are required." }, { status: 400 });
  }
  const reviewedFiles = [
    { file: resume, mimeType: docxMimeType },
    { file: resumePdf, mimeType: pdfMimeType },
    { file: coverLetter, mimeType: docxMimeType },
    { file: coverLetterPdf, mimeType: pdfMimeType },
  ];
  const filesAreValid = (await Promise.all(reviewedFiles.map(async ({ file, mimeType }) =>
    file.type === mimeType && file.size <= MAX_BYTES && file.size > 0 && extensionMatchesMimeType(file.name, file.type) && hasExpectedFileSignature(file)
  ))).every(Boolean);
  if (!filesAreValid) {
    return NextResponse.json({ error: "Each delivery must contain matching DOCX and PDF files no larger than 10 MB each." }, { status: 400 });
  }
  const safety = await Promise.all(reviewedFiles.map(({ file }) => validateDocumentSafety(file)));
  if (safety.some((result) => !result.safe)) {
    return NextResponse.json({ error: "A delivery contains an unsupported or unsafe document feature." }, { status: 400 });
  }
  const scans = await Promise.all(reviewedFiles.map(({ file }) => scanFile(file, { structureValidated: true })));
  if (scans.some((scan) => scan.status !== "clean")) {
    return NextResponse.json({ error: "All four reviewed files must pass the configured document safety checks before delivery." }, { status: 409 });
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
    return NextResponse.json({ error: "Another operator is already delivering this Apply Pack." }, { status: 409 });
  }
  const releaseClaim = () => auth.admin.from("apply_pack_items").update({ status: priorStatus, delivery_claimed_at: null }).eq("id", itemId).eq("status", "delivery_processing");
  const releaseAllClaims = async () => {
    await releaseClaim();
    await auth.admin.rpc("release_order_delivery", { p_order_id: item.order_id });
  };
  const base = order.customer_id + "/orders/" + item.order_id + "/items/" + itemId;
  const resumePath = base + "/resume.docx";
  const resumePdfPath = base + "/resume.pdf";
  const coverPath = base + "/cover-letter.docx";
  const coverPdfPath = base + "/cover-letter.pdf";
  const deliveryFiles = [
    { path: resumePath, file: resume, contentType: docxMimeType, label: "Word resume" },
    { path: resumePdfPath, file: resumePdf, contentType: pdfMimeType, label: "PDF resume" },
    { path: coverPath, file: coverLetter, contentType: docxMimeType, label: "Word cover letter" },
    { path: coverPdfPath, file: coverLetterPdf, contentType: pdfMimeType, label: "PDF cover letter" },
  ];
  const uploadedPaths: string[] = [];
  for (const deliveryFile of deliveryFiles) {
    const upload = await auth.admin.storage.from("customer-deliveries").upload(deliveryFile.path, deliveryFile.file, {
      contentType: deliveryFile.contentType,
      upsert: false,
    });
    if (upload.error) {
      if (uploadedPaths.length) await auth.admin.storage.from("customer-deliveries").remove(uploadedPaths);
      await releaseAllClaims();
      return NextResponse.json({ error: "The " + deliveryFile.label + " could not be stored." }, { status: 502 });
    }
    uploadedPaths.push(deliveryFile.path);
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
    p_resume_pdf_path: resumePdfPath,
    p_cover_letter_path: coverPath,
    p_cover_letter_pdf_path: coverPdfPath,
    p_review_checklist: reviewChecklist,
    p_delivered_at: deliveredAt,
  });
  if (updateError || !completed) {
    await auth.admin.storage.from("customer-deliveries").remove(uploadedPaths);
    await releaseAllClaims();
    return NextResponse.json({ error: "Delivery records could not be saved." }, { status: 502 });
  }
  await notifyCustomer({
    customerId: order.customer_id,
    orderId: item.order_id,
    template: "apply_pack_delivery",
    subject: "Your ApplyPack documents are ready",
    lines: ["Your tailored resume and cover letter are ready in My ApplyPack.", "Choose editable Word files for Microsoft Word or Google Docs, or PDF files for viewing and sharing. Review both documents before submitting them to an employer."],
    keySuffix: itemId,
  });
  return NextResponse.json({ ok: true });
}

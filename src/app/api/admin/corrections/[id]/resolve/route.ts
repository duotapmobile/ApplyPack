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
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "This correction request was rejected." }, { status: 403 });
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_REQUEST_BYTES) return NextResponse.json({ error: "The correction upload is too large." }, { status: 413 });
  const requestId = (await context.params).id;
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const form = await request.formData();
  const resume = form.get("resume");
  const resumePdf = form.get("resumePdf");
  const coverLetter = form.get("coverLetter");
  const coverLetterPdf = form.get("coverLetterPdf");
  const qualityConfirmed = form.get("qualityConfirmed") === "true";
  const resolution = String(form.get("resolution") || "").trim();
  if (!(resume instanceof File) || !(resumePdf instanceof File) || !(coverLetter instanceof File) || !(coverLetterPdf instanceof File) || !qualityConfirmed || resolution.length < 10 || resolution.length > 2000) {
    return NextResponse.json({ error: "Reviewed Word and PDF versions of both corrected documents, quality confirmation, and an operator note are required." }, { status: 400 });
  }
  const reviewedFiles = [
    { file: resume, mimeType: docxMimeType },
    { file: resumePdf, mimeType: pdfMimeType },
    { file: coverLetter, mimeType: docxMimeType },
    { file: coverLetterPdf, mimeType: pdfMimeType },
  ];
  const valid = (await Promise.all(reviewedFiles.map(async ({ file, mimeType }) =>
    file.type === mimeType && file.size > 0 && file.size <= MAX_BYTES &&
    extensionMatchesMimeType(file.name, file.type) && hasExpectedFileSignature(file)
  ))).every(Boolean);
  if (!valid) return NextResponse.json({ error: "Each corrected delivery must contain matching DOCX and PDF files no larger than 10 MB each." }, { status: 400 });
  const safety = await Promise.all(reviewedFiles.map(({ file }) => validateDocumentSafety(file)));
  if (safety.some((result) => !result.safe)) return NextResponse.json({ error: "A corrected file contains an unsupported or unsafe document feature." }, { status: 400 });
  const scans = await Promise.all(reviewedFiles.map(({ file }) => scanFile(file, { structureValidated: true })));
  if (scans.some((scan) => scan.status !== "clean")) return NextResponse.json({ error: "All four corrected files must pass the configured private document safety checks before delivery." }, { status: 409 });

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
  const resumePdfPath = base + "/resume.pdf";
  const coverPath = base + "/cover-letter.docx";
  const coverPdfPath = base + "/cover-letter.pdf";
  const deliveryFiles = [
    { path: resumePath, file: resume, contentType: docxMimeType, label: "corrected Word resume" },
    { path: resumePdfPath, file: resumePdf, contentType: pdfMimeType, label: "corrected PDF resume" },
    { path: coverPath, file: coverLetter, contentType: docxMimeType, label: "corrected Word cover letter" },
    { path: coverPdfPath, file: coverLetterPdf, contentType: pdfMimeType, label: "corrected PDF cover letter" },
  ];
  const uploadedPaths: string[] = [];
  for (const deliveryFile of deliveryFiles) {
    const upload = await auth.admin.storage.from("customer-deliveries").upload(deliveryFile.path, deliveryFile.file, {
      contentType: deliveryFile.contentType,
      upsert: false,
    });
    if (upload.error) {
      if (uploadedPaths.length) await auth.admin.storage.from("customer-deliveries").remove(uploadedPaths);
      return NextResponse.json({ error: "The " + deliveryFile.label + " could not be stored." }, { status: 502 });
    }
    uploadedPaths.push(deliveryFile.path);
  }
  const resolvedAt = new Date().toISOString();
  const { data: completed, error: completionError } = await auth.admin.rpc("complete_correction_delivery", {
    p_request_id: requestId,
    p_actor_id: auth.user.id,
    p_resume_path: resumePath,
    p_resume_pdf_path: resumePdfPath,
    p_cover_letter_path: coverPath,
    p_cover_letter_pdf_path: coverPdfPath,
    p_resolution: resolution,
    p_resolved_at: resolvedAt,
  });
  if (completionError || !completed) {
    await auth.admin.storage.from("customer-deliveries").remove(uploadedPaths);
    return NextResponse.json({ error: "The corrected delivery could not be committed atomically." }, { status: 502 });
  }
  await notifyCustomer({
    customerId: order.customer_id,
    orderId: item.order_id,
    template: "correction_delivery",
    subject: "Your corrected ApplyPack files are ready",
    lines: ["The factual correction you requested has been completed.", "The new Word and PDF versions of your resume and cover letter now replace the prior download links in My ApplyPack."],
    keySuffix: requestId,
  });
  return NextResponse.json({ ok: true });
}

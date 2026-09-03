import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { validateDocumentSafety } from "@/lib/files/document-safety";
import { extensionMatchesMimeType, hasExpectedFileSignature } from "@/lib/files/signatures";
import { scanFile } from "@/lib/files/scanner";
import { allowedResumeTypes } from "@/lib/schemas/intake";
import { isSameOriginRequest } from "@/lib/security/origin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_REQUEST_BYTES = 11 * 1024 * 1024;

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "This upload request was rejected." }, { status: 403 });
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_REQUEST_BYTES) return NextResponse.json({ error: "The upload is too large." }, { status: 413 });
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) return NextResponse.json({ error: "Private storage is unavailable." }, { status: 503 });
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: "Sign in before uploading." }, { status: 401 });

  const form = await request.formData();
  const kind = form.get("kind");
  const file = form.get("file");
  if ((kind !== "resume" && kind !== "cover_letter") || !(file instanceof File) || file.size < 1) {
    return NextResponse.json({ error: "Choose a resume or cover-letter document." }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES || !allowedResumeTypes.has(file.type) || !extensionMatchesMimeType(file.name, file.type) || !(await hasExpectedFileSignature(file))) {
    return NextResponse.json({ error: "Upload a valid PDF or DOCX no larger than 10 MB." }, { status: 400 });
  }
  const safety = await validateDocumentSafety(file);
  if (!safety.safe) return NextResponse.json({ error: "The document contains an unsupported or unsafe feature. Export a new plain PDF or DOCX." }, { status: 400 });

  const now = new Date();
  const { data: draft, error: draftError } = await admin.from("intake_drafts").upsert({
    customer_id: authData.user.id,
    email: (authData.user.email || "").toLowerCase(),
    updated_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  }, { onConflict: "customer_id" }).select("id,resume_document,cover_letter_document").single();
  if (draftError || !draft) return NextResponse.json({ error: "The intake draft could not be prepared." }, { status: 502 });

  const extension = file.name.toLowerCase().split(".").pop();
  const path = authData.user.id + "/drafts/" + draft.id + "/" + kind + "-" + randomUUID() + "." + extension;
  const upload = await admin.storage.from("customer-source-documents").upload(path, file, { contentType: file.type, upsert: false });
  if (upload.error) return NextResponse.json({ error: "The document could not be stored privately." }, { status: 502 });

  const scan = await scanFile(file, { structureValidated: true });
  const document = {
    path,
    name: file.name.slice(0, 255),
    size: file.size,
    mimeType: file.type,
    sha256: scan.sha256,
    scanStatus: scan.status,
    scanProvider: scan.provider,
    scanProviderReference: scan.providerReference,
    scanErrorCode: scan.errorCode,
    scannedAt: scan.scannedAt,
  };
  const field = kind === "resume" ? "resume_document" : "cover_letter_document";
  const prior = (kind === "resume" ? draft.resume_document : draft.cover_letter_document) as { path?: string } | null;
  const { error: updateError } = await admin.from("intake_drafts").update({
    [field]: document,
    updated_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  }).eq("id", draft.id).eq("customer_id", authData.user.id);
  if (updateError) {
    await admin.storage.from("customer-source-documents").remove([path]);
    return NextResponse.json({ error: "The document record could not be saved." }, { status: 502 });
  }
  if (prior?.path && prior.path !== path) {
    const removal = await admin.storage.from("customer-source-documents").remove([prior.path]);
    if (removal.error) {
      await admin.from("storage_cleanup_queue").upsert({
        bucket: "customer-source-documents",
        storage_path: prior.path,
        reason: "draft_document_replaced",
        last_error: "storage_remove_failed",
      }, { onConflict: "bucket,storage_path" });
    }
  }
  return NextResponse.json({
    draftId: draft.id,
    document: { name: document.name, size: document.size, mimeType: document.mimeType, scanStatus: document.scanStatus },
  });
}

export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "This delete request was rejected." }, { status: 403 });
  const kind = new URL(request.url).searchParams.get("kind");
  if (kind !== "resume" && kind !== "cover_letter") return NextResponse.json({ error: "Unknown document type." }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) return NextResponse.json({ error: "Private storage is unavailable." }, { status: 503 });
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: "Sign in before changing documents." }, { status: 401 });
  const field = kind === "resume" ? "resume_document" : "cover_letter_document";
  const { data: draft, error } = await admin.from("intake_drafts").select("id,resume_document,cover_letter_document")
    .eq("customer_id", authData.user.id).maybeSingle();
  if (error || !draft) return NextResponse.json({ error: "The saved document was not found." }, { status: 404 });
  const prior = (kind === "resume" ? draft.resume_document : draft.cover_letter_document) as { path?: string } | null;
  const update = await admin.from("intake_drafts").update({ [field]: null, updated_at: new Date().toISOString() })
    .eq("id", draft.id).eq("customer_id", authData.user.id);
  if (update.error) return NextResponse.json({ error: "The saved document could not be removed." }, { status: 502 });
  if (prior?.path) {
    const removal = await admin.storage.from("customer-source-documents").remove([prior.path]);
    if (removal.error) {
      const queued = await admin.from("storage_cleanup_queue").upsert({
        bucket: "customer-source-documents",
        storage_path: prior.path,
        reason: "draft_document_removed",
        last_error: "storage_remove_failed",
      }, { onConflict: "bucket,storage_path" });
      if (queued.error) return NextResponse.json({ error: "The record was cleared, but storage cleanup could not be queued." }, { status: 500 });
      return NextResponse.json({ ok: true, cleanupPending: true });
    }
  }
  return NextResponse.json({ ok: true });
}

import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { anonymousDraftContext, anonymousDraftError } from "@/lib/drafts/anonymous-server";
import { validateDocumentSafety } from "@/lib/files/document-safety";
import { hasExpectedFileSignature } from "@/lib/files/signatures";
import { MAX_SOURCE_DOCUMENT_BYTES, validateSourceDocumentMetadata } from "@/lib/files/upload-policy";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { isSameOriginRequest } from "@/lib/security/origin";

const kinds = new Map([["resume", "RESUME"], ["prior_cover_letter", "PRIOR_COVER_LETTER"]] as const);

function validName(name: string) {
  return name.replace(/[\u0000-\u001f\u007f]/gu, "").slice(0, 255) || "document";
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "This upload request was rejected." }, { status: 403 });
  const context = await anonymousDraftContext();
  if (!context) return NextResponse.json({ error: "The saved draft is unavailable." }, { status: 404 });
  const rate = await consumeRateLimit({ request, scope: "anonymous_draft_document_upload", identity: context.capability.draftId, limit: 12, windowSeconds: 60 * 60 });
  if (!rate.configured || !rate.allowed) return NextResponse.json({ error: "A document cannot be uploaded right now." }, { status: rate.configured ? 429 : 503 });
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_SOURCE_DOCUMENT_BYTES + 256 * 1024) {
    return NextResponse.json({ error: "The upload request is too large." }, { status: 413 });
  }
  const form = await request.formData().catch(() => null);
  const kind = form?.get("kind");
  const file = form?.get("file");
  const expectedVersion = Number(form?.get("expectedVersion"));
  const documentKind = typeof kind === "string" ? kinds.get(kind as "resume" | "prior_cover_letter") : undefined;
  if (!documentKind || !(file instanceof File) || file.size < 1 || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    return NextResponse.json({ error: "The upload request is invalid." }, { status: 400 });
  }
  const metadata = validateSourceDocumentMetadata({ name: file.name, size: file.size, claimedMimeType: file.type, signatureMatches: await hasExpectedFileSignature(file) });
  if (!metadata.allowed) {
    return NextResponse.json({ error: "Upload one valid PDF or DOCX no larger than 10 MiB." }, { status: 400 });
  }
  const safety = await validateDocumentSafety(file);
  if (!safety.safe) return NextResponse.json({ error: "The document is encrypted, active, macro-enabled, malformed, or otherwise unsupported.", code: safety.reason }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const documentId = randomUUID();
  const extension = file.type === "application/pdf" ? "pdf" : "docx";
  const path = `anonymous/${context.capability.draftId}/${documentKind.toLowerCase()}/${documentId}.${extension}`;
  const upload = await context.admin.storage.from("customer-source-documents").upload(path, bytes, { cacheControl: "no-cache", contentType: file.type, upsert: false });
  if (upload.error) return NextResponse.json({ error: "The private upload could not be saved." }, { status: 502 });
  const registered = await context.admin.rpc("ap_register_anonymous_document", {
    p_draft_id: context.capability.draftId,
    p_secret_hash: context.secretHash,
    p_expected_draft_version: expectedVersion,
    p_document_id: documentId,
    p_kind: documentKind,
    p_name: validName(file.name),
    p_path: path,
    p_size: file.size,
    p_claimed_mime: file.type,
    p_verified_mime: file.type,
    p_sha256: createHash("sha256").update(bytes).digest("hex"),
  });
  if (registered.error || !Array.isArray(registered.data) || !registered.data[0]) {
    await context.admin.storage.from("customer-source-documents").remove([path]);
    const mapped = anonymousDraftError(registered.error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
  const row = registered.data[0] as Record<string, unknown>;
  return NextResponse.json({ document: { id: row.document_id, version: row.document_version, kind: documentKind, processingState: "QUARANTINED" }, draftVersion: row.draft_version }, { status: 201 });
}

export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "This removal request was rejected." }, { status: 403 });
  const context = await anonymousDraftContext();
  if (!context) return NextResponse.json({ error: "The saved draft is unavailable." }, { status: 404 });
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const expectedVersion = Number(url.searchParams.get("expectedVersion"));
  const documentKind = kind ? kinds.get(kind as "resume" | "prior_cover_letter") : undefined;
  if (!documentKind || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) return NextResponse.json({ error: "The removal request is invalid." }, { status: 400 });
  const removed = await context.admin.rpc("ap_remove_anonymous_document", { p_draft_id: context.capability.draftId, p_secret_hash: context.secretHash, p_expected_draft_version: expectedVersion, p_kind: documentKind });
  if (removed.error || !Array.isArray(removed.data) || !removed.data[0]) {
    const mapped = anonymousDraftError(removed.error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
  const row = removed.data[0] as Record<string, unknown>;
  // History is retained. The cleanup scheduler removes superseded bytes only
  // after the configured retention policy makes them eligible.
  return NextResponse.json({ removed: true, documentId: row.document_id, draftVersion: row.draft_version });
}

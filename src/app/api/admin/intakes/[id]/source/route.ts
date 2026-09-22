import { processSourceForReview } from "@/lib/files/isolated-extraction";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";

const kindSchema = z.enum(["resume", "cover_letter"]);

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const intakeId = (await context.params).id;
  const kind = kindSchema.safeParse(new URL(request.url).searchParams.get("kind"));
  if (!kind.success) return NextResponse.json({ error: "Choose a source document." }, { status: 400 });
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { data: intake } = await auth.admin.from("intakes")
    .select("resume_path,cover_letter_path,source_scan_status,source_deleted_at")
    .eq("id", intakeId)
    .maybeSingle();
  if (!intake || intake.source_deleted_at) return NextResponse.json({ error: "Source document not found." }, { status: 404 });
  const path = kind.data === "resume" ? intake.resume_path : intake.cover_letter_path;
  if (!path) return NextResponse.json({ error: "Source document not found." }, { status: 404 });
  const { data, error } = await auth.admin.storage.from("customer-source-documents").download(path);
  if (error || !data || data.size > 10 * 1024 * 1024) return NextResponse.json({ error: "Source unavailable." }, { status: 503 });
  const result = await processSourceForReview(Buffer.from(await data.arrayBuffer()), data.type).catch(() => null);
  if (!result || result.errorCode || result.stage !== "OPERATOR_REVIEW") return NextResponse.json({ error: "Isolated document processing is unavailable or requires review. The original remains quarantined." }, { status: 423 });
  const audit = await auth.admin.from("audit_logs").insert({ actor_id: auth.user.id, action: "source_document_extracted_for_review", entity_type: "intake", entity_id: intakeId,
    details: { kind: kind.data, sha256: result.sha256, parserReference: result.parserReference, malwareVerdict: "NOT_SCANNED", pageCount: result.pageCount, paginationStatus: result.paginationStatus } });
  if (audit.error) return NextResponse.json({ error: "Review audit could not be recorded." }, { status: 503 });
  return NextResponse.json({ text: result.modelInput, status: "OPERATOR_REVIEW", malwareVerdict: "NOT_SCANNED", pageCount: result.pageCount, paginationStatus: result.paginationStatus, referenceBlocksWithheld: result.quarantinedReferenceBlocks.length },
    { headers: { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
}

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { validateDocumentSafety } from "@/lib/files/document-safety";
import { extensionMatchesMimeType, hasExpectedFileSignature } from "@/lib/files/signatures";
import { scanFile, type FileScanResult } from "@/lib/files/scanner";
import { allowedResumeTypes, parseIntakeForm } from "@/lib/schemas/intake";
import { isSameOriginRequest } from "@/lib/security/origin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_REQUEST_BYTES = 22 * 1024 * 1024;

type StoredDocument = {
  path: string;
  name: string;
  size: number;
  mimeType: string;
  sha256: string;
  scanStatus: FileScanResult["status"];
  scanProvider: FileScanResult["provider"];
  scanProviderReference: string | null;
  scanErrorCode: string | null;
  scannedAt: string | null;
};

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "This intake request was rejected." }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_REQUEST_BYTES) return NextResponse.json({ error: "The intake request is too large." }, { status: 413 });
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) {
    return NextResponse.json({ error: "Private account storage is not connected yet." }, { status: 503 });
  }
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: "Secure email sign-in is required.", authRequired: true }, { status: 401 });
  const rate = await consumeRateLimit({ request, scope: "intake_submit", identity: authData.user.id, limit: 10, windowSeconds: 60 * 60 });
  if (!rate.allowed) return NextResponse.json({ error: "Too many intake attempts. Try again later." }, { status: 429 });

  const formData = await request.formData();
  const parsed = parseIntakeForm(formData);
  if (!parsed.success) {
    return NextResponse.json({ error: "Complete every required intake field.", details: parsed.error.flatten() }, { status: 400 });
  }
  if (parsed.data.email.toLowerCase() !== (authData.user.email || "").toLowerCase()) {
    return NextResponse.json({ error: "Use the email address that received your secure sign-in code." }, { status: 403 });
  }

  const draftId = String(formData.get("draftId") || "");
  const { data: savedDraft, error: draftError } = draftId
    ? await admin.from("intake_drafts").select("id,resume_document,cover_letter_document")
      .eq("id", draftId).eq("customer_id", authData.user.id).maybeSingle()
    : { data: null, error: null };
  if (draftError) return NextResponse.json({ error: "Your saved intake could not be verified." }, { status: 502 });

  const intakeId = randomUUID();
  const freshPaths: string[] = [];
  const resumeFile = formData.get("resume");
  const coverFile = formData.get("coverLetter");
  let resumeDocument: StoredDocument | null = null;
  let coverDocument: StoredDocument | null = null;
  try {
    resumeDocument = resumeFile instanceof File && resumeFile.size > 0
      ? await uploadDocument(resumeFile, "resume", authData.user.id, intakeId)
      : validateStoredDocument(savedDraft?.resume_document, authData.user.id, draftId);
    if (!resumeDocument) return NextResponse.json({ error: "Attach and save your current resume before checkout." }, { status: 400 });

    coverDocument = coverFile instanceof File && coverFile.size > 0
      ? await uploadDocument(coverFile, "cover-letter", authData.user.id, intakeId)
      : validateStoredDocument(savedDraft?.cover_letter_document, authData.user.id, draftId);
  } catch (error) {
    if (freshPaths.length) await admin.storage.from("customer-source-documents").remove(freshPaths);
    return NextResponse.json({ error: error instanceof Error ? error.message : "A source document could not be validated." }, { status: 400 });
  }

  async function uploadDocument(file: File, kind: string, customerId: string, targetIntakeId: string): Promise<StoredDocument> {
    if (file.size > MAX_FILE_BYTES || !allowedResumeTypes.has(file.type) || !extensionMatchesMimeType(file.name, file.type) || !(await hasExpectedFileSignature(file))) {
      throw new Error("Upload a valid PDF or DOCX no larger than 10 MB.");
    }
    const safety = await validateDocumentSafety(file);
    if (!safety.safe) throw new Error("A document contains an unsupported or unsafe feature. Export a new plain PDF or DOCX.");
    const extension = file.name.toLowerCase().split(".").pop();
    const path = customerId + "/intakes/" + targetIntakeId + "/source/" + kind + "-" + randomUUID() + "." + extension;
    const upload = await admin!.storage.from("customer-source-documents").upload(path, file, { contentType: file.type, upsert: false });
    if (upload.error) throw new Error("A source document could not be stored privately.");
    freshPaths.push(path);
    const scan = await scanFile(file, { structureValidated: true });
    return {
      path, name: file.name.slice(0, 255), size: file.size, mimeType: file.type,
      sha256: scan.sha256, scanStatus: scan.status, scanProvider: scan.provider,
      scanProviderReference: scan.providerReference, scanErrorCode: scan.errorCode, scannedAt: scan.scannedAt,
    };
  }

  const now = new Date();
  const intakeRecord = {
    direction: [parsed.data.directionChoice, parsed.data.targetTitles].filter(Boolean).join(": "),
    priorities: [...parsed.data.employmentTypes, ...parsed.data.schedulePreferences, ...parsed.data.requiredBenefits, ...parsed.data.preferredBenefits],
    dealbreakers: [...parsed.data.neverInclude, parsed.data.oldCareerExclusion].filter(Boolean).join("; "),
    location_preference: [parsed.data.city, parsed.data.state, parsed.data.remoteRequirement, parsed.data.remoteDetail].filter(Boolean).join("; "),
    schedule_preference: parsed.data.schedulePreferences.join("; ") || "No specific schedule preference",
    minimum_salary: parsed.data.minimumSalary || null,
    cover_letter_path: coverDocument?.path || null,
    experience_summary: parsed.data.backgroundDetails,
    notes: [parsed.data.tools, parsed.data.credentials, parsed.data.resumeCorrections].filter(Boolean).join("\n\n") || null,
    resume_path: resumeDocument.path,
    source_retention_due_at: new Date(now.getTime() + Number(process.env.APP_SOURCE_DOCUMENT_RETENTION_DAYS || 30) * 86_400_000).toISOString(),
  };

  const documents = [
    { kind: "resume", document: resumeDocument },
    ...(coverDocument ? [{ kind: "cover_letter", document: coverDocument }] : []),
  ];
  const documentRecords = documents.map(({ kind, document }) => ({
      document_kind: kind,
      storage_path: document.path,
      size_bytes: document.size,
      claimed_mime_type: document.mimeType,
      verified_mime_type: document.mimeType,
      sha256: document.sha256,
      scan_status: document.scanStatus,
      scan_provider: document.scanProvider,
      scan_provider_reference: document.scanProviderReference,
      scan_error_code: document.scanErrorCode,
      scan_attempts: document.scanProvider ? 1 : 0,
      scanned_at: document.scannedAt,
  }));
  const { data: sourceScanStatus, error: completionError } = await admin.rpc("create_completed_intake", {
    p_intake_id: intakeId,
    p_customer_id: authData.user.id,
    p_email: parsed.data.email.toLowerCase(),
    p_display_name: parsed.data.fullName,
    p_intake: intakeRecord,
    p_answers: parsed.data,
    p_documents: documentRecords,
    p_draft_id: savedDraft?.id || null,
  });
  if (completionError) {
    if (freshPaths.length) await admin.storage.from("customer-source-documents").remove([...new Set(freshPaths)]);
    return NextResponse.json({ error: "Your approved criteria and private document records could not be preserved atomically." }, { status: 502 });
  }
  return NextResponse.json({
    intakeId,
    sourceScanStatus,
    message: sourceScanStatus === "clean"
      ? "Your documents passed the private document safety checks."
      : sourceScanStatus === "blocked"
        ? "A document was blocked by the private document safety checks. No payment was started."
        : "Your documents remain private and quarantined until document safety checks complete. No payment was started.",
  }, { status: sourceScanStatus === "clean" ? 200 : 202 });
}

function validateStoredDocument(value: unknown, customerId: string, draftId: string): StoredDocument | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || !draftId) return null;
  const item = value as Record<string, unknown>;
  const path = String(item.path || "");
  const mimeType = String(item.mimeType || "");
  const scanStatus = String(item.scanStatus || "");
  if (
    !path.startsWith(customerId + "/drafts/" + draftId + "/") ||
    !allowedResumeTypes.has(mimeType) ||
    !["pending", "clean", "blocked", "scan_error"].includes(scanStatus) ||
    !/^[0-9a-f]{64}$/.test(String(item.sha256 || "")) ||
    Number(item.size || 0) < 1 ||
    Number(item.size || 0) > MAX_FILE_BYTES
  ) return null;
  return {
    path,
    name: String(item.name || "source-document").slice(0, 255),
    size: Number(item.size),
    mimeType,
    sha256: String(item.sha256),
    scanStatus: scanStatus as StoredDocument["scanStatus"],
    scanProvider: item.scanProvider === "clamav" || item.scanProvider === "document_validation" ? item.scanProvider : null,
    scanProviderReference: typeof item.scanProviderReference === "string" ? item.scanProviderReference : null,
    scanErrorCode: typeof item.scanErrorCode === "string" ? item.scanErrorCode : null,
    scannedAt: typeof item.scannedAt === "string" ? item.scannedAt : null,
  };
}

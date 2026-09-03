import { createHash } from "node:crypto";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { validateDocumentSafety } from "./document-safety";
import { fileScanConfiguration, scanFile } from "./scanner";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

export async function processPendingFileScans(admin: AdminClient, limit = 5) {
  if (!fileScanConfiguration().ready) return { processed: 0, clean: 0, blocked: 0, errors: 0 };
  const { data: rows, error } = await admin.rpc("claim_source_document_scans", {
    p_limit: Math.max(1, Math.min(limit, 20)),
  });
  if (error) throw error;
  let clean = 0;
  let blocked = 0;
  let errors = 0;
  for (const row of rows || []) {
    const { data, error: downloadError } = await admin.storage.from("customer-source-documents").download(row.storage_path);
    if (downloadError || !data) {
      const failedDownload = await admin.from("source_documents").update({
        scan_status: "scan_error",
        scan_error_code: "quarantine_download_failed",
        scan_claimed_at: null,
        updated_at: new Date().toISOString(),
      }).eq("id", row.id);
      if (failedDownload.error) throw failedDownload.error;
      errors += 1;
      continue;
    }
    const bytes = Buffer.from(await data.arrayBuffer());
    const file = new File([bytes], "quarantined-source", { type: row.verified_mime_type });
    const safety = await validateDocumentSafety(file);
    const result = safety.safe
      ? await scanFile(file, { structureValidated: true })
      : {
          status: "blocked" as const,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          provider: "document_validation" as const,
          providerReference: "document_validation:" + safety.reason,
          errorCode: safety.reason,
          scannedAt: new Date().toISOString(),
        };
    const scanUpdate = await admin.from("source_documents").update({
      sha256: result.sha256,
      scan_status: result.status,
      scan_provider: result.provider,
      scan_provider_reference: result.providerReference,
      scan_error_code: result.errorCode,
      scan_claimed_at: null,
      scanned_at: result.scannedAt,
      updated_at: new Date().toISOString(),
    }).eq("id", row.id);
    if (scanUpdate.error) throw scanUpdate.error;
    if (result.status === "clean") clean += 1;
    else if (result.status === "blocked") blocked += 1;
    else errors += 1;
    const refreshed = await admin.rpc("refresh_intake_scan_status", { p_intake_id: row.intake_id });
    if (refreshed.error) throw refreshed.error;
  }
  return { processed: (rows || []).length, clean, blocked, errors };
}

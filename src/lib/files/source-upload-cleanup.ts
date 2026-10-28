import "server-only";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

const SOURCE_BUCKET = "customer-source-documents" as const;
const INTENT_GRACE_MILLISECONDS = 60 * 60 * 1_000;

export async function createSourceUploadCleanupIntent(
  admin: AdminClient,
  storagePath: string,
  reason: "anonymous_source_upload_intent" | "draft_source_upload_intent" | "intake_source_upload_intent",
) {
  const queued = await admin.from("storage_cleanup_queue").upsert({
    bucket: SOURCE_BUCKET,
    storage_path: storagePath,
    reason,
    attempts: 0,
    last_error: null,
    last_attempt_at: null,
    not_before: new Date(Date.now() + INTENT_GRACE_MILLISECONDS).toISOString(),
  }, { onConflict: "bucket,storage_path" });
  if (queued.error) throw new Error("source_upload_cleanup_intent_failed");
}

export async function removeSourceUploadOrQueue(
  admin: AdminClient,
  storagePath: string,
  reason: string,
) {
  const removal = await admin.storage.from(SOURCE_BUCKET).remove([storagePath]);
  if (!removal.error) {
    const cleared = await admin.from("storage_cleanup_queue").delete()
      .eq("bucket", SOURCE_BUCKET).eq("storage_path", storagePath);
    if (cleared.error) throw new Error("source_upload_cleanup_intent_clear_failed");
    return;
  }
  const queued = await admin.from("storage_cleanup_queue").upsert({
    bucket: SOURCE_BUCKET,
    storage_path: storagePath,
    reason,
    last_error: "storage_remove_failed",
    not_before: new Date().toISOString(),
  }, { onConflict: "bucket,storage_path" });
  if (queued.error) throw new Error("source_upload_cleanup_queue_failed");
}

import "server-only";

import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
type GeneratedStorageBucket = "customer-deliveries" | "operator-drafts" | "operator-render-previews";

export async function removeGeneratedStorageOrQueue(
  admin: AdminClient,
  objects: ReadonlyArray<{ bucket: GeneratedStorageBucket; path: string }>,
  reason: "generated_upload_failed" | "generated_registration_failed",
) {
  for (const object of objects) {
    const removal = await admin.storage.from(object.bucket).remove([object.path]);
    if (!removal.error) continue;
    const queued = await admin.from("storage_cleanup_queue").upsert({
      bucket: object.bucket,
      storage_path: object.path,
      reason,
      last_error: "storage_remove_failed",
    }, { onConflict: "bucket,storage_path" });
    if (queued.error) throw new Error("generated_storage_cleanup_unrecoverable");
  }
}

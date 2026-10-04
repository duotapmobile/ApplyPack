import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("customer source upload cleanup", () => {
  it("creates a delayed intent before every customer source upload", () => {
    const helper = source("src/lib/files/source-upload-cleanup.ts");
    const anonymous = source("src/app/api/intake/anonymous-draft/document/route.ts");
    const draft = source("src/app/api/intake/draft/document/route.ts");
    const intake = source("src/app/api/intake/route.ts");

    expect(helper).toContain("INTENT_GRACE_MILLISECONDS");
    expect(helper).toContain('bucket: SOURCE_BUCKET');
    expect(helper).toContain('not_before: new Date(Date.now() + INTENT_GRACE_MILLISECONDS)');
    expect(helper).toContain("source_upload_cleanup_queue_failed");
    expect(anonymous.indexOf("await createSourceUploadCleanupIntent")).toBeLessThan(anonymous.indexOf('.upload(path, bytes'));
    expect(draft.indexOf("await createSourceUploadCleanupIntent")).toBeLessThan(draft.indexOf('.upload(path, file'));
    expect(intake.indexOf("await createSourceUploadCleanupIntent")).toBeLessThan(intake.indexOf('.upload(path, file'));
    expect(anonymous).toContain('"anonymous_source_upload_intent"');
    expect(draft).toContain('"draft_source_upload_intent"');
    expect(intake).toContain('"intake_source_upload_intent"');
  });

  it("registers atomically and surfaces cleanup failures", () => {
    const helper = source("src/lib/files/source-upload-cleanup.ts");
    const anonymous = source("src/app/api/intake/anonymous-draft/document/route.ts");
    const draft = source("src/app/api/intake/draft/document/route.ts");
    const intake = source("src/app/api/intake/route.ts");
    const migration = source("supabase/migrations/202610030071_customer_source_upload_cleanup_intents.sql");

    expect(helper).toContain('admin.storage.from(SOURCE_BUCKET).remove([storagePath])');
    expect(helper).toContain('admin.from("storage_cleanup_queue").upsert');
    expect(anonymous).toContain("removeSourceUploadOrQueue");
    expect(draft).toContain('rpc("ap_register_intake_draft_document"');
    expect(draft).toContain("prior-document cleanup could not be queued");
    expect(intake).toContain("private document cleanup could not be confirmed");
    expect(migration).toContain("ap_registered_anonymous_source_cleanup");
    expect(migration).toContain("ap_register_intake_draft_document");
    expect(migration).toContain("ap_registered_intake_source_cleanup");
    expect(migration).toContain("draft_source_upload_intent_missing");
    expect(migration).toContain("CUSTOMER_SOURCE_UPLOAD_CLEANUP_INTENTS");
  });

  it("keeps an explicit employer delivery filename distinct from the preview bucket", () => {
    const migration = source("supabase/migrations/202610040072_material_delivery_filename_cleanup_compatibility.sql");

    expect(migration).toContain("MATERIAL_DELIVERY_FILENAME_CLEANUP_COMPATIBILITY");
    expect(migration).toContain("when 'operator-render-previews' then value->>'storagePath' is distinct from base_path||'/render-preview.pdf'");
    expect(migration).toContain("when 'customer-deliveries' then value->>'storagePath' not like base_path||'/%'");
    expect(migration).not.toContain("value->>'storagePath'=base_path||'/render-preview.pdf'");
  });
});

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { removeGeneratedStorageOrQueue } from "@/lib/materials/storage-cleanup";

function adminFixture(input: { removalFails?: boolean; queueFails?: boolean } = {}) {
  const remove = vi.fn(async () => ({ error: input.removalFails ? new Error("remove failed") : null }));
  const upsert = vi.fn(async () => ({ error: input.queueFails ? new Error("queue failed") : null }));
  const admin = {
    storage: { from: vi.fn(() => ({ remove })) },
    from: vi.fn(() => ({ upsert })),
  };
  return { admin, remove, upsert };
}

describe("generated storage cleanup recovery", () => {
  it("removes an uploaded source without creating a recovery row", async () => {
    const fixture = adminFixture();
    await removeGeneratedStorageOrQueue(fixture.admin as never, [
      { bucket: "operator-drafts", path: "customer/materials/source.docx" },
    ], "generated_upload_failed");
    expect(fixture.remove).toHaveBeenCalledWith(["customer/materials/source.docx"]);
    expect(fixture.upsert).not.toHaveBeenCalled();
  });

  it("queues an idempotent PII-free cleanup reason when storage removal fails", async () => {
    const fixture = adminFixture({ removalFails: true });
    await removeGeneratedStorageOrQueue(fixture.admin as never, [
      { bucket: "operator-drafts", path: "customer/materials/source.docx" },
    ], "generated_registration_failed");
    expect(fixture.upsert).toHaveBeenCalledWith({
      bucket: "operator-drafts",
      storage_path: "customer/materials/source.docx",
      reason: "generated_registration_failed",
      last_error: "storage_remove_failed",
    }, { onConflict: "bucket,storage_path" });
  });

  it("fails closed when neither deletion nor durable cleanup queuing succeeds", async () => {
    const fixture = adminFixture({ removalFails: true, queueFails: true });
    await expect(removeGeneratedStorageOrQueue(fixture.admin as never, [
      { bucket: "operator-drafts", path: "customer/materials/source.docx" },
    ], "generated_upload_failed")).rejects.toThrow("generated_storage_cleanup_unrecoverable");
  });
});

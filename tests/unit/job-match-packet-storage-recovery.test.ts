// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sha256 } from "@/lib/documents/job-match-packet/identity";
import { privateObjectMatchesChecksum } from "@/lib/documents/job-match-packet/storage-recovery";

describe("private packet object crash recovery", () => {
  it("accepts an already-uploaded object only when its checksum matches the render", async () => {
    const bytes = Uint8Array.from(Buffer.from("%PDF-1.7\nrecovery fixture"));
    const stored = new Blob([bytes], { type: "application/pdf" });

    await expect(privateObjectMatchesChecksum(stored, sha256(bytes))).resolves.toBe(true);
    await expect(privateObjectMatchesChecksum(stored, "0".repeat(64))).resolves.toBe(false);
  });
});

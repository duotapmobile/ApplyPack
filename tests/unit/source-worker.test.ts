import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { sourceRetryAt } from "@/lib/jobs/source-worker-policy";

describe("job source worker", () => {
  it("backs off exponentially and honors longer Retry-After values", () => {
    const now = new Date("2026-09-15T12:00:00.000Z");
    expect(sourceRetryAt(1, null, now)).toBe("2026-09-15T12:01:00.000Z");
    expect(sourceRetryAt(2, 600, now)).toBe("2026-09-15T12:10:00.000Z");
    expect(sourceRetryAt(20, 100_000, now)).toBe("2026-09-16T15:46:40.000Z");
  });

  it("keeps successful collection observation-only", () => {
    const collection = readFileSync(resolve(process.cwd(), "src/lib/jobs/source-collection.ts"), "utf8");
    expect(collection).toContain("job_source_run_listings");
    expect(collection).toContain("job_id: null");
    expect(collection).toContain("source_reference_id: null");
    expect(collection).toContain("job_snapshot_id: null");
    expect(collection).toContain("persisted_count: 0");
    expect(collection).toContain('projection_status: "observation_only"');
    expect(collection).not.toContain("persistNormalizedJob");
  });
});

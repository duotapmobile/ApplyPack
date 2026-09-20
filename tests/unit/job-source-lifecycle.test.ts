import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { decideMissingListingClosure } from "@/lib/jobs/source-lifecycle";

describe("job source missing-listing lifecycle", () => {
  it("never treats failed or bounded collection as closure evidence", () => {
    expect(decideMissingListingClosure({
      runSucceeded: false,
      inventorySnapshotComplete: true,
      consecutiveCompleteMisses: 10,
      minimumCompleteMisses: 2,
      withinVisibilityWindow: false,
    })).toEqual({ mayCloseMissing: false, reason: "run_not_successful" });

    expect(decideMissingListingClosure({
      runSucceeded: true,
      inventorySnapshotComplete: false,
      consecutiveCompleteMisses: 10,
      minimumCompleteMisses: 2,
      withinVisibilityWindow: false,
    })).toEqual({ mayCloseMissing: false, reason: "snapshot_not_authoritative_complete" });
  });

  it("requires an expired visibility window and repeated complete misses", () => {
    expect(decideMissingListingClosure({
      runSucceeded: true,
      inventorySnapshotComplete: true,
      consecutiveCompleteMisses: 2,
      minimumCompleteMisses: 2,
      withinVisibilityWindow: true,
    }).mayCloseMissing).toBe(false);

    expect(decideMissingListingClosure({
      runSucceeded: true,
      inventorySnapshotComplete: true,
      consecutiveCompleteMisses: 1,
      minimumCompleteMisses: 2,
      withinVisibilityWindow: false,
    }).mayCloseMissing).toBe(false);

    expect(decideMissingListingClosure({
      runSucceeded: true,
      inventorySnapshotComplete: true,
      consecutiveCompleteMisses: 2,
      minimumCompleteMisses: 2,
      withinVisibilityWindow: false,
    })).toEqual({ mayCloseMissing: true, reason: "confirmed_absent_after_complete_runs" });
  });

  it("keeps source collection out of customer workflows and queues admin refreshes", () => {
    const adminRoute = readFileSync(resolve(process.cwd(), "src/app/api/admin/job-sources/route.ts"), "utf8");
    const legacyWorkflow = readFileSync(resolve(process.cwd(), "src/lib/workflow/process.ts"), "utf8");

    expect(adminRoute).toContain("ap_enqueue_job_source_sync");
    expect(adminRoute).toContain("ap_set_job_source_schedule_state");
    expect(adminRoute).toContain("status: 202");
    expect(adminRoute).not.toContain("persistNormalizedJob");
    expect(adminRoute).not.toContain("enumerateJobs(");
    expect(legacyWorkflow).toContain("INDEPENDENT_SCHEDULED_ROTATION");
    expect(legacyWorkflow).not.toContain("createSourceAdapter");
    expect(legacyWorkflow).not.toContain("fetchJobs(");
  });
});

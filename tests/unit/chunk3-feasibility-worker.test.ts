import { describe, expect, it } from "vitest";
import { createCoveragePlan, type CoverageCell, type PersistedInventoryEvaluation } from "@/lib/matching/feasibility";
import { runFeasibilityWorker, type FeasibilityWorkerStore, type PersistedFeasibilityInput } from "@/lib/matching/feasibility-worker";

const completeCell = (change: Partial<CoverageCell> = {}): CoverageCell => ({ id: "cell", familyId: "family", sourceId: "manual-reviewed", authorizationState: "AUTHORIZED_MANUAL_ONLY", authorizationEvidenceId: "evidence-v1", path: "MANUAL", queryFingerprint: "f".repeat(64), paginationBound: 1, lookbackBound: 1, resultBound: 10, outcome: "SUCCEEDED_WITH_RESULTS", resultCount: 10, configuredBoundSatisfied: true, normalizedAndDeduplicated: true, manualChecklistComplete: true, parserResult: "COMPLETE", stopReason: "bound", ...change });
const input = (cell = completeCell(), currentSnapshotHash = "a".repeat(64)): PersistedFeasibilityInput => ({
  plan: createCoveragePlan({ id: "plan", inventoryVersionId: "inventory-v1", snapshotHash: "a".repeat(64), breadth: "ADJACENT_OPPORTUNITIES", requiredFamilyIds: ["family"], cells: [cell], versions: { source: "s", query: "q", inventory: "i", parser: "p", cutoff: "c" }, disposition: "REQUIRED", collisionProof: null }),
  inventory: Array.from({ length: 10 }, (_, index): PersistedInventoryEvaluation => ({ inventoryMemberId: `member-${index}`, inventoryVersionId: "inventory-v1", evaluationId: `evaluation-${index}`, snapshotId: "snapshot", jobSnapshotId: `job-${index}`, classification: "PRELIMINARILY_DELIVERABLE", resolutionBlocker: "NONE", exclusionReason: null })),
  currentSnapshotId: "snapshot",
  currentSnapshotHash,
  expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
});

function storeFor(payload: PersistedFeasibilityInput) {
  const events: string[] = [];
  const store: FeasibilityWorkerStore = {
    async claim(requestId, workerId) { events.push("claim"); return { requestId, snapshotId: "snapshot", draftId: "draft", workerId }; },
    async load() { events.push("load"); return payload; },
    async persistComplete(_claim, result) { events.push(`persist:${result.outcome}`); return "assessment"; },
    async complete() { events.push("complete"); },
    async defer() { events.push("defer"); },
    async markStale() { events.push("stale"); },
    async fail() { events.push("fail"); },
  };
  return { store, events };
}

describe("Chunk 3 feasibility worker transitions", () => {
  it("claims, calculates, persists, and completes a current likely assessment", async () => {
    const fake = storeFor(input());
    await expect(runFeasibilityWorker(fake.store, "request", "worker")).resolves.toMatchObject({ runState: "COMPLETE", outcome: "LIKELY", assessmentId: "assessment" });
    expect(fake.events).toEqual(["claim", "load", "persist:LIKELY", "complete"]);
  });

  it("defers retryable coverage and never fabricates an outcome", async () => {
    const fake = storeFor(input(completeCell({ outcome: "PENDING", parserResult: "PENDING", resultCount: null })));
    await expect(runFeasibilityWorker(fake.store, "request", "worker")).resolves.toMatchObject({ runState: "PENDING", outcome: null });
    expect(fake.events).toEqual(["claim", "load", "defer"]);
  });

  it("marks stale snapshots and errors result-changing defects", async () => {
    const stale = storeFor(input(completeCell(), "b".repeat(64)));
    await runFeasibilityWorker(stale.store, "request", "worker");
    expect(stale.events).toEqual(["claim", "load", "stale"]);
    const failed = storeFor(input(completeCell({ outcome: "PARSER_ERROR", parserResult: "ERROR" })));
    await runFeasibilityWorker(failed.store, "request", "worker");
    expect(failed.events).toEqual(["claim", "load", "fail"]);
  });
});

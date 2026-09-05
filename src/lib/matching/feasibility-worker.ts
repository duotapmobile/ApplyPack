import { assessFeasibility, type CoveragePlan, type InventoryEvaluation } from "@/lib/matching/feasibility";

export const FEASIBILITY_WORKER_VERSION = "feasibility-worker-v1";

export type ClaimedFeasibilityRequest = { requestId: string; snapshotId: string; draftId: string };
export type PersistedFeasibilityInput = {
  plan: CoveragePlan;
  inventory: readonly InventoryEvaluation[];
  currentSnapshotHash: string;
  resolutionBlocker: "NONE" | "NEEDS_CANDIDATE_INPUT" | "NEEDS_HUMAN_REVIEW";
  expiresAt: string;
};

export interface FeasibilityWorkerStore {
  claim(requestId: string, workerId: string): Promise<ClaimedFeasibilityRequest>;
  load(claim: ClaimedFeasibilityRequest): Promise<PersistedFeasibilityInput>;
  persistComplete(claim: ClaimedFeasibilityRequest, result: ReturnType<typeof assessFeasibility>, expiresAt: string, workerVersion: string): Promise<string>;
  complete(requestId: string, workerId: string, assessmentId: string): Promise<void>;
  defer(requestId: string, workerId: string, reason: string): Promise<void>;
  markStale(requestId: string, workerId: string, reason: string): Promise<void>;
  fail(requestId: string, workerId: string, errorCode: string): Promise<void>;
}

export async function runFeasibilityWorker(store: FeasibilityWorkerStore, requestId: string, workerId: string) {
  const claim = await store.claim(requestId, workerId);
  try {
    const input = await store.load(claim);
    const result = assessFeasibility(input);
    if (result.runState === "PENDING") {
      await store.defer(requestId, workerId, "COVERAGE_PENDING");
      return result;
    }
    if (result.runState === "STALE") {
      await store.markStale(requestId, workerId, "SNAPSHOT_NO_LONGER_ACTIVE");
      return result;
    }
    if (result.runState === "ERROR") {
      await store.fail(requestId, workerId, "FEASIBILITY_COVERAGE_ERROR");
      return result;
    }
    const assessmentId = await store.persistComplete(claim, result, input.expiresAt, FEASIBILITY_WORKER_VERSION);
    await store.complete(requestId, workerId, assessmentId);
    return { ...result, assessmentId };
  } catch (error) {
    await store.fail(requestId, workerId, error instanceof Error ? error.message.slice(0, 100) : "FEASIBILITY_WORKER_ERROR");
    throw error;
  }
}

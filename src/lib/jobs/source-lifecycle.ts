export type MissingListingClosureReason =
  | "run_not_successful"
  | "snapshot_not_authoritative_complete"
  | "verification_window_active"
  | "insufficient_complete_misses"
  | "confirmed_absent_after_complete_runs";

export type MissingListingClosureDecision = {
  mayCloseMissing: boolean;
  reason: MissingListingClosureReason;
};

/**
 * Absence is not closure evidence unless the provider response is explicitly
 * known to be a complete inventory snapshot. Current adapters are bounded, so
 * callers must pass inventorySnapshotComplete=false and retain unseen jobs for
 * the normal freshness and verification lifecycle.
 */
export function decideMissingListingClosure(input: {
  runSucceeded: boolean;
  inventorySnapshotComplete: boolean;
  consecutiveCompleteMisses: number;
  minimumCompleteMisses: number;
  withinVisibilityWindow: boolean;
}): MissingListingClosureDecision {
  if (!input.runSucceeded) return { mayCloseMissing: false, reason: "run_not_successful" };
  if (!input.inventorySnapshotComplete) {
    return { mayCloseMissing: false, reason: "snapshot_not_authoritative_complete" };
  }
  if (input.withinVisibilityWindow) return { mayCloseMissing: false, reason: "verification_window_active" };
  if (input.consecutiveCompleteMisses < input.minimumCompleteMisses) {
    return { mayCloseMissing: false, reason: "insufficient_complete_misses" };
  }
  return { mayCloseMissing: true, reason: "confirmed_absent_after_complete_runs" };
}

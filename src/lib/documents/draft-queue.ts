import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";

export const draftQueueStages = ["RENDER", "GENERATE", "PREPARE"] as const;
export type DraftQueueStage = typeof draftQueueStages[number];
export type DraftQueueControls = { enabled: boolean; generate: boolean; render: boolean };
const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const claimSchema = z.object({ id: uuid, customer_id: uuid, material_line_id: uuid, line_revision_id: uuid,
  source_snapshot_id: uuid, state: z.enum(["PREPARING", "READY", "SOURCE_READY"]), active_version_id: uuid.nullable(),
  lease_owner: uuid, lease_token: uuid, lease_generation: z.number().int().positive(), lease_expires_at: z.iso.datetime({ offset: true }) });
export type DraftQueueClaim = { jobId: string; ownerId: string; leaseToken: string };
export type DraftQueueServices = {
  // The service adapter calls the stage-filtered DB function once. A lost claim
  // response is uncertain, not an empty queue or authority to retry the claim.
  claim(stage: DraftQueueStage, workerId: string, signal: AbortSignal): Promise<unknown>;
  prepare(claim: DraftQueueClaim, signal: AbortSignal): Promise<unknown>;
  generate(claim: DraftQueueClaim, signal: AbortSignal): Promise<unknown>;
  render(claim: DraftQueueClaim, signal: AbortSignal): Promise<unknown>;
};
export type DraftQueueResult = {
  status: "DISABLED" | "COMPLETE" | "HELD" | "RESULT_UNKNOWN" | "FAILED";
  claimed: number; prepared: number; generated: number; rendered: number; held: number; unknown: number; failed: number;
};
const preparedSchema = z.object({ status: z.enum(["ATTACHED", "ALREADY_ATTACHED", "ATTACHED_AFTER_AMBIGUOUS_RESPONSE"]),
  jobId: uuid, versionId: uuid, payloadId: uuid, packetSha256: hash, contextSha256: hash });
const generatedSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("DISABLED") }),
  z.object({ status: z.literal("NOT_DISPATCHED"), code: z.string() }),
  z.object({ status: z.literal("RESULT_UNKNOWN"), requestId: uuid, code: z.string() }),
  z.object({ status: z.literal("SOURCE_READY"), requestId: uuid, versionId: uuid, sourceSha256: hash, reconciled: z.boolean() }),
]);
// Other worker fields are intentionally not returned in maintenance diagnostics.
const renderedSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("DISABLED") }),
  z.object({ status: z.literal("HELD"), code: z.string() }),
  z.object({ status: z.literal("RESULT_UNKNOWN"), code: z.string() }),
  z.object({ status: z.literal("REVIEW_READY"), jobId: uuid, versionId: uuid, memberSetSha256: hash,
    reconciled: z.boolean(), ownerReviewRequired: z.literal(true), deliveryAuthorized: z.literal(false) }),
]);
class QueueError extends Error {}

/** One claimed stage per invocation, bounded across all database/worker work.
 * Jobs awaiting a human decision are excluded by the stage-filtered claim RPC.
 * No provider retry, source promotion, wording review, approval or Send exists in
 * this orchestrator. Each worker rechecks live authority before its own writes. */
export async function processDraftQueue(services: DraftQueueServices, options: {
  controls: () => DraftQueueControls; signal?: AbortSignal; now?: () => Date;
}): Promise<DraftQueueResult> {
  const result: DraftQueueResult = { status: "COMPLETE", claimed: 0, prepared: 0, generated: 0, rendered: 0, held: 0, unknown: 0, failed: 0 };
  const enabled = (stage: DraftQueueStage) => { const current = options.controls(); return current.enabled
    && (stage === "PREPARE" || stage === "GENERATE" && current.generate || stage === "RENDER" && current.render); };
  if (!options.controls().enabled) return { ...result, status: "DISABLED" };
  const now = options.now ?? (() => new Date()), workerId = randomUUID(), controller = new AbortController(), signal = controller.signal;
  const abort = () => controller.abort(); options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, 150_000);
  let mutationPending = false;
  function check() { if (signal.aborted || !Number.isFinite(now().getTime())) throw new QueueError(); }
  async function call<T>(operation: () => Promise<T>): Promise<T> {
    check(); let stop: () => void = () => undefined;
    const interrupted = new Promise<never>((_, reject) => { stop = () => reject(new QueueError()); signal.addEventListener("abort", stop, { once: true }); });
    try { const value = await Promise.race([operation(), interrupted]); check(); return value; }
    finally { signal.removeEventListener("abort", stop); }
  }
  const held = () => { result.status = "HELD"; result.held = 1; return result; };
  try {
    for (const stage of draftQueueStages) {
      check(); if (!enabled(stage)) continue;
      mutationPending = true;
      const rows = z.array(claimSchema).max(1).parse(await call(() => services.claim(stage, workerId, signal)));
      mutationPending = false;
      if (rows.length === 0) continue;
      const row = rows[0];
      const expectedState = { PREPARE: "PREPARING", GENERATE: "READY", RENDER: "SOURCE_READY" }[stage];
      if (row.lease_owner !== workerId || Date.parse(row.lease_expires_at) <= now().getTime() || row.state !== expectedState
        || (stage === "PREPARE" ? row.active_version_id !== null : row.active_version_id === null)) {
        mutationPending = true; throw new QueueError();
      }
      result.claimed = 1;
      // A switch may be turned off while claiming. Let the lease expire; do not
      // start private reads/provider work or mutate another worker's ownership.
      if (!enabled(stage)) return held();
      const claim = { jobId: row.id, ownerId: workerId, leaseToken: row.lease_token };
      mutationPending = true;
      if (stage === "PREPARE") {
        const saved = preparedSchema.parse(await call(() => services.prepare(claim, signal)));
        if (saved.jobId !== row.id) throw new QueueError();
        result.prepared = 1;
      } else if (stage === "GENERATE") {
        const saved = generatedSchema.parse(await call(() => services.generate(claim, signal)));
        if (saved.status === "DISABLED" || saved.status === "NOT_DISPATCHED") return held();
        if (saved.status === "RESULT_UNKNOWN") { result.status = "RESULT_UNKNOWN"; result.unknown = 1; return result; }
        if (saved.versionId !== row.active_version_id) throw new QueueError();
        result.generated = 1;
      } else {
        const saved = renderedSchema.parse(await call(() => services.render(claim, signal)));
        if (saved.status === "DISABLED" || saved.status === "HELD") return held();
        if (saved.status === "RESULT_UNKNOWN") { result.status = "RESULT_UNKNOWN"; result.unknown = 1; return result; }
        if (saved.jobId !== row.id || saved.versionId !== row.active_version_id) throw new QueueError();
        result.rendered = 1;
      }
      mutationPending = false;
      return result;
    }
    return options.controls().enabled ? result : { ...result, status: "DISABLED" };
  } catch {
    // A timeout/transport failure may happen after a claim or worker commit.
    // Preserve its lease/payload/files and leave reconciliation to the DB worker.
    result.status = mutationPending ? "RESULT_UNKNOWN" : "FAILED";
    if (mutationPending) result.unknown = 1; else result.failed = 1;
    return result;
  } finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); controller.abort(); }
}

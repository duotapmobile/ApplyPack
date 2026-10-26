import { z } from "zod";
import { researchFamilies } from "./research";

export const RESEARCH_PREPARATION_VERSION = "automatic-research-preparation-v1";
export const preparationStates = ["QUEUED", "PREPARING", "COLLECTING", "OWNER_REVIEW", "READY", "COMPLETE", "MANUAL_RESEARCH", "EXCEPTION", "STALE"] as const;
export const preparationClaimSchema = z.object({
  id: z.uuid(), snapshot_id: z.uuid(), request_id: z.uuid(), snapshot_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  state: z.enum(preparationStates), lease_token: z.uuid(), policy_revision: z.number().int().positive(),
  plan_id: z.uuid().nullable(),
}).passthrough();
export type PreparationClaim = z.infer<typeof preparationClaimSchema>;
export type PreparationResult = { status: "DISABLED" | "IDLE" | "ADVANCED" | "RESULT_UNKNOWN"; processed: number };
export type PreparationPort = {
  claim(signal: AbortSignal): Promise<unknown>;
  load(claim: PreparationClaim, signal: AbortSignal): Promise<{ snapshot: Record<string, unknown>; facts: Record<string, unknown>[] }>;
  prepare(claim: PreparationClaim, families: ReturnType<typeof researchFamilies>["families"], signal: AbortSignal): Promise<void>;
  collect(claim: PreparationClaim, signal: AbortSignal): Promise<void>;
};

/** No source/provider permission is created here. One bounded local orchestration
 * stage consumes already-approved source schedules and waits for real human
 * attestations. An uncertain write is never automatically repeated in this run. */
export async function processResearchPreparation(port: PreparationPort, options: {
  enabled: boolean; signal?: AbortSignal; timeoutMs?: number;
}): Promise<PreparationResult> {
  if (!options.enabled) return { status: "DISABLED", processed: 0 };
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new Error("research_preparation_deadline_invalid");
  const controller = new AbortController(), cancel = () => controller.abort();
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const timer = setTimeout(cancel, timeoutMs);
  let interrupt = () => {};
  const stopped = new Promise<never>((_, reject) => {
    interrupt = () => reject(new Error("research_preparation_interrupted"));
    controller.signal.addEventListener("abort", interrupt, { once: true });
  });
  const bounded = async <T>(work: () => Promise<T>) => {
    controller.signal.throwIfAborted();
    const result = await Promise.race([work(), stopped]);
    controller.signal.throwIfAborted(); return result;
  };
  try {
    const raw = await bounded(() => port.claim(controller.signal));
    const claims = z.array(preparationClaimSchema).max(1).parse(raw);
    if (!claims.length) return { status: "IDLE", processed: 0 };
    const claim = claims[0];
    if (!claim.plan_id) {
      const input = await bounded(() => port.load(claim, controller.signal));
      if (input.snapshot.id !== claim.snapshot_id || input.snapshot.content_sha256 !== claim.snapshot_sha256
        || input.facts.length > 1000 || input.facts.some(fact => fact.snapshot_id !== claim.snapshot_id)) {
        throw new Error("research_preparation_snapshot_changed");
      }
      const built = researchFamilies(input.snapshot, input.facts, 1);
      // Never silently truncate customer duties or claim wider coverage.
      if (built.families.length > 100) throw new Error("research_preparation_family_bound");
      await bounded(() => port.prepare(claim, built.families, controller.signal));
    } else await bounded(() => port.collect(claim, controller.signal));
    return { status: "ADVANCED", processed: 1 };
  } catch { return { status: "RESULT_UNKNOWN", processed: 0 }; }
  finally {
    clearTimeout(timer); options.signal?.removeEventListener("abort", cancel);
    controller.signal.removeEventListener("abort", interrupt); controller.abort();
  }
}

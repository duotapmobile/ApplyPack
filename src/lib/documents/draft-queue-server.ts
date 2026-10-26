import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/database.types";
import { processDraftQueue, draftQueueStages, type DraftQueueControls, type DraftQueueServices } from "./draft-queue";
import { createDraftWorkflowServer } from "./draft-workflow-server";
import { attachDraftPacketForClaim } from "./draft-packet-worker";
import { generateDraftForClaim } from "./draft-generation-worker";
import { createDraftRenderServer } from "./draft-render-server";
import { renderDraftForClaim } from "./draft-render-worker";

type Admin = SupabaseClient<Database>;
type Options = { signal?: AbortSignal; now?: () => Date; uploadClientFactory: (signal: AbortSignal) => Admin | null };
export function draftQueueControls(): DraftQueueControls {
  return { enabled: process.env.APP_MATERIAL_DRAFT_QUEUE_ENABLED === "true",
    generate: process.env.APP_MATERIAL_DRAFTING_ENABLED === "true", render: process.env.APP_MATERIAL_DRAFT_RENDERING_ENABLED === "true" };
}
function ensure(value: unknown): asserts value { if (!value) throw new Error("DRAFT_QUEUE_UNCONFIRMED"); }

/** Typed094 composition, called only by authenticated maintenance after global
 * readiness gates. No provider call, data read or scheduling occurs on creation.
 * A claim has one20-second transport budget and is never retried here. */
export function createDraftQueueServer(admin: Admin, options: Options): DraftQueueServices {
  const now = options.now ?? (() => new Date());
  const workflow = createDraftWorkflowServer(admin, { now });
  const rendering = createDraftRenderServer(admin, { now, uploadClientFactory: options.uploadClientFactory });
  return {
    async claim(rawStage, rawWorkerId, parent) {
      const stage = z.enum(draftQueueStages).parse(rawStage), workerId = z.uuid().parse(rawWorkerId), controls = draftQueueControls();
      ensure(controls.enabled && (stage === "PREPARE" || stage === "GENERATE" && controls.generate || stage === "RENDER" && controls.render));
      const controller = new AbortController(), abort = () => controller.abort();
      parent.addEventListener("abort", abort, { once: true }); if (parent.aborted) abort();
      const timer = setTimeout(abort, 20_000); let interrupt: () => void = () => undefined;
      const stopped = new Promise<never>((_, reject) => { interrupt = () => reject(new Error("DRAFT_QUEUE_INTERRUPTED"));
        controller.signal.addEventListener("abort", interrupt, { once: true }); if (controller.signal.aborted) interrupt(); });
      try {
        ensure(!controller.signal.aborted);
        const receipt = await Promise.race([admin.rpc("ap_claim_material_draft_stage", { p_worker_id: workerId, p_stage: stage, p_limit: 1 })
          .abortSignal(controller.signal), stopped]);
        ensure(!controller.signal.aborted && !receipt.error); return receipt.data;
      } finally { clearTimeout(timer); parent.removeEventListener("abort", abort); controller.signal.removeEventListener("abort", interrupt); controller.abort(); }
    },
    prepare: (claim, signal) => {
      ensure(draftQueueControls().enabled && !signal.aborted);
      return attachDraftPacketForClaim(workflow.packet, claim, { signal, now });
    },
    generate: (claim, signal) => generateDraftForClaim(workflow.generation, claim,
      { enabled: draftQueueControls().enabled && draftQueueControls().generate, signal, now }),
    render: (claim, signal) => renderDraftForClaim(rendering, claim,
      { enabled: draftQueueControls().enabled && draftQueueControls().render, signal, now }),
  };
}

export async function processMaterialDraftQueue(admin: Admin, options: Options) {
  const services = createDraftQueueServer(admin, options);
  return processDraftQueue(services, { controls: draftQueueControls, signal: options.signal, now: options.now });
}

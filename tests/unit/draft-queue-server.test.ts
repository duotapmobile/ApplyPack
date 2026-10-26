import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const ports = vi.hoisted(() => ({ prepare: vi.fn(), generate: vi.fn(), render: vi.fn(), workflow: vi.fn(), rendering: vi.fn() }));
vi.mock("@/lib/documents/draft-workflow-server", () => ({ createDraftWorkflowServer: ports.workflow }));
vi.mock("@/lib/documents/draft-render-server", () => ({ createDraftRenderServer: ports.rendering }));
vi.mock("@/lib/documents/draft-packet-worker", () => ({ attachDraftPacketForClaim: ports.prepare }));
vi.mock("@/lib/documents/draft-generation-worker", () => ({ generateDraftForClaim: ports.generate }));
vi.mock("@/lib/documents/draft-render-worker", () => ({ renderDraftForClaim: ports.render }));
import { createDraftQueueServer, processMaterialDraftQueue } from "@/lib/documents/draft-queue-server";
const id = (n: number) => `78000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = new Date("2026-10-25T12:00:00.000Z"), hash = "a".repeat(64);
const packet = {}, generation = {}, rendering = {};
type Args = Database["public"]["Functions"]["ap_claim_material_draft_stage"]["Args"];
function fixture(stage = "PREPARE") {
  const calls: Array<{ name: string; args: Args; signal?: AbortSignal }> = [];
  let failure = false, wait: Promise<unknown> | undefined;
  const admin = { rpc: (name: string, args: Args) => {
    const call: typeof calls[number] = { name, args }; calls.push(call);
    return { abortSignal: (signal: AbortSignal) => {
      call.signal = signal;
      if (wait) return wait;
      return Promise.resolve({ data: failure ? null : args.p_stage !== stage ? [] : [{ id: id(1), customer_id: id(2), material_line_id: id(3),
        line_revision_id: id(4), source_snapshot_id: id(5), state: { PREPARE: "PREPARING", GENERATE: "READY", RENDER: "SOURCE_READY" }[stage],
        active_version_id: stage === "PREPARE" ? null : id(6), lease_owner: args.p_worker_id, lease_token: id(7), lease_generation: 1,
        lease_expires_at: "2026-10-25T12:05:00.000Z" }], error: failure ? { message: "PRIVATE_DATABASE_DETAIL" } : null });
    } };
  } } as unknown as SupabaseClient<Database>;
  const uploadClientFactory = vi.fn(() => admin), options = { now: () => now, uploadClientFactory };
  return { admin, calls, options, fail: () => { failure = true; }, hang: () => { wait = new Promise(() => undefined); },
    run: (signal?: AbortSignal) => processMaterialDraftQueue(admin, { ...options, signal }) };
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("APP_MATERIAL_DRAFT_QUEUE_ENABLED", "true"); vi.stubEnv("APP_MATERIAL_DRAFTING_ENABLED", "true"); vi.stubEnv("APP_MATERIAL_DRAFT_RENDERING_ENABLED", "true");
  ports.workflow.mockReturnValue({ packet, generation }); ports.rendering.mockReturnValue(rendering);
  ports.prepare.mockResolvedValue({ status: "ATTACHED", jobId: id(1), versionId: id(6), payloadId: id(8), packetSha256: hash, contextSha256: hash });
  ports.generate.mockResolvedValue({ status: "SOURCE_READY", requestId: id(9), versionId: id(6), sourceSha256: hash, reconciled: false });
  ports.render.mockResolvedValue({ status: "REVIEW_READY", jobId: id(1), versionId: id(6), memberSetSha256: hash, reconciled: false, ownerReviewRequired: true, deliveryAuthorized: false });
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
describe("typed stage queue composition", () => {
  it("constructs without database, upload or worker work and remains dormant by default", async () => {
    const f = fixture(); createDraftQueueServer(f.admin, f.options); expect(f.calls).toHaveLength(0); expect(f.options.uploadClientFactory).not.toHaveBeenCalled();
    vi.stubEnv("APP_MATERIAL_DRAFT_QUEUE_ENABLED", "false"); expect(await f.run()).toMatchObject({ status: "DISABLED", claimed: 0 });
    expect(f.calls).toHaveLength(0); expect(ports.prepare).not.toHaveBeenCalled(); expect(ports.generate).not.toHaveBeenCalled(); expect(ports.render).not.toHaveBeenCalled();
  });
  it.each(["PREPARE", "GENERATE", "RENDER"])("claims at most one %s job with the actual094 signature and dispatches the exact lease", async (stage) => {
    const f = fixture(stage); expect(await f.run()).toMatchObject({ status: "COMPLETE", claimed: 1, prepared: Number(stage === "PREPARE"), generated: Number(stage === "GENERATE"), rendered: Number(stage === "RENDER") });
    expect(f.calls.every((call) => call.name === "ap_claim_material_draft_stage" && call.args.p_limit === 1 && call.signal?.aborted)).toBe(true);
    const worker = stage === "PREPARE" ? ports.prepare : stage === "GENERATE" ? ports.generate : ports.render;
    expect(worker).toHaveBeenCalledOnce(); expect(worker.mock.calls[0][0]).toBe(stage === "PREPARE" ? packet : stage === "GENERATE" ? generation : rendering);
    expect(worker.mock.calls[0][1]).toEqual({ jobId: id(1), ownerId: f.calls[0].args.p_worker_id, leaseToken: id(7) });
    expect(worker.mock.calls[0][2]).toMatchObject({ signal: expect.any(AbortSignal), now: f.options.now });
    expect(ports.prepare.mock.calls.length + ports.generate.mock.calls.length + ports.render.mock.calls.length).toBe(1);
  });
  it("prepares evidence without enabling provider generation or rendering", async () => {
    vi.stubEnv("APP_MATERIAL_DRAFTING_ENABLED", "false"); vi.stubEnv("APP_MATERIAL_DRAFT_RENDERING_ENABLED", "false");
    const f = fixture(); expect(await f.run()).toMatchObject({ status: "COMPLETE", prepared: 1 });
    expect(f.calls.map((call) => call.args.p_stage)).toEqual(["PREPARE"]); expect(ports.generate).not.toHaveBeenCalled(); expect(ports.render).not.toHaveBeenCalled();
  });
  it("reports uncertain claim transport without repeating a mutation or exposing the database error", async () => {
    const f = fixture(); f.fail(); const result = await f.run(); expect(result).toMatchObject({ status: "RESULT_UNKNOWN", unknown: 1 });
    expect(f.calls).toHaveLength(1); expect(JSON.stringify(result)).not.toContain("PRIVATE"); expect(ports.prepare).not.toHaveBeenCalled();
  });
  it("cancels a hanging claim at its own20-second deadline", async () => {
    vi.useFakeTimers(); const f = fixture(); f.hang(); const pending = f.run(); await vi.advanceTimersByTimeAsync(20_001);
    expect(await pending).toMatchObject({ status: "RESULT_UNKNOWN", unknown: 1 }); expect(f.calls).toHaveLength(1); expect(f.calls[0].signal?.aborted).toBe(true);
  });
  it("never claims after the maintenance request is canceled", async () => {
    const f = fixture(), controller = new AbortController(); controller.abort(); expect(await f.run(controller.signal)).toMatchObject({ status: "FAILED", failed: 1 });
    expect(f.calls).toHaveLength(0);
  });
  it("rechecks a disabled provider switch on the direct generation port", async () => {
    const f = fixture(), service = createDraftQueueServer(f.admin, f.options); vi.stubEnv("APP_MATERIAL_DRAFTING_ENABLED", "false");
    await service.generate({ jobId: id(1), ownerId: id(2), leaseToken: id(7) }, new AbortController().signal);
    expect(ports.generate.mock.calls[0][2].enabled).toBe(false); expect(f.calls).toHaveLength(0);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { processDraftQueue, type DraftQueueControls, type DraftQueueServices, type DraftQueueStage } from "@/lib/documents/draft-queue";
const id = (n: number) => `79000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = new Date("2026-10-25T12:00:00Z"), future = "2026-10-25T12:05:00Z", digest = "a".repeat(64);
function fixture() {
  const controls: DraftQueueControls = { enabled: true, generate: true, render: true };
  let available: DraftQueueStage | null = "PREPARE";
  const row = { id: id(1), customer_id: id(2), material_line_id: id(3), line_revision_id: id(4), source_snapshot_id: id(5),
    state: "PREPARING", active_version_id: null as string | null, lease_owner: id(6), lease_token: id(7), lease_generation: 1, lease_expires_at: future };
  const services = {
    claim: vi.fn(async (stage: DraftQueueStage, owner: string) => stage === available ? [{ ...row, lease_owner: owner }] : []),
    prepare: vi.fn(async () => ({ status: "ATTACHED", jobId: row.id, versionId: id(8), payloadId: id(9), packetSha256: digest, contextSha256: digest })),
    generate: vi.fn(async (): Promise<unknown> => ({ status: "SOURCE_READY", requestId: id(10), versionId: id(8), sourceSha256: digest, reconciled: false })),
    render: vi.fn(async (): Promise<unknown> => ({ status: "REVIEW_READY", jobId: row.id, versionId: id(8), memberSetSha256: digest,
      reconciled: false, ownerReviewRequired: true, deliveryAuthorized: false })),
  } satisfies DraftQueueServices;
  const options = { controls: () => controls, now: () => at };
  return { controls, row, services, options, stage(stage: DraftQueueStage | null) { available = stage; row.state = stage === "RENDER" ? "SOURCE_READY" : stage === "GENERATE" ? "READY" : "PREPARING"; row.active_version_id = stage && stage !== "PREPARE" ? id(8) : null; } };
}
afterEach(() => vi.useRealTimers());
describe("bounded document stage scheduling", () => {
  it("performs no claim or worker call when the queue is disabled", async () => {
    const f = fixture(); f.controls.enabled = false;
    expect(await processDraftQueue(f.services, f.options)).toMatchObject({ status: "DISABLED", claimed: 0 });
    for (const call of Object.values(f.services)) expect(call).not.toHaveBeenCalled();
  });
  it("claims preparation without consulting disabled provider or render stages", async () => {
    const f = fixture(); f.controls.generate = false; f.controls.render = false;
    expect(await processDraftQueue(f.services, f.options)).toMatchObject({ status: "COMPLETE", claimed: 1, prepared: 1, generated: 0, rendered: 0 });
    expect(f.services.claim.mock.calls.map(args => args[0])).toEqual(["PREPARE"]);
    expect(f.services.generate).not.toHaveBeenCalled(); expect(f.services.render).not.toHaveBeenCalled();
  });
  it.each(["RENDER", "GENERATE", "PREPARE"] as const)("runs only one ready %s stage and returns metadata counts", async stage => {
    const f = fixture(); f.stage(stage);
    const result = await processDraftQueue(f.services, f.options);
    expect(result).toEqual({ status: "COMPLETE", claimed: 1, prepared: Number(stage === "PREPARE"), generated: Number(stage === "GENERATE"),
      rendered: Number(stage === "RENDER"), held: 0, unknown: 0, failed: 0 });
    expect(f.services.prepare.mock.calls.length + f.services.generate.mock.calls.length + f.services.render.mock.calls.length).toBe(1);
    expect(JSON.stringify(result)).not.toContain(id(1)); expect(JSON.stringify(result)).not.toContain(digest);
    expect(f.services.claim.mock.calls.every(call => call[1] === f.services.claim.mock.calls[0][1])).toBe(true);
  });
  it("checks at most the three stages when there is no eligible work", async () => {
    const f = fixture(); f.stage(null);
    expect(await processDraftQueue(f.services, f.options)).toMatchObject({ status: "COMPLETE", claimed: 0 });
    expect(f.services.claim.mock.calls.map(args => args[0])).toEqual(["RENDER", "GENERATE", "PREPARE"]);
    expect(f.services.prepare).not.toHaveBeenCalled();
  });
  it("stops before private worker reads when the stage switch changes during claiming", async () => {
    const f = fixture(); f.stage("GENERATE"); const claim = f.services.claim.getMockImplementation()!;
    f.services.claim.mockImplementation(async (stage, owner) => { const rows = await claim(stage, owner); if (stage === "GENERATE") f.controls.generate = false; return rows; });
    expect(await processDraftQueue(f.services, f.options)).toMatchObject({ status: "HELD", claimed: 1, held: 1 });
    expect(f.services.generate).not.toHaveBeenCalled(); expect(f.services.prepare).not.toHaveBeenCalled();
  });
  it("does not retry a lost claim response or touch a second stage", async () => {
    const f = fixture(); f.services.claim.mockRejectedValue(new Error("private provider data"));
    const result = await processDraftQueue(f.services, f.options);
    expect(result).toMatchObject({ status: "RESULT_UNKNOWN", unknown: 1, claimed: 0 });
    expect(f.services.claim).toHaveBeenCalledOnce(); expect(f.services.render).not.toHaveBeenCalled(); expect(JSON.stringify(result)).not.toContain("private");
  });
  it.each(["wrong owner", "expired lease", "wrong stage", "wrong active version", "two rows", "invalid UUID", "invalid generation"])("rejects %s without starting a worker", async mode => {
    const f = fixture(); f.stage("RENDER");
    f.services.claim.mockImplementation(async (_stage, owner) => {
      const row = { ...f.row, lease_owner: owner };
      if (mode === "wrong owner") row.lease_owner = id(99);
      if (mode === "expired lease") row.lease_expires_at = at.toISOString();
      if (mode === "wrong stage") row.state = "READY";
      if (mode === "wrong active version") row.active_version_id = null;
      if (mode === "invalid UUID") row.id = "private data";
      if (mode === "invalid generation") row.lease_generation = 0;
      return mode === "two rows" ? [row, row] : [row];
    });
    expect(await processDraftQueue(f.services, f.options)).toMatchObject({ status: "RESULT_UNKNOWN", unknown: 1 });
    expect(f.services.render).not.toHaveBeenCalled(); expect(f.services.claim).toHaveBeenCalledOnce();
  });
  it("rejects an active version in a first-packet claim", async () => {
    const f = fixture(); f.row.active_version_id = id(8);
    expect(await processDraftQueue(f.services, f.options)).toMatchObject({ status: "RESULT_UNKNOWN" }); expect(f.services.prepare).not.toHaveBeenCalled();
  });
  it("does not continue after a worker response is lost", async () => {
    const f = fixture(); f.stage("RENDER"); f.services.render.mockRejectedValue(new Error("private file path"));
    expect(await processDraftQueue(f.services, f.options)).toMatchObject({ status: "RESULT_UNKNOWN", claimed: 1, unknown: 1 });
    expect(f.services.claim).toHaveBeenCalledOnce(); expect(f.services.render).toHaveBeenCalledOnce();
  });
  it.each(["DISABLED", "NOT_DISPATCHED"])("preserves a generation %s hold without another attempt", async status => {
    const f = fixture(); f.stage("GENERATE"); f.services.generate.mockResolvedValue({ status, code: "private payload" });
    const result = await processDraftQueue(f.services, f.options);
    expect(result).toMatchObject({ status: "HELD", held: 1, generated: 0 }); expect(JSON.stringify(result)).not.toContain("private");
    expect(f.services.generate).toHaveBeenCalledOnce(); expect(f.services.prepare).not.toHaveBeenCalled();
  });
  it("reports a reserved provider outcome as unknown without retry", async () => {
    const f = fixture(); f.stage("GENERATE"); f.services.generate.mockResolvedValue({ status: "RESULT_UNKNOWN", requestId: id(10), code: "TRANSPORT_UNCONFIRMED" });
    expect(await processDraftQueue(f.services, f.options)).toMatchObject({ status: "RESULT_UNKNOWN", unknown: 1 }); expect(f.services.generate).toHaveBeenCalledOnce();
  });
  it.each(["HELD", "DISABLED", "RESULT_UNKNOWN"])("preserves the rendering %s result without upload/commit retry", async status => {
    const f = fixture(); f.stage("RENDER"); f.services.render.mockResolvedValue({ status, code: "UNCONFIRMED" });
    expect(await processDraftQueue(f.services, f.options)).toMatchObject({ status: status === "RESULT_UNKNOWN" ? status : "HELD", rendered: 0 });
    expect(f.services.render).toHaveBeenCalledOnce(); expect(f.services.claim).toHaveBeenCalledOnce();
  });
  it.each(["wrong version", "wrong job", "delivery authorized", "review skipped"])("rejects rendered receipt: %s", async mode => {
    const f = fixture(); f.stage("RENDER"); f.services.render.mockResolvedValue({ status: "REVIEW_READY", jobId: mode === "wrong job" ? id(99) : id(1),
      versionId: mode === "wrong version" ? id(99) : id(8), memberSetSha256: digest, reconciled: false,
      ownerReviewRequired: mode !== "review skipped", deliveryAuthorized: mode === "delivery authorized" });
    expect(await processDraftQueue(f.services, f.options)).toMatchObject({ status: "RESULT_UNKNOWN", rendered: 0 });
  });
  it("rejects a generated source receipt for another saved version", async () => {
    const f = fixture(); f.stage("GENERATE"); f.services.generate.mockResolvedValue({ status: "SOURCE_READY", requestId: id(10), versionId: id(99), sourceSha256: digest, reconciled: false });
    expect(await processDraftQueue(f.services, f.options)).toMatchObject({ status: "RESULT_UNKNOWN", generated: 0 });
  });
  it("rejects a packet receipt belonging to another job", async () => {
    const f = fixture(); const receipt = await f.services.prepare(); f.services.prepare.mockResolvedValue({ ...receipt, jobId: id(99) });
    expect(await processDraftQueue(f.services, f.options)).toMatchObject({ status: "RESULT_UNKNOWN", prepared: 0 });
  });
  it("starts no work with an already aborted signal", async () => {
    const f = fixture(); const signal = AbortSignal.abort();
    expect(await processDraftQueue(f.services, { ...f.options, signal })).toMatchObject({ status: "FAILED", failed: 1 }); expect(f.services.claim).not.toHaveBeenCalled();
  });
  it("bounds a stuck claim and aborts its signal without another claim", async () => {
    vi.useFakeTimers(); const f = fixture(); let signal: AbortSignal | undefined;
    const claim: DraftQueueServices["claim"] = async (_stage, _worker, child) => { signal = child; return new Promise(() => {}); };
    const services = { ...f.services, claim: vi.fn(claim) };
    const pending = processDraftQueue(services, f.options); await vi.advanceTimersByTimeAsync(150_001);
    expect(await pending).toMatchObject({ status: "RESULT_UNKNOWN", unknown: 1 }); expect(signal?.aborted).toBe(true); expect(services.claim).toHaveBeenCalledOnce();
  });
  it("propagates interruption during a worker and never starts the next stage", async () => {
    const f = fixture(); f.stage("RENDER"); const controller = new AbortController(); let signal: AbortSignal | undefined;
    const render: DraftQueueServices["render"] = async (_claim, child) => { signal = child; controller.abort(); return new Promise(() => {}); };
    const pending = processDraftQueue({ ...f.services, render }, { ...f.options, signal: controller.signal });
    expect(await pending).toMatchObject({ status: "RESULT_UNKNOWN", unknown: 1 }); expect(signal?.aborted).toBe(true); expect(f.services.claim).toHaveBeenCalledOnce();
  });
  it("fails before a claim with an invalid clock", async () => {
    const f = fixture(); expect(await processDraftQueue(f.services, { ...f.options, now: () => new Date(NaN) })).toMatchObject({ status: "FAILED" });
    expect(f.services.claim).not.toHaveBeenCalled();
  });
});

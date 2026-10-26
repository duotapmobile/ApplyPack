import { afterEach, describe, expect, it, vi } from "vitest";
import { processResearchPreparation, type PreparationPort } from "@/lib/matching/research-preparation";
const id = (n: number) => `a1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture(plan = false) {
  const claim = { id: id(1), snapshot_id: id(2), request_id: id(3), snapshot_sha256: "a".repeat(64),
    state: "PREPARING", lease_token: id(4), policy_revision: 1, plan_id: plan ? id(5) : null };
  const port = { claim: vi.fn().mockResolvedValue([claim]), load: vi.fn().mockResolvedValue({
    snapshot: { id: claim.snapshot_id, content_sha256: claim.snapshot_sha256, search_breadth: "ADJACENT_OPPORTUNITIES",
      desired_activities: ["Helping customers"], work_modes: ["REMOTE"], us_state_or_dc: "VA", employment_types: ["FULL_TIME"] }, facts: [],
  }), prepare: vi.fn().mockResolvedValue(undefined), collect: vi.fn().mockResolvedValue(undefined) } satisfies PreparationPort;
  return { port, claim };
}
afterEach(() => vi.useRealTimers());
describe("bounded research preparation", () => {
  it("does no work when disabled", async () => {
    const f = fixture(); expect(await processResearchPreparation(f.port, { enabled: false })).toEqual({ status: "DISABLED", processed: 0 });
    expect(f.port.claim).not.toHaveBeenCalled();
  });
  it("creates a responsibility-based plan without manufacturing owner verification", async () => {
    const f = fixture(); expect(await processResearchPreparation(f.port, { enabled: true })).toEqual({ status: "ADVANCED", processed: 1 });
    const [claim, families] = f.port.prepare.mock.calls[0];
    expect(claim.snapshot_id).toBe(id(2)); expect(families[0].responsibilities).toEqual(["Helping customers"]);
    expect(families[0].neutral).toBe(true); expect(f.port.collect).not.toHaveBeenCalled();
  });
  it("resumes an existing plan without rebuilding it or re-reading private facts", async () => {
    const f = fixture(true); await processResearchPreparation(f.port, { enabled: true });
    expect(f.port.collect).toHaveBeenCalledOnce(); expect(f.port.load).not.toHaveBeenCalled(); expect(f.port.prepare).not.toHaveBeenCalled();
  });
  it.each(["id", "content_sha256"])("rejects changed snapshot %s before plan persistence", async field => {
    const f = fixture(); const input = await f.port.load(); input.snapshot[field] = "changed";
    expect((await processResearchPreparation(f.port, { enabled: true })).status).toBe("RESULT_UNKNOWN");
    expect(f.port.prepare).not.toHaveBeenCalled();
  });
  it("rejects a mixed-customer fact set", async () => {
    const f = fixture(); const input = await f.port.load(); input.facts.push({ snapshot_id: id(99) });
    expect((await processResearchPreparation(f.port, { enabled: true })).status).toBe("RESULT_UNKNOWN"); expect(f.port.prepare).not.toHaveBeenCalled();
  });
  it.each([null, {}, [null], [fixture().claim, fixture().claim]])("rejects malformed or multiple claims %j", async raw => {
    const f = fixture(); f.port.claim.mockResolvedValue(raw);
    expect((await processResearchPreparation(f.port, { enabled: true })).status).toBe("RESULT_UNKNOWN"); expect(f.port.load).not.toHaveBeenCalled();
  });
  it("does not retry an ambiguous plan write", async () => {
    const f = fixture(); f.port.prepare.mockRejectedValue(new Error("private database detail"));
    expect(await processResearchPreparation(f.port, { enabled: true })).toEqual({ status: "RESULT_UNKNOWN", processed: 0 });
    expect(f.port.prepare).toHaveBeenCalledOnce();
  });
  it("a timed-out load cannot proceed to a late plan write", async () => {
    vi.useFakeTimers(); const f = fixture(); let finish!: (v: unknown) => void;
    f.port.load.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const result = processResearchPreparation(f.port, { enabled: true, timeoutMs: 10 });
    await vi.advanceTimersByTimeAsync(11); expect((await result).status).toBe("RESULT_UNKNOWN");
    finish({ snapshot: {}, facts: [] }); await Promise.resolve(); expect(f.port.prepare).not.toHaveBeenCalled();
  });
});

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { processServiceRetention } from "@/lib/files/service-retention";

const claimId = "88000000-0000-4000-8000-000000000001";
const target = (index = 1, path = `customer/test-${index}.pdf`) => ({
  id: `88100000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  bucket: "customer-source-documents", path, pathSha256: createHash("sha256").update(path).digest("hex"),
});
function fixture(objects = [target()]) {
  const pending = new Map(objects.map((item) => [item.id, item]));
  const remove = vi.fn().mockResolvedValue({ data: [], error: null });
  const exists = vi.fn().mockResolvedValue({ data: false, error: { status: 404 } });
  const rpc = vi.fn(async (name: string, args: Record<string, string>): Promise<{ data: unknown; error: { code: string } | null }> => {
    if (name === "ap_claim_expired_service_retention") return { data: [{ claimId, objects: [...pending.values()] }], error: null };
    if (name === "ap_authorize_service_retention_object") return { data: pending.get(args.p_object_id), error: null };
    if (name === "ap_finish_service_retention_object") { pending.delete(args.p_object_id); return { data: true, error: null }; }
    if (name === "ap_finish_service_retention_claim") return { data: pending.size === 0, error: null };
    throw new Error("unexpected_rpc");
  });
  const admin = { rpc, storage: { from: vi.fn(() => ({ remove, exists })) } };
  return { admin: () => admin as unknown as SupabaseClient, rpc, remove, exists, pending };
}
describe("one-off service retention maintenance", () => {
  afterEach(() => vi.useRealTimers());
  it("authorizes each exact object, acknowledges successful removal, and completes the claim", async () => {
    const f = fixture();
    expect(await processServiceRetention(f.admin)).toEqual({ claimed: 1, attempted: 1, deleted: 1, completed: 1, failed: 0 });
    expect(f.remove).toHaveBeenCalledWith([target().path]);
    expect(f.rpc.mock.calls.map(([name]) => name)).toEqual(["ap_claim_expired_service_retention", "ap_authorize_service_retention_object", "ap_finish_service_retention_object", "ap_finish_service_retention_claim"]);
  });
  it("never acknowledges failed or ambiguous removal and retries the original durable object", async () => {
    const f = fixture(); f.remove.mockRejectedValueOnce(new Error("connection_lost"));
    expect(await processServiceRetention(f.admin)).toMatchObject({ deleted: 0, completed: 0, failed: 1 });
    expect(f.pending.size).toBe(1);
    expect(f.rpc.mock.calls.some(([name]) => name === "ap_finish_service_retention_object")).toBe(false);
    expect(await processServiceRetention(f.admin)).toMatchObject({ deleted: 1, completed: 1, failed: 0 });
  });
  it("keeps a lost acknowledgement pending so an idempotent removal can be finalized on retry", async () => {
    const f = fixture(); const original = f.rpc.getMockImplementation()!;
    let failed = false;
    f.rpc.mockImplementation(async (name, args) => {
      if (name === "ap_finish_service_retention_object" && !failed) { failed = true; return { data: null, error: { code: "lost_response" } }; }
      return original(name, args);
    });
    expect(await processServiceRetention(f.admin)).toMatchObject({ deleted: 0, completed: 0, failed: 1 });
    expect(await processServiceRetention(f.admin)).toMatchObject({ deleted: 1, completed: 1, failed: 0 });
  });
  it.each(["../customer.pdf", "customer//test.pdf", "customer/%2e%2e/test.pdf", "customer\\test.pdf", "customer/test.pdf?token=x"])("rejects the whole list before deleting anything when a path is unsafe: %s", async (path) => {
    const f = fixture([target(), target(2, path)]);
    await expect(processServiceRetention(f.admin)).rejects.toThrow("service_retention_claim_invalid");
    expect(f.remove).not.toHaveBeenCalled();
  });
  it("rejects an unknown bucket and a path hash mismatch before deletion", async () => {
    for (const item of [{ ...target(), bucket: "public" }, { ...target(), pathSha256: "a".repeat(64) }]) {
      const f = fixture([item]);
      await expect(processServiceRetention(f.admin)).rejects.toThrow("service_retention_claim_invalid");
      expect(f.remove).not.toHaveBeenCalled();
    }
  });
  it("does not remove an object when the immediate authorization is denied or changes identity", async () => {
    const f = fixture(); const original = f.rpc.getMockImplementation()!;
    f.rpc.mockImplementation(async (name, args) => name === "ap_authorize_service_retention_object"
      ? { data: target(2), error: null } : original(name, args));
    expect(await processServiceRetention(f.admin)).toMatchObject({ deleted: 0, failed: 1 });
    expect(f.remove).not.toHaveBeenCalled();
  });
  it("caps removal at twenty and leaves the rest durable for the next maintenance cycle", async () => {
    const f = fixture(Array.from({ length: 23 }, (_, index) => target(index + 1)));
    expect(await processServiceRetention(f.admin)).toMatchObject({ attempted: 20, deleted: 20, completed: 0 });
    expect(f.pending.size).toBe(3);
    expect(await processServiceRetention(f.admin)).toMatchObject({ attempted: 3, deleted: 3, completed: 1 });
  });
  it("reports a malformed finalization response as failed without claiming completion", async () => {
    const f = fixture(); const original = f.rpc.getMockImplementation()!;
    f.rpc.mockImplementation(async (name, args) => name === "ap_finish_service_retention_claim"
      ? { data: null, error: null } : original(name, args));
    expect(await processServiceRetention(f.admin)).toMatchObject({ deleted: 1, completed: 0, failed: 1 });
  });
  it.each([null, {}, [{ name: "different-object.pdf" }], [{ name: target().path, bucket_id: "public" }]])("rejects malformed or mismatched removal acknowledgements (%j)", async (data) => {
    const f = fixture(); f.remove.mockResolvedValue({ data, error: null });
    expect(await processServiceRetention(f.admin)).toMatchObject({ deleted: 0, failed: 1 });
    expect(f.exists).not.toHaveBeenCalled();
    expect(f.pending.size).toBe(1);
  });
  it.each([{ data: true, error: null }, { data: false, error: { status: 400 } }, { data: false, error: { status: 403 } }, { data: false, error: null }])("requires authenticated exact-path absence, not an ambiguous status (%j)", async (result) => {
    const f = fixture(); f.exists.mockResolvedValue(result);
    expect(await processServiceRetention(f.admin)).toMatchObject({ deleted: 0, failed: 1 });
    expect(f.pending.size).toBe(1);
  });
  it.each(["claim", "remove"])("aborts a stalled %s and never finalizes a late response", async (stage) => {
    vi.useFakeTimers(); const f = fixture();
    let resolveLate: (value: { data: unknown; error: null }) => void = () => {};
    const late = new Promise<{ data: unknown; error: null }>((resolve) => { resolveLate = resolve; });
    if (stage === "claim") f.rpc.mockImplementationOnce(() => late); else f.remove.mockReturnValueOnce(late);
    let signal: AbortSignal | undefined;
    const execution = processServiceRetention((value) => { signal = value; return f.admin(); }, { timeoutMs: 50 });
    const rejected = expect(execution).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(51); await rejected;
    expect(signal?.aborted).toBe(true);
    resolveLate(stage === "claim" ? { data: [{ claimId, objects: [target()] }], error: null } : { data: [], error: null });
    await vi.advanceTimersByTimeAsync(1);
    expect(f.rpc.mock.calls.some(([name]) => name.startsWith("ap_finish_"))).toBe(false);
    expect(f.pending.size).toBe(1);
  });
});

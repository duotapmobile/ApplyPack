import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createDraftChangePort } from "@/lib/documents/draft-change-supabase";
const id = (n: number) => `97000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = "a".repeat(64), signal = () => new AbortController().signal;
const row = { id: id(1), customer_id: id(2), material_line_id: id(3), job_id: id(4), parent_version_id: id(5), successor_version_id: id(6),
  encrypted_payload_id: id(7), request_sha256: hash, payload_sha256: hash, parent_source_sha256: hash, parent_proposal_sha256: hash,
  packet_sha256: hash, context_sha256: hash, reviewer_id: id(8), created_at: "2026-10-25T12:00:00Z" };
const commit: Database["public"]["Functions"]["ap_request_material_draft_changes"]["Args"] = {
  p_job_id: row.job_id, p_expected_version_id: row.parent_version_id, p_expected_source_sha256: hash, p_request_id: row.id,
  p_payload_id: row.encrypted_payload_id, p_request_sha256: hash, p_payload_sha256: hash, p_parent_proposal_sha256: hash, p_reviewer_id: row.reviewer_id,
};
const reserve: Database["public"]["Functions"]["ap_begin_material_draft_request_with_changes"]["Args"] = {
  p_job_id: row.job_id, p_lease_token: id(9), p_version_id: row.successor_version_id, p_request_id: id(10), p_policy_id: id(11),
  p_input_token_cap: 2000, p_output_token_cap: 1000, p_change_request_id: row.id, p_change_payload_sha256: hash,
};
type Call = { name: string; args?: unknown; columns?: string; filters: Array<[string, unknown]>; signal?: AbortSignal; maybeSingle?: boolean };
function fixture(initial: unknown = row) {
  const calls: Call[] = [];
  let result: { data: unknown; error: unknown } = { data: initial, error: null };
  let operation: (() => Promise<typeof result>) | undefined;
  const query = (call: Call) => {
    calls.push(call);
    const run = () => operation ? operation() : Promise.resolve(result);
    const q = { select: (columns: string) => { call.columns = columns; return q; }, eq: (name: string, value: unknown) => { call.filters.push([name, value]); return q; },
      abortSignal: (value: AbortSignal) => { call.signal = value; return q; }, maybeSingle: () => { call.maybeSingle = true; return run(); },
      then: (resolve: (value: typeof result) => unknown, reject?: (value: unknown) => unknown) => run().then(resolve, reject) };
    return q;
  };
  const admin = { from: (name: string) => query({ name, filters: [] }), rpc: (name: string, args: unknown) => query({ name, args, filters: [] }) } as unknown as SupabaseClient<Database>;
  return { calls, admin, port: createDraftChangePort(admin), set: (data: unknown, error: unknown = null) => { result = { data, error }; },
    run: (fn: () => Promise<typeof result>) => { operation = fn; } };
}
afterEach(() => vi.useRealTimers());
describe("actual097 Supabase request-change transport", () => {
  it("constructs without database or provider access", () => { expect(fixture().calls).toEqual([]); });
  it("reads only the exact immutable request metadata with abort and nullable absence", async () => {
    const f = fixture(); expect(await f.port.readRequest(row.id, signal())).toEqual(row);
    expect(f.calls).toEqual([expect.objectContaining({ name: "ap_material_draft_change_requests", filters: [["id", row.id]], maybeSingle: true, signal: expect.any(AbortSignal) })]);
    expect(f.calls[0].columns?.split(",").sort()).toEqual(Object.keys(row).sort());
    f.set(null); expect(await f.port.readRequest(row.id, signal())).toBeNull();
  });
  it.each([undefined, {}, { ...row, id: id(99) }, { ...row, payload_sha256: "bad" }, { ...row, instructions: "Private text" }])("rejects malformed/foreign request success %#", async (value) => {
    const f = fixture(); f.set(value); await expect(f.port.readRequest(row.id, signal())).rejects.toThrow("RECEIPT_INVALID");
  });
  it("delegates nearest same-job ancestry to the exact097 evidence RPC, preserving null", async () => {
    const f = fixture(); expect(await f.port.readEvidence(id(12), signal())).toEqual(row);
    expect(f.calls[0]).toMatchObject({ name: "ap_material_draft_change_evidence", args: { p_version_id: id(12) }, signal: expect.any(AbortSignal) });
    f.set(null); expect(await f.port.readEvidence(id(12), signal())).toBeNull();
  });
  it("commits the exact immutable request once and leaves replay/CAS to SQL", async () => {
    const f = fixture(row.successor_version_id); expect(await f.port.commit(commit, signal())).toBe(row.successor_version_id);
    expect(f.calls).toEqual([expect.objectContaining({ name: "ap_request_material_draft_changes", args: commit, signal: expect.any(AbortSignal) })]);
  });
  it.each([null, true, {}, "bad"]) ("rejects malformed write acknowledgement %# without another mutation", async (value) => {
    const f = fixture(value); await expect(f.port.commit(commit, signal())).rejects.toThrow("RECEIPT_INVALID"); expect(f.calls).toHaveLength(1);
  });
  it("passes exact existing token caps and change identity to the097 reservation", async () => {
    const receipt = { requestId: reserve.p_request_id, dispatchAuthorized: true, state: "DISPATCHED", reservedMicrousd: 2500,
      provider: "openai", model: "synthetic-model", policySha256: hash };
    const f = fixture(receipt); expect(await f.port.reserve(reserve, signal())).toEqual(receipt);
    expect(f.calls[0]).toMatchObject({ name: "ap_begin_material_draft_request_with_changes", args: reserve });
  });
  it.each(["DISPATCHED", "RESULT_RECORDED", "RESULT_UNKNOWN", "NO_RESULT_CONFIRMED"])("never converts %s replay to a dispatch permit", async (state) => {
    const receipt = { requestId: reserve.p_request_id, dispatchAuthorized: false, state, reservedMicrousd: 2500 };
    const f = fixture(receipt); expect(await f.port.reserve(reserve, signal())).toEqual(receipt); expect(f.calls).toHaveLength(1);
  });
  it.each([{ requestId: id(99), dispatchAuthorized: false, state: "DISPATCHED", reservedMicrousd: 1 },
    { requestId: reserve.p_request_id, dispatchAuthorized: true, state: "DISPATCHED", reservedMicrousd: 1 },
    { requestId: reserve.p_request_id, dispatchAuthorized: false, state: "READY", reservedMicrousd: 1 }])("rejects mixed or fabricated reservation receipt %#", async (value) => {
    const f = fixture(value); await expect(f.port.reserve(reserve, signal())).rejects.toThrow("RECEIPT_INVALID"); expect(f.calls).toHaveLength(1);
  });
  it("rejects extra authority/PII fields and over-cap inputs before a database call", async () => {
    const f = fixture();
    await expect(f.port.commit({ ...commit, approved: true } as typeof commit, signal())).rejects.toThrow("INPUT_INVALID");
    await expect(f.port.reserve({ ...reserve, p_input_token_cap: 50001 }, signal())).rejects.toThrow("INPUT_INVALID");
    await expect(f.port.readEvidence("bad", signal())).rejects.toThrow("INPUT_INVALID"); expect(f.calls).toEqual([]);
  });
  it("does not retry, reset limits or disclose private SQL details after a policy rejection or lost response", async () => {
    const f = fixture(); f.set(null, { code: "P0001", message: "material_draft_attempt_limit PRIVATE_SOURCE" });
    await expect(f.port.commit(commit, signal())).rejects.toThrow(/^DRAFT_CHANGE_TRANSPORT_UNCONFIRMED$/);
    expect(f.calls).toHaveLength(1); expect(f.calls[0].args).toEqual(commit);
  });
  it("detaches caller arguments before asynchronous transport", async () => {
    const f = fixture(row.successor_version_id), args = { ...commit }, pending = f.port.commit(args, signal()); args.p_reviewer_id = id(99);
    await pending; expect(f.calls[0].args).toEqual(commit);
  });
  it("rejects pre-aborted work without database access and bounds a hung write without retry", async () => {
    vi.useFakeTimers(); const f = fixture(), stopped = new AbortController(); stopped.abort();
    await expect(f.port.commit(commit, stopped.signal)).rejects.toThrow("ABORTED"); expect(f.calls).toEqual([]);
    f.run(() => new Promise(() => undefined)); const pending = expect(f.port.commit(commit, signal())).rejects.toThrow("ABORTED");
    await vi.advanceTimersByTimeAsync(20_001); await pending; expect(f.calls).toHaveLength(1); expect(f.calls[0].signal?.aborted).toBe(true);
  });
  it("rejects acknowledgement delivered after cancellation", async () => {
    const f = fixture(), controller = new AbortController(); f.run(async () => { controller.abort(); return { data: row.successor_version_id, error: null }; });
    await expect(f.port.commit(commit, controller.signal)).rejects.toThrow("ABORTED"); expect(f.calls).toHaveLength(1);
  });
});

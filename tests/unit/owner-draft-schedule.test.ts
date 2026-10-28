import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/stripe/server", () => ({ createStripeOperationalClient: () => { throw new Error("Unexpected payment provider call"); } }));
vi.mock("@/lib/commerce/checkout-initiation", () => ({ reconcileCheckoutInitiations: () => { throw new Error("Unexpected checkout mutation"); } }));
vi.mock("@/lib/commerce/outbox", () => ({ processChunk4Outbox: async () => ({ status: "enabled", attempted: 1, sent: 0, suppressed: 1 }) }));
import { processChunk4Workers } from "@/lib/commerce/workers";

const jobId = "a1060000-0000-4000-8000-000000000001", messageId = "a1060000-0000-4000-8000-000000000002";
const owner = "fictional-schedule-worker";
function database(overrides: Record<string, unknown> = {}) {
  const message = { state: "SUPPRESSED", next_attempt_at: null, message_kind: "OWNER_DRAFT_REVIEW_REQUIRED",
    provider_message_id: null, reconciliation_state: "NOT_REQUIRED", ...overrides };
  const rpc = vi.fn(async (name: string) => {
    if (name === "ap_claim_scheduled_jobs") return { data: [{ id: jobId, job_kind: "OUTBOX_SEND", reference_id: messageId,
      attempts: 1, created_at: new Date().toISOString() }], error: null };
    if (["ap_enqueue_chunk4_due_jobs", "ap_enqueue_chunk5_due_jobs", "ap_complete_external_scheduled_job", "ap_retry_scheduled_job",
      "ap_chunk4_monitor_snapshot", "ap_chunk5_monitor_snapshot"].includes(name)) return { data: true, error: null };
    throw new Error(`Unexpected RPC ${name}`);
  });
  const from = vi.fn((table: string) => {
    expect(table).toBe("ap_outbox_messages");
    return { select: (columns: string) => {
      expect(columns).toBe("state,next_attempt_at,message_kind,provider_message_id,reconciliation_state");
      return { eq: (column: string, value: string) => {
        expect([column, value]).toEqual(["id", messageId]);
        return { maybeSingle: async () => ({ data: message, error: null }) };
      } };
    } };
  });
  return { admin: { rpc, from } as unknown as Parameters<typeof processChunk4Workers>[0], rpc };
}
beforeEach(() => { vi.stubEnv("APP_CHUNK4_WORKER_ID", owner); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it("finishes a suppressed owner notification schedule without retrying or counting a sent email", async () => {
  const f = database(); const receipt = await processChunk4Workers(f.admin);
  expect(receipt).toMatchObject({ status: "enabled", processed: 1, completed: 1, outbox: { sent: 0, suppressed: 1 } });
  expect(f.rpc).toHaveBeenCalledWith("ap_complete_external_scheduled_job", { p_job_id: jobId, p_owner: owner });
  expect(f.rpc.mock.calls.some(([name]) => name === "ap_retry_scheduled_job")).toBe(false);
});
for (const state of ["SENT", "DEAD_LETTER"]) it(`preserves existing ${state} schedule completion`, async () => {
  const f = database({ state, message_kind: "PAYMENT_VERIFIED_SEARCH_STARTED" });
  await processChunk4Workers(f.admin);
  expect(f.rpc).toHaveBeenCalledWith("ap_complete_external_scheduled_job", { p_job_id: jobId, p_owner: owner });
});
for (const override of [{ message_kind: "PAYMENT_VERIFIED_SEARCH_STARTED" }, { provider_message_id: "unexpected-provider-id" },
  { reconciliation_state: "REQUIRED" }]) it("rejects an inconsistent suppressed record instead of treating it as completed", async () => {
  const f = database(override); await processChunk4Workers(f.admin);
  expect(f.rpc.mock.calls.some(([name]) => name === "ap_complete_external_scheduled_job")).toBe(false);
  expect(f.rpc).toHaveBeenCalledWith("ap_retry_scheduled_job", expect.objectContaining({ p_job_id: jobId, p_error_code: "CHUNK4_WORKER_FAILED" }));
});
for (const state of ["QUEUED", "SENDING", "RETRY"]) it(`retains retry handling for ${state} notices`, async () => {
  const f = database({ state }); await processChunk4Workers(f.admin);
  expect(f.rpc.mock.calls.some(([name]) => name === "ap_complete_external_scheduled_job")).toBe(false);
  expect(f.rpc).toHaveBeenCalledWith("ap_retry_scheduled_job", expect.objectContaining({ p_error_code: "OUTBOX_NOT_TERMINAL" }));
});

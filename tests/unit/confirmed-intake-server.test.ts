import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ privateState: vi.fn() }));
vi.mock("@/lib/intake/four-step-server", async (original) => ({ ...await original<typeof import("@/lib/intake/four-step-server")>(), fourStepPrivateState: state.privateState }));
import { canonicalSha256 } from "@/lib/domain/foundation";
import { prepareConfirmedReview, validateSubmittedConfirmation, boundedIntakeJson } from "@/lib/intake/confirmed-review-server";
import { emptyFourStepDraft } from "@/lib/intake/four-step";
const answers = { ...emptyFourStepDraft, entryMode: "GUIDED" as const, fullName: "Synthetic Customer", email: "synthetic@example.invalid", noPriorEmployment: true, backgroundReviewed: true, desiredActivities: ["SUPPORTING_CUSTOMERS"], workModes: ["REMOTE" as const], stateOrDc: "VA", employmentTypes: ["FULL_TIME" as const], termsAccepted: true };
const receipt = { id: "10000000-0000-4000-8000-000000000001", contractVersion: "applypack-confirmed-intake-v1" as const, draftVersion: 2, sourceSha256: "a".repeat(64), reviewSha256: "b".repeat(64), answersSha256: canonicalSha256(answers), preparedAt: "2026-10-25T00:00:00.000Z", entryMode: "GUIDED" as const };
function client(stale = false) {
  const rpc = vi.fn(async (name: string) => name === "ap_intake_confirmation_source" ? { data: "a".repeat(64), error: null } : name === "ap_read_four_step_draft" ? { data: [{ version: 2, state: "IN_PROGRESS", answers }], error: null } : { data: stale ? null : receipt, error: stale ? { message: "intake_review_stale" } : null });
  return { rpc, admin: { rpc } as unknown as Parameters<typeof prepareConfirmedReview>[0] };
}
beforeEach(() => state.privateState.mockResolvedValue({ documents: [], facts: [], presentedFactIds: [] }));
describe("server-confirmed intake review", () => {
  it("prepares from the saved revision and performs a second source check at receipt creation", async () => {
    const { admin, rpc } = client(); const result = await prepareConfirmedReview(admin, "draft", "secret-hash", 2);
    expect(result.receipt).toEqual(receipt); expect(JSON.stringify(result.sections)).toContain("Synthetic Customer");
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["ap_intake_confirmation_source", "ap_read_four_step_draft", "ap_prepare_intake_confirmation"]);
    expect(rpc).toHaveBeenLastCalledWith("ap_prepare_intake_confirmation", expect.objectContaining({ p_expected_version: 2, p_source_sha256: "a".repeat(64), p_answers_sha256: canonicalSha256(answers), p_review_sha256: canonicalSha256(result.sections) }));
  });
  it("fails closed when sources change during review preparation", async () => {
    const { admin } = client(true); await expect(prepareConfirmedReview(admin, "draft", "hash", 2)).rejects.toThrow("INTAKE_REVIEW_STALE");
  });
  it("returns necessary clarification without creating a receipt", async () => {
    const { admin, rpc } = client(); state.privateState.mockResolvedValue({ documents: [], facts: [{ id: "fact", tier: "SEARCH_CRITICAL", verification: "EXTRACTED_UNCONFIRMED", displayLabel: "Employer" }], presentedFactIds: [] });
    const result = await prepareConfirmedReview(admin, "draft", "hash", 2);
    expect(result.receipt).toBeNull(); expect(result.errors.map((error) => error.fieldId)).toContain("fact-fact"); expect(rpc).toHaveBeenCalledTimes(2);
  });
  it("accepts the same receipt on a lost-response retry but rejects altered answers or version", async () => {
    const { admin } = client();
    expect(await validateSubmittedConfirmation(admin, "draft", "hash", 2, answers, receipt)).toBe(true);
    expect(await validateSubmittedConfirmation(admin, "draft", "hash", 2, { ...answers, phone: "555 0101" }, receipt)).toBe(false);
    expect(await validateSubmittedConfirmation(admin, "draft", "hash", 3, answers, receipt)).toBe(false);
  });
  it("rejects a forged receipt even if its answer hash matches", async () => {
    const { admin } = client(); expect(await validateSubmittedConfirmation(admin, "draft", "hash", 2, answers, { ...receipt, reviewSha256: "f".repeat(64) })).toBe(false);
  });
  it("bounds actual request bytes even without content-length", async () => {
    expect(await boundedIntakeJson(new Request("https://example.invalid", { method: "POST", body: JSON.stringify({ value: "x".repeat(100_000) }) }))).toBeNull();
    expect(await boundedIntakeJson(new Request("https://example.invalid", { method: "POST", body: '{"expectedVersion":2}' }))).toEqual({ expectedVersion: 2 });
  });
  it("cancels a stalled body at the whole-request deadline", async () => {
    vi.useFakeTimers(); const cancel = vi.fn();
    try {
      const body = new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => undefined), cancel });
      const request = { body, signal: new AbortController().signal } as Request;
      const pending = boundedIntakeJson(request);
      await vi.advanceTimersByTimeAsync(5_001);
      expect(await pending).toBeNull(); expect(cancel).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });
  it("does not read an already-aborted request", async () => {
    const controller = new AbortController(); controller.abort();
    const getReader = vi.fn();
    expect(await boundedIntakeJson({ body: { getReader }, signal: controller.signal } as unknown as Request)).toBeNull();
    expect(getReader).not.toHaveBeenCalled();
  });
});

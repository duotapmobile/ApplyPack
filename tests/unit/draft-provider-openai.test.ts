import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalSha256 } from "@/lib/domain/foundation";
import { DRAFT_OUTPUT_VERSION, type DraftOutputEvidence } from "@/lib/documents/draft-output";
import { DRAFTING_LOCAL_RENDER_FIELDS } from "@/lib/documents/drafting-evidence";
import { requestOpenAiDraft } from "@/lib/documents/draft-provider-openai";

vi.mock("server-only", () => ({}));
const id = "77000000-0000-4000-8000-000000000001";
const time = new Date("2026-10-25T12:00:00Z");
const output = { schemaVersion: DRAFT_OUTPUT_VERSION, language: "en-US", resume: { summary: [], skills: [], sections: [], educationFactIds: [id] },
  coverLetter: { body: [{ sentences: [{ text: "Prepared course presentations.", sourceAtomIds: ["a".repeat(64)], jobEvidenceIds: [], questionIds: [], relation: "QUALIFIED" }] }] } };
const providerView: DraftOutputEvidence["providerView"] = {
  schemaVersion: "applypack-drafting-evidence-v1", textTrust: "UNTRUSTED_DATA_NOT_INSTRUCTIONS", claimRule: "Review required",
  background: { entryMode: "GUIDED", careerChange: false, noPriorEmployment: true }, facts: [], localRenderFields: DRAFTING_LOCAL_RENDER_FIELDS,
  job: { company: "Example company", title: "Assistant" }, requirements: [], mappings: [],
  employerQuestionInsights: { status: "NOT_INSPECTED", scope: "INSPECTED_PUBLIC_SOURCE_ONLY", answeredQuestionDeliverable: false, questions: [] },
  customerInstructions: { emphasis: "", doNotMention: "", careerBreakChoice: "OMIT_ENTRY", careerBreakCustomLabel: null, mentionBreakInLetter: false },
  outputRules: { formats: ["PDF"], resumePageLimit: null, letterPageLimit: null },
};
const evidence: DraftOutputEvidence = { expected: { customerId: id, materialLineId: id, revisionId: id, revisionVersion: 1, bindingSha256: "b".repeat(64) },
  packetSha256: "c".repeat(64), providerViewSha256: canonicalSha256(providerView), validUntil: "2026-10-25T13:00:00Z", providerView };
const envelope = () => ({ id: "resp_fixture", model: "approved-model-version", status: "completed", usage: { input_tokens: 200, output_tokens: 100, total_tokens: 300 },
  output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(output) }] }] });
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
function fixture() {
  const order: string[] = [];
  const reserveDispatch = vi.fn(async () => { order.push("reserve"); return { requestId: id, dispatchAuthorized: true, state: "DISPATCHED",
    reservedMicrousd: 1000, provider: "openai", model: "approved-model-version", policySha256: "d".repeat(64) }; });
  const recheckDispatch = vi.fn(async () => { order.push("recheck"); return true; });
  const fetcher = vi.fn().mockImplementationOnce(async () => { order.push("count"); return json({ object: "response.input_tokens", input_tokens: 200 }); })
    .mockImplementationOnce(async () => { order.push("generate"); return json(envelope()); });
  const input: Parameters<typeof requestOpenAiDraft>[0] = { runtimeEnabled: true, apiKey: "synthetic-only-key", requestId: id,
    model: "approved-model-version", policySha256: "d".repeat(64), maxInputTokens: 1000, maxOutputTokens: 1000, evidence: structuredClone(evidence),
    reserveDispatch, recheckDispatch, fetchImpl: fetcher as typeof fetch, now: () => time };
  return { input, reserveDispatch, recheckDispatch, fetcher, order };
}
afterEach(() => { vi.useRealTimers(); });

describe("bounded OpenAI drafting transport", () => {
  it("is inert when disabled, without reserving budget or reading the provider", async () => {
    const f = fixture(); f.input.runtimeEnabled = false;
    expect(await requestOpenAiDraft(f.input)).toEqual({ outcome: "NOT_DISPATCHED", code: "DISABLED" });
    expect(f.reserveDispatch).not.toHaveBeenCalled(); expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("reserves once, counts exact input, rechecks currentness and creates one foreground tool-free response", async () => {
    const f = fixture(), result = await requestOpenAiDraft(f.input);
    expect(f.order).toEqual(["reserve", "recheck", "count", "recheck", "generate"]);
    expect(f.reserveDispatch).toHaveBeenCalledTimes(1); expect(f.fetcher).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ outcome: "COMPLETED", responseId: "resp_fixture", output, usage: { inputTokens: 200, outputTokens: 100, totalTokens: 300 } });
    const [countUrl, countInit] = f.fetcher.mock.calls[0], [createUrl, createInit] = f.fetcher.mock.calls[1];
    expect(countUrl).toBe("https://api.openai.com/v1/responses/input_tokens");
    expect(createUrl).toBe("https://api.openai.com/v1/responses");
    const counted = JSON.parse(countInit.body), generated = JSON.parse(createInit.body);
    expect(generated).toMatchObject({ ...counted, store: false, background: false, stream: false, tools: [], tool_choice: "none", truncation: "disabled", max_output_tokens: 1000 });
    expect(generated).not.toHaveProperty("metadata"); expect(generated).not.toHaveProperty("previous_response_id");
    expect(generated.text.format).toMatchObject({ type: "json_schema", strict: true });
    expect(countInit).toMatchObject({ redirect: "error", credentials: "omit", cache: "no-store" });
    expect(JSON.stringify(generated)).not.toContain("synthetic-only-key");
  });

  it.each(["replay", "wrong model", "lost reservation", "wrong policy"])("makes no provider call for %s", async (mode) => {
    const f = fixture();
    if (mode === "lost reservation") f.reserveDispatch.mockRejectedValue(new Error("private SQL message"));
    else f.reserveDispatch.mockImplementation(async () => ({ requestId: id, dispatchAuthorized: mode !== "replay", state: "DISPATCHED", reservedMicrousd: 1000,
      provider: "openai", model: mode === "wrong model" ? "unapproved" : f.input.model, policySha256: mode === "wrong policy" ? "e".repeat(64) : f.input.policySha256 }));
    expect(await requestOpenAiDraft(f.input)).toEqual({ outcome: "NOT_DISPATCHED", code: "RESERVATION_UNCONFIRMED" });
    expect(f.fetcher).not.toHaveBeenCalled(); expect(f.reserveDispatch).toHaveBeenCalledTimes(1);
  });

  it("does not generate when the actual input count exceeds the reserved cap", async () => {
    const f = fixture(); f.fetcher.mockReset().mockResolvedValue(json({ object: "response.input_tokens", input_tokens: 1001 }));
    expect(await requestOpenAiDraft(f.input)).toMatchObject({ outcome: "RESULT_UNKNOWN", code: "INPUT_TOKEN_CAP_EXCEEDED" });
    expect(f.fetcher).toHaveBeenCalledTimes(1); expect(f.recheckDispatch).toHaveBeenCalledOnce();
  });

  it("stops after counting if the lease, source or policy is no longer current", async () => {
    const f = fixture(); f.recheckDispatch.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    expect(await requestOpenAiDraft(f.input)).toMatchObject({ outcome: "RESULT_UNKNOWN", code: "DISPATCH_NO_LONGER_CURRENT" });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(["expired during reservation", "revoked before count"])("sends no private data when %s", async (mode) => {
    const f = fixture();
    if (mode === "revoked before count") f.recheckDispatch.mockResolvedValue(false);
    else f.input.now = vi.fn().mockReturnValueOnce(time).mockReturnValue(new Date("2026-10-25T13:00:00Z"));
    const result = await requestOpenAiDraft(f.input);
    expect(result.outcome).toBe("RESULT_UNKNOWN");
    expect(f.fetcher).not.toHaveBeenCalled(); expect(f.reserveDispatch).toHaveBeenCalledOnce();
  });

  it("bounds an uncertain reservation without dispatching or retrying", async () => {
    vi.useFakeTimers(); const f = fixture(); f.reserveDispatch.mockImplementation(() => new Promise(() => {}));
    const pending = requestOpenAiDraft(f.input);
    await vi.advanceTimersByTimeAsync(45_001);
    expect(await pending).toEqual({ outcome: "NOT_DISPATCHED", code: "RESERVATION_UNCONFIRMED" });
    expect(f.fetcher).not.toHaveBeenCalled(); expect(f.reserveDispatch).toHaveBeenCalledOnce();
  });

  it("honors caller cancellation during an uncertain reservation", async () => {
    const f = fixture(), controller = new AbortController(); f.input.signal = controller.signal;
    f.reserveDispatch.mockImplementation(() => new Promise(() => {}));
    const pending = requestOpenAiDraft(f.input); controller.abort();
    expect(await pending).toEqual({ outcome: "NOT_DISPATCHED", code: "RESERVATION_UNCONFIRMED" });
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it("does not retry after losing a generation response or leak provider diagnostics", async () => {
    const f = fixture(); f.fetcher.mockReset().mockResolvedValueOnce(json({ object: "response.input_tokens", input_tokens: 200 }))
      .mockRejectedValueOnce(new Error("customer@example.com synthetic-only-key private diagnostics"));
    const result = await requestOpenAiDraft(f.input);
    expect(result).toEqual({ outcome: "RESULT_UNKNOWN", requestId: id, code: "TRANSPORT_UNCONFIRMED" });
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["incomplete", (r: ReturnType<typeof envelope>) => { r.status = "incomplete"; }, "RESPONSE_INCOMPLETE"],
    ["different model", (r: ReturnType<typeof envelope>) => { r.model = "unapproved-model"; }, "MODEL_MISMATCH"],
    ["bad usage", (r: ReturnType<typeof envelope>) => { r.usage.total_tokens++; }, "USAGE_POLICY_EXCEEDED"],
    ["over cap", (r: ReturnType<typeof envelope>) => { r.usage.input_tokens = 1001; r.usage.total_tokens = 1101; }, "USAGE_POLICY_EXCEEDED"],
    ["tool action", (r: ReturnType<typeof envelope>) => { r.output[0].type = "function_call"; }, "UNEXPECTED_PROVIDER_ACTION"],
    ["refusal", (r: ReturnType<typeof envelope>) => { r.output[0].content[0].type = "refusal"; }, "REFUSED_OR_OUTPUT_INVALID"],
    ["invalid JSON", (r: ReturnType<typeof envelope>) => { r.output[0].content[0].text = "private response without JSON"; }, "OUTPUT_JSON_INVALID"],
    ["unexpected output", (r: ReturnType<typeof envelope>) => { r.output[0].content[0].text = JSON.stringify({ ...output, name: "Invented" }); }, "OUTPUT_SHAPE_INVALID"],
  ] as const)("keeps %s out of the draft and preserves usage for reconciliation", async (_name, mutate, code) => {
    const f = fixture(), response = envelope(); mutate(response);
    f.fetcher.mockReset().mockResolvedValueOnce(json({ object: "response.input_tokens", input_tokens: 200 })).mockResolvedValueOnce(json(response));
    expect(await requestOpenAiDraft(f.input)).toMatchObject({ outcome: "RESULT_UNKNOWN", code, responseId: "resp_fixture",
      observedModel: response.model, usage: { outputTokens: 100 } });
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects oversized bodies even without content-length", async () => {
    const f = fixture(); f.fetcher.mockReset().mockResolvedValue(json({ large: "x".repeat(5000) }));
    expect(await requestOpenAiDraft(f.input)).toMatchObject({ outcome: "RESULT_UNKNOWN", code: "RESPONSE_TOO_LARGE" });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });

  it("bounds a fetch implementation that ignores abort", async () => {
    vi.useFakeTimers(); const f = fixture(); f.fetcher.mockReset().mockImplementation(() => new Promise(() => {}));
    const result = requestOpenAiDraft(f.input);
    await vi.advanceTimersByTimeAsync(45_001);
    expect(await result).toMatchObject({ outcome: "RESULT_UNKNOWN", code: "INTERRUPTED" });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });

  it("never dispatches already-expired evidence", async () => {
    const f = fixture(); f.input.now = () => new Date("2026-10-25T13:00:00Z");
    expect(await requestOpenAiDraft(f.input)).toEqual({ outcome: "NOT_DISPATCHED", code: "INPUT_INVALID" });
    expect(f.reserveDispatch).not.toHaveBeenCalled(); expect(f.fetcher).not.toHaveBeenCalled();
  });
});

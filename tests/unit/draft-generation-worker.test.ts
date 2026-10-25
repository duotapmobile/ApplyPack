import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { canonicalSha256 } from "@/lib/domain/foundation";
import { DRAFTING_LOCAL_RENDER_FIELDS, type DraftingEvidencePacket } from "@/lib/documents/drafting-evidence";
import { DRAFT_OUTPUT_VERSION, type DraftOutputEvidence } from "@/lib/documents/draft-output";
import { generateDraftForClaim, type DraftGenerationServices, type DraftGenerationState } from "@/lib/documents/draft-generation-worker";

const id = (n: number) => `78000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = new Date("2026-10-25T12:00:00Z"), future = "2026-10-25T13:00:00Z";
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
function fixture() {
  const claim = { jobId: id(1), ownerId: id(2), leaseToken: id(3) };
  const value = { educationLevel: "Coursework", activity: "Prepared course presentations" };
  const providerView: DraftOutputEvidence["providerView"] = {
    schemaVersion: "applypack-drafting-evidence-v1", textTrust: "UNTRUSTED_DATA_NOT_INSTRUCTIONS", claimRule: "Review required",
    background: { entryMode: "GUIDED", careerChange: false, noPriorEmployment: true }, localRenderFields: DRAFTING_LOCAL_RENDER_FIELDS,
    facts: [{ id: id(20), kind: "EDUCATION", value, valueSha256: canonicalSha256(value), disposition: "LIMITED_OR_UNKNOWN_DO_NOT_UPGRADE",
      parentFactId: null, datePrecision: "UNKNOWN", atoms: [{ id: "b".repeat(64), factId: id(20), path: "/activity", value: value.activity, localRenderOnly: false }] }],
    job: { company: "Example", title: "Assistant" }, requirements: [], mappings: [],
    employerQuestionInsights: { status: "NOT_INSPECTED", scope: "INSPECTED_PUBLIC_SOURCE_ONLY", answeredQuestionDeliverable: false, questions: [] },
    customerInstructions: { emphasis: "", doNotMention: "", careerBreakChoice: "OMIT_ENTRY", careerBreakCustomLabel: null, mentionBreakInLetter: false },
    outputRules: { formats: ["PDF"], resumePageLimit: null, letterPageLimit: null },
  };
  const body = { schemaVersion: "applypack-drafting-evidence-v1", expected: { customerId: id(4), materialLineId: id(5),
    revisionId: id(6), revisionVersion: 1, bindingSha256: "a".repeat(64) }, binding: { snapshotId: id(7), dueAt: future },
    providerView, providerViewSha256: canonicalSha256(providerView), validUntil: future };
  // This port fixture represents already validated/decrypted storage. Full
  // packet provenance and encryption are tested in their own connected suites.
  const packet = { ...body, packetSha256: canonicalSha256(body) } as unknown as DraftingEvidencePacket;
  const state: DraftGenerationState = { ...claim, customerId: id(4), materialLineId: id(5), revisionId: id(6), revisionVersion: 1,
    bindingSha256: "a".repeat(64), snapshotId: id(7), dueAt: future, leaseGeneration: 1, leaseExpiresAt: future, state: "READY",
    versionId: id(8), packetPayloadId: id(9), packetSha256: packet.packetSha256, contextSha256: "c".repeat(64), sourcePayloadId: null, invalidatedAt: null };
  const policy = { id: id(10), provider: "openai", model: "approved-model", policy_sha256: "d".repeat(64),
    privacy_reference_sha256: "e".repeat(64), evaluation_reference_sha256: "f".repeat(64), quote_reference_sha256: "a".repeat(64), max_input_tokens: 1000, max_output_tokens: 1000 };
  const output = { schemaVersion: DRAFT_OUTPUT_VERSION, language: "en-US", resume: { summary: [], skills: [], sections: [], educationFactIds: [id(20)] },
    coverLetter: { body: [{ sentences: [{ text: "Prepared course presentations.", sourceAtomIds: ["b".repeat(64)], jobEvidenceIds: [], questionIds: [], relation: "QUALIFIED" }] }] } };
  const response = { id: "resp_fixture", model: policy.model, status: "completed", usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 },
    output: [{ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: JSON.stringify(output) }] }] };
  let recorded: unknown = null;
  const services = {
    readRuntime: vi.fn(async () => ({ enabled: true, policy_id: policy.id })), readState: vi.fn(async () => state),
    readPolicy: vi.fn(async () => policy), loadPacket: vi.fn(async () => packet), renewLease: vi.fn(async () => future),
    readApiKey: vi.fn(() => "synthetic-only-key"),
    reserve: vi.fn(async (args: Parameters<DraftGenerationServices["reserve"]>[0]) => ({ requestId: args.p_request_id, dispatchAuthorized: true,
      state: "DISPATCHED", reservedMicrousd: 1000, provider: "openai", model: policy.model, policySha256: policy.policy_sha256 })),
    recheck: vi.fn(async () => true), observe: vi.fn(async () => "e".repeat(64)),
    storePayload: vi.fn(async (input: Parameters<DraftGenerationServices["storePayload"]>[0]) => ({ payloadId: input.payloadId, sha256: input.sha256 })),
    recordSource: vi.fn(async (args: Parameters<DraftGenerationServices["recordSource"]>[0]) => {
      recorded = { jobId: state.jobId, customerId: state.customerId, materialLineId: state.materialLineId, versionId: state.versionId,
        requestId: args.p_request_id, packetSha256: packet.packetSha256, sourceSha256: args.p_source_sha256,
        sourcePayloadId: args.p_source_payload_id, attemptState: "RESULT_RECORDED", invalidatedAt: null };
      return state.versionId;
    }),
    readRecordedSource: vi.fn(async () => recorded), fail: vi.fn(async () => "RESULT_UNKNOWN"),
  };
  const fetcher = vi.fn().mockImplementationOnce(async () => json({ object: "response.input_tokens", input_tokens: 100 }))
    .mockImplementationOnce(async () => json(response));
  const options = { enabled: true, now: () => at, fetchImpl: fetcher as typeof fetch };
  return { claim, state, packet, policy, output, response, services, fetcher, options };
}
afterEach(() => vi.useRealTimers());

describe("durable draft generation orchestration", () => {
  it("does nothing when its environment switch is disabled", async () => {
    const f = fixture(); f.options.enabled = false;
    expect(await generateDraftForClaim(f.services, f.claim, f.options)).toEqual({ status: "DISABLED" });
    expect(f.services.readRuntime).not.toHaveBeenCalled(); expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("respects the disabled database gate before loading private content or credentials", async () => {
    const f = fixture(); f.services.readRuntime.mockResolvedValue({ enabled: false, policy_id: f.policy.id });
    expect(await generateDraftForClaim(f.services, f.claim, f.options)).toEqual({ status: "DISABLED" });
    expect(f.services.loadPacket).not.toHaveBeenCalled(); expect(f.services.readApiKey).not.toHaveBeenCalled();
  });
  it.each(["wrong customer", "changed packet", "stale lease", "wrong policy"])("blocks %s before dispatch", async (mode) => {
    const f = fixture();
    if (mode === "wrong customer") f.state.customerId = id(99);
    if (mode === "changed packet") f.packet.providerView.job.title = "Changed";
    if (mode === "stale lease") f.state.leaseExpiresAt = at.toISOString();
    if (mode === "wrong policy") f.services.readPolicy.mockResolvedValue({ ...f.policy, id: id(99) });
    expect(await generateDraftForClaim(f.services, f.claim, f.options)).toMatchObject({ status: "NOT_DISPATCHED" });
    expect(f.services.reserve).not.toHaveBeenCalled(); expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("stores a source-linked unapproved pair and verifies the actual database receipt", async () => {
    const f = fixture(), result = await generateDraftForClaim(f.services, f.claim, f.options);
    expect(result).toMatchObject({ status: "SOURCE_READY", versionId: f.state.versionId, reconciled: false });
    expect(f.services.reserve).toHaveBeenCalledOnce(); expect(f.services.recheck).toHaveBeenCalledTimes(2); expect(f.fetcher).toHaveBeenCalledTimes(2);
    const stored = f.services.storePayload.mock.calls[0][0];
    expect(stored.purpose).toBe("MATERIAL_DRAFT_SOURCE");
    expect(JSON.parse(stored.body).state).toBe("OWNER_REVIEW_REQUIRED");
    expect(f.services.observe).toHaveBeenCalledWith(expect.objectContaining({ outcome: "PROPOSAL_VALIDATED", responseId: "resp_fixture",
      observedModel: f.policy.model, usage: { inputTokens: 100, outputTokens: 100, totalTokens: 200 } }), expect.any(AbortSignal));
    expect(f.services.fail).not.toHaveBeenCalled();
  });
  it("reconciles a committed source after a lost response without retrying or marking it failed", async () => {
    const f = fixture(), record = f.services.recordSource.getMockImplementation()!;
    f.services.recordSource.mockImplementation(async (args) => { await record(args); throw new Error("lost response"); });
    expect(await generateDraftForClaim(f.services, f.claim, f.options)).toMatchObject({ status: "SOURCE_READY", reconciled: true });
    expect(f.services.recordSource).toHaveBeenCalledOnce(); expect(f.services.fail).not.toHaveBeenCalled(); expect(f.fetcher).toHaveBeenCalledTimes(2);
  });
  it("never treats an unreadable commit as permission to delete or invalidate its source", async () => {
    const f = fixture(); f.services.readRecordedSource.mockRejectedValue(new Error("private SQL detail"));
    expect(await generateDraftForClaim(f.services, f.claim, f.options)).toMatchObject({ status: "RESULT_UNKNOWN" });
    expect(f.services.recordSource).toHaveBeenCalledOnce(); expect(f.services.fail).not.toHaveBeenCalled();
  });
  it("does not fail a competing attempt when reservation is rejected or its response is lost", async () => {
    const f = fixture(); f.services.reserve.mockRejectedValue(new Error("private SQL detail"));
    const result = await generateDraftForClaim(f.services, f.claim, f.options);
    expect(result).toMatchObject({ status: "RESULT_UNKNOWN", code: "RESERVATION_UNCONFIRMED" });
    expect(f.fetcher).not.toHaveBeenCalled(); expect(f.services.fail).not.toHaveBeenCalled(); expect(f.services.observe).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("rejects unsupported generated claims before committing a source", async () => {
    const f = fixture(); f.output.coverLetter.body[0].sentences[0].text = "Improved results by 50%.";
    f.response.output[0].content[0].text = JSON.stringify(f.output);
    expect(await generateDraftForClaim(f.services, f.claim, f.options)).toMatchObject({ status: "RESULT_UNKNOWN", code: "PROPOSAL_REJECTED" });
    expect(f.services.observe).toHaveBeenCalledWith(expect.objectContaining({ outcome: "PROPOSAL_REJECTED" }), expect.any(AbortSignal));
    expect(f.services.storePayload).not.toHaveBeenCalled(); expect(f.services.recordSource).not.toHaveBeenCalled();
  });
  it("retains an uncertain provider attempt without retry or plaintext diagnostics", async () => {
    const f = fixture(); f.fetcher.mockReset().mockResolvedValueOnce(json({ object: "response.input_tokens", input_tokens: 100 }))
      .mockRejectedValueOnce(new Error("private applicant content"));
    const result = await generateDraftForClaim(f.services, f.claim, f.options);
    expect(result).toMatchObject({ status: "RESULT_UNKNOWN", code: "TRANSPORT_UNCONFIRMED" });
    expect(f.services.fail).toHaveBeenCalledOnce(); expect(f.services.recordSource).not.toHaveBeenCalled();
    expect(f.fetcher).toHaveBeenCalledTimes(2); expect(JSON.stringify(result)).not.toContain("applicant");
  });
  it("bounds a stuck database read before any private transfer", async () => {
    vi.useFakeTimers(); const f = fixture(); f.services.readState.mockImplementation(() => new Promise(() => {}));
    const pending = generateDraftForClaim(f.services, f.claim, f.options); await vi.advanceTimersByTimeAsync(90_001);
    expect(await pending).toEqual({ status: "NOT_DISPATCHED", code: "INTERRUPTED" }); expect(f.fetcher).not.toHaveBeenCalled();
  });
});

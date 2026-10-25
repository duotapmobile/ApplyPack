import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), origin: vi.fn(), from: vi.fn(), rpc: vi.fn(), factory: vi.fn(), promote: vi.fn(), review: vi.fn(), ruleFactory: vi.fn(), revalidate: vi.fn(), refresh: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.auth }));
vi.mock("@/lib/security/origin", () => ({ isSameOriginRequest: mocks.origin }));
vi.mock("@/lib/documents/draft-owner-server", () => ({ createDraftOwnerServer: mocks.factory }));
vi.mock("@/lib/documents/material-rule-owner-server", () => ({ createMaterialRuleOwnerServer: mocks.ruleFactory }));
import { POST } from "@/app/api/admin/material-draft-jobs/[id]/route";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const job = id(1), version = id(2), reviewer = id(3), release = id(4), outbox = id(5);
const binding = { versionId: version, packetSha256: "a".repeat(64), sourceSha256: "b".repeat(64), memberSetSha256: "c".repeat(64) };
const checklist = { contentReviewed: true, visualReviewed: true, listingRechecked: true, instructionsReparsed: true,
  linksRechecked: true, provenanceReviewed: true, secureFilesConfirmed: true };
const approve = { action: "APPROVE_PAIR", ...binding, checklist, attestation: "I checked this exact complete document pair." };
const send = { action: "SEND_PAIR", ...binding, approvalSha256: "d".repeat(64), releaseId: release, outboxId: outbox,
  rationale: "Send the exact pair I have reviewed and approved." };
const review = { action: "REVIEW_WORDING", review: { versionId: version, packetSha256: binding.packetSha256, sourceSha256: binding.sourceSha256,
  claims: [{ claimId: id(6), wordingSha256: "e".repeat(64), decision: "APPROVED" }] } };
const promote = { action: "PROMOTE_SOURCE", expectedVersionId: version, expectedSourceSha256: binding.sourceSha256 };
const ruleBasis = { lineRevisionId: id(11), sourceSnapshotId: id(12), jobSnapshotId: id(13), jobContentSha256: "a".repeat(64),
  ruleId: id(14), ruleSha256: "b".repeat(64), ruleRecordSha256: "c".repeat(64), sourceAuthoritySha256: "d".repeat(64) };
const ruleReview = { action: "REVALIDATE_RULE", expectedVersionId: version, receiptId: id(15), expectedBasis: ruleBasis,
  checklist: { applicationAccessReviewed: true, liveListingOpened: true, submissionInstructionsCompared: true, unchangedRuleConfirmed: true } };
const refresh = { action: "REFRESH_PACKET", expectedVersionId: version, expectedPacketSha256: binding.packetSha256, expectedContextSha256: "f".repeat(64), requestId: id(16) };
let versionResult: { data: unknown; error: unknown };
let jobResult: { data: unknown; error: unknown };
let rpcResult: { data: unknown; error: unknown };
const admin = { from: mocks.from, rpc: mocks.rpc };
function invoke(body: unknown, jobId = job, contentType = "application/json") {
  return POST(new Request(`https://applypack.test/api/admin/material-draft-jobs/${jobId}`, {
    method: "POST", headers: { "Content-Type": contentType }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: jobId }) });
}
function privateHeaders(result: Response) {
  expect(result.headers.get("Cache-Control")).toBe("no-store, private");
  expect(result.headers.get("Referrer-Policy")).toBe("no-referrer");
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.origin.mockReturnValue(true);
  mocks.auth.mockResolvedValue({ ok: true, admin, user: { id: reviewer } });
  versionResult = { data: { id: version, job_id: job }, error: null };
  jobResult = { data: { id: job, active_version_id: null, state: "EVIDENCE_PENDING" }, error: null };
  rpcResult = { data: "f".repeat(64), error: null };
  mocks.from.mockImplementation((table: string) => {
    const q: Record<string, unknown> = {};
    for (const method of ["select", "eq", "abortSignal"]) q[method] = vi.fn(() => q);
    q.maybeSingle = () => Promise.resolve(table === "ap_material_draft_jobs" ? jobResult : versionResult); return q;
  });
  mocks.rpc.mockImplementation(() => ({ abortSignal: () => Promise.resolve(rpcResult) }));
  mocks.factory.mockReturnValue({ promoteSource: mocks.promote, recordWordingReview: mocks.review });
  mocks.promote.mockResolvedValue({ versionId: id(7), deliveryAuthorized: false });
  mocks.review.mockResolvedValue({ versionId: version, reviewSha256: "f".repeat(64), deliveryAuthorized: false });
  mocks.ruleFactory.mockReturnValue({ revalidate: mocks.revalidate, refreshPacket: mocks.refresh });
  mocks.revalidate.mockResolvedValue({ jobId: job, receiptId: ruleReview.receiptId, recorded: true, current: true, deliveryAuthorized: false });
  mocks.refresh.mockResolvedValue({ jobId: job, versionId: id(17), priorVersionId: version, recorded: true, current: true, deliveryAuthorized: false });
});

describe("owner document HTTP actions", () => {
  it("delegates exact rule review to the authenticated reviewer without inventing a timestamp or changing its checklist", async () => {
    const result = await invoke(ruleReview);
    expect(result.status).toBe(200); privateHeaders(result);
    expect(mocks.ruleFactory).toHaveBeenCalledWith(admin, reviewer);
    const input = { expectedVersionId: ruleReview.expectedVersionId, receiptId: ruleReview.receiptId,
      expectedBasis: ruleReview.expectedBasis, checklist: ruleReview.checklist };
    expect(mocks.revalidate).toHaveBeenCalledWith({ ...input, jobId: job }, expect.any(AbortSignal));
    expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("permits exact null-version receipt reconciliation through the adapter after an earlier first review", async () => {
    jobResult.data = { id: job, active_version_id: id(99), state: "READY" };
    expect((await invoke({ ...ruleReview, expectedVersionId: null })).status).toBe(200);
    expect(mocks.revalidate).toHaveBeenCalledWith(expect.objectContaining({ expectedVersionId: null }), expect.any(AbortSignal));
  });
  it("requires a separate explicit refresh bound to the displayed old packet and new context", async () => {
    const result = await invoke(refresh); expect(result.status).toBe(200); privateHeaders(result);
    const input = { expectedVersionId: refresh.expectedVersionId, expectedPacketSha256: refresh.expectedPacketSha256,
      expectedContextSha256: refresh.expectedContextSha256, requestId: refresh.requestId };
    expect(mocks.refresh).toHaveBeenCalledWith({ ...input, jobId: job }, expect.any(AbortSignal));
    expect(mocks.revalidate).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    { ...ruleReview, checkedAt: "2026-10-25T12:00:00Z" }, { ...ruleReview, reviewerId: id(99) },
    { ...ruleReview, checklist: { ...ruleReview.checklist, unchangedRuleConfirmed: false } },
    { ...ruleReview, expectedBasis: { ...ruleBasis, ruleRecordSha256: undefined } },
    { ...refresh, expectedVersionId: null }, { ...refresh, requestId: undefined },
    { ...refresh, payloadId: id(99) }, { ...refresh, copyApproval: true },
  ])("rejects incomplete or expanded evidence renewal before service access: %#", async (body) => {
    expect((await invoke(body)).status).toBe(400);
    expect(mocks.ruleFactory).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
  });
  it("does not repeat an ambiguous rule mutation or leak service errors", async () => {
    mocks.revalidate.mockRejectedValue(new Error("PRIVATE service-key=SECRET"));
    const result = await invoke(ruleReview); expect(result.status).toBe(409);
    expect(mocks.revalidate).toHaveBeenCalledOnce(); expect(await result.text()).not.toMatch(/PRIVATE|SECRET/);
  });
  it("rejects cross-origin calls before authentication or data access", async () => {
    mocks.origin.mockReturnValue(false);
    const result = await invoke(send); expect(result.status).toBe(403); privateHeaders(result);
    expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
  });
  it.each([401, 403, 503])("respects the fresh-MFA authorization failure %s before reading private state", async (status) => {
    mocks.auth.mockResolvedValue({ ok: false, response: Response.json({ error: "Fresh admin MFA verification required." }, { status }) });
    const result = await invoke(review); expect(result.status).toBe(status); privateHeaders(result);
    expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.factory).not.toHaveBeenCalled();
  });
  it.each([{}, { ...approve, checklist: undefined }, { ...approve, checklist: { ...checklist, visualReviewed: false } },
    { ...approve, checklist: { ...checklist, contentReviewed: "true" } }, { ...send, approvalSha256: undefined },
    { ...send, releaseId: undefined }, { ...send, outboxId: undefined }, { ...send, reviewerId: id(9) },
    { ...promote, provider: "anything" }, { ...review, review: { ...review.review, claims: [] } },
    { action: "LISTING_CHECK", expectedVersionId: version, checkId: id(10), phase: "BEFORE_RELEASE", result: "ACTIVE", evidenceSha256: "a".repeat(64) },
  ])("rejects incomplete or broadened actions before data access: %#", async (body) => {
    const result = await invoke(body); expect(result.status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.factory).not.toHaveBeenCalled();
  });
  it("rejects an invalid job, wrong media type and oversized streamed JSON", async () => {
    expect((await invoke(send, "invalid")).status).toBe(400);
    expect((await invoke(send, job, "text/plain")).status).toBe(400);
    expect((await invoke({ ...send, rationale: "a".repeat(100_000) })).status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("rejects malformed UTF-8 and an already aborted request before data access", async () => {
    const invalid = new Request("https://applypack.test/api/admin/material-draft-jobs/" + job, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: new Uint8Array([0x7b, 0xff, 0x7d]),
    });
    expect((await POST(invalid, { params: Promise.resolve({ id: job }) })).status).toBe(400);
    const controller = new AbortController(); controller.abort();
    const aborted = new Request("https://applypack.test/api/admin/material-draft-jobs/" + job, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(send), signal: controller.signal,
    });
    expect((await POST(aborted, { params: Promise.resolve({ id: job }) })).status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it("cancels a stalled body after five seconds without touching private state", async () => {
    vi.useFakeTimers();
    try {
      const canceled = vi.fn();
      const body = new ReadableStream<Uint8Array>({ cancel: canceled });
      const request = new Request("https://applypack.test/api/admin/material-draft-jobs/" + job, {
        method: "POST", headers: { "Content-Type": "application/json" }, body, duplex: "half",
      } as RequestInit);
      const pending = POST(request, { params: Promise.resolve({ id: job }) });
      await vi.advanceTimersByTimeAsync(5100);
      expect((await pending).status).toBe(400); expect(canceled).toHaveBeenCalledOnce();
      expect(mocks.from).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it.each([null, { id: version, job_id: id(99) }, { id: id(99), job_id: job }])("does not cross a job/version boundary", async (data) => {
    versionResult = { data, error: null };
    expect((await invoke(send)).status).toBe(409); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.factory).not.toHaveBeenCalled();
  });
  it("uses only the authenticated reviewer for source promotion and wording review", async () => {
    expect((await invoke(promote)).status).toBe(200);
    expect(mocks.factory).toHaveBeenCalledWith(admin, reviewer);
    expect(mocks.promote).toHaveBeenCalledWith({ jobId: job, expectedVersionId: version, expectedSourceSha256: binding.sourceSha256 }, expect.any(AbortSignal));
    expect((await invoke(review)).status).toBe(200);
    expect(mocks.review).toHaveBeenCalledWith({ jobId: job, request: review.review }, expect.any(AbortSignal));
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("records an explicit listing inspection against the expected version and stable check identity", async () => {
    rpcResult.data = id(10);
    const result = await invoke({ action: "LISTING_CHECK", expectedVersionId: version, checkId: id(10), phase: "BEFORE_RELEASE",
      result: "ACTIVE", evidenceSha256: "a".repeat(64), listingOpened: true, instructionsCompared: true });
    expect(result.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("ap_record_material_draft_listing_check", { p_job_id: job, p_expected_version_id: version, p_check_id: id(10),
      p_phase: "BEFORE_RELEASE", p_result: "ACTIVE", p_evidence_sha256: "a".repeat(64), p_reviewer_id: reviewer });
  });
  it("records the initial generation inspection with actual NULL while still using the database CAS", async () => {
    rpcResult.data = id(10);
    const result = await invoke({ action: "LISTING_CHECK", expectedVersionId: null, checkId: id(10), phase: "BEFORE_GENERATION",
      result: "ACTIVE", evidenceSha256: "a".repeat(64), listingOpened: true, instructionsCompared: true });
    expect(result.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("ap_record_material_draft_listing_check", expect.objectContaining({ p_expected_version_id: null, p_job_id: job }));
  });
  it.each(["version appeared", "wrong job", "wrong state", "before release"])("rejects initial listing checks when %s", async (variant) => {
    if (variant === "version appeared") jobResult.data = { id: job, active_version_id: version, state: "PREPARING" };
    if (variant === "wrong job") jobResult.data = { id: id(99), active_version_id: null, state: "PREPARING" };
    if (variant === "wrong state") jobResult.data = { id: job, active_version_id: null, state: "APPROVED" };
    const result = await invoke({ action: "LISTING_CHECK", expectedVersionId: null, checkId: id(10), phase: variant === "before release" ? "BEFORE_RELEASE" : "BEFORE_GENERATION",
      result: "ACTIVE", evidenceSha256: "a".repeat(64), listingOpened: true, instructionsCompared: true });
    expect(result.status).toBe(variant === "before release" ? 400 : 409); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("approves only the explicit complete review and never sends as part of approval", async () => {
    const result = await invoke(approve); expect(result.status).toBe(200); privateHeaders(result);
    expect(await result.json()).toEqual({ action: "APPROVE_PAIR", approvalSha256: "f".repeat(64), sent: false });
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("ap_approve_material_draft_pair", { p_version_id: version, p_packet_sha256: binding.packetSha256,
      p_source_sha256: binding.sourceSha256, p_member_set_sha256: binding.memberSetSha256, p_checklist: checklist,
      p_attestation: approve.attestation, p_reviewer_id: reviewer });
  });
  it("uses the exact approved identity and the same release/outbox IDs on a lost-response retry", async () => {
    rpcResult = { data: null, error: { message: "response lost" } };
    expect((await invoke(send)).status).toBe(409); expect(mocks.rpc).toHaveBeenCalledOnce();
    rpcResult = { data: release, error: null };
    const result = await invoke(send); expect(result.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledTimes(2); expect(mocks.rpc.mock.calls[0]).toEqual(mocks.rpc.mock.calls[1]);
    expect(mocks.rpc.mock.calls[1]).toEqual(["ap_send_material_draft_pair", { p_version_id: version, p_packet_sha256: binding.packetSha256,
      p_source_sha256: binding.sourceSha256, p_member_set_sha256: binding.memberSetSha256, p_approval_sha256: send.approvalSha256,
      p_release_id: release, p_outbox_id: outbox, p_rationale: send.rationale, p_reviewer_id: reviewer }]);
  });
  it.each([{ data: id(999), error: null }, { data: null, error: { message: "private customer information" } }])("does not claim an unconfirmed Send succeeded or disclose provider errors", async (value) => {
    rpcResult = value;
    const result = await invoke(send); expect(result.status).toBe(409); privateHeaders(result);
    expect(await result.text()).not.toContain("private customer information"); expect(mocks.rpc).toHaveBeenCalledOnce();
  });
  it("keeps private data-layer failures out of the response", async () => {
    mocks.review.mockRejectedValue(new Error("private customer information"));
    const result = await invoke(review); expect(result.status).toBe(409);
    expect(await result.text()).not.toContain("private customer information");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), origin: vi.fn(), from: vi.fn(), rpc: vi.fn(), factory: vi.fn(), promote: vi.fn(), review: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.auth }));
vi.mock("@/lib/security/origin", () => ({ isSameOriginRequest: mocks.origin }));
vi.mock("@/lib/documents/draft-owner-server", () => ({ createDraftOwnerServer: mocks.factory }));
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
let versionResult: { data: unknown; error: unknown };
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
  rpcResult = { data: "f".repeat(64), error: null };
  mocks.from.mockImplementation(() => {
    const q: Record<string, unknown> = {};
    for (const method of ["select", "eq", "abortSignal"]) q[method] = vi.fn(() => q);
    q.maybeSingle = () => Promise.resolve(versionResult); return q;
  });
  mocks.rpc.mockImplementation(() => ({ abortSignal: () => Promise.resolve(rpcResult) }));
  mocks.factory.mockReturnValue({ promoteSource: mocks.promote, recordWordingReview: mocks.review });
  mocks.promote.mockResolvedValue({ versionId: id(7), deliveryAuthorized: false });
  mocks.review.mockResolvedValue({ versionId: version, reviewSha256: "f".repeat(64), deliveryAuthorized: false });
});

describe("owner document HTTP actions", () => {
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

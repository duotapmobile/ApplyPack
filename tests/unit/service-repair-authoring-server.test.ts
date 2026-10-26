// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ load: vi.fn(), read: vi.fn(), write: vi.fn() }));
vi.mock("@/lib/documents/service-repair-render-server", () => ({ loadServiceRepairOriginalEvidence: mocks.load }));
vi.mock("@/lib/materials/service-repair-payload", () => ({ readServiceRepairPayload: mocks.read, storeServiceRepairPayload: mocks.write }));
import { createServiceRepairAuthoringServer, type ServiceRepairSaveSource } from "@/lib/documents/service-repair-authoring-server";
import { buildRecordedDraftOwnerEditModel } from "@/lib/documents/draft-owner-edit";
import { serviceErrorSha256 } from "@/lib/materials/service-error-contract";
import { repairFixtureNow, serviceRepairRenderFixture } from "../fixtures/service-repair-render";
const id = (n: number) => `9c000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const signal = () => new AbortController().signal;
function fixture() {
  const f = serviceRepairRenderFixture(), inspection = structuredClone(f.inspection), calls: string[] = [], allocated: Buffer[] = [];
  Object.assign(inspection.version, { encrypted_payload_id: null, source_sha256: null, claim_review_encrypted_payload_id: null,
    claim_review_sha256: null, claim_review_metadata: null, claims_reviewed_by: null, claims_reviewed_at: null });
  Object.assign(inspection.job, { lease_owner: null, lease_token: null, lease_expires_at: null });
  const state = { payload: null as null | { id: string; customer_id: string; content_sha256: string; retention_state: string },
    saved: null as Buffer | null, clock: repairFixtureNow, loseClaim: false, loseAttach: false, skipAttach: false, wrongAck: false,
    beforeInspect: () => undefined as void };
  const copy = (value: Uint8Array) => { const bytes = Buffer.from(value); allocated.push(bytes); return bytes; };
  mocks.load.mockImplementation(async (_admin, reviewer, identity, child: AbortSignal) => {
    expect(reviewer).toBe(f.reviewerId); expect(identity).toEqual({ caseId: f.identity.caseId, materialLineId: f.identity.materialLineId, versionId: f.identity.versionId });
    expect(child.aborted).toBe(false); const evidence = f.evidence();
    return { inspection: structuredClone(inspection), originals: [{ member: structuredClone(f.original), packet: structuredClone(f.packet),
      source: structuredClone(f.prior), packetBytes: copy(evidence.originals[0].packetBytes), sourceBytes: copy(evidence.originals[0].sourceBytes) }] };
  });
  mocks.read.mockImplementation(async (_admin, input) => { expect(input.payloadId).toBe(state.payload?.id); expect(input.purpose).toBe("SERVICE_REPAIR_SOURCE"); return copy(state.saved!); });
  mocks.write.mockImplementation(async (_admin, input, bytes: Buffer, options) => {
    expect(options.signal.aborted).toBe(false); expect(input.sha256).toBe(serviceErrorSha256(bytes));
    state.saved = Buffer.from(bytes); state.payload = { id: input.payloadId, customer_id: input.customerId, content_sha256: input.sha256, retention_state: "ACTIVE" };
    return { payloadId: input.payloadId, sha256: input.sha256 };
  });
  function query(operation: (child?: AbortSignal) => unknown) {
    let child: AbortSignal | undefined;
    const chain = { abortSignal: (value: AbortSignal) => { child = value; return chain; },
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve().then(() => {
        if (child?.aborted) throw new Error("ABORTED"); return operation(child);
      }).then(resolve, reject) }; return chain;
  }
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => query(child => {
    expect(child).toBeInstanceOf(AbortSignal); calls.push(name);
    if (name === "ap_inspect_service_repair") { state.beforeInspect(); return { data: structuredClone(inspection), error: null }; }
    expect(args.p_version_id).toBe(f.identity.versionId);
    if (name === "ap_claim_service_repair") {
      Object.assign(inspection.job, { lease_owner: args.p_owner, lease_token: id(2), lease_generation: 2,
        lease_expires_at: new Date(state.clock.getTime() + 240_000).toISOString() });
      if (state.loseClaim) throw new Error("lost claim"); return { data: structuredClone(inspection.job), error: null };
    }
    expect(name).toBe("ap_attach_service_repair_source"); expect(args.p_lease_token).toBe(inspection.job.lease_token);
    if (!state.skipAttach) Object.assign(inspection.version, { encrypted_payload_id: args.p_payload_id, source_sha256: args.p_source_sha256 });
    if (state.loseAttach) throw new Error("lost attach"); return { data: state.wrongAck ? id(99) : f.identity.versionId, error: null };
  }));
  const from = vi.fn((table: string) => {
    expect(table).toBe("ap_sensitive_payloads"); let key: unknown;
    const chain = { select: () => chain, eq: (_column: string, value: unknown) => { key = value; return chain; }, abortSignal: () => chain,
      maybeSingle: async () => { expect(key).toBe(id(1)); return { data: state.payload, error: null }; } }; return chain;
  });
  const admin = { rpc, from } as unknown as SupabaseClient<Database>;
  const request: ServiceRepairSaveSource = { caseId: f.identity.caseId, materialLineId: f.identity.materialLineId, versionId: f.identity.versionId,
    requestId: id(1), acceptedScopeSha256: inspection.scope.acceptedScopeSha256, contextSha256: inspection.contextSha256,
    members: [{ originalFileVersionId: f.original.fileVersionId, repairMode: "SOURCE_PRESERVING_RERENDER" }] };
  const server = createServiceRepairAuthoringServer(admin, f.reviewerId, { now: () => state.clock });
  const corrected = () => {
    const output = buildRecordedDraftOwnerEditModel(f.prior, f.packet).output;
    output.coverLetter.body[0].sentences[0].text = "I organized schedules for community events.";
    request.members = [{ originalFileVersionId: f.original.fileVersionId, repairMode: "SOURCE_CORRECTION", output }]; return output;
  };
  return { ...f, inspection, calls, allocated, state, request, server, corrected, rpc, from,
    identity: { caseId: request.caseId, materialLineId: request.materialLineId, versionId: request.versionId },
    clear: () => expect(allocated.every(bytes => bytes.every(value => value === 0))).toBe(true) };
}
beforeEach(() => vi.resetAllMocks());
describe("actual099 immutable repair source authoring", () => {
  it("constructs without I/O; reads exact original prose and facts without an execution lease or repair payload", async () => {
    const f = fixture(); expect(f.calls).toHaveLength(0); expect(mocks.load).not.toHaveBeenCalled();
    const view = await f.server.read(f.identity, signal()); expect(view).toMatchObject({ ...f.identity, sourceSaved: false,
      members: [{ originalFileVersionId: f.original.fileVersionId, artifactType: "COVER_LETTER", model: { output: buildRecordedDraftOwnerEditModel(f.prior, f.packet).output } }] });
    expect(JSON.stringify(view)).not.toContain("lease_token"); expect(mocks.write).not.toHaveBeenCalled(); f.clear();
  });
  it.each([false, true])("saves only exact accepted source mode correction=%s with a separate wording review required", async correction => {
    const f = fixture(); if (correction) f.corrected(); const receipt = await f.server.save(f.request, signal());
    expect(receipt).toMatchObject({ ...f.identity, requestId: f.request.requestId, state: "WORDING_REVIEW_REQUIRED", retryAllowed: false,
      renderingAuthorized: false, deliveryAuthorized: false });
    const body = JSON.parse(f.state.saved!.toString()); expect(body.members).toHaveLength(1);
    expect(body.members[0].source.resume).toEqual(f.prior.resume); expect(body.members[0].source.validUntil).toBe(f.prior.validUntil);
    if (!correction) expect(body.members[0].renderSourceSha256).toBe(f.prior.renderSourceSha256);
    expect(f.calls.filter(n => n === "ap_claim_service_repair")).toHaveLength(1);
    expect(f.calls.filter(n => n === "ap_attach_service_repair_source")).toHaveLength(1); f.clear();
  });
  it("reconciles lost claim and attach replies by exact saved state without repeating mutations", async () => {
    const f = fixture(); f.state.loseClaim = true; f.state.loseAttach = true;
    expect((await f.server.save(f.request, signal())).state).toBe("WORDING_REVIEW_REQUIRED");
    f.state.clock = new Date(repairFixtureNow.getTime() + 120_000);
    expect((await f.server.check(f.request, signal())).replayed).toBe(true);
    expect((await f.server.save(f.request, signal())).replayed).toBe(true);
    expect(f.calls.filter(n => n === "ap_claim_service_repair")).toHaveLength(1);
    expect(f.calls.filter(n => n === "ap_attach_service_repair_source")).toHaveLength(1); expect(mocks.write).toHaveBeenCalledOnce(); f.clear();
  });
  it("checks confirmed absence without acquiring, writing or attaching anything", async () => {
    const f = fixture(); const receipt = await f.server.check(f.request, signal());
    expect(receipt).toMatchObject({ state: "NOT_SAVED", retryAllowed: true });
    expect(f.calls.every(n => n === "ap_inspect_service_repair")).toBe(true); expect(mocks.write).not.toHaveBeenCalled(); f.clear();
  });
  it("reads an orphan payload and permits only the identical explicit attachment retry", async () => {
    const f = fixture(); f.corrected(); f.state.skipAttach = true;
    await expect(f.server.save(f.request, signal())).rejects.toThrow("ATTACH_UNCONFIRMED");
    const mutations = f.calls.filter(n => n !== "ap_inspect_service_repair").length;
    f.state.clock = new Date(repairFixtureNow.getTime() + 120_000);
    expect(await f.server.check(f.request, signal())).toMatchObject({ state: "SOURCE_STORED", retryAllowed: true });
    expect(f.calls.filter(n => n !== "ap_inspect_service_repair")).toHaveLength(mutations);
    f.state.skipAttach = false; expect((await f.server.save(f.request, signal())).state).toBe("WORDING_REVIEW_REQUIRED"); f.clear();
  });
  it.each(["scope", "context", "file", "duplicate", "extra"]) ("rejects changed %s before payload writes", async change => {
    const f = fixture(); let request: unknown = f.request;
    if (change === "scope") f.request.acceptedScopeSha256 = "f".repeat(64);
    if (change === "context") f.request.contextSha256 = "f".repeat(64);
    if (change === "file") f.request.members[0].originalFileVersionId = id(80);
    if (change === "duplicate") f.request.members.push(f.request.members[0]);
    if (change === "extra") request = { ...f.request, reviewerId: id(80) };
    await expect(f.server.save(request, signal())).rejects.toThrow(); expect(mocks.write).not.toHaveBeenCalled(); f.clear();
  });
  it("rejects unsupported corrected wording before claiming or storing, keeping confirmed facts unchanged", async () => {
    const f = fixture(), output = f.corrected(); output.coverLetter.body[0].sentences[0].text = "I managed 999 employees.";
    await expect(f.server.save(f.request, signal())).rejects.toThrow("WORDING_INVALID");
    expect(f.calls).toHaveLength(0); expect(mocks.write).not.toHaveBeenCalled(); f.clear();
  });
  it("does not reuse the request ID for different text or a different owner payload", async () => {
    const f = fixture(); f.corrected(); await f.server.save(f.request, signal());
    f.request.members = [{ originalFileVersionId: f.original.fileVersionId, repairMode: "SOURCE_PRESERVING_RERENDER" }];
    await expect(f.server.check(f.request, signal())).rejects.toThrow("REQUEST_CONFLICT");
    f.state.payload!.customer_id = id(80); await expect(f.server.save(f.request, signal())).rejects.toThrow("REQUEST_CONFLICT");
    expect(mocks.write).toHaveBeenCalledOnce(); f.clear();
  });
  it("does not replace another attached source or another active execution lease", async () => {
    const f = fixture(); f.inspection.version.encrypted_payload_id = id(80);
    await expect(f.server.save(f.request, signal())).rejects.toThrow("SOURCE_ALREADY_SAVED");
    f.inspection.version.encrypted_payload_id = null;
    Object.assign(f.inspection.job, { lease_owner: id(80), lease_token: id(81), lease_expires_at: new Date(repairFixtureNow.getTime() + 240_000).toISOString() });
    await expect(f.server.save(f.request, signal())).rejects.toThrow("REPAIR_BUSY"); expect(mocks.write).not.toHaveBeenCalled(); f.clear();
  });
  it("rejects changed authoritative context before mutation and clears private source buffers", async () => {
    const f = fixture(); f.state.beforeInspect = () => { f.inspection.contextSha256 = "f".repeat(64); };
    await expect(f.server.save(f.request, signal())).rejects.toThrow(); expect(mocks.write).not.toHaveBeenCalled(); f.clear();
  });
  it("does not accept an unrelated successful acknowledgement as proof", async () => {
    const f = fixture(); f.state.wrongAck = true;
    await expect(f.server.save(f.request, signal())).rejects.toThrow("ATTACH_UNCONFIRMED");
    expect((await f.server.check(f.request, signal())).state).toBe("WORDING_REVIEW_REQUIRED"); f.clear();
  });
  it("rejects already cancelled requests before private reads", async () => {
    const f = fixture(), controller = new AbortController(); controller.abort();
    await expect(f.server.save(f.request, controller.signal)).rejects.toThrow(); expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });
  it("clears late loaded originals after cancellation before issuing any additional database work", async () => {
    const f = fixture(), controller = new AbortController(); let finish!: (value: unknown) => void;
    mocks.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = f.server.save(f.request, controller.signal), failed = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(mocks.load).toHaveBeenCalledOnce()); controller.abort(); await failed;
    const original = f.evidence().originals[0]; f.allocated.push(original.packetBytes, original.sourceBytes);
    finish({ inspection: f.inspection, originals: [{ ...original, source: f.prior }] });
    await vi.waitFor(f.clear); expect(f.from).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });
});

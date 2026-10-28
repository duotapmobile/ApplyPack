// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ load: vi.fn(), read: vi.fn(), store: vi.fn(), contact: vi.fn(), references: vi.fn(), oversizedEnvelope: false }));
vi.mock("@/lib/materials/service-error-contract", async original => {
  const actual = await original<typeof import("@/lib/materials/service-error-contract")>();
  return { ...actual, serviceErrorCanonicalJson: (value: unknown) => mocks.oversizedEnvelope && value && typeof value === "object"
    && "schemaVersion" in value && value.schemaVersion === "applypack-service-repair-wording-review-v1"
    ? actual.serviceErrorCanonicalJson({ ...value, simulatedFutureEvidence: "x".repeat(1_000_001) }) : actual.serviceErrorCanonicalJson(value) };
});
vi.mock("@/lib/documents/service-repair-render-server", () => ({ loadServiceRepairOriginalEvidence: mocks.load }));
vi.mock("@/lib/materials/service-repair-payload", () => ({ readServiceRepairPayload: mocks.read, storeServiceRepairPayload: mocks.store }));
vi.mock("@/lib/documents/draft-owner-contact", () => ({ readConfirmedDraftContact: mocks.contact }));
vi.mock("@/lib/documents/draft-owner-references", () => ({ readServiceRepairReviewReferences: mocks.references }));
import { createServiceRepairWordingServer } from "@/lib/documents/service-repair-wording-server";
import { assertBoundServiceRepairMember, assertServiceRepairReviewMember, bindServiceRepairRenderSource, readServiceRepairSourceForReview,
  type ServiceRepairBoundMember } from "@/lib/documents/service-repair-source";
import type { RepairWordingRequest } from "@/lib/materials/service-repair-wording";
import { repairFixtureNow, serviceRepairRenderFixture } from "../fixtures/service-repair-render";
const id = "7b000000-0000-4000-8000-000000000090";
beforeEach(() => { vi.resetAllMocks(); mocks.oversizedEnvelope = false; });
function setup() {
  const f = serviceRepairRenderFixture(), v = f.inspection.version;
  v.claim_review_encrypted_payload_id = null; v.claim_review_sha256 = null; v.claim_review_metadata = null; v.claims_reviewed_by = null; v.claims_reviewed_at = null;
  const payloads = new Map<string, Buffer>(), returned: Buffer[] = [], mutations: Record<string, unknown>[] = [];
  const state = { reviewer: true, loseReply: false, failRead: false, mutateAtStore: false, badReturn: false, noCommit: false };
  mocks.load.mockImplementation(async () => { const e = f.evidence(); returned.push(...e.originals.flatMap(o => [o.packetBytes, o.sourceBytes]));
    return { inspection: structuredClone(f.inspection), originals: e.originals }; });
  mocks.read.mockImplementation(async (_admin, p) => { const value = p.purpose === "SERVICE_REPAIR_SOURCE" ? Buffer.from(f.serialized.body) : Buffer.from(payloads.get(p.payloadId)!);
    returned.push(value); return value; });
  mocks.store.mockImplementation(async (_admin, p, bytes) => { payloads.set(p.payloadId, Buffer.from(bytes));
    if (state.mutateAtStore) f.inspection.contextSha256 = "9".repeat(64); return { payloadId: p.payloadId, sha256: p.sha256 }; });
  mocks.contact.mockImplementation(async () => { const value = Buffer.from(f.document.input.contact.plaintext); returned.push(value); return value; });
  const respond = (work: () => unknown) => ({ abortSignal() { return this; }, then: (yes: (value: unknown) => unknown, no?: (error: unknown) => unknown) =>
    Promise.resolve().then(work).then(data => ({ data, error: null })).then(yes, no) });
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => respond(() => {
    if (name === "ap_require_material_reviewer") return state.reviewer;
    if (name === "ap_inspect_service_repair") return structuredClone(f.inspection);
    if (name !== "ap_review_service_repair_wording") throw new Error("unexpected authority");
    mutations.push(args);
    if (!state.noCommit) Object.assign(v, { claim_review_encrypted_payload_id: args.p_payload_id, claim_review_sha256: args.p_review_sha256,
      claim_review_metadata: args.p_members, claims_reviewed_by: args.p_reviewer_id, claims_reviewed_at: repairFixtureNow.toISOString() });
    if (state.loseReply) throw new Error("private upstream body"); return state.badReturn ? "wrong" : args.p_review_sha256;
  }));
  const from = vi.fn(() => { const q = { select: () => q, eq: () => q, abortSignal: () => q, single: () => q,
    then: (yes: (value: unknown) => unknown, no?: (error: unknown) => unknown) => Promise.resolve().then(() => {
      if (state.failRead) throw new Error("private database body"); return { data: structuredClone(v), error: null }; }).then(yes, no) }; return q; });
  const admin = { rpc, from } as unknown as SupabaseClient<Database>, service = createServiceRepairWordingServer(admin, f.reviewerId, { now: () => repairFixtureNow });
  const signal = new AbortController().signal, identity = { caseId: f.identity.caseId, materialLineId: f.identity.materialLineId, versionId: v.id };
  const request = async (): Promise<RepairWordingRequest> => { const view = await service.read(identity, signal); return { requestId: id, expected: view.expected,
    decisions: view.expected.members.flatMap(member => member.claims.map(claim => ({ originalFileVersionId: member.originalFileVersionId, ...claim, decision: "APPROVED" as const }))) }; };
  return { f, v, state, returned, mutations, payloads, rpc, from, service, signal, identity, request };
}
describe("repair wording review-only capability", () => {
  it("reads saved historical content without inventing a lease or review and cannot render", () => {
    const s = setup(), input = { ...s.identity, inspection: s.f.inspection, ...s.f.evidence() };
    const read = readServiceRepairSourceForReview(input, repairFixtureNow), member = read.members[0];
    expect(read.renderingAuthorized).toBe(false); expect(read.deliveryAuthorized).toBe(false); assertServiceRepairReviewMember(member);
    expect(() => assertServiceRepairReviewMember(structuredClone(member))).toThrow("REVIEW_MEMBER_UNBOUND");
    expect(() => assertBoundServiceRepairMember(member as unknown as ServiceRepairBoundMember)).toThrow("MEMBER_UNBOUND");
    expect(() => bindServiceRepairRenderSource({ ...input, leaseToken: s.f.identity.leaseToken }, repairFixtureNow)).toThrow("AUTHORITY_STALE");
  });
});
describe("explicit099 saved wording review", () => {
  it("displays exact selected wording, local contact and supporting facts without writing", async () => {
    const s = setup(), view = await s.service.read(s.identity, s.signal);
    expect(view.reviewed).toBe(false); expect(view.members.map(m => m.artifactType)).toEqual(["COVER_LETTER"]);
    expect(view.members[0].claims.some(c => c.sources.some(source => source.label.startsWith("Confirmed checkout")))).toBe(true);
    expect(view.members[0].claims.some(c => c.sources.some(source => source.label.includes("·")))).toBe(true);
    expect(s.mutations).toEqual([]); expect(mocks.references).not.toHaveBeenCalled(); expect(s.returned.every(bytes => bytes.every(n => n === 0))).toBe(true);
  });
  it("rejects reviewer before private reads", async () => {
    const s = setup(); s.state.reviewer = false;
    await expect(s.service.read(s.identity, s.signal)).rejects.toThrow("UNCONFIRMED"); expect(mocks.load).not.toHaveBeenCalled(); expect(s.from).not.toHaveBeenCalled();
  });
  it("records all exact explicit decisions once, with trusted reviewer and encrypted review only", async () => {
    const s = setup(), request = await s.request(); const result = await s.service.act(request, false, s.signal);
    expect(result).toMatchObject({ status: "RECORDED", requestId: id, renderingAuthorized: false, deliveryAuthorized: false });
    expect(s.mutations).toHaveLength(1); expect(s.mutations[0]).toMatchObject({ p_version_id: s.v.id, p_reviewer_id: s.f.reviewerId, p_payload_id: id, p_source_sha256: s.v.source_sha256 });
    expect(mocks.store.mock.calls[0][1].purpose).toBe("SERVICE_REPAIR_CLAIM_REVIEW");
    expect(s.v.approval_sha256).toBeNull(); expect(s.v.release_id).toBeNull(); await s.service.act(request, false, s.signal); expect(s.mutations).toHaveLength(1);
    expect(s.returned.every(bytes => bytes.every(n => n === 0))).toBe(true);
  });
  it.each(["missing", "duplicate", "wronghash", "rejected", "reviewer"])("rejects %s decisions before saving", async mode => {
    const s = setup(), request = await s.request(), raw: Record<string, unknown> = structuredClone(request);
    if (mode === "missing") raw.decisions = request.decisions.slice(1);
    if (mode === "duplicate") raw.decisions = [...request.decisions, request.decisions[0]];
    if (mode === "wronghash") raw.decisions = request.decisions.map((d, i) => i ? d : { ...d, wordingSha256: "0".repeat(64) });
    if (mode === "rejected") raw.decisions = request.decisions.map(d => ({ ...d, decision: "REJECTED" }));
    if (mode === "reviewer") raw.reviewerId = id;
    await expect(s.service.act(raw, false, s.signal)).rejects.toThrow("INVALID"); expect(s.mutations).toEqual([]); expect(mocks.store).not.toHaveBeenCalled();
  });
  it("CHECK is read-only and distinguishes failed reads from absence", async () => {
    const s = setup(), request = await s.request(); await expect(s.service.act(request, true, s.signal)).resolves.toMatchObject({ status: "ABSENT" });
    expect(s.mutations).toEqual([]); expect(mocks.store).not.toHaveBeenCalled(); s.state.failRead = true;
    await expect(s.service.act(request, true, s.signal)).rejects.toThrow("UNCONFIRMED");
  });
  it("keeps recorded wording readable after rendering and approval without reopening review", async () => {
    const s = setup(), request = await s.request(); await s.service.act(request, false, s.signal);
    s.v.member_set_sha256 = "7".repeat(64); s.v.approval_sha256 = "8".repeat(64);
    const view = await s.service.read(s.identity, s.signal); expect(view.reviewed).toBe(true); expect(view.renderingAuthorized).toBe(false);
    expect(s.mutations).toHaveLength(1);
  });
  it("does not create missing wording review after a member set has already been registered", async () => {
    const s = setup(), request = await s.request(); s.v.member_set_sha256 = "7".repeat(64);
    await expect(s.service.act(request, false, s.signal)).rejects.toThrow("CHANGED"); expect(s.mutations).toEqual([]); expect(mocks.store).not.toHaveBeenCalled();
  });
  it("reconciles committed response loss without retry, even after later invalidation", async () => {
    const s = setup(), request = await s.request(); s.state.loseReply = true;
    await expect(s.service.act(request, false, s.signal)).resolves.toMatchObject({ status: "RECORDED" });
    s.v.invalidated_at = repairFixtureNow.toISOString(); s.f.inspection.contextSha256 = "9".repeat(64); mocks.load.mockClear();
    await expect(s.service.act(request, true, s.signal)).resolves.toMatchObject({ status: "RECORDED" }); expect(mocks.load).not.toHaveBeenCalled(); expect(s.mutations).toHaveLength(1);
  });
  it.each(["lost", "contradictory"])("does not claim success on %s mutation outcome", async mode => {
    const s = setup(), request = await s.request(); s.state.noCommit = mode === "lost"; s.state.loseReply = mode === "lost"; s.state.badReturn = mode === "contradictory";
    await expect(s.service.act(request, false, s.signal)).rejects.toThrow("UNCONFIRMED"); expect(s.mutations).toHaveLength(1);
  });
  it("does not mutate after context changes during encrypted persistence or delete its uncertain payload", async () => {
    const s = setup(), request = await s.request(); s.state.mutateAtStore = true;
    await expect(s.service.act(request, false, s.signal)).rejects.toThrow("CHANGED"); expect(s.mutations).toEqual([]); expect(s.payloads.has(id)).toBe(true);
  });
  it("rejects oversized serialized review evidence before encrypted storage or SQL mutation", async () => {
    const s = setup(), request = await s.request(); mocks.oversizedEnvelope = true;
    await expect(s.service.act(request, false, s.signal)).rejects.toThrow("TOO_LARGE");
    expect(mocks.store).not.toHaveBeenCalled(); expect(s.mutations).toEqual([]); expect(s.payloads.size).toBe(0);
  });
  it("does not substitute a different request, reviewer or metadata for a saved receipt", async () => {
    const s = setup(), request = await s.request(); await s.service.act(request, false, s.signal);
    await expect(s.service.act({ ...request, requestId: "7b000000-0000-4000-8000-000000000091" }, true, s.signal)).rejects.toThrow("CHANGED");
    s.v.claims_reviewed_by = id; await expect(s.service.act(request, true, s.signal)).rejects.toThrow("CHANGED");
  });
  it("clears late private contact bytes after cancellation without mutation", async () => {
    const s = setup(), controller = new AbortController(); let finish!: (value: Buffer) => void;
    mocks.contact.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const result = s.service.read(s.identity, controller.signal), check = expect(result).rejects.toThrow();
    await vi.waitFor(() => expect(finish).toBeTypeOf("function")); controller.abort(); await check;
    const bytes = Buffer.from(s.f.document.input.contact.plaintext); finish(bytes);
    await vi.waitFor(() => expect(bytes.every(n => n === 0)).toBe(true)); expect(s.mutations).toEqual([]);
  });
});

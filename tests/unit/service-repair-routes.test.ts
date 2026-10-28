// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ auth: vi.fn(), origin: vi.fn(), store: vi.fn() }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.auth }));
vi.mock("@/lib/security/origin", () => ({ isSameOriginRequest: mocks.origin }));
vi.mock("@/lib/materials/service-repair-store", () => ({ createServiceRepairStore: mocks.store }));
import { GET, POST } from "@/app/api/admin/service-errors/[id]/repairs/[materialLineId]/route";
import { serviceRepairAcceptedScope } from "@/lib/materials/service-repair-contract";
import type { ServiceRepairVersion } from "@/lib/materials/service-repair-workflow";
const id = (n: number) => `99000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const caseId = id(1), line = id(2), customer = id(3), reviewer = id(4), time = "2026-10-25T12:00:00Z";
const acceptedRows = [{ id: id(5), case_id: caseId, decision_id: id(6), customer_id: customer, material_line_id: line,
  source_snapshot_id: id(7), artifact_id: id(8), file_version_id: id(9), release_id: id(10), member_kind: "ACCEPTED_ERROR" as const }];
const normalized = serviceRepairAcceptedScope({ caseId, customerId: customer }, acceptedRows);
const scope = { schemaVersion: normalized.schemaVersion, caseId, customerId: customer, members: normalized.members, acceptedScopeSha256: normalized.acceptedScopeSha256 };
const original = { ...scope.members[0], artifactType: "COVER_LETTER" as const, checksumSha256: "a".repeat(64), draftVersionId: id(11), draftJobId: id(12),
  packetPayloadId: id(13), packetSha256: "b".repeat(64), sourcePayloadId: id(14), sourceSha256: "c".repeat(64), revisionId: id(15), revisionVersion: 1,
  bindingSha256: "d".repeat(64), approvedAt: time, deliveredAt: time };
const request = { requestId: id(16), caseId, materialLineId: line, expectedVersionId: null, acceptedScopeSha256: scope.acceptedScopeSha256, contextSha256: "e".repeat(64) };
const version: ServiceRepairVersion = { id: id(17), request_id: request.requestId, job_id: id(18), case_id: caseId, customer_id: customer, material_line_id: line,
  version: 1, supersedes_id: null, accepted_scope_sha256: request.acceptedScopeSha256, context_sha256: request.contextSha256, originals: [original],
  encrypted_payload_id: null, source_sha256: null, claim_review_encrypted_payload_id: null, claim_review_sha256: null, claim_review_metadata: null,
  claims_reviewed_by: null, claims_reviewed_at: null, member_set_sha256: null, approval_sha256: null, review_checklist: null, approved_by: null,
  approved_at: null, release_id: null, invalidated_at: null, created_by: reviewer, created_at: time };
const inspection = { scope, acceptedRows, originals: [original], contextSha256: request.contextSha256, job: null, version: null, latestRepairs: [], feedback: [] };
const route = (idValue = caseId, lineValue = line) => ({ params: Promise.resolve({ id: idValue, materialLineId: lineValue }) });
const url = `https://applypack.work/api/admin/service-errors/${caseId}/repairs/${line}`;
const post = (body: unknown = request) => new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const privateResponse = (response: Response) => { expect(response.headers.get("Cache-Control")).toBe("no-store, private"); expect(response.headers.get("Referrer-Policy")).toBe("no-referrer"); };
let stored: ServiceRepairVersion | null;
let store: { requireReviewer: ReturnType<typeof vi.fn>; inspect: ReturnType<typeof vi.fn>; readVersion: ReturnType<typeof vi.fn>; open: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.clearAllMocks(); stored = null; mocks.origin.mockReturnValue(true); mocks.auth.mockResolvedValue({ ok: true, user: { id: reviewer }, admin: { authenticated: true } });
  store = { requireReviewer: vi.fn().mockResolvedValue(true), inspect: vi.fn().mockResolvedValue(inspection), readVersion: vi.fn(async () => stored),
    open: vi.fn(async () => { stored = structuredClone(version); return version.id; }) }; mocks.store.mockReturnValue(store);
});
describe("authenticated scoped-repair opening routes", () => {
  it("requires same origin before mutation auth and fresh staff access before any private read", async () => {
    mocks.origin.mockReturnValue(false); const response = await POST(post(), route()); expect(response.status).toBe(403); privateResponse(response);
    expect(mocks.auth).not.toHaveBeenCalled(); expect(mocks.store).not.toHaveBeenCalled();
    mocks.origin.mockReturnValue(true); mocks.auth.mockImplementation(async () => ({ ok: false, response: new Response("Fresh MFA required", { status: 403 }) }));
    for (const response of [await GET(new Request(url), route()), await POST(post(), route())]) { expect(response.status).toBe(403); privateResponse(response); }
    expect(mocks.store).not.toHaveBeenCalled();
  });
  it("binds both path identities, rejects client authority and invalid bodies before the store", async () => {
    for (const body of [{ ...request, caseId: id(40) }, { ...request, materialLineId: id(40) }, { ...request, reviewerId: reviewer },
      { ...request, renderingAuthorized: true }, { ...request, contextSha256: "invalid" }]) expect((await POST(post(body), route())).status).toBe(400);
    expect((await POST(post({ prose: "x".repeat(100_000) }), route())).status).toBe(400);
    expect((await GET(new Request(url), route("invalid"))).status).toBe(404); expect(mocks.store).not.toHaveBeenCalled();
  });
  it("returns only selected metadata, never private sources, credentials or execution leases", async () => {
    const response = await GET(new Request(url), route()); expect(response.status).toBe(200); privateResponse(response);
    const result = await response.json(); expect(result.summary).toMatchObject({ caseId, materialLineId: line, current: null, originals: [{ artifactType: "COVER_LETTER" }] });
    expect(Object.keys(result.summary.originals[0]).sort()).toEqual(["artifactId", "artifactType", "deliveredAt", "fileVersionId"]);
    const text = JSON.stringify(result); for (const value of [customer, original.packetPayloadId, original.sourcePayloadId, "acceptedRows", "lease_token"]) expect(text).not.toContain(value);
    expect(store.inspect).toHaveBeenCalledExactlyOnceWith(caseId, line, reviewer, expect.any(AbortSignal));
  });
  it("rejects incomplete authoritative union and sanitized provider failure", async () => {
    store.inspect.mockResolvedValue({ ...inspection, acceptedRows: [] }); expect((await GET(new Request(url), route())).status).toBe(503);
    store.inspect.mockRejectedValue(new Error("private provider value")); const response = await GET(new Request(url), route()); expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private provider value"); privateResponse(response);
  });
  it("uses the actual opening workflow and exact readback when the mutation reply is lost", async () => {
    store.open.mockImplementation(async () => { stored = structuredClone(version); throw new Error("lost reply"); });
    const response = await POST(post(), route()); expect(response.status).toBe(200); privateResponse(response);
    expect(await response.json()).toMatchObject({ receipt: { id: version.id, requestId: request.requestId, caseId, materialLineId: line }, renderingAuthorized: false, deliveryAuthorized: false });
    expect(store.open).toHaveBeenCalledExactlyOnceWith({ ...request, reviewerId: reviewer }, expect.any(AbortSignal));
    expect(store.readVersion).toHaveBeenCalledTimes(2);
    expect((await POST(post(), route())).status).toBe(200); expect(store.open).toHaveBeenCalledOnce();
  });
  it("reports ambiguous acknowledgement as unconfirmed and a changed scope as conflict", async () => {
    store.open.mockResolvedValue(version.id); expect((await POST(post(), route())).status).toBe(503);
    store.inspect.mockResolvedValue({ ...inspection, contextSha256: "f".repeat(64) }); expect((await POST(post(), route())).status).toBe(409);
    expect(store.open).toHaveBeenCalledOnce();
  });
  it("reads exact historical request status without opening or exposing a foreign case, line or author", async () => {
    const read = () => GET(new Request(`${url}?requestId=${request.requestId}`), route());
    expect(await (await read()).json()).toEqual({ receipt: null }); stored = { ...version, invalidated_at: time };
    expect(await (await read()).json()).toMatchObject({ receipt: { id: version.id, requestId: request.requestId } });
    for (const change of [{ case_id: id(40) }, { material_line_id: id(40) }, { created_by: id(40) }, { request_id: id(40) }]) {
      stored = { ...version, ...change }; expect((await read()).status).toBe(404);
    }
    expect(store.open).not.toHaveBeenCalled(); expect(store.inspect).not.toHaveBeenCalled();
  });
  it("does not treat malformed read requests or failed reviewer authorization as absence", async () => {
    expect((await GET(new Request(`${url}?requestId=bad`), route())).status).toBe(400);
    expect((await GET(new Request(`${url}?requestId=${id(20)}&requestId=${id(21)}`), route())).status).toBe(400);
    store.requireReviewer.mockResolvedValue(false); expect((await GET(new Request(`${url}?requestId=${id(20)}`), route())).status).toBe(503);
    expect(store.readVersion).not.toHaveBeenCalled();
  });
});

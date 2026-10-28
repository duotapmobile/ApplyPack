import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), read: vi.fn(), store: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "verified-customer" } } }) } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
vi.mock("@/lib/security/origin", () => ({ isSameOriginRequest: () => true }));
vi.mock("@/lib/security/rate-limit", () => ({ consumeRateLimit: async () => ({ configured: true, allowed: true }) }));
vi.mock("@/lib/materials/references", async () => {
  const { z } = await import("zod");
  return { referencePayloadSchema: z.object({ name: z.string() }), readReferencePayload: mocks.read, storeReferencePayload: mocks.store };
});
import { GET, POST } from "@/app/api/customer/references/route";
import { PATCH, DELETE } from "@/app/api/customer/references/[opaqueId]/route";
const opaqueId = "10000000-0000-4000-8000-000000000001";
const recordId = "10000000-0000-4000-8000-000000000002";
const versionId = "10000000-0000-4000-8000-000000000003";
const route = { params: Promise.resolve({ opaqueId }) };
const request = (method: string) => new Request(`https://applypack.work/api/customer/references/${opaqueId}`, {
  method, body: method === "DELETE" ? undefined : JSON.stringify({ reference: { name: "Synthetic reference" }, permissionContactConfirmed: true }),
});
beforeEach(() => {
  vi.clearAllMocks();
  const query = { select: () => query, eq: () => query, is: () => query, order: async () => ({ data: [], error: null }), maybeSingle: async () => ({ data: { id: recordId, current_version: 1 }, error: null }) };
  mocks.from.mockReturnValue(query);
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "ap_replace_reference" ? versionId : true, error: null }));
  mocks.store.mockResolvedValue({ payloadSha256: "a".repeat(64) });
});
describe("private reference access after service expiry", () => {
  it("does not query or decrypt private references for expired-only customers", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ references: [], accessExpired: true });
    expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });
  it("fails closed without leaking provider detail when retention cannot be verified", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "private-provider-detail" } });
    const response = await GET();
    expect(response.status).toBe(503); expect(JSON.stringify(await response.json())).not.toContain("private-provider-detail");
    expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });
  it("preserves account references when the database verifies historical or ongoing paid access", async () => {
    expect((await GET()).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("ap_customer_private_retention_access", { p_customer_id: "verified-customer" });
    expect(mocks.from).toHaveBeenCalledWith("ap_reference_records");
  });
  it("does not expose expired job permissions merely because another family keeps a shared reference active", async () => {
    const visibleId = "10000000-0000-4000-8000-000000000004";
    const hiddenId = "10000000-0000-4000-8000-000000000005";
    const payloadId = "10000000-0000-4000-8000-000000000006";
    const rows: Record<string, unknown[]> = {
      ap_reference_records: [{ id: recordId, opaque_client_id: opaqueId, current_version: 1 }],
      ap_reference_record_versions: [{ id: versionId, reference_record_id: recordId, version: 1, encrypted_payload_id: payloadId, permission_status: "CONFIRMED" }],
      ap_sensitive_payloads: [{ id: payloadId }],
      ap_reference_permissions: [visibleId, hiddenId].map((id) => ({ id, reference_record_version_id: versionId,
        job_snapshot_id: id, employer_snapshot: id === hiddenId ? "Expired private employer" : "Current employer", exact_position_snapshot: "Position", revoked_at: null, contact_version_changed_at: null })),
    };
    mocks.from.mockImplementation((table: string) => {
      const query = { select: () => query, eq: () => query, is: () => query, in: () => query, order: () => query,
        then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => Promise.resolve(resolve({ data: rows[table], error: null })) };
      return query;
    });
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === "ap_customer_visible_reference_permissions" ? [visibleId] : true, error: null }));
    mocks.read.mockResolvedValue({ name: "Synthetic shared reference" });
    const response = await GET();
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.references[0].allowedApplications.map((item: { permissionId: string }) => item.permissionId)).toEqual([visibleId]);
    expect(JSON.stringify(result)).not.toContain("Expired private employer");
    expect(mocks.rpc).toHaveBeenCalledWith("ap_customer_visible_reference_permissions", { p_customer_id: "verified-customer" });
  });
  it("rejects new reference content before encryption when access has expired", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });
    expect((await POST(request("POST"))).status).toBe(410);
    expect(mocks.store).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
  });
  it.each([false, null])("rejects replacement content for denied or unknown access (%s)", async (allowed) => {
    mocks.rpc.mockResolvedValue({ data: allowed, error: null });
    expect((await PATCH(request("PATCH"), route))?.status).toBe(allowed === false ? 410 : 503);
    expect(mocks.store).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalledWith("ap_replace_reference", expect.anything());
  });
  it("allows required reference updates for an ongoing paid obligation", async () => {
    expect((await PATCH(request("PATCH"), route))?.status).toBe(200);
    expect(mocks.store).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("ap_replace_reference", expect.objectContaining({ p_customer_id: "verified-customer", p_reference_record_id: recordId }));
  });
  it("keeps customer reference revocation available without reopening content access", async () => {
    expect((await DELETE(request("DELETE"), route))?.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("ap_remove_reference", { p_customer_id: "verified-customer", p_reference_record_id: recordId, p_reason_code: "CUSTOMER_REMOVED" });
    expect(mocks.store).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });
});

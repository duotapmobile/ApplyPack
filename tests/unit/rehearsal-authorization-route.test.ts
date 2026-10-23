// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const mocks = vi.hoisted(() => ({ access: vi.fn(), origin: vi.fn(), rpc: vi.fn(), reconcile: vi.fn(), mode: "LOCKED_STAGING" }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.access }));
vi.mock("@/lib/security/origin", () => ({ isSameOriginRequest: mocks.origin }));
vi.mock("@/lib/stripe/mode", () => ({ checkoutConfiguration: () => ({ state: mocks.mode, validState: mocks.mode !== "INVALID" }) }));
vi.mock("@/lib/operations/summary", () => ({ safeReleaseSha: () => "a".repeat(40) }));
vi.mock("@/lib/commerce/checkout-initiation", () => ({ reconcileCheckoutInitiations: mocks.reconcile }));
vi.mock("@/lib/operations/launch-readiness", () => ({ evaluateLaunchInfrastructure: vi.fn(), manualLaunchCanaryCheckoutGate: vi.fn(), manualLaunchCheckoutGate: vi.fn() }));
import { POST, PATCH } from "@/app/api/admin/manual-launch/rehearsal-authorizations/route";
import { POST as authorizeCanary } from "@/app/api/admin/manual-launch/canary-authorizations/route";
import { PATCH as revokeCanary } from "@/app/api/admin/manual-launch/canary-authorizations/route";
import { POST as refundCanary } from "@/app/api/admin/manual-launch/canary-refunds/route";
import { POST as retryCanary } from "@/app/api/admin/manual-launch/canary-retries/route";

const id = "00000000-0000-4000-8000-000000000001";
const secondId = "00000000-0000-4000-8000-000000000002";
const body = () => ({ productKind: "SEARCH", customerId: id, resourceId: secondId,
  evidenceReference: "operator-reviewed-rehearsal", expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() });
const request = (value: unknown) => new Request("https://applypack-staging-staging.up.railway.app/api/admin/manual-launch/rehearsal-authorizations", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(value),
});
describe("service-only rehearsal authorization endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.mode = "LOCKED_STAGING"; mocks.origin.mockReturnValue(true);
    mocks.rpc.mockResolvedValue({ data: id, error: null }); mocks.reconcile.mockResolvedValue({ processed: 1, unresolved: 0 });
    mocks.access.mockResolvedValue({ ok: true, role: "admin", user: { id: secondId }, admin: { rpc: mocks.rpc } });
    vi.stubEnv("APP_RELEASE_SHA", "a".repeat(40)); vi.stubEnv("RAILWAY_GIT_COMMIT_SHA", "");
  });
  afterEach(() => vi.unstubAllEnvs());
  it("rejects cross-origin mutation before reading admin identity", async () => {
    mocks.origin.mockReturnValue(false);
    expect((await POST(request(body()))).status).toBe(403);
    expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("preserves fresh TOTP denial and does not let an operator authorize rehearsal", async () => {
    mocks.access.mockResolvedValueOnce({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await POST(request(body()))).status).toBe(403);
    mocks.access.mockResolvedValueOnce({ ok: true, role: "operator" });
    expect((await POST(request(body()))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["LOCKED_PRODUCTION", "PUBLIC_INVITATION", "STAGING_CANARY", "INVALID"])("rejects non-rehearsal deployment %s", async (state) => {
    mocks.mode = state; expect((await POST(request(body()))).status).toBe(503); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects a lifetime over thirty minutes and a previously expired authorization", async () => {
    for (const delta of [31 * 60_000, -1_000]) {
      expect((await POST(request({ ...body(), expiresAt: new Date(Date.now() + delta).toISOString() }))).status).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("binds the actor, release, exact resource, product and selected jobs", async () => {
    const input = { ...body(), productKind: "MATERIALS", selectedJobIds: [secondId, id] };
    expect((await POST(request(input))).status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith("ap_authorize_staging_rehearsal_checkout", expect.objectContaining({
      p_actor_id: secondId, p_release_sha: "a".repeat(40), p_customer_id: id, p_resource_id: secondId, p_product_kind: "MATERIALS",
      p_resource_sha256: createHash("sha256").update([id, secondId].join(",")).digest("hex"),
    }));
  });
  it("records revocation first and reports unresolved provider work truthfully", async () => {
    mocks.mode = "LOCKED_STAGING"; mocks.reconcile.mockResolvedValue({ processed: 0, unresolved: 1 });
    const response = await PATCH(request({ authorizationId: id, evidenceReference: "operator-stopped-rehearsal" }));
    expect(response.status).toBe(200); await expect(response.json()).resolves.toMatchObject({ ok: true, reconciliationPending: true });
    expect(mocks.rpc).toHaveBeenCalledWith("ap_revoke_staging_rehearsal_checkout", expect.objectContaining({ p_actor_id: secondId, p_authorization_id: id }));
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.reconcile.mock.invocationCallOrder[0]);
  });
  it("requires an exact delivered release and a single selected job for a materials canary", async () => {
    const canary = { productKind: "MATERIALS", expectedCustomerId: id,
      evidenceReference: "canary-product-approval", expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() };
    expect((await authorizeCanary(request(canary))).status).toBe(400);
    expect((await authorizeCanary(request({ ...canary, deliveredReleaseId: secondId, selectedJobIds: [id, secondId] }))).status).toBe(400);
    expect((await authorizeCanary(request({ ...canary, deliveredReleaseId: secondId, selectedJobIds: [id] }))).status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith("ap_authorize_scoped_manual_launch_canary_checkout", expect.objectContaining({
      p_resource_id: secondId, p_resource_sha256: createHash("sha256").update(id).digest("hex"), p_actor_id: secondId,
    }));
  });
  it.each(["LOCKED_PRODUCTION", "PUBLIC_INVITATION", "INVALID"])("rejects new canary authorization, special refunds and retries in %s", async (state) => {
    mocks.mode = state;
    expect((await authorizeCanary(request({}))).status).toBe(503);
    expect((await refundCanary(request({}))).status).toBe(409);
    expect((await retryCanary(request({}))).status).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("preserves production canary revocation and reconciliation for historical authorizations", async () => {
    mocks.mode = "LOCKED_PRODUCTION"; mocks.rpc.mockResolvedValue({ data: true, error: null });
    const response = await revokeCanary(request({ authorizationId: id, evidenceReference: "historical-canary-revocation" }));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("ap_revoke_manual_launch_canary_checkout", expect.objectContaining({ p_authorization_id: id }));
    expect(mocks.reconcile).toHaveBeenCalled();
  });
});

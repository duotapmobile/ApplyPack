// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sandboxReleaseSha, sandboxValidationFixture, sandboxVerifiedAt } from "../fixtures/sandbox-validation";
import { SANDBOX_ACTIVATION_CONTRACT_VERSION, sandboxValidationMatchesRelease, sandboxValidationSchema } from "@/lib/operations/sandbox-validation";

const mocks = vi.hoisted(() => ({ access: vi.fn(), origin: vi.fn(), rpc: vi.fn(), state: "LOCKED_PRODUCTION", releaseSha: "a".repeat(40) }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.access }));
vi.mock("@/lib/security/origin", () => ({ isSameOriginRequest: mocks.origin }));
vi.mock("@/lib/operations/summary", () => ({ safeReleaseSha: () => mocks.releaseSha }));
vi.mock("@/lib/stripe/mode", async (original) => ({
  ...await original<typeof import("@/lib/stripe/mode")>(),
  checkoutConfiguration: () => ({ state: mocks.state }),
}));

import { POST } from "@/app/api/admin/manual-launch/activations/route";

const actorId = "00000000-0000-4000-8000-000000000005";
const activationId = "00000000-0000-4000-8000-000000000006";
const references = Object.fromEntries([
  "healthEvidenceReference", "databaseEvidenceReference", "paymentEvidenceReference", "emailEvidenceReference",
  "kmsEvidenceReference", "workerEvidenceReference", "maintenanceEvidenceReference", "backupRestoreEvidenceReference",
  "inventoryEvidenceReference", "accessibilityEvidenceReference", "productSupervisorReference", "securitySupervisorReference",
  "operationsSupervisorReference", "tenthManSupervisorReference", "acceptedP2DispositionReference", "legacySubscriptionRetirementReference",
].map((name) => [name, `reviewed-proof-${name}`]));

function activation() {
  return {
    activationPhase: "PUBLIC",
    activationContractVersion: SANDBOX_ACTIVATION_CONTRACT_VERSION,
    evidence: {
      ...references,
      workerNetworkAttestationSha256: "c".repeat(64), evidenceBundleSha256: "d".repeat(64),
      sandboxValidation: sandboxValidationFixture(),
    },
  };
}
const request = (body: unknown) => new Request("https://applypack.work/api/admin/manual-launch/activations", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

describe("strict sandbox proof receipt", () => {
  it("requires complete proof for one fixed-total purchase and full refund per product", () => {
    expect(sandboxValidationSchema.safeParse(sandboxValidationFixture()).success).toBe(true);
    for (const purchases of [[], [sandboxValidationFixture().purchases[0]], [...sandboxValidationFixture().purchases, sandboxValidationFixture().purchases[0]]]) {
      expect(sandboxValidationSchema.safeParse({ ...sandboxValidationFixture(), purchases }).success).toBe(false);
    }
  });

  it.each([
    { schemaVersion: "legacy-receipt" },
    { sourceEnvironment: "production" }, { sourceProjectRef: "otherproject" }, { sourceOrigin: "https://applypack.work" },
    { stripeAccountId: "acct_wrong" }, { livemode: true }, { currency: "usd" },
    { releaseSha: "short" }, { verifiedAt: "yesterday" }, { proofBundleSha256: "not-a-digest" }, { forgedSignature: "signed" },
  ])("rejects incorrect identity, mode or unrecognized receipt fields: %o", (change) => {
    expect(sandboxValidationSchema.safeParse({ ...sandboxValidationFixture(), ...change }).success).toBe(false);
  });

  it.each([
    { units: 2 }, { amountCents: 799 }, { amountCents: 1_900 }, { refundAmountCents: 799 }, { refundStatus: "pending" },
    { paymentAttemptId: "payment" }, { checkoutSessionId: "cs_live_search" }, { paymentIntentId: "ch_search" },
    { checkoutCompletedEventId: null }, { deliveredReleaseId: null }, { refundId: "rf_search" }, { unchecked: true },
  ])("rejects incomplete or contradictory purchase proof: %o", (change) => {
    const receipt = sandboxValidationFixture();
    expect(sandboxValidationSchema.safeParse({ ...receipt, purchases: [{ ...receipt.purchases[0], ...change }, receipt.purchases[1]] }).success).toBe(false);
  });

  it.each(["paymentAttemptId", "checkoutSessionId", "paymentIntentId", "checkoutCompletedEventId", "deliveredReleaseId", "refundId"] as const)(
    "rejects reusing one transaction's %s as proof of both purchases", (key) => {
      const receipt = sandboxValidationFixture(); receipt.purchases[1][key] = receipt.purchases[0][key];
      expect(sandboxValidationSchema.safeParse(receipt).success).toBe(false);
    },
  );

  it("rejects two search proofs even if their transaction identities differ", () => {
    const receipt = sandboxValidationFixture();
    receipt.purchases[1] = { ...receipt.purchases[1], productKind: "SEARCH", amountCents: 1_899, refundAmountCents: 1_899 };
    expect(sandboxValidationSchema.safeParse(receipt).success).toBe(false);
  });

  it("binds the exact release and rejects future or stale verification at approval", () => {
    const receipt = sandboxValidationFixture(); const verifiedAt = Date.parse(sandboxVerifiedAt);
    expect(sandboxValidationMatchesRelease(receipt, sandboxReleaseSha, verifiedAt)).toBe(true);
    expect(sandboxValidationMatchesRelease(receipt, sandboxReleaseSha, verifiedAt + 86_400_000)).toBe(true);
    expect(sandboxValidationMatchesRelease(receipt, sandboxReleaseSha, verifiedAt + 86_400_001)).toBe(false);
    expect(sandboxValidationMatchesRelease(receipt, sandboxReleaseSha, verifiedAt - 1)).toBe(false);
    expect(sandboxValidationMatchesRelease(receipt, "b".repeat(40), verifiedAt)).toBe(false);
    expect(sandboxValidationMatchesRelease(receipt, sandboxReleaseSha, Number.NaN)).toBe(false);
  });
});

describe("sandbox-backed PUBLIC activation boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-23T13:00:00.000Z"));
    mocks.state = "LOCKED_PRODUCTION"; mocks.releaseSha = sandboxReleaseSha; mocks.origin.mockReturnValue(true);
    mocks.rpc.mockResolvedValue({ data: activationId, error: null });
    mocks.access.mockResolvedValue({ ok: true, role: "admin", user: { id: actorId }, admin: { rpc: mocks.rpc } });
  });
  afterEach(() => vi.useRealTimers());

  it("binds the authenticated administrator and deployed SHA and leaves digest calculation to the database", async () => {
    const body = activation(); const response = await POST(request(body));
    expect(response.status).toBe(201); expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(mocks.rpc).toHaveBeenCalledWith("ap_record_manual_launch_activation", {
      p_activation_phase: "PUBLIC", p_release_sha: sandboxReleaseSha, p_actor_id: actorId,
      p_evidence: { ...body.evidence, activationContractVersion: SANDBOX_ACTIVATION_CONTRACT_VERSION },
    });
    await expect(response.json()).resolves.toMatchObject({ activationId, activationContractVersion: SANDBOX_ACTIVATION_CONTRACT_VERSION });
  });

  it("retains CSRF, fresh MFA and administrator privilege gates before recording proof", async () => {
    mocks.origin.mockReturnValueOnce(false);
    expect((await POST(request(activation()))).status).toBe(403); expect(mocks.access).not.toHaveBeenCalled();
    mocks.access.mockResolvedValueOnce({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await POST(request(activation()))).status).toBe(403);
    mocks.access.mockResolvedValueOnce({ ok: true, role: "operator" });
    expect((await POST(request(activation()))).status).toBe(403); expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects old PUBLIC contracts and client-provided actor or calculated digest", async () => {
    const body = activation();
    const inputs = [
      { ...body, activationContractVersion: undefined },
      { ...body, activationContractVersion: "legacy-production-canary-v1" },
      { ...body, evidence: { ...body.evidence, sandboxValidation: undefined } },
      { ...body, evidence: { ...body.evidence, canaryReconciliationReference: "legacy-production-refunds" } },
      { ...body, actorId }, { ...body, evidence: { ...body.evidence, sandboxValidationDigest: "f".repeat(64) } },
    ];
    for (const input of inputs) expect((await POST(request(input))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(["STAGING_CANARY", "STAGING_REHEARSAL", "LOCKED_STAGING", "INVALID"])("rejects PUBLIC activation in %s", async (state) => {
    mocks.state = state; expect((await POST(request(activation()))).status).toBe(409); expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    { verifiedAt: "2026-10-22T12:59:59.999Z" }, { verifiedAt: "2026-10-23T13:00:00.001Z" }, { releaseSha: "b".repeat(40) },
  ])("rejects old, future or wrong-release proofs before the RPC: %o", async (change) => {
    const body = activation();
    expect((await POST(request({ ...body, evidence: { ...body.evidence, sandboxValidation: { ...body.evidence.sandboxValidation, ...change } } }))).status).toBe(409);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns a conflict when database approval evidence cannot be persisted", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "gate blocked" } });
    const response = await POST(request(activation())); expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Public activation requires the verified sandbox receipt and every reviewed launch gate." });
  });

  it("preserves staging canary activation without accepting new production canaries", async () => {
    const body = activation();
    const canary = { activationPhase: "CANARY", evidence: { ...body.evidence, sandboxValidation: undefined, canaryReconciliationReference: "staging-sandbox-only-proof" } };
    expect((await POST(request(canary))).status).toBe(409); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.state = "LOCKED_STAGING";
    expect((await POST(request(canary))).status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith("ap_record_manual_launch_activation", expect.objectContaining({ p_activation_phase: "CANARY" }));
  });
});

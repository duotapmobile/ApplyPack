// Actual material checkout handler; provider/configuration boundaries are fictional.
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const boundary = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), create: vi.fn(), operationalStripe: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ from: boundary.from, rpc: boundary.rpc }) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "a1150000-0000-4000-8000-000000000001" } } }) } }) }));
vi.mock("@/lib/security/rate-limit", () => ({ consumeRateLimit: async () => ({ configured: true, allowed: true }) }));
vi.mock("@/lib/commerce/checkout-authorization", () => ({ authorizeCheckout: async () => ({ mode: "REHEARSAL", releaseSha: "a".repeat(40), authorizationId: "a1150000-0000-4000-8000-000000000011" }), selectedJobResourceSha256: () => "b".repeat(64) }));
vi.mock("@/lib/commerce/checkout-initiation", () => ({ createOrResumeCheckoutSession: boundary.create }));
vi.mock("@/lib/stripe/server", () => ({ createStripeMaterialsClient: () => ({}), createStripeOperationalClient: boundary.operationalStripe, assertConfiguredPrice: async () => undefined }));
vi.mock("@/lib/stripe/mode", () => ({ checkoutConfiguration: () => ({ sessionCreationAllowed: true, acceptingOrders: false, restrictedMode: "REHEARSAL" }) }));
vi.mock("@/lib/commerce/fixed-total", () => ({ manualLaunchFixedTotalIsSafe: () => true, STRIPE_NO_ADDED_TAX: {} }));
vi.mock("@/lib/materials/retention-access-server", () => ({ loadCustomerRetentionAccess: async () => ({ orders: [{ order_id: "a1150000-0000-4000-8000-000000000003", action_expires_at: "2099-01-01T00:00:00Z", purged_at: null }] }), mayResumeMaterialCheckoutAfterActionExpiry: vi.fn() }));
vi.mock("@/lib/documents/renderer", () => ({ documentRendererConfiguration: () => ({ ready: false }) }));
vi.mock("@/lib/files/aws-document-worker", () => ({ documentWorkerExecutionMode: () => "remote", documentWorkerConfiguration: () => ({ ready: true, identity: "fictional-worker", fontSha256: "c".repeat(64), fontManifestSha256: "d".repeat(64) }) }));
import { POST } from "@/app/api/checkout/apply-packs/route";
const id = (n: number) => `a1150000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const origin = "https://applypack.example", contact = { displayName: "Fictional Customer", email: "documents@example.invalid", phone: "5550101234", cityState: "Richmond, VA" };
const input = { deliveredOrderId: id(3), deliveredReleaseId: id(6), sourceSnapshotId: id(7), contact,
  items: [{ jobMatchId: id(8), ruleId: id(9) }], careerBreakChoice: "KEEP_EXISTING_TIMELINE", coverLetterBreakConsent: false,
  documentContactConfirmed: true, documentFactsConfirmed: true, noAutoApplyAcknowledged: true, outcomesAcknowledged: true };
const request = () => new Request(`${origin}/api/checkout/apply-packs`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(input) });
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("NEXT_PUBLIC_APP_URL", origin); vi.stubEnv("STRIPE_APPLY_PACK_PRICE_ID", "price_fictional"); vi.stubEnv("APP_RELEASE_SHA", "a".repeat(40));
  const contactHash = createHash("sha256").update(JSON.stringify({ schemaVersion: "chunk5-document-contact-v1", ...contact, linkedInOrPortfolio: null })).digest("hex");
  const config = { canonical_site_url: origin, checkout_enabled: false, pricing_version: "fixture", tax_version: "fixture", materials_rule_ttl_seconds: 3600,
    immediate_payment_methods: ["card"], materials_generation_approved: true, materials_generation_approval_reference: "fictional-test", material_output_formats: ["PDF"],
    document_renderer_identity: "fictional-worker", document_font_sha256: "c".repeat(64), document_font_manifest_sha256: "d".repeat(64), document_safety_policy: "generated-structural-v1" };
  boundary.from.mockImplementation((table: string) => { const query = { select: () => query, eq: () => query,
    maybeSingle: async () => ({ data: table === "ap_commerce_configuration" ? config : { content_sha256: contactHash }, error: null }) }; return query; });
  boundary.rpc.mockResolvedValue({ data: { checkoutIntentId: id(2), paymentAttemptId: id(5), expiresAt: "2099-01-01T00:00:00Z", providerIdempotencyKey: "fictional-key" }, error: null });
  boundary.create.mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/fictional", expires_at: 4070908800 });
});
afterEach(() => vi.unstubAllEnvs());
describe("Apply Pack checkout return identities", () => {
  it("creates authenticated product-specific success/cancel locators without any document/contact/capability data", async () => {
    const response = await POST(request()); expect(response.status).toBe(200);
    const args = boundary.create.mock.calls[0]; expect(args[2]).toBe(id(2));
    const options = args[3], success = new URL(options.success_url), cancel = new URL(options.cancel_url);
    expect(success.origin).toBe(origin); expect(success.pathname).toBe("/checkout/return");
    expect(Object.fromEntries(success.searchParams)).toEqual({ checkout_kind: "apply_pack", material_checkout_id: id(2) });
    expect(Object.fromEntries(cancel.searchParams)).toEqual({ checkout_kind: "apply_pack", material_checkout_id: id(2), cancelled: "1" });
    expect(options.success_url + options.cancel_url).not.toMatch(/@|secret|token|555|Fictional/);
    expect(options.line_items).toEqual([{ quantity: 1, price: "price_fictional" }]);
    expect(response.headers.has("set-cookie")).toBe(false);
  });
  it("retains exactly the same prepared checkout and provider parameters after an uncertain response", async () => {
    boundary.create.mockRejectedValueOnce(new Error("fictional response lost"));
    expect((await POST(request())).status).toBe(502); expect((await POST(request())).status).toBe(200);
    expect(boundary.create.mock.calls[0].slice(2)).toEqual(boundary.create.mock.calls[1].slice(2));
    expect(boundary.rpc.mock.calls[0]).toEqual(boundary.rpc.mock.calls[1]);
  });
  it("refuses a malformed checkout locator before any provider call", async () => {
    boundary.rpc.mockResolvedValue({ data: { checkoutIntentId: "id&secret=untrusted", paymentAttemptId: id(5), expiresAt: "2099-01-01T00:00:00Z", providerIdempotencyKey: "fictional" }, error: null });
    expect((await POST(request())).status).toBe(502); expect(boundary.create).not.toHaveBeenCalled();
  });
  it("keeps an old accepted command fail-closed on changed URL parameters, then reconciles its original provider session without a second creation", async () => {
    const { createOrResumeCheckoutSession, reconcileCheckoutInitiations } = await vi.importActual<typeof import("@/lib/commerce/checkout-initiation")>("@/lib/commerce/checkout-initiation");
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const attempt = { id: id(2), mode: "REHEARSAL", release_sha: "a".repeat(40), authorization_id: id(11),
      provider_session_id: null as string | null, provider_idempotency_key: "persisted-old-command-key", provider_session_deadline: new Date(deadline * 1000).toISOString(),
      initiated_at: new Date().toISOString(), state: "READY", payment_attempt_id: id(5) };
    const session = { id: "cs_test_original", status: "open", payment_status: "unpaid", expires_at: deadline,
      metadata: { initiation_id: id(2) }, url: "https://checkout.stripe.com/c/pay/original", success_url: `${origin}/checkout/return` };
    const creates = vi.fn().mockRejectedValue(Object.assign(new Error("parameters differ from the accepted command"), { code: "idempotency_error" }));
    const stripe = { checkout: { sessions: { create: creates, retrieve: vi.fn().mockResolvedValue(session),
      list: vi.fn().mockResolvedValue({ data: [session], has_more: false }), expire: vi.fn() } } };
    boundary.operationalStripe.mockReturnValue(stripe);
    const rpc = vi.fn(async (name: string) => {
      if (name === "ap_checkout_initiations_requiring_reconciliation") return { data: [attempt], error: null };
      if (name === "ap_bind_checkout_initiation") { attempt.provider_session_id = session.id; return { data: { expirationRequired: false }, error: null }; }
      return { data: true, error: null };
    });
    const from = (table: string) => { const query = { select: () => query, eq: () => query, single: async () => ({ data: attempt, error: null }),
      maybeSingle: async () => ({ data: table === "ap_checkout_mode_configuration" ? { mode: "REHEARSAL", release_sha: "a".repeat(40) } : { expires_at: "2099-01-01T00:00:00Z", revoked_at: null }, error: null }) }; return query; };
    const admin = { from, rpc } as unknown as Parameters<typeof createOrResumeCheckoutSession>[0];
    const provider = stripe as unknown as Parameters<typeof createOrResumeCheckoutSession>[1];
    const parameters = { mode: "payment" as const, success_url: `${origin}/checkout/return?checkout_kind=apply_pack&material_checkout_id=${id(2)}` };
    await expect(createOrResumeCheckoutSession(admin, provider, id(2), parameters)).rejects.toMatchObject({ code: "idempotency_error" });
    await expect(createOrResumeCheckoutSession(admin, provider, id(2), parameters)).rejects.toMatchObject({ code: "idempotency_error" });
    expect(creates.mock.calls.map(([, options]) => options.idempotencyKey)).toEqual(["persisted-old-command-key", "persisted-old-command-key"]);
    expect(await reconcileCheckoutInitiations(admin)).toEqual({ processed: 1, unresolved: 0 });
    const before = creates.mock.calls.length;
    expect(await createOrResumeCheckoutSession(admin, provider, id(2), parameters)).toEqual(session);
    expect(creates).toHaveBeenCalledTimes(before); expect(stripe.checkout.sessions.expire).not.toHaveBeenCalled();
    expect(rpc.mock.calls.some(([name]) => name.includes("apply_verified"))).toBe(false);
  });
});

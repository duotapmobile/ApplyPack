// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sandboxReleaseSha, sandboxValidationFixture } from "../fixtures/sandbox-validation";
import { SANDBOX_ACTIVATION_CONTRACT_VERSION } from "@/lib/operations/sandbox-validation";
import { MANUAL_LAUNCH_TAX_TREATMENT } from "@/lib/commerce/fixed-total";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/files/aws-document-worker", () => ({ documentWorkerConfiguration: () => ({ networkAttestationSha256: "c".repeat(64) }) }));

import { manualLaunchCheckoutGate } from "@/lib/operations/launch-readiness";

const infrastructure = {
  ready: true, deployedSha: sandboxReleaseSha, commerceConfigured: true, capacityAvailable: true,
  capacityByResource: { SEARCH: true, MATERIALS: true }, environmentAcceptingOrders: true, checks: {},
};

function configuration() {
  return {
    checkout_enabled: true, launch_activation_id: "activation", launch_release_sha: sandboxReleaseSha,
    document_worker_network_attestation_sha256: "c".repeat(64), search_price_cents: 1_899, material_line_price_cents: 799,
    currency: "USD", tax_inclusive: true, tax_treatment: MANUAL_LAUNCH_TAX_TREATMENT,
  };
}

function activation() {
  return {
    id: "activation", activation_phase: "PUBLIC", release_sha: sandboxReleaseSha,
    worker_network_attestation_sha256: "c".repeat(64), legacy_subscription_retirement_reference: "legacy-subscription-retirement-proof",
    unresolved_p0_count: 0, unresolved_p1_count: 0,
    activation_contract_version: SANDBOX_ACTIVATION_CONTRACT_VERSION, sandbox_validation: sandboxValidationFixture(),
    sandbox_validation_digest: "d".repeat(64), created_at: "2026-10-23T13:00:00.000Z",
    // Historical amount is not proof for the current activation contract.
    canary_reconciled_amount_cents: 0,
  };
}

function admin(receipt: unknown = activation(), config: unknown = configuration()) {
  return {
    from: vi.fn((table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: table === "ap_commerce_configuration" ? config : receipt, error: null }) }) }),
    })),
  };
}

describe("public checkout uses immutable sandbox approval", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-26T13:00:00.000Z")); });
  afterEach(() => vi.useRealTimers());

  it("accepts valid proof approved within 24 hours even after that approval is more than a day old", async () => {
    expect(await manualLaunchCheckoutGate(admin() as never, infrastructure as never, "SEARCH")).toBe(true);
  });

  it.each([
    { activation_contract_version: "legacy-production-canary-v1", canary_reconciled_amount_cents: 2_698 },
    { sandbox_validation: null }, { sandbox_validation_digest: null }, { sandbox_validation_digest: "invalid" },
    { activation_phase: "CANARY" }, { release_sha: "b".repeat(40) }, { unresolved_p0_count: 1 }, { unresolved_p1_count: 1 },
    { created_at: "2026-10-27T13:00:00.000Z" }, { created_at: "invalid" },
    { worker_network_attestation_sha256: "e".repeat(64) }, { legacy_subscription_retirement_reference: "" },
  ])("keeps checkout locked for invalid or old activation evidence: %o", async (change) => {
    expect(await manualLaunchCheckoutGate(admin({ ...activation(), ...change }) as never, infrastructure as never)).toBe(false);
  });

  it.each([
    { verifiedAt: "2026-10-22T12:59:59.999Z" }, { verifiedAt: "2026-10-23T13:00:00.001Z" },
    { stripeAccountId: "acct_other" }, { livemode: true }, { releaseSha: "b".repeat(40) },
  ])("revalidates receipt identity and freshness at the stored activation timestamp: %o", async (change) => {
    const receipt = { ...activation(), sandbox_validation: { ...sandboxValidationFixture(), ...change } };
    expect(await manualLaunchCheckoutGate(admin(receipt) as never, infrastructure as never)).toBe(false);
  });

  it("keeps existing live acceptance, price, capacity, worker and exact-SHA checks", async () => {
    for (const config of [
      { ...configuration(), checkout_enabled: false }, { ...configuration(), search_price_cents: 2_000 },
      { ...configuration(), launch_release_sha: "b".repeat(40) },
    ]) expect(await manualLaunchCheckoutGate(admin(activation(), config) as never, infrastructure as never)).toBe(false);
    for (const state of [
      { ...infrastructure, ready: false }, { ...infrastructure, environmentAcceptingOrders: false },
      { ...infrastructure, capacityAvailable: false },
      { ...infrastructure, capacityByResource: { SEARCH: false, MATERIALS: true } },
    ]) expect(await manualLaunchCheckoutGate(admin() as never, state as never, "SEARCH")).toBe(false);
  });
});

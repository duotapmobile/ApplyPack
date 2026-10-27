import { describe, expect, it } from "vitest";
import { paidSearchProviderFixture } from "../integration/paid-search-provider-fixture";

function body(pack = false, quantity = "1") {
  return new URLSearchParams({ mode: "payment", "line_items[0][price]": pack ? "price_fictional_pack" : "price_fictional_search",
    "line_items[0][quantity]": quantity, expires_at: "2000000000", customer_email: "fictional@example.invalid",
    "automatic_tax[enabled]": "false", "payment_method_types[0]": "card",
    "metadata[initiation_id]": "fictional-initiation", [`metadata[${pack ? "checkout_intent_id" : "checkout_attempt_id"}]`]: "fictional-attempt",
    "metadata[product_kind]": pack ? "apply_pack" : "job_search", "metadata[contract_version]": pack ? "manual-launch-pack-v2" : "manual-launch-search-v2" });
}
function create(provider: ReturnType<typeof paidSearchProviderFixture>, data: URLSearchParams, key: string) {
  return provider.fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { "idempotency-key": key }, body: data });
}

describe("finite modeled Stripe transport for connected paid journeys", () => {
  it("keeps search and pack totals, line quantities, and payment identities separate", async () => {
    const provider = paidSearchProviderFixture();
    const search = await (await create(provider, body(), "search")).json();
    const pack = await (await create(provider, body(true, "2"), "pack")).json();
    expect(search).toMatchObject({ amount_total: 1899, line_items: { data: [{ quantity: 1, price: { id: "price_fictional_search", unit_amount: 1899 } }] } });
    expect(pack).toMatchObject({ amount_total: 1598, line_items: { data: [{ quantity: 2, price: { id: "price_fictional_pack", unit_amount: 799 } }] } });
    const paidSearch = provider.complete(search.id), paidPack = provider.complete(pack.id);
    expect(paidSearch.payment_intent).toMatchObject({ amount: 1899, amount_received: 1899, latest_charge: { amount: 1899 } });
    expect(paidPack.payment_intent).toMatchObject({ amount: 1598, amount_received: 1598, latest_charge: { amount: 1598 } });
    expect(paidPack.payment_intent?.id).not.toBe(paidSearch.payment_intent?.id);
    expect((paidPack.payment_intent?.latest_charge as { id: string }).id).not.toBe((paidSearch.payment_intent?.latest_charge as { id: string }).id);
    expect(provider.complete(pack.id)).toEqual(paidPack);
    expect(await (await provider.fetch(`https://api.stripe.com/v1/checkout/sessions/${pack.id}`)).json()).toEqual(paidPack);
  });

  it("replays the exact command and rejects changed request bytes without another session", async () => {
    const provider = paidSearchProviderFixture(), data = body(true);
    const first = await (await create(provider, data, "pack")).json();
    expect(await (await create(provider, data, "pack")).json()).toEqual(first);
    data.set("line_items[0][quantity]", "2");
    await expect(create(provider, data, "pack")).rejects.toThrow("fictional_provider_payload_changed");
    expect(provider.sessions.size).toBe(1); expect(provider.commands.size).toBe(1);
  });

  it.each(["wrong-price", "search-quantity", "fraction", "zero", "overflow", "extra-line", "duplicate-price", "wrong-product", "wrong-contract", "wrong-binding", "expiry"])("rejects %s instead of fabricating a successful checkout", async kind => {
    const provider = paidSearchProviderFixture(), data = body(kind !== "search-quantity");
    if (kind === "wrong-price") data.set("line_items[0][price]", "price_unknown");
    if (kind === "search-quantity") data.set("line_items[0][quantity]", "2");
    if (kind === "fraction") data.set("line_items[0][quantity]", "1.5");
    if (kind === "zero") data.set("line_items[0][quantity]", "0");
    if (kind === "overflow") data.set("line_items[0][quantity]", "11");
    if (kind === "extra-line") data.set("line_items[1][price]", "price_fictional_pack");
    if (kind === "duplicate-price") data.append("line_items[0][price]", "price_fictional_search");
    if (kind === "wrong-product") data.set("metadata[product_kind]", "job_search");
    if (kind === "wrong-contract") data.set("metadata[contract_version]", "unreviewed");
    if (kind === "wrong-binding") { data.delete("metadata[checkout_intent_id]"); data.set("metadata[checkout_attempt_id]", "wrong-kind"); }
    if (kind === "expiry") data.set("expires_at", "NaN");
    await expect(create(provider, data, "rejected")).rejects.toThrow(/fictional_checkout/);
    expect(provider.sessions.size).toBe(0); expect(provider.commands.size).toBe(0);
  });

  it("rejects unexpected network destinations and endpoints", async () => {
    const provider = paidSearchProviderFixture();
    await expect(provider.fetch("https://example.invalid/v1/account")).rejects.toThrow("fictional_stripe_origin_rejected");
    await expect(provider.fetch("https://api.stripe.com/v1/payment_intents/unmodeled")).rejects.toThrow("fictional_stripe_request_rejected");
  });

  it.each([
    ["automatic_tax[enabled]", "true"], ["discounts[0][coupon]", "coupon_extra"], ["allow_promotion_codes", "true"],
    ["line_items[0][tax_rates][0]", "txr_extra"], ["line_items[0][adjustable_quantity][enabled]", "true"],
    ["shipping_options[0][shipping_rate]", "shr_extra"], ["payment_method_types[1]", "us_bank_account"],
    ["metadata[customer_resume]", "unapproved data"],
  ])("rejects unmodeled total or request option %s", async (field, value) => {
    for (const pack of [false, true]) {
      const provider = paidSearchProviderFixture(), data = body(pack); data.set(field, value);
      await expect(create(provider, data, "rejected")).rejects.toThrow("fictional_checkout_total_invalid");
      expect(provider.sessions.size).toBe(0); expect(provider.commands.size).toBe(0);
    }
  });

  it("requires explicit fixed-tax/card flags and rejects duplicate metadata", async () => {
    for (const field of ["automatic_tax[enabled]", "payment_method_types[0]"]) {
      const provider = paidSearchProviderFixture(), data = body(true); data.delete(field);
      await expect(create(provider, data, "missing")).rejects.toThrow("fictional_checkout_total_invalid");
      expect(provider.sessions.size).toBe(0);
    }
    const provider = paidSearchProviderFixture(), data = body(true);
    data.append("metadata[product_kind]", "job_search");
    await expect(create(provider, data, "duplicate")).rejects.toThrow("fictional_checkout_total_invalid");
    expect(provider.sessions.size).toBe(0);
  });
});

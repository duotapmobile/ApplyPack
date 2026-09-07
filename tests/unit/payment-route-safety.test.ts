import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const search = readFileSync(resolve(process.cwd(), "src/app/api/checkout/search/route.ts"), "utf8");
const apply = readFileSync(resolve(process.cwd(), "src/app/api/checkout/apply-packs/route.ts"), "utf8");
const webhook = readFileSync(resolve(process.cwd(), "src/app/api/stripe/webhook/route.ts"), "utf8");

describe("payment route safety", () => {
  it("requires the current finalized snapshot and derived likely feasibility before the $20 checkout", () => {
    expect(search).toContain('context.admin.rpc("ap_read_current_feasibility"');
    expect(search).toContain("view.snapshotId !== parsed.data.snapshotId");
    expect(search).toContain("view.assessmentId !== parsed.data.assessmentId");
    expect(search).toContain('view.state !== "COMPLETE"');
    expect(search).toContain('view.outcome !== "LIKELY"');
    expect(search).toContain("view.checkoutEligible !== true");
    expect(search).toContain('context.admin.rpc("ap_begin_search_checkout"');
  });

  it("uses configured fixed Stripe prices instead of browser-controlled price data", () => {
    expect(search).toContain("STRIPE_JOB_SEARCH_PRICE_ID");
    expect(search).toContain("price: priceId");
    expect(search).not.toContain("price_data");
    expect(apply).toContain("STRIPE_APPLY_PACK_PRICE_ID");
    expect(apply).toContain("price: priceId");
    expect(apply).not.toContain("price_data");
  });

  it("rejects a signed webhook from the wrong Stripe mode", () => {
    expect(webhook).toContain("stripeEventMatchesConfiguredMode(event.livemode)");
  });
});

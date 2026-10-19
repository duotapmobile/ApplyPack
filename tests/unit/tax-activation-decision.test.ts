import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  manualLaunchFixedTotalIsSafe,
  MANUAL_LAUNCH_TAX_TREATMENT,
  STRIPE_NO_ADDED_TAX,
} from "@/lib/commerce/fixed-total";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const safeFixedTotal = {
  search_price_cents: 1_899,
  material_line_price_cents: 799,
  currency: "USD",
  tax_inclusive: true,
  tax_treatment: MANUAL_LAUNCH_TAX_TREATMENT,
};

describe("October 19 tax activation decision", () => {
  it("does not treat a separate tax approval or reference as an activation input", () => {
    const legacyFieldsAreAbsent = {
      ...safeFixedTotal,
      tax_configuration_approved: false,
      tax_approval_reference: null,
    };
    expect(manualLaunchFixedTotalIsSafe(legacyFieldsAreAbsent)).toBe(true);

    const activationRoute = source("src/app/api/admin/manual-launch/activations/route.ts");
    const readiness = source("src/lib/operations/launch-readiness.ts");
    expect(activationRoute).not.toContain("taxApprovalReference");
    expect(readiness).not.toContain("tax_configuration_approved");
    expect(readiness).not.toContain("tax_approval_reference");
  });

  it("fails closed if any fixed-total or no-added-tax fact changes", () => {
    expect(STRIPE_NO_ADDED_TAX).toEqual({ automatic_tax: { enabled: false } });
    expect(manualLaunchFixedTotalIsSafe({ ...safeFixedTotal, search_price_cents: 1_900 })).toBe(false);
    expect(manualLaunchFixedTotalIsSafe({ ...safeFixedTotal, material_line_price_cents: 800 })).toBe(false);
    expect(manualLaunchFixedTotalIsSafe({ ...safeFixedTotal, currency: "EUR" })).toBe(false);
    expect(manualLaunchFixedTotalIsSafe({ ...safeFixedTotal, tax_inclusive: false })).toBe(false);
    expect(manualLaunchFixedTotalIsSafe({ ...safeFixedTotal, tax_treatment: "ADDED_AT_CHECKOUT" })).toBe(false);

    for (const path of [
      "src/app/api/checkout/search/route.ts",
      "src/app/api/checkout/apply-packs/route.ts",
      "src/app/api/checkout/board-materials/[id]/route.ts",
      "src/lib/commerce/workers.ts",
    ]) {
      const checkout = source(path);
      expect(checkout).toContain("manualLaunchFixedTotalIsSafe");
      expect(checkout).toContain("STRIPE_NO_ADDED_TAX");
    }
  });

  it("keeps the persisted activation gate fixed-price and independent of approval evidence", () => {
    const migration = source("supabase/migrations/202610190082_tax_activation_decision.sql");
    expect(migration).toContain("tax_treatment='TAX_INCLUSIVE_NO_ADDED_AMOUNT'");
    expect(migration).toContain("search_price_cents=1899");
    expect(migration).toContain("material_line_price_cents=799");
    expect(migration).toContain("manual_launch_fixed_total_configuration_required");
    expect(migration).not.toContain("p_evidence->>'taxApprovalReference'");
    expect(migration).not.toContain("tax_configuration_approved=true");
  });

  it("shows the fixed $18.99 total and no-added-tax disclosure at search payment review", () => {
    const wizard = source("src/app/get-started/wizard-v3.tsx");
    expect(wizard).toContain("$18.99 total.");
    expect(wizard).toContain("The displayed total is fixed. ApplyPack does not add tax at checkout.");
    expect(wizard.indexOf("$18.99 total.")).toBeLessThan(wizard.lastIndexOf("SEARCH_CHECKOUT_CTA"));
  });
});

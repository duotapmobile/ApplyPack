import { APPLY_PACK_PRICE_CENTS, SEARCH_PRICE_CENTS } from "@/lib/domain/applypack";

export const MANUAL_LAUNCH_TAX_TREATMENT = "TAX_INCLUSIVE_NO_ADDED_AMOUNT";

export const STRIPE_NO_ADDED_TAX = {
  automatic_tax: { enabled: false },
} as const;

export type ManualLaunchFixedTotalConfiguration = {
  search_price_cents: number;
  material_line_price_cents: number;
  currency: string;
  tax_inclusive: boolean;
  tax_treatment: string;
};

export function manualLaunchFixedTotalIsSafe(configuration: ManualLaunchFixedTotalConfiguration) {
  return configuration.search_price_cents === SEARCH_PRICE_CENTS
    && configuration.material_line_price_cents === APPLY_PACK_PRICE_CENTS
    && configuration.currency === "USD"
    && configuration.tax_inclusive
    && configuration.tax_treatment === MANUAL_LAUNCH_TAX_TREATMENT;
}

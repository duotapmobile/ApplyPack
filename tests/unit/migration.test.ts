import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202609010001_initial.sql"),
  "utf8"
).replace(/\s+/g, " ");

describe("production migration invariants", () => {
  it("quarantines new source documents until scanning passes", () => {
    expect(sql).toContain("source_scan_status text not null default 'pending'");
    expect(sql).toContain("source_scan_status in ('pending','clean','blocked')");
  });

  it("limits one Apply Pack cart to the approved two units", () => {
    expect(sql).toContain("item_count integer not null check (item_count between 1 and 2)");
    expect(sql).toContain("reservation_units <> target.item_count");
  });

  it("creates one $8 order and one work item for every paid cart item", () => {
    expect(sql).toContain("unit_price_cents integer not null default 800 check (unit_price_cents = 800)");
    expect(sql).toMatch(/for cart_item in .*?insert into public\.orders\(.*?insert into public\.apply_pack_items\(/);
  });

  it("keeps payment conversion and capacity mutation service-role only", () => {
    expect(sql).toContain("grant execute on function public.complete_paid_checkout");
    expect(sql).toContain("grant execute on function public.complete_apply_pack_cart");
    expect(sql).toContain("grant execute on function public.reserve_capacity");
    expect(sql).toContain("grant execute on function public.consume_rate_limit");
    expect(sql).not.toMatch(/grant execute on function public\.(complete_paid_checkout|complete_apply_pack_cart|reserve_capacity|consume_rate_limit).* to authenticated/);
  });

  it("enables RLS on every customer-data table", () => {
    for (const table of [
      "profiles", "intakes", "intake_answers", "criteria_versions", "orders",
      "apply_pack_carts", "apply_pack_cart_items", "jobs", "job_matches",
      "apply_pack_items", "correction_requests", "conflict_reviews", "refunds",
    ]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
  });

  it("keeps both document buckets private", () => {
    expect(sql).toContain("('customer-source-documents', 'customer-source-documents', false)");
    expect(sql).toContain("('customer-deliveries', 'customer-deliveries', false)");
  });
});

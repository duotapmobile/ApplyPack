import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/202609020007_checkout_drafts.sql"), "utf8").replace(/\s+/g, " ");
const search = readFileSync(resolve(process.cwd(), "src/app/api/checkout/search/route.ts"), "utf8");
const applyPack = readFileSync(resolve(process.cwd(), "src/app/api/checkout/apply-packs/route.ts"), "utf8");
const workflow = readFileSync(resolve(process.cwd(), "src/lib/workflow/process.ts"), "utf8");

describe("checkout preparation and private draft safety", () => {
  it("serializes search and Apply Pack preparation before contacting Stripe", () => {
    expect(migration).toContain("pg_advisory_xact_lock(hashtext('search:'");
    expect(migration).toContain("pg_advisory_xact_lock(hashtext('apply-pack:'");
    expect(migration).toContain("one_active_search_order_per_intake");
    expect(search.indexOf('rpc("prepare_search_checkout"')).toBeLessThan(search.indexOf("stripe.checkout.sessions.create"));
    expect(applyPack.indexOf('rpc("prepare_apply_pack_checkout"')).toBeLessThan(applyPack.indexOf("stripe.checkout.sessions.create"));
  });

  it("uses stable Stripe idempotency keys based on the database-owned intent", () => {
    expect(search).toContain("`search-checkout/${orderId}`");
    expect(applyPack).toContain("`apply-pack-checkout/${cartId}`");
    expect(search).not.toContain("randomUUID");
    expect(applyPack).not.toContain("randomUUID");
  });

  it("stores drafts privately and leaves customer delivery behind admin review", () => {
    expect(migration).toContain("values ('operator-drafts', 'operator-drafts', false)");
    expect(workflow).toContain('status: "draft_ready"');
    expect(workflow).toContain('status: "awaiting_review"');
    expect(workflow).toContain('storage.from("operator-drafts")');
    expect(workflow).not.toContain('storage.from("customer-deliveries")');
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/202609020007_checkout_drafts.sql"), "utf8").replace(/\s+/g, " ");
const search = readFileSync(resolve(process.cwd(), "src/app/api/checkout/search/route.ts"), "utf8");
const applyPack = readFileSync(resolve(process.cwd(), "src/app/api/checkout/apply-packs/route.ts"), "utf8");
const initiation = readFileSync(resolve(process.cwd(), "src/lib/commerce/checkout-initiation.ts"), "utf8");
const workflow = readFileSync(resolve(process.cwd(), "src/lib/workflow/process.ts"), "utf8");

describe("checkout preparation and private draft safety", () => {
  it("serializes search and Apply Pack preparation before contacting Stripe", () => {
    expect(migration).toContain("pg_advisory_xact_lock(hashtext('search:'");
    expect(migration).toContain("pg_advisory_xact_lock(hashtext('apply-pack:'");
    expect(migration).toContain("one_active_search_order_per_intake");
    for (const [route, rpc] of [[search, "ap_begin_authorized_search_checkout"], [applyPack, "ap_begin_authorized_material_checkout"]]) {
      const preparedAt = route.indexOf(`rpc("${rpc}"`);
      const providerAt = route.indexOf("await createOrResumeCheckoutSession(");
      expect(preparedAt).toBeGreaterThanOrEqual(0);
      expect(providerAt).toBeGreaterThan(preparedAt);
      expect(route).not.toContain("stripe.checkout.sessions.create");
    }
  });

  it("uses stable Stripe idempotency keys based on the database-owned intent", () => {
    expect(search).toContain("`search-checkout/${commandId}`");
    expect(initiation).toContain("idempotencyKey: attempt.provider_idempotency_key");
    expect(initiation).toContain("const attempt = await initiation(admin, attemptId)");
    expect(applyPack).toContain("materialCheckoutRequestKey(selectionSha256)");
    expect(search).not.toContain("randomUUID");
    expect(applyPack).not.toContain("randomUUID");
  });

  it("stores drafts privately and leaves customer delivery behind admin review", () => {
    expect(migration).toContain("values ('operator-drafts', 'operator-drafts', false)");
    expect(workflow).toContain('last_error_code: "evidence_bound_material_line_required"');
    expect(workflow).toContain('status: "awaiting_review"');
    expect(workflow).not.toContain("generateApplyPackDrafts");
    expect(workflow).not.toContain('storage.from("customer-deliveries")');
  });
});

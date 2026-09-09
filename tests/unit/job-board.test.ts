import { describe, expect, it } from "vitest";
import { evaluateBoardAdmission, neutralSort } from "@/lib/job-board/admission";
import { boardPlanDisclosure, boardPlans, isBoardPlanId } from "@/lib/job-board/plans";
import { boardSubscriptionStateFromProvider, hasBoardAccess, transitionBoardEntitlement } from "@/lib/job-board/entitlements";
import { readFileSync } from "node:fs";

describe("paid filtered job board", () => {
  it("allowlists exact server-owned recurring plans and disclosures", () => {
    expect(isBoardPlanId("weekly")).toBe(true);
    expect(isBoardPlanId("annual")).toBe(false);
    expect(boardPlans.three_months).toMatchObject({ amountCents: 4499, interval: "month", intervalCount: 3 });
    expect(boardPlanDisclosure("three_months")).toContain("$44.99 charged every three calendar months");
  });

  it("uses capability evidence for admission and never produces a score", () => {
    const result = evaluateBoardAdmission(
      { confirmedCapabilities: ["case management"], transferableCapabilities: ["de-escalation"], hardRules: [] },
      { id: "a", requiredCapabilities: ["De-escalation", "sales"], facts: {}, postedAt: null, salaryMin: null },
    );
    expect(result.admitted).toBe(true);
    expect(result.connectionCodes).toEqual(["CAPABILITY_DE_ESCALATION"]);
    expect(result).not.toHaveProperty("score");
  });

  it("excludes confirmed dealbreaker violations but warns on unknowns", () => {
    const candidate = { confirmedCapabilities: ["support"], transferableCapabilities: [], hardRules: [{ field: "employment", operator: "equals" as const, value: "w2" }] };
    expect(evaluateBoardAdmission(candidate, { id: "a", requiredCapabilities: ["support"], facts: { employment: { value: "1099", certainty: "confirmed" } }, postedAt: null, salaryMin: null }).admitted).toBe(false);
    const unknown = evaluateBoardAdmission(candidate, { id: "a", requiredCapabilities: ["support"], facts: { employment: { value: null, certainty: "unknown" } }, postedAt: null, salaryMin: null });
    expect(unknown).toMatchObject({ admitted: true, warnings: ["UNKNOWN_EMPLOYMENT"] });
  });

  it("sorts factually with stable ids and missing salary last", () => {
    const jobs = [
      { id: "b", requiredCapabilities: [], facts: {}, postedAt: "2026-09-01T00:00:00Z", salaryMin: null },
      { id: "a", requiredCapabilities: [], facts: {}, postedAt: "2026-09-02T00:00:00Z", salaryMin: 50000 },
    ];
    expect(neutralSort(jobs).map((job) => job.id)).toEqual(["a", "b"]);
    expect(neutralSort(jobs, "salary_high").map((job) => job.id)).toEqual(["a", "b"]);
  });

  it("grants only verified paid-period states and ignores older events", () => {
    const pending = { state: "PENDING" as const, accessEndsAt: null, lastProviderEventCreated: 10 };
    const paid = transitionBoardEntitlement(pending, { kind: "INVOICE_PAID", providerCreated: 20, periodEnd: "2026-10-08T00:00:00Z" });
    expect(hasBoardAccess(paid, new Date("2026-09-08T00:00:00Z"))).toBe(true);
    expect(transitionBoardEntitlement(paid, { kind: "PAYMENT_FAILED", providerCreated: 19 })).toEqual(paid);
    expect(hasBoardAccess(transitionBoardEntitlement(paid, { kind: "PAYMENT_FAILED", providerCreated: 21 }))).toBe(false);
    const disputed = transitionBoardEntitlement(paid, { kind: "DISPUTED", providerCreated: 22 });
    expect(transitionBoardEntitlement(disputed, { kind: "INVOICE_PAID", providerCreated: 22 })).toEqual(disputed);
    expect(hasBoardAccess(disputed)).toBe(false);
    expect(hasBoardAccess(transitionBoardEntitlement(paid, { kind: "REFUNDED", providerCreated: 23 }))).toBe(false);
  });

  it("derives pending, cancellation, recovery, failed-payment, and ended subscription states", () => {
    expect(boardSubscriptionStateFromProvider({ eventType: "customer.subscription.created", subscriptionStatus: "incomplete", cancelAtPeriodEnd: false, latestInvoicePaid: false })).toBe("PENDING");
    expect(boardSubscriptionStateFromProvider({ eventType: "customer.subscription.updated", subscriptionStatus: "active", cancelAtPeriodEnd: true, latestInvoicePaid: true })).toBe("CANCEL_AT_PERIOD_END");
    expect(boardSubscriptionStateFromProvider({ eventType: "customer.subscription.updated", subscriptionStatus: "active", cancelAtPeriodEnd: false, latestInvoicePaid: true })).toBe("ACTIVE");
    expect(boardSubscriptionStateFromProvider({ eventType: "customer.subscription.updated", subscriptionStatus: "past_due", cancelAtPeriodEnd: false, latestInvoicePaid: false })).toBe("PAST_DUE");
    expect(boardSubscriptionStateFromProvider({ eventType: "customer.subscription.deleted", subscriptionStatus: "canceled", cancelAtPeriodEnd: false, latestInvoicePaid: true })).toBe("CANCELED");
  });

  it("enforces listing, detail, and apply-link access on the server without shared caching", () => {
    for (const file of [
      "src/app/api/customer/job-board/route.ts",
      "src/app/api/customer/job-board/[id]/route.ts",
      "src/app/api/customer/job-board/[id]/apply-link/route.ts",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain("requireBoardAccess");
      expect(source).toContain("private, no-store");
      expect(source).toContain("profile_snapshot_id");
    }
  });

  it("requires full checkout readiness for board checkout and handles the provider lifecycle", () => {
    const checkout = readFileSync("src/app/api/checkout/job-board/route.ts", "utf8");
    const events = readFileSync("src/lib/job-board/stripe-events.ts", "utf8");
    expect(checkout).toContain("createStripeBoardClient");
    expect(events).toContain('event.type === "customer.subscription.created"');
    expect(events).toContain('expand: ["latest_invoice"]');
    expect(events).toContain('requestedState === "PENDING"');
  });

  it("keeps subscription access separate from purchased material orders in the migration", () => {
    const migration = readFileSync("supabase/migrations/202609080032_paid_filtered_job_board.sql", "utf8");
    expect(migration).toContain("ap_board_one_live_subscription_per_customer");
    expect(migration).toContain("ap_board_material_orders");
    expect(migration).toContain("One-time orders deliberately survive subscription expiry");
  });

  it("adds immutable profile claims, durable recomputation, and an explicitly unranked board materials lineage", () => {
    const migration = readFileSync("supabase/migrations/202609090033_final_integration_board_runtime.sql", "utf8");
    expect(migration).toContain("create table public.ap_board_profile_claims");
    expect(migration).toContain("create table public.ap_board_recompute_jobs");
    expect(migration).toContain("create or replace function public.ap_claim_board_profile");
    expect(migration).toContain("create or replace function public.ap_begin_board_material_checkout");
    expect(migration).toContain("match_kind='BOARD_MATERIAL_SOURCE' and position is null and ranking_score is null");
    expect(migration).toContain("source_kind='BOARD' and delivered_release_id is null");
  });
});

import { describe, expect, it } from "vitest";
import { evaluateBoardAdmission, neutralSort } from "@/lib/job-board/admission";
import { boardPlanDisclosure, boardPlans, isBoardPlanId } from "@/lib/job-board/plans";
import { boardSubscriptionStateFromProvider, hasBoardAccess, hasProviderConfirmedLegacyBoardAccess, legacyBoardProviderProjection, transitionBoardEntitlement } from "@/lib/job-board/entitlements";
import { GET as getRetiredBoardJobs } from "@/app/api/customer/job-board/route";
import { GET as getRetiredBoardJob } from "@/app/api/customer/job-board/[id]/route";
import { GET as getRetiredBoardApplyLink } from "@/app/api/customer/job-board/[id]/apply-link/route";
import { readFileSync } from "node:fs";

describe("retired paid filtered job board", () => {
  it("preserves historical plan identities only for reconciliation", () => {
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

  it("requires provider-bound, unexpired, non-refunded legacy archive evidence", () => {
    const entitlement = {
      state: "CANCEL_AT_PERIOD_END" as const,
      accessEndsAt: "2026-10-20T00:00:00Z",
      lastProviderEventCreated: 100,
      lastProviderEventId: "evt_legacy_paid",
      providerCustomerId: "cus_legacy",
      providerSubscriptionId: "sub_legacy",
      refundState: "NONE" as const,
      providerDisputeId: null,
    };
    const now = new Date("2026-10-19T00:00:00Z");
    expect(hasProviderConfirmedLegacyBoardAccess(entitlement, now)).toBe(true);
    expect(hasProviderConfirmedLegacyBoardAccess({ ...entitlement, accessEndsAt: "2026-10-18T00:00:00Z" }, now)).toBe(false);
    expect(hasProviderConfirmedLegacyBoardAccess({ ...entitlement, refundState: "PARTIAL" }, now)).toBe(false);
    expect(hasProviderConfirmedLegacyBoardAccess({ ...entitlement, state: "REFUNDED" }, now)).toBe(false);
    expect(hasProviderConfirmedLegacyBoardAccess({ ...entitlement, lastProviderEventId: null }, now)).toBe(false);
    expect(hasProviderConfirmedLegacyBoardAccess({ ...entitlement, providerDisputeId: "dp_legacy" }, now)).toBe(false);
  });

  it("derives pending, cancellation, recovery, failed-payment, and ended subscription states", () => {
    expect(boardSubscriptionStateFromProvider({ eventType: "customer.subscription.created", subscriptionStatus: "incomplete", cancelAtPeriodEnd: false, latestInvoicePaid: false })).toBe("PENDING");
    expect(boardSubscriptionStateFromProvider({ eventType: "customer.subscription.updated", subscriptionStatus: "active", cancelAtPeriodEnd: true, latestInvoicePaid: true })).toBe("CANCEL_AT_PERIOD_END");
    expect(boardSubscriptionStateFromProvider({ eventType: "customer.subscription.updated", subscriptionStatus: "active", cancelAtPeriodEnd: false, latestInvoicePaid: true })).toBe("ACTIVE");
    expect(boardSubscriptionStateFromProvider({ eventType: "customer.subscription.updated", subscriptionStatus: "past_due", cancelAtPeriodEnd: false, latestInvoicePaid: false })).toBe("PAST_DUE");
    expect(boardSubscriptionStateFromProvider({ eventType: "customer.subscription.deleted", subscriptionStatus: "canceled", cancelAtPeriodEnd: false, latestInvoicePaid: true })).toBe("CANCELED");
  });

  it("persists provider-derived paid-period state without reviving refunded access", () => {
    const base = {
      requestedState: "ACTIVE" as const,
      subscriptionStatus: "active",
      cancelAtPeriodEnd: true,
      periodEnd: "2026-11-01T00:00:00Z",
      currentState: "CANCELED" as const,
      refundState: "NONE" as const,
      providerDisputeId: null,
    };
    expect(legacyBoardProviderProjection(base)).toEqual({
      state: "CANCEL_AT_PERIOD_END",
      accessEndsAt: "2026-11-01T00:00:00Z",
    });
    expect(legacyBoardProviderProjection({ ...base, currentState: "REFUNDED", refundState: "FULL" })).toEqual({
      state: "REFUNDED",
      accessEndsAt: null,
    });
    expect(legacyBoardProviderProjection({ ...base, requestedState: "PAST_DUE" })).toEqual({
      state: "PAST_DUE",
      accessEndsAt: null,
    });
  });

  it("retires every customer listing and apply-link API before auth, environment, or data access", async () => {
    const previousMaintenanceFlag = process.env.APP_LEGACY_BOARD_MAINTENANCE_ENABLED;
    process.env.APP_LEGACY_BOARD_MAINTENANCE_ENABLED = "true";
    try {
      for (const response of [
        await getRetiredBoardJobs(),
        await getRetiredBoardJob(),
        await getRetiredBoardApplyLink(),
      ]) {
        expect(response.status).toBe(410);
        expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
        await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("not offered") });
      }
    } finally {
      if (previousMaintenanceFlag === undefined) delete process.env.APP_LEGACY_BOARD_MAINTENANCE_ENABLED;
      else process.env.APP_LEGACY_BOARD_MAINTENANCE_ENABLED = previousMaintenanceFlag;
    }

    for (const file of [
      "src/app/api/customer/job-board/route.ts",
      "src/app/api/customer/job-board/[id]/route.ts",
      "src/app/api/customer/job-board/[id]/apply-link/route.ts",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain("status: 410");
      expect(source).toContain('"cache-control": "no-store, max-age=0"');
      expect(source).not.toMatch(/requireBoardAccess|createSupabase|createStripe|ap_board_subscriptions|process\.env/);
    }
  });

  it("limits authenticated pages to the frozen archive with no live jobs or apply links", () => {
    for (const file of [
      "src/app/my-applypack/job-board/page.tsx",
      "src/app/my-applypack/job-board/[id]/page.tsx",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain('import { notFound } from "next/navigation"');
      expect(source).toContain("notFound();");
      expect(source).toContain("requireLegacyBoardArchiveAccess");
      expect(source).toContain("ap_legacy_board_archive_entries");
      expect(source).not.toMatch(/from\("jobs"\)|ap_board_admissions|ApplyLinkButton|apply-link|source_job_url|ranking_score|process\.env/);
    }
    expect(readFileSync("src/app/my-applypack/job-board/page.tsx", "utf8")).toContain("LEGACY PAID ARCHIVE");
    expect(readFileSync("src/app/my-applypack/job-board/[id]/page.tsx", "utf8")).toContain("does not resolve or expose an application link");
  });

  it("hard-disables new board checkout while retaining historical provider reconciliation", () => {
    const checkout = readFileSync("src/app/api/checkout/job-board/route.ts", "utf8");
    const events = readFileSync("src/lib/job-board/stripe-events.ts", "utf8");
    const entitlements = readFileSync("src/lib/job-board/entitlements.ts", "utf8");
    expect(checkout).toContain("Subscription checkout is not offered in the manual launch.");
    expect(checkout).toContain("status: 410");
    expect(checkout).not.toContain("createStripeBoardClient");
    const stripeMode = readFileSync("src/lib/stripe/mode.ts", "utf8");
    const stripeServer = readFileSync("src/lib/stripe/server.ts", "utf8");
    expect(stripeMode).toContain("boardReady: false");
    expect(stripeServer).toContain("createStripeBoardClient()");
    expect(stripeServer).toContain("return null");
    expect(events).toContain('event.type === "customer.subscription.created"');
    expect(events).toContain('expand: ["latest_invoice"]');
    expect(events).toContain("stripe.subscriptions.update(subscription.id, { cancel_at_period_end: true })");
    expect(entitlements).toContain('input.requestedState === "ACTIVE" && input.cancelAtPeriodEnd');
    expect(events).toContain("access_ends_at: accessEndsAt");
    expect(events).toContain('type: "legacy.subscription.unbound"');
    expect(events).not.toContain('.insert(record)');
    expect(events).toContain('latestInvoiceId === binding.invoice.id');
    const health = readFileSync("src/app/api/health/route.ts", "utf8");
    const launchReadiness = readFileSync("src/lib/operations/launch-readiness.ts", "utf8");
    const site = readFileSync("src/config/site.ts", "utf8");
    const sitemap = readFileSync("src/app/sitemap.ts", "utf8");
    const header = readFileSync("src/components/layout/site-header.tsx", "utf8");
    const footer = readFileSync("src/components/layout/site-footer.tsx", "utf8");
    expect(health).toContain("evaluateLaunchInfrastructure");
    expect(launchReadiness).toContain('admin.rpc("ap_current_source_readiness")');
    expect(health).not.toContain("STRIPE_JOB_BOARD_WEEKLY_PRICE_ID");
    expect(launchReadiness).not.toContain("STRIPE_JOB_BOARD_WEEKLY_PRICE_ID");
    expect(launchReadiness).not.toContain("ap_board_subscriptions");
    expect(launchReadiness).toContain("legacy_subscription_retirement_reference");
    for (const publicSurface of [site, sitemap, header, footer]) {
      expect(publicSurface).not.toContain("/job-board");
    }
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

  it("adds a forward-only immutable legacy archive and retires every write path", () => {
    const migration = readFileSync("supabase/migrations/202610190083_legacy_board_read_only_archive.sql", "utf8");
    expect(migration).toContain("create table public.ap_legacy_board_archive_entries");
    expect(migration).toContain("ap_legacy_board_archive_immutable");
    expect(migration).toContain("ap_legacy_board_admissions_frozen");
    expect(migration).toContain("ap_legacy_board_recompute_jobs_frozen");
    expect(migration).toContain("legacy_board_recompute_retired");
    expect(migration).toContain("board_origin_commerce_retired");
    expect(migration).toContain("new_board_subscriptions_are_retired");
    expect(migration).not.toContain("source_job_url");
    const maintenance = readFileSync("src/app/api/cron/maintenance/route.ts", "utf8");
    expect(maintenance).toContain('const boardAdmissions = { status: "retired"');
    expect(maintenance).not.toContain("processBoardRecomputeJobs");
    const staging = readFileSync("src/app/staging/synthetic-application/page.tsx", "utf8");
    expect(staging).toContain('href="/my-applypack"');
    expect(staging).not.toContain("Return to the test board");
    const runbook = readFileSync("docs/runbooks/MANUAL_LAUNCH_RELEASE.md", "utf8");
    const schema = readFileSync("src/lib/operations/launch-schema.ts", "utf8");
    expect(runbook).toContain("migrations 077 through 084");
    expect(runbook).toContain("schema `202610190084`");
    expect(schema).toContain('REQUIRED_LAUNCH_SCHEMA_VERSION = "202610250095"');
  });

  it("separates reconciliation from signed ordering and restricts cross-tenant entitlement checks", () => {
    const migration = readFileSync("supabase/migrations/202610190084_legacy_board_terminal_event_ordering.sql", "utf8");
    const events = readFileSync("src/lib/job-board/stripe-events.ts", "utf8");
    expect(migration).toContain("add column if not exists last_reconciled_at");
    expect(migration).toContain("ap_apply_legacy_board_terminal_event");
    expect(migration).toContain("legacy_board_terminal_event_replay_mismatch");
    expect(migration).toContain("greatest(subscription.last_provider_event_created,p_provider_created)");
    expect(migration).toContain("from public,anon,authenticated");
    expect(migration).toContain("p_customer_id=auth.uid()");
    expect(events).toContain('kind: "reconciliation"');
    expect(events).toContain("last_reconciled_at: source.reconciledAt");
    expect(events).not.toContain("legacy.subscription.reconciliation");
  });

  it("executes a real migration-083 to migration-084 legacy entitlement upgrade", () => {
    const packageJson = readFileSync("package.json", "utf8");
    const runner = readFileSync("scripts/run-supabase-legacy-board-upgrade-test.mjs", "utf8");
    const seed = readFileSync("tests/integration/legacy-board-083-upgrade-seed.sql", "utf8");
    const verify = readFileSync("tests/integration/legacy-board-084-upgrade-verify.sql", "utf8");
    const rollback = readFileSync("scripts/run-supabase-rollback-test.mjs", "utf8");
    expect(packageJson).toContain("node scripts/run-supabase-legacy-board-upgrade-test.mjs");
    expect(runner).toContain('"--version", "202610190083"');
    expect(runner).toContain('["migration", "up", "--local"]');
    expect(seed).toContain("LEGACY_BOARD_083_UPGRADE_SEED_OK");
    expect(seed).toContain("column_name='last_reconciled_at'");
    expect(verify).toContain("LEGACY_BOARD_084_UPGRADE_VERIFY_OK");
    expect(verify).toContain("legacy_board_terminal_event_replay_mismatch");
    expect(verify).toContain("last_provider_event_id='evt_upgrade_refund_newer'");
    expect(rollback).toContain("LEGACY_BOARD_084_UPGRADE_VERIFY_OK");
  });
});

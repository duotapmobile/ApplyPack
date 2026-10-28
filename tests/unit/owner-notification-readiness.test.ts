// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/operations/runtime-readiness", () => ({ checkRuntimeFileSafety: async () => true }));
vi.mock("@/lib/security/kms-health", () => ({ checkSensitivePayloadHealth: async () => true }));
vi.mock("@/lib/operations/renderer-readiness", () => ({ checkDocumentRendererReadiness: async () => true }));
vi.mock("@/lib/operations/protected-recovery-readiness", () => ({ readProtectedRecoveryReadiness: async () => ({ ready: false }) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => null }));
vi.mock("@/lib/stripe/server", () => ({ createStripeOperationalClient: () => null, assertConfiguredPrice: async () => undefined }));
import { configuredOwnerDraftRecipient, ownerDraftNotificationReady } from "@/lib/commerce/owner-draft-notification";
import { evaluateLaunchInfrastructure } from "@/lib/operations/launch-readiness";
import { collectOperationsSummary, containsSensitiveOperationsData } from "@/lib/operations/summary";

describe("approved owner-notice destination readiness", () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each([undefined, "", "invalid", "Name <owner@example.test>", "one@example.test,two@example.test", "one@example.test\r\nBcc:two@example.test"])("rejects absent or multiple recipient configuration %j", value => {
    expect(configuredOwnerDraftRecipient({ APP_ADMIN_ALERT_EMAIL: value, APP_ADMIN_EMAILS: "fallback@example.test" })).toBeNull();
  });
  it("accepts one normalized explicit recipient and retains the test-mode allowlist", () => {
    vi.stubEnv("APP_ADMIN_ALERT_EMAIL", " OWNER@example.test "); vi.stubEnv("APP_PAYMENT_MODE", "test"); vi.stubEnv("APP_SAFE_TEST_EMAILS", "");
    expect(configuredOwnerDraftRecipient()).toBe("owner@example.test"); expect(ownerDraftNotificationReady()).toBe(false);
    vi.stubEnv("APP_SAFE_TEST_EMAILS", "owner@example.test"); expect(ownerDraftNotificationReady()).toBe(true);
  });
  it("includes the independent destination gate in launch readiness without exposing its address", async () => {
    vi.stubEnv("APP_ADMIN_ALERT_EMAIL", ""); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    let result = await evaluateLaunchInfrastructure(); expect(result.checks.ownerNoticeDestination).toBe(false); expect(result.ready).toBe(false);
    vi.stubEnv("APP_ADMIN_ALERT_EMAIL", "approved-owner@example.test"); vi.stubEnv("APP_PAYMENT_MODE", "test"); vi.stubEnv("APP_SAFE_TEST_EMAILS", "approved-owner@example.test");
    result = await evaluateLaunchInfrastructure(); expect(result.checks.ownerNoticeDestination).toBe(true); expect(JSON.stringify(result)).not.toContain("approved-owner@example.test");
  });
  it("reports only a boolean in operations and excludes terminal suppression from active queue counts", async () => {
    vi.stubEnv("APP_DEPLOYMENT_ENV", "staging"); vi.stubEnv("APP_RELEASE_SHA", "a".repeat(40));
    vi.stubEnv("APP_ADMIN_ALERT_EMAIL", "approved-owner@example.test"); vi.stubEnv("APP_PAYMENT_MODE", "test"); vi.stubEnv("APP_SAFE_TEST_EMAILS", "approved-owner@example.test");
    const queriedStates: unknown[] = [];
    const query = () => {
      const q = { select: () => q, eq: (field: string, value: unknown) => { if (field === "state") queriedStates.push(value); return q; },
        neq: () => q, is: () => q, in: (field: string, value: unknown) => { if (field === "state") queriedStates.push(value); return q; },
        gt: () => q, gte: () => q, lt: () => q, lte: () => q, not: () => q, order: () => q, limit: () => q, maybeSingle: () => q,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(resolve) };
      return q;
    };
    const admin = { from: query, rpc: query } as unknown as Parameters<typeof collectOperationsSummary>[0];
    const result = await collectOperationsSummary(admin);
    expect(result.readiness.ownerNoticeDestination).toBe(true); expect(containsSensitiveOperationsData(result)).toBe(false);
    expect(JSON.stringify(result)).not.toContain("approved-owner@example.test"); expect(JSON.stringify(queriedStates)).not.toContain("SUPPRESSED");
    vi.stubEnv("APP_ADMIN_ALERT_EMAIL", ""); expect((await collectOperationsSummary(admin)).readiness.ownerNoticeDestination).toBe(false);
  });
});

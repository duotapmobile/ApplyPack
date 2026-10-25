// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/operations/runtime-readiness", () => ({ checkRuntimeFileSafety: async () => true }));
vi.mock("@/lib/security/kms-health", () => ({ checkSensitivePayloadHealth: async () => true }));
vi.mock("@/lib/operations/renderer-readiness", () => ({ checkDocumentRendererReadiness: async () => true }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => null }));
vi.mock("@/lib/stripe/server", () => ({ createStripeOperationalClient: () => ({}), assertConfiguredPrice: async () => {} }));
vi.mock("@/lib/stripe/mode", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/stripe/mode")>(),
  checkoutConfiguration: () => ({
  commerceConfigured: true, validState: true, acceptingOrders: false, restrictedMode: null,
}) }));
vi.mock("@/lib/files/aws-document-worker", () => ({ documentWorkerConfiguration: () => ({ ready: true }) }));
vi.mock("@/lib/operations/launch-schema", () => ({ launchSchemaReadinessIsCurrent: () => true }));

import { evaluateLaunchInfrastructure } from "@/lib/operations/launch-readiness";
import { collectOperationsSummary, containsSensitiveOperationsData } from "@/lib/operations/summary";
import { currentLegalContentBinding } from "@/lib/legal/content-hash";

const now = new Date("2026-10-23T08:00:00.000Z");
type Row = Record<string, unknown>;
const due = (ageSeconds: number, completed = false): Row => ({
  id: "private-object-identifier", attempts: 0,
  not_before: new Date(now.getTime() - ageSeconds * 1000).toISOString(),
  completed_at: completed ? now.toISOString() : null,
});

function database(rows: Row[] = []) {
  const state = { rows, awsQueryError: false, missingDueTimestamp: false, unknownDueCount: false };
  const binding = currentLegalContentBinding();
  const legal = {
    terms_version: binding.termsVersion, terms_content_sha256: binding.termsContentSha256,
    privacy_version: binding.privacyVersion, privacy_content_sha256: binding.privacyContentSha256,
    legal_acceptance_copy_version: binding.acceptanceCopyVersion, legal_acceptance_copy_sha256: binding.acceptanceCopySha256,
    legal_content_canonicalization_version: binding.contentCanonicalizationVersion, legal_receipt_schema_version: binding.receiptSchemaVersion,
  };
  const admin = {
    from(table: string) {
      const predicates: Array<(row: Row) => boolean> = [];
      let head = false, single = false, dueFilter = false;
      let limit = Infinity;
      let order: string | undefined;
      const query: Record<string, unknown> = {};
      query.select = (_columns: string, options?: { head?: boolean }) => { head = options?.head === true; return query; };
      query.is = query.eq = (name: string, value: unknown) => { predicates.push(row => row[name] === value); return query; };
      query.neq = (name: string, value: unknown) => { predicates.push(row => row[name] !== value); return query; };
      query.in = (name: string, values: unknown[]) => { predicates.push(row => values.includes(row[name])); return query; };
      query.gte = (name: string, value: number) => { predicates.push(row => Number(row[name]) >= value); return query; };
      query.lt = (name: string, value: number) => { predicates.push(row => Number(row[name]) < value); return query; };
      query.lte = (name: string, value: string) => {
        if (name === "not_before") dueFilter = true;
        predicates.push(row => String(row[name]) <= value); return query;
      };
      query.not = () => query;
      query.order = (name: string) => { order = name; return query; };
      query.limit = (value: number) => { limit = value; return query; };
      query.maybeSingle = () => { single = true; return query; };
      query.then = (resolve: (value: unknown) => unknown) => Promise.resolve().then(() => {
        if (table === "ap_aws_temporary_cleanup" && state.awsQueryError) {
          return { data: null, count: null, error: { message: "private database diagnostic" } };
        }
        const source: Row[] = table === "ap_aws_temporary_cleanup" ? state.rows
          : table === "operational_heartbeats" ? [{ task_name: "maintenance", last_succeeded_at: now.toISOString() }]
          : table === "ap_commerce_configuration" ? [{ singleton: true, ...legal }]
          : table === "ap_checkout_mode_configuration" ? [{ singleton: true, mode: "LOCKED", release_sha: null }]
          : [];
        const filtered = source.filter(row => predicates.every(predicate => predicate(row)));
        if (order) filtered.sort((left, right) => String(left[order!]).localeCompare(String(right[order!])));
        let data: unknown = head ? null : single ? filtered[0] ?? null : filtered.slice(0, limit);
        if (table === "ap_aws_temporary_cleanup" && dueFilter && state.missingDueTimestamp && !head) data = [{}];
        const count = table === "ap_aws_temporary_cleanup" && dueFilter && state.unknownDueCount ? null : filtered.length;
        return { data, count, error: null };
      }).then(resolve);
      return query;
    },
    async rpc(name: string) {
      const data = name === "ap_current_source_readiness"
        ? { jobSourcesRegistered: true, authorizedSourceInventory: true, manualReady: true, automatedReady: false }
        : name === "ap_manual_launch_capacity_readiness"
          ? { ready: true, resources: [{ resource: "SEARCH", checkoutAvailable: true }, { resource: "MATERIALS", checkoutAvailable: true }] }
          : {};
      return { data, error: null };
    },
  };
  return { state, admin: admin as unknown as Parameters<typeof evaluateLaunchInfrastructure>[0] & Parameters<typeof collectOperationsSummary>[0] };
}

describe("AWS temporary cleanup readiness", () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    const environment = {
      APP_DEPLOYMENT_ENV: "staging", APP_KMS_PROVIDER: "aws", CRON_SECRET: "test-cron",
      APP_SERVICE_RETENTION_ENABLED: "true",
      NEXT_PUBLIC_SUPABASE_URL: "https://fixture.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-public", SUPABASE_SECRET_KEY: "test-secret",
      APP_EXPECTED_RELEASE_SHA: "a".repeat(40), APP_RELEASE_SHA: "a".repeat(40), RAILWAY_GIT_COMMIT_SHA: "a".repeat(40),
      RESEND_API_KEY: "test-email", EMAIL_FROM_ADDRESS: "fixture@example.test", APP_EMAIL_DELIVERY_VERIFIED_AT: now.toISOString(),
      NEXT_PUBLIC_APP_URL: "https://staging.applypack.work", STRIPE_JOB_SEARCH_PRICE_ID: "price_search", STRIPE_APPLY_PACK_PRICE_ID: "price_pack",
    };
    for (const [key, value] of Object.entries(environment)) vi.stubEnv(key, value);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("changes an otherwise healthy launch gate at the exact overdue boundary", async () => {
    const db = database([due(1799)]);
    expect((await evaluateLaunchInfrastructure(db.admin)).ready).toBe(true);
    db.state.rows = [due(1800)];
    const result = await evaluateLaunchInfrastructure(db.admin);
    expect(result.ready).toBe(false);
    expect(Object.entries(result.checks).filter(([, ready]) => !ready).map(([key]) => key)).toEqual(["maintenance"]);
    db.state.rows = [due(3600, true), due(-60)];
    expect((await evaluateLaunchInfrastructure(db.admin)).ready).toBe(true);
  });
  it.each([undefined, "false"])("keeps launch closed until service-retention execution is explicitly enabled (%s)", async (enabled) => {
    vi.stubEnv("APP_SERVICE_RETENTION_ENABLED", enabled);
    const result = await evaluateLaunchInfrastructure(database().admin);
    expect(result.ready).toBe(false);
    expect(result.checks.serviceRetention).toBe(false);
  });

  it("fails launch readiness when overdue-count evidence is unavailable instead of treating it as zero", async () => {
    const db = database();
    expect((await evaluateLaunchInfrastructure(db.admin)).ready).toBe(true);
    db.state.unknownDueCount = true;
    expect((await evaluateLaunchInfrastructure(db.admin)).checks.maintenance).toBe(false);
    db.state.unknownDueCount = false;
    db.state.awsQueryError = true;
    expect((await evaluateLaunchInfrastructure(db.admin)).checks.maintenance).toBe(false);
  });

  it("summarizes all due rows despite fetching only the oldest timestamp and exposes no object identifiers", async () => {
    const db = database();
    expect((await collectOperationsSummary(db.admin, now)).readiness.maintenance).toBe(true);
    db.state.rows = Array.from({ length: 25 }, (_, index) => due(1800 + index));
    const result = await collectOperationsSummary(db.admin, now);
    expect(result.readiness.maintenance).toBe(false);
    expect(result.readiness.database).toBe(true);
    expect(result.queues.storageCleanup).toEqual({
      states: { pending: 25, awsDue: 25, deadLetter: 0 }, oldestItemAgeSeconds: 1824, stale: true,
    });
    expect(containsSensitiveOperationsData(result)).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private-object-identifier");
  });

  it("does not count completed history or not-yet-due objects as overdue", async () => {
    const db = database([due(3600, true), due(-60)]);
    const result = await collectOperationsSummary(db.admin, now);
    expect(result.readiness.maintenance).toBe(true);
    expect(result.queues.storageCleanup).toEqual({
      states: { pending: 1, awsDue: 0, deadLetter: 0 }, oldestItemAgeSeconds: null, stale: false,
    });
  });

  it("fails summary readiness for missing due timestamps and query errors", async () => {
    const db = database([due(60)]);
    expect((await collectOperationsSummary(db.admin, now)).readiness.maintenance).toBe(true);
    db.state.missingDueTimestamp = true;
    expect((await collectOperationsSummary(db.admin, now)).readiness.maintenance).toBe(false);
    db.state.awsQueryError = true;
    const result = await collectOperationsSummary(db.admin, now);
    expect(result.readiness).toMatchObject({ maintenance: false, database: false });
    expect(JSON.stringify(result)).not.toContain("private database diagnostic");
  });

  it("fails summary readiness when an exact due count is absent", async () => {
    const db = database();
    expect((await collectOperationsSummary(db.admin, now)).readiness.maintenance).toBe(true);
    db.state.unknownDueCount = true;
    expect((await collectOperationsSummary(db.admin, now)).readiness).toMatchObject({ database: false, maintenance: false });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const email = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/email/send", () => ({ sendTransactionalEmail: email.send }));
import { diagnoseOperations, recordMaintenanceDiagnosis, sendProtectedRecoveryAlert } from "@/lib/operations/maintenance-observability";
import { containsSensitiveOperationsData, type OperationsSummary } from "@/lib/operations/summary";

function summary(): OperationsSummary {
  const queue = { states: {}, oldestItemAgeSeconds: null, stale: false };
  return { generatedAt: "2026-10-23T22:00:00.000Z", environment: "production", releaseSha: "a".repeat(40),
    readiness: { database: true, payments: true, email: true, fileSafety: true, maintenance: true },
    inventory: { registeredSources: 0, scheduledSources: 0, scheduledAutomatedRealSources: 0, realAuthorizedAutomatedSources: 0,
      unauthorizedScheduledAutomatedRealSources: 0, syntheticRuns: 0, realRuns: 0, syntheticActiveJobs: 0, realActiveJobs: 0 },
    queues: { recompute: queue, workflow: queue, outbox: queue, commerceReconciliation: queue, storageCleanup: queue },
    maintenance: { heartbeatAgeSeconds: 0, stale: false }, alerts: { openWarnings: 0, openCritical: 0 },
    protectedRecovery: { required: true, ready: false, warning: true, ageSeconds: 720 },
  };
}
function database(status: string | null = null) {
  const existing = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data: status ? { status } : null, error: null }),
    upsert: vi.fn().mockResolvedValue({ error: null }) };
  existing.select.mockReturnValue(existing); existing.eq.mockReturnValue(existing);
  const markers = { select: vi.fn(), in: vi.fn().mockResolvedValue({ data: [{ alert_key: "maintenance/PROTECTED_RECOVERY_NOT_READY", opened_at: "2026-10-23T21:50:00.000Z" }], error: null }) };
  markers.select.mockReturnValue(markers);
  const from = vi.fn((name) => name === "email_events" ? existing : markers);
  return { existing, markers, admin: { from } as unknown as Parameters<typeof sendProtectedRecoveryAlert>[0] };
}
describe("protected recovery operations", () => {
  afterEach(() => { vi.unstubAllEnvs(); email.send.mockReset(); });
  it("treats absent production proof as an acceptance hold and ten-minute aging as a warning", () => {
    const value = summary(); expect(diagnoseOperations(value).failClosedCodes).toEqual(["PROTECTED_RECOVERY_NOT_READY"]);
    delete value.protectedRecovery; expect(diagnoseOperations(value).failClosedCodes).toEqual(["PROTECTED_RECOVERY_NOT_READY"]);
    value.protectedRecovery = { required: true, ready: true, warning: true, ageSeconds: 600 };
    expect(diagnoseOperations(value)).toMatchObject({ codes: ["PROTECTED_RECOVERY_AGING"], failClosedCodes: [] });
    expect(containsSensitiveOperationsData(value)).toBe(false);
  });
  it("sends only aggregate operator details and records provider-confirmed delivery", async () => {
    vi.stubEnv("APP_ADMIN_ALERT_EMAIL", "operator@example.test"); email.send.mockResolvedValue({ skipped: false, providerMessageId: "message" });
    const db = database(); expect(await sendProtectedRecoveryAlert(db.admin, summary(), ["PROTECTED_RECOVERY_NOT_READY"])).toBe("sent");
    expect(email.send).toHaveBeenCalledWith(expect.objectContaining({ to: "operator@example.test", idempotencyKey: expect.stringMatching(/^protected-recovery-alert\/[a-f0-9]{32}$/) }));
    expect(db.existing.upsert).toHaveBeenCalledWith(expect.objectContaining({ status: "sent", provider_message_id: "message" }), { onConflict: "idempotency_key" });
  });
  it("deduplicates a confirmed episode while allowing failed or skipped attempts to retry", async () => {
    vi.stubEnv("APP_ADMIN_ALERT_EMAIL", "operator@example.test"); email.send.mockResolvedValue({ skipped: false, providerMessageId: "message" });
    expect(await sendProtectedRecoveryAlert(database("sent").admin, summary(), ["PROTECTED_RECOVERY_NOT_READY"])).toBe("already_sent");
    expect(email.send).not.toHaveBeenCalled();
    expect(await sendProtectedRecoveryAlert(database("failed").admin, summary(), ["PROTECTED_RECOVERY_NOT_READY"])).toBe("sent");
    expect(await sendProtectedRecoveryAlert(database("skipped").admin, summary(), ["PROTECTED_RECOVERY_NOT_READY"])).toBe("sent");
  });
  it("does not report missing credentials, skipped sends, missing provider IDs or provider errors as delivered", async () => {
    const db = database(); expect(await sendProtectedRecoveryAlert(db.admin, summary(), ["PROTECTED_RECOVERY_NOT_READY"])).toBe("failed");
    vi.stubEnv("APP_ADMIN_ALERT_EMAIL", "operator@example.test");
    for (const result of [{ skipped: true }, { skipped: false }]) {
      email.send.mockResolvedValue(result); expect(await sendProtectedRecoveryAlert(db.admin, summary(), ["PROTECTED_RECOVERY_NOT_READY"])).toBe("failed");
    }
    email.send.mockRejectedValue(new Error("private provider secret"));
    expect(await sendProtectedRecoveryAlert(db.admin, summary(), ["PROTECTED_RECOVERY_NOT_READY"])).toBe("failed");
    expect(db.existing.upsert).not.toHaveBeenCalled();
  });
  it("does not send an alert for unrelated diagnoses or a healthy checkpoint", async () => {
    expect(await sendProtectedRecoveryAlert(database().admin, summary(), [])).toBe("not_needed"); expect(email.send).not.toHaveBeenCalled();
  });
  it("sends again after recovery and a second outage without repeating an open episode", async () => {
    vi.stubEnv("APP_ADMIN_ALERT_EMAIL", "operator@example.test");
    email.send.mockResolvedValue({ skipped: false, providerMessageId: "message" });
    const alerts = new Map<string, Record<string, unknown>>();
    const events = new Map<string, Record<string, unknown>>();
    const admin = { from: (table: string) => {
      let key = ""; let update: Record<string, unknown> | null = null; let selecting = false;
      const query = {
        select: () => { selecting = true; return query; },
        update: (value: Record<string, unknown>) => { update = value; return query; },
        eq: (_column: string, value: string) => { key = value; return table === "operational_heartbeats" ? Promise.resolve({ error: null }) : query; },
        in: (_column: string, values: string[]) => {
          if (selecting) return Promise.resolve({ data: values.flatMap((value) => alerts.has(value) ? [alerts.get(value)] : []), error: null });
          const row = alerts.get(key);
          if (row && values.includes(String(row.state))) Object.assign(row, update);
          return Promise.resolve({ error: null });
        },
        maybeSingle: () => Promise.resolve({ data: events.get(key) || null, error: null }),
        upsert: (value: Record<string, unknown>) => {
          if (table === "email_events") events.set(String(value.idempotency_key), value);
          else {
            const name = String(value.alert_key);
            const row = alerts.get(name) || { opened_at: "2026-10-23T22:00:00.000Z" };
            alerts.set(name, { ...row, ...value });
          }
          return Promise.resolve({ error: null });
        },
      };
      return query;
    } } as unknown as Parameters<typeof recordMaintenanceDiagnosis>[0];
    const outage = summary();
    expect((await recordMaintenanceDiagnosis(admin, outage, new Date("2026-10-23T22:00:00.000Z"))).protectedRecoveryAlert).toBe("sent");
    expect((await recordMaintenanceDiagnosis(admin, outage, new Date("2026-10-23T22:01:00.000Z"))).protectedRecoveryAlert).toBe("already_sent");
    const healthy = summary(); healthy.protectedRecovery = { required: true, ready: true, warning: false, ageSeconds: 60 };
    await recordMaintenanceDiagnosis(admin, healthy, new Date("2026-10-23T22:02:00.000Z"));
    expect((await recordMaintenanceDiagnosis(admin, outage, new Date("2026-10-23T23:00:00.000Z"))).protectedRecoveryAlert).toBe("sent");
    expect(email.send).toHaveBeenCalledTimes(2);
    expect(email.send.mock.calls[0][0].idempotencyKey).not.toBe(email.send.mock.calls[1][0].idempotencyKey);
    expect(alerts.get("maintenance/PROTECTED_RECOVERY_NOT_READY")?.opened_at).toBe("2026-10-23T23:00:00.000Z");
  });
});

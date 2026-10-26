import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { assessMonitorDatabase, assessMonitorMaintenance, authorizeIndependentMonitor, buildIndependentMonitorSnapshot } from "@/lib/operations/independent-monitor";

const release = "a".repeat(40), nonce = "b".repeat(64), secret = "S".repeat(43);
const now = Date.parse("2026-10-26T01:00:00Z"), at = (age: number) => new Date(now - age * 1_000).toISOString();
const config = { environment: "production" as const, releaseSha: release };
const environment = { APP_OPERATIONS_MONITOR_ENABLED: "true", APP_OPERATIONS_MONITOR_SECRET: secret,
  APP_DEPLOYMENT_ENV: "production", APP_EXPECTED_RELEASE_SHA: release, RAILWAY_GIT_COMMIT_SHA: release,
  NEXT_PUBLIC_SUPABASE_URL: "https://spjaaxndiduhrcleazwb.supabase.co" };
const request = (suffix = `?nonce=${nonce}`, headers: Record<string, string> = {}) => new Request(`https://applypack.work/api/internal/operations-monitor${suffix}`,
  { headers: { authorization: `Bearer ${secret}`, ...headers } });
const heartbeat = () => ({ task_name: "maintenance", last_succeeded_at: at(60), updated_at: at(60),
  summary: { schemaVersion: 2, environment: "production", releaseSha: release, phase: "VERIFIED", unresolvedCodes: [] as string[] } });
const database = () => ({ schemaVersion: "applypack-database-archive-status-v1", state: "VERIFIED", reason: null,
  runId: "11111111-1111-4111-8111-111111111111", releaseSha: release, providerVerificationSha256: "d".repeat(64),
  sourceProjectRef: "spjaaxndiduhrcleazwb", schemaVersionOfSnapshot: "202610250099", sourceWatermark: at(60), databaseSnapshotAt: at(45), verifiedAt: at(30), evidenceExpiresAt: at(-840) });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("independent readonly operations monitor", () => {
  it("requires a distinct explicit token and exact deployment identity", () => {
    expect(authorizeIndependentMonitor(request(), environment)).toEqual({ configuration: config, nonce });
    for (const patch of [{ APP_OPERATIONS_MONITOR_ENABLED: "false" }, { APP_EXPECTED_RELEASE_SHA: "c".repeat(40) },
      { APP_DEPLOYMENT_ENV: "staging" }, { NEXT_PUBLIC_SUPABASE_URL: "https://wrong.supabase.co" },
      { CRON_SECRET: secret }, { APP_OPERATIONS_MONITOR_SECRET: "too-short" }]) {
      expect(() => authorizeIndependentMonitor(request(), { ...environment, ...patch })).toThrow("MONITOR_UNAVAILABLE");
    }
  });
  it.each<Record<string, string>>([{ authorization: "Bearer wrong" }, { cookie: "session=anything" }, { authorization: "x".repeat(257) }])("rejects sessions or incorrect credentials", (headers) => {
    expect(() => authorizeIndependentMonitor(request(undefined, headers), environment)).toThrow("MONITOR_UNAUTHORIZED");
  });
  it.each(["", "?nonce=short", `?nonce=${nonce}&nonce=${nonce}`, `?nonce=${nonce}&other=1`])("rejects replayless or extra query inputs %s", (suffix) => {
    expect(() => authorizeIndependentMonitor(request(suffix), environment)).toThrow("MONITOR_INVALID_REQUEST");
  });
  it("accepts only verified success for this release; stale attempts never refresh success", () => {
    expect(assessMonitorMaintenance(heartbeat(), config, now)).toEqual({ state: "HEALTHY", ageSeconds: 60 });
    for (const phase of ["FAILED", "DIAGNOSED"]) {
      const row = heartbeat(); row.summary.phase = phase;
      expect(assessMonitorMaintenance(row, config, now).state).toBe(phase === "FAILED" ? "FAILED" : "RUNNING");
    }
    const row = heartbeat(); row.last_succeeded_at = at(1200); row.updated_at = at(0);
    expect(assessMonitorMaintenance(row, config, now).state).toBe("STALE");
    row.summary.releaseSha = "c".repeat(40);
    expect(assessMonitorMaintenance(row, config, now).state).toBe("UNKNOWN");
  });
  it("rejects future timestamps and unresolved conditions even with a fresh success time", () => {
    const row = heartbeat(); row.updated_at = at(-1);
    expect(assessMonitorMaintenance(row, config, now).state).toBe("UNKNOWN");
    row.updated_at = at(0); row.summary.unresolvedCodes = ["DATABASE_NOT_READY"];
    expect(assessMonitorMaintenance(row, config, now).state).toBe("FAILED");
  });
  it("uses the source watermark, exact schema, and authenticated completion rather than upload time", () => {
    expect(assessMonitorDatabase(database(), config, "202610250099", now)).toEqual({ state: "HEALTHY", ageSeconds: 60 });
    expect(assessMonitorDatabase({ ...database(), sourceWatermark: at(600), evidenceExpiresAt: at(-300) }, config, "202610250099", now).state).toBe("STALE");
    for (const patch of [{ state: "OPEN" }, { schemaVersionOfSnapshot: "202610250095" }, { sourceProjectRef: "wrong" },
      { sourceWatermark: at(-1) }, { evidenceExpiresAt: at(0) }]) {
      expect(assessMonitorDatabase({ ...database(), ...patch }, config, "202610250099", now).state).toBe("UNKNOWN");
    }
  });
  it("outputs only coarse fixed checks and nonce; missing and duplicate evidence is unknown", () => {
    const result = buildIndependentMonitorSnapshot({ configuration: config, nonce, rows: [heartbeat()], database: { state: "UNKNOWN", ageSeconds: null }, now });
    expect(Object.keys(result.checks)).toEqual(["maintenance", "fileRecovery", "databaseRecovery", "archiveRetention"]);
    expect(result.checks.fileRecovery?.state).toBe("UNKNOWN");
    expect(result.checks.databaseRecovery?.state).toBe("UNKNOWN");
    expect(JSON.stringify(result)).not.toMatch(/customer|provider|manifest|spjaaxndiduhrcleazwb|SECRET/);
    const duplicate = buildIndependentMonitorSnapshot({ configuration: config, nonce, rows: [heartbeat(), heartbeat()], database: { state: "UNKNOWN", ageSeconds: null }, now });
    expect(duplicate.checks.maintenance.state).toBe("UNKNOWN");
    expect(Object.keys(buildIndependentMonitorSnapshot({ configuration: { ...config, environment: "staging" }, nonce,
      rows: [], database: { state: "UNKNOWN", ageSeconds: null }, now }).checks)).toEqual(["maintenance"]);
  });
});

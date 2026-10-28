import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { assessDatabaseRecoveryStatus, assessProtectedRecoveryCheckpoint, RECOVERY_SOURCE_PROJECT_REF } from "./protected-recovery-readiness";

export const MONITOR_VERSION = "applypack-independent-monitor-v1";
export const MONITOR_TASKS = ["maintenance", "protected_recovery", "protected_recovery_retention"] as const;
export const MONITOR_HEADERS = { "cache-control": "private, no-store", "x-robots-tag": "noindex, nofollow", "x-content-type-options": "nosniff" };
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const timestamp = z.iso.datetime({ offset: true });
const productionUrl = `https://${RECOVERY_SOURCE_PROJECT_REF}.supabase.co`;
const stagingUrl = "https://fmugizadzdnqfckujqlw.supabase.co";
const maintenanceSchema = z.object({ schemaVersion: z.literal(2), environment: z.enum(["staging", "production"]), releaseSha: sha,
  phase: z.enum(["VERIFIED", "DIAGNOSED", "FAILED"]), unresolvedCodes: z.array(z.string()).max(100),
}).passthrough();

export type MonitorConfiguration = { environment: "staging" | "production"; releaseSha: string };
export type MonitorCheck = { state: "HEALTHY" | "RUNNING" | "FAILED" | "STALE" | "UNKNOWN"; ageSeconds: number | null };
export type MonitorHeartbeat = { task_name?: unknown; last_succeeded_at?: unknown; updated_at?: unknown; summary?: unknown };
const unknown = (): MonitorCheck => ({ state: "UNKNOWN", ageSeconds: null });

/** This token reads only the fixed health projection. It must not grant access
 * to a writer, archive reader, cron action, user session or customer record. */
export function authorizeIndependentMonitor(request: Request, env: Partial<NodeJS.ProcessEnv> = process.env) {
  const secret = env.APP_OPERATIONS_MONITOR_SECRET;
  const deployedSha = env.RAILWAY_GIT_COMMIT_SHA || env.APP_RELEASE_SHA || "";
  const environment = env.APP_DEPLOYMENT_ENV;
  if (env.APP_OPERATIONS_MONITOR_ENABLED !== "true" || !secret || !/^[A-Za-z0-9_-]{43,128}$/.test(secret)
    || !sha.safeParse(deployedSha).success || env.APP_EXPECTED_RELEASE_SHA !== deployedSha
    || (environment !== "staging" && environment !== "production")
    || env.NEXT_PUBLIC_SUPABASE_URL !== (environment === "production" ? productionUrl : stagingUrl)
    || Object.entries(env).some(([name, value]) => name !== "APP_OPERATIONS_MONITOR_SECRET"
      && /SECRET|TOKEN|KEY/.test(name) && value === secret)) throw new Error("MONITOR_UNAVAILABLE");
  const provided = request.headers.get("authorization") || "";
  if (request.headers.has("cookie") || provided.length > 256
    || !timingSafeEqual(createHash("sha256").update(provided).digest(), createHash("sha256").update(`Bearer ${secret}`).digest())) {
    throw new Error("MONITOR_UNAUTHORIZED");
  }
  const url = new URL(request.url), nonce = url.searchParams.get("nonce");
  if (request.method !== "GET" || request.body !== null || [...url.searchParams.keys()].length !== 1
    || !nonce || !/^[a-f0-9]{64}$/.test(nonce)) throw new Error("MONITOR_INVALID_REQUEST");
  return { configuration: { environment, releaseSha: deployedSha } satisfies MonitorConfiguration, nonce };
}

export function assessMonitorMaintenance(row: MonitorHeartbeat | undefined, config: MonitorConfiguration, now: number): MonitorCheck {
  const parsed = maintenanceSchema.safeParse(row?.summary);
  if (!parsed.success || parsed.data.environment !== config.environment || parsed.data.releaseSha !== config.releaseSha
    || typeof row?.last_succeeded_at !== "string" || typeof row.updated_at !== "string"
    || !timestamp.safeParse(row.last_succeeded_at).success || !timestamp.safeParse(row.updated_at).success || !Number.isFinite(now)) return unknown();
  const succeeded = Date.parse(row.last_succeeded_at), updated = Date.parse(row.updated_at);
  if (succeeded > now || updated > now || updated < succeeded) return unknown();
  const ageSeconds = Math.floor((now - succeeded) / 1_000);
  if (parsed.data.phase === "FAILED" || parsed.data.unresolvedCodes.length) return { state: "FAILED", ageSeconds };
  // One scheduled 15-minute cycle plus its bounded five-minute execution budget.
  if (ageSeconds >= 20 * 60) return { state: "STALE", ageSeconds };
  // An in-progress run is never substituted for completed verification. The
  // maintenance alarm allows five minutes; recovery alarms allow two minutes.
  return { state: parsed.data.phase === "VERIFIED" ? "HEALTHY" : "RUNNING", ageSeconds };
}

export function assessMonitorDatabase(value: unknown, config: MonitorConfiguration, expectedSchema: string, now: number): MonitorCheck {
  const result = assessDatabaseRecoveryStatus(value, config.releaseSha, now, expectedSchema);
  return { state: result.reason === "UNVERIFIED" ? "UNKNOWN" : result.warning ? "STALE" : "HEALTHY", ageSeconds: result.ageSeconds };
}

export function buildIndependentMonitorSnapshot(input: {
  configuration: MonitorConfiguration; nonce: string; rows: MonitorHeartbeat[]; database: MonitorCheck; now?: number;
}) {
  const now = input.now ?? Date.now(), config = input.configuration;
  if (!sha.safeParse(config.releaseSha).success || !/^[a-f0-9]{64}$/.test(input.nonce) || !Number.isFinite(now)) throw new Error("MONITOR_INVALID_SNAPSHOT");
  const row = (task: string) => {
    const matches = input.rows.filter((item) => item.task_name === task);
    return matches.length === 1 ? matches[0] : undefined;
  };
  const maintenance = assessMonitorMaintenance(row("maintenance"), config, now);
  const recovery = (task: string, kind: "archive" | "retention"): MonitorCheck => {
    const result = assessProtectedRecoveryCheckpoint(row(task), config.releaseSha, now, kind);
    return { state: result.reason === "UNVERIFIED" ? "UNKNOWN" : result.warning ? "STALE" : "HEALTHY", ageSeconds: result.ageSeconds };
  };
  return { schemaVersion: MONITOR_VERSION, environment: config.environment, releaseSha: config.releaseSha,
    nonce: input.nonce, observedAt: new Date(now).toISOString(),
    checks: config.environment === "production" ? { maintenance, fileRecovery: recovery("protected_recovery", "archive"),
      databaseRecovery: input.database, archiveRetention: recovery("protected_recovery_retention", "retention") } : { maintenance } };
}

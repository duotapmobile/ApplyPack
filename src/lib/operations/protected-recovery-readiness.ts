import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { readDatabaseArchiveStatus } from "../../../scripts/lib/archive-writer-completion.mjs";
import { DATABASE_RECOVERY } from "../../../scripts/lib/database-recovery-protocol.mjs";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
export const RECOVERY_SOURCE_PROJECT_REF = "spjaaxndiduhrcleazwb";
export const RECOVERY_WARNING_AGE_MS = 10 * 60 * 1_000;
// Stop new data before the agreed 15-minute limit, leaving time for in-flight work.
export const RECOVERY_ACCEPTANCE_AGE_MS = 12 * 60 * 1_000;
const MAX_CYCLE_MS = 5 * 60 * 1_000;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true });
const checkpointSchema = z.object({
  schemaVersion: z.literal("applypack-protected-recovery-checkpoint-v1"),
  sourceEnvironment: z.literal("production"),
  sourceProjectRef: z.literal(RECOVERY_SOURCE_PROJECT_REF),
  releaseSha: z.string().regex(/^[a-f0-9]{40}$/),
  sourceStartedAt: timestamp,
  completedAt: timestamp,
  inventoryDigest: digest,
  manifestSha256: digest,
  manifestVersionId: z.string().min(1).max(1_024).regex(/^[A-Za-z0-9._~+\/=:-]+$/).refine((value) => value !== "null"),
  objectCount: z.number().int().min(0).max(100_000),
  referenceCount: z.number().int().min(0).max(1_000_000),
  tombstoneCount: z.number().int().min(0).max(1_000_000),
}).strict();
const retentionSchema = z.object({
  schemaVersion: z.literal("applypack-protected-recovery-retention-v1"),
  sourceEnvironment: z.literal("production"), sourceProjectRef: z.literal(RECOVERY_SOURCE_PROJECT_REF),
  releaseSha: z.string().regex(/^[a-f0-9]{40}$/), sourceStartedAt: timestamp, completedAt: timestamp,
  inventoryDigest: digest, planSha256: digest, providerVerificationSha256: digest,
  deletedVersionCount: z.number().int().min(0).max(100_000),
  retainedVersionCount: z.number().int().min(0).max(100_000),
}).strict();

export type RecoveryReadiness = {
  required: boolean;
  ready: boolean;
  warning: boolean;
  ageSeconds: number | null;
  reason: "NOT_REQUIRED" | "VERIFIED" | "STALE" | "UNVERIFIED";
};

export function assessProtectedRecoveryCheckpoint(
  row: { last_succeeded_at?: unknown; summary?: unknown } | null | undefined,
  expectedReleaseSha: string,
  now = Date.now(),
  kind: "archive" | "retention" = "archive",
): RecoveryReadiness {
  const denied: RecoveryReadiness = { required: true, ready: false, warning: true, ageSeconds: null, reason: "UNVERIFIED" };
  const parsed = (kind === "archive" ? checkpointSchema : retentionSchema).safeParse(row?.summary);
  if (!parsed.success || !Number.isFinite(now) || !/^[a-f0-9]{40}$/.test(expectedReleaseSha)
    || parsed.data.releaseSha !== expectedReleaseSha || typeof row?.last_succeeded_at !== "string") return denied;
  const start = Date.parse(parsed.data.sourceStartedAt);
  const completed = Date.parse(parsed.data.completedAt);
  if (Date.parse(row.last_succeeded_at) !== start || start > now || completed > now
    || completed < start || completed - start > MAX_CYCLE_MS) return denied;
  const age = now - start;
  return { required: true, ready: age < RECOVERY_ACCEPTANCE_AGE_MS,
    warning: age >= RECOVERY_WARNING_AGE_MS, ageSeconds: Math.floor(age / 1_000),
    reason: age < RECOVERY_ACCEPTANCE_AGE_MS ? "VERIFIED" : "STALE" };
}

export function assessDatabaseRecoveryStatus(
  value: unknown, expectedReleaseSha: string, now = Date.now(), expectedSchemaVersion: string = DATABASE_RECOVERY.schemaVersion,
): RecoveryReadiness {
  const denied: RecoveryReadiness = { required: true, ready: false, warning: true, ageSeconds: null, reason: "UNVERIFIED" };
  const parsed = z.object({ schemaVersion: z.literal("applypack-database-archive-status-v1"), state: z.literal("VERIFIED"), reason: z.null(),
    runId: z.uuid(), releaseSha: z.literal(expectedReleaseSha), sourceProjectRef: z.literal(RECOVERY_SOURCE_PROJECT_REF),
    schemaVersionOfSnapshot: z.literal(expectedSchemaVersion), sourceWatermark: timestamp, databaseSnapshotAt: timestamp,
    verifiedAt: timestamp, providerVerificationSha256: digest, evidenceExpiresAt: timestamp,
  }).strict().safeParse(value);
  if (!parsed.success || !Number.isFinite(now) || !/^[a-f0-9]{40}$/.test(expectedReleaseSha)) return denied;
  const start = Date.parse(parsed.data.sourceWatermark), snapshot = Date.parse(parsed.data.databaseSnapshotAt);
  const verified = Date.parse(parsed.data.verifiedAt), expires = Date.parse(parsed.data.evidenceExpiresAt);
  if (start > snapshot || snapshot > verified || verified > now || verified - start > RECOVERY_WARNING_AGE_MS
    || expires !== start + 15 * 60_000 || now >= expires) return denied;
  const age = now - start;
  return { required: true, ready: age < RECOVERY_ACCEPTANCE_AGE_MS, warning: age >= RECOVERY_WARNING_AGE_MS,
    ageSeconds: Math.floor(age / 1_000), reason: age < RECOVERY_ACCEPTANCE_AGE_MS ? "VERIFIED" : "STALE" };
}

export async function readProtectedRecoveryReadiness(admin: AdminClient): Promise<RecoveryReadiness> {
  const productionSource = `https://${RECOVERY_SOURCE_PROJECT_REF}.supabase.co`;
  const required = process.env.APP_DEPLOYMENT_ENV === "production"
    || process.env.NEXT_PUBLIC_SUPABASE_URL === productionSource
    || process.env.NEXT_PUBLIC_APP_URL === "https://applypack.work";
  if (!required) {
    return { required: false, ready: true, warning: false, ageSeconds: null, reason: "NOT_REQUIRED" };
  }
  const denied: RecoveryReadiness = { required: true, ready: false, warning: true, ageSeconds: null, reason: "UNVERIFIED" };
  const sha = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.APP_RELEASE_SHA || "";
  if (process.env.APP_DEPLOYMENT_ENV !== "production" || process.env.APP_EXPECTED_RELEASE_SHA !== sha
    || process.env.NEXT_PUBLIC_SUPABASE_URL !== productionSource) return denied;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  let onAbort: (() => void) | undefined;
  try {
    const reads = Promise.all([
      admin.from("operational_heartbeats").select("last_succeeded_at,summary").eq("task_name", "protected_recovery").abortSignal(controller.signal).maybeSingle(),
      admin.from("operational_heartbeats").select("last_succeeded_at,summary").eq("task_name", "protected_recovery_retention").abortSignal(controller.signal).maybeSingle(),
      readDatabaseArchiveStatus({ releaseSha: sha, expectedSchemaVersion: DATABASE_RECOVERY.schemaVersion, signal: controller.signal,
        readLatestDatabaseCompletion: async ({ signal }: { signal: AbortSignal }) => {
          const result = await admin.rpc("ap_latest_verified_database_archive").abortSignal(signal);
          if (result.error) throw new Error("DATABASE_RECOVERY_READ_UNAVAILABLE");
          return result.data;
        },
      }),
    ]);
    const [archive, retention, database] = await Promise.race([reads, new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error("RECOVERY_READ_UNAVAILABLE"));
      controller.signal.addEventListener("abort", onAbort, { once: true });
      if (controller.signal.aborted) onAbort();
    })]);
    if (controller.signal.aborted) return denied;
    if (archive.error || retention.error) return denied;
    const results = [assessProtectedRecoveryCheckpoint(archive.data, sha),
      assessProtectedRecoveryCheckpoint(retention.data, sha, Date.now(), "retention"), assessDatabaseRecoveryStatus(database, sha)];
    if (results.some((result) => result.reason === "UNVERIFIED")) return denied;
    const ready = results.every((result) => result.ready);
    return { required: true, ready, warning: results.some((result) => result.warning),
      ageSeconds: Math.max(...results.map((result) => result.ageSeconds ?? 0)), reason: ready ? "VERIFIED" : "STALE" };
  } catch {
    return denied;
  } finally {
    clearTimeout(timer);
    if (onAbort) controller.signal.removeEventListener("abort", onAbort);
    controller.abort();
  }
}

export async function newIntakeRecoveryHold(admin: AdminClient) {
  if ((await readProtectedRecoveryReadiness(admin)).ready) return null;
  return NextResponse.json({ error: "New intake is temporarily unavailable. Please try again later." },
    { status: 503, headers: { "cache-control": "private, no-store" } });
}

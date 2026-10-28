import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  assessDatabaseRecoveryStatus, assessProtectedRecoveryCheckpoint, newIntakeRecoveryHold, readProtectedRecoveryReadiness,
  RECOVERY_ACCEPTANCE_AGE_MS, RECOVERY_SOURCE_PROJECT_REF, RECOVERY_WARNING_AGE_MS,
} from "@/lib/operations/protected-recovery-readiness";
import { DATABASE_RECOVERY } from "../../scripts/lib/database-recovery-protocol.mjs";
import { canonicalSha256 } from "../../scripts/lib/protected-recovery-core.mjs";
import { inspectDatabaseArchiveCompletion } from "../../scripts/lib/archive-writer-completion.mjs";

const now = Date.parse("2026-10-23T22:00:00.000Z");
const sha = "a".repeat(40);
function checkpoint(age = 60_000) {
  const sourceStartedAt = new Date(now - age).toISOString();
  return { last_succeeded_at: sourceStartedAt, summary: {
    schemaVersion: "applypack-protected-recovery-checkpoint-v1", sourceEnvironment: "production",
    sourceProjectRef: RECOVERY_SOURCE_PROJECT_REF, releaseSha: sha, sourceStartedAt,
    completedAt: new Date(now - age + Math.min(age, 30_000)).toISOString(),
    inventoryDigest: "b".repeat(64), manifestSha256: "c".repeat(64), manifestVersionId: "opaque-version_1",
    objectCount: 3, referenceCount: 4, tombstoneCount: 1,
  } };
}

function retentionCheckpoint(age = 60_000) {
  const row = checkpoint(age);
  return { last_succeeded_at: row.last_succeeded_at, summary: {
    schemaVersion: "applypack-protected-recovery-retention-v1", sourceEnvironment: "production",
    sourceProjectRef: RECOVERY_SOURCE_PROJECT_REF, releaseSha: sha,
    sourceStartedAt: row.summary.sourceStartedAt, completedAt: row.summary.completedAt,
    inventoryDigest: "b".repeat(64), planSha256: "c".repeat(64), providerVerificationSha256: "d".repeat(64),
    deletedVersionCount: 0, retainedVersionCount: 4,
  } };
}
function databaseCompletion(age = 60_000) {
  const at = (offset: number) => new Date(now - age + offset).toISOString();
  const id = "11111111-1111-4111-8111-111111111111";
  const receipt = { schemaVersion: "applypack-archive-writer-completion-v1", runId: id, kind: "DATABASE", releaseSha: sha,
    sourceProjectRef: RECOVERY_SOURCE_PROJECT_REF, snapshotSchemaVersion: DATABASE_RECOVERY.schemaVersion,
    sourceWatermark: at(0), databaseSnapshotAt: at(15_000), verifiedAt: at(30_000), evidenceExpiresAt: at(900_000),
    manifestSha256: "b".repeat(64), manifestVersionId: "database-v1", inventoryDigest: "c".repeat(64),
    pairedFileManifestSha256: "d".repeat(64), pairedFileManifestVersionId: "files-v1", applicationCheckpointSha256: "e".repeat(64), providerVerificationSha256: "f".repeat(64) };
  return { id, kind: "DATABASE", state: "COMPLETE", provider_dispatched: true, release_sha: sha, started_at: at(10_000),
    finished_at: at(40_000), completion_receipt: receipt, result_sha256: canonicalSha256(receipt) };
}
function client(data: unknown, error: unknown = null, retention: unknown = retentionCheckpoint(), database: unknown = databaseCompletion()) {
  const query = { select: vi.fn(), eq: vi.fn(), abortSignal: vi.fn(), maybeSingle: vi.fn()
    .mockResolvedValueOnce({ data, error }).mockResolvedValue({ data: retention, error }) };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.abortSignal.mockReturnValue(query);
  const from = vi.fn().mockReturnValue(query);
  const rpcQuery = { abortSignal: vi.fn().mockResolvedValue({ data: database, error }) };
  const rpc = vi.fn().mockReturnValue(rpcQuery);
  return { from, query, rpc, rpcQuery, admin: { from, rpc } as unknown as Parameters<typeof readProtectedRecoveryReadiness>[0] };
}

describe("protected recovery acceptance", () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(now);
    vi.stubEnv("APP_DEPLOYMENT_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `https://${RECOVERY_SOURCE_PROJECT_REF}.supabase.co`);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://applypack.work");
    vi.stubEnv("RAILWAY_GIT_COMMIT_SHA", sha);
    vi.stubEnv("APP_RELEASE_SHA", "");
    vi.stubEnv("APP_EXPECTED_RELEASE_SHA", sha);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

  it("accepts a complete current-source checkpoint and permits a verified empty inventory", () => {
    expect(assessProtectedRecoveryCheckpoint(checkpoint(), sha, now)).toMatchObject({ ready: true, warning: false, ageSeconds: 60 });
    const empty = checkpoint(); Object.assign(empty.summary, { objectCount: 0, referenceCount: 0, tombstoneCount: 0 });
    expect(assessProtectedRecoveryCheckpoint(empty, sha, now).ready).toBe(true);
  });

  it("warns at ten minutes and stops acceptance at twelve, measured from source start", () => {
    expect(assessProtectedRecoveryCheckpoint(checkpoint(RECOVERY_WARNING_AGE_MS), sha, now))
      .toMatchObject({ ready: true, warning: true });
    expect(assessProtectedRecoveryCheckpoint(checkpoint(RECOVERY_ACCEPTANCE_AGE_MS - 1), sha, now).ready).toBe(true);
    expect(assessProtectedRecoveryCheckpoint(checkpoint(RECOVERY_ACCEPTANCE_AGE_MS), sha, now))
      .toMatchObject({ ready: false, warning: true, reason: "STALE" });
  });

  it.each([
    ["different release", { releaseSha: "d".repeat(40) }],
    ["staging source", { sourceProjectRef: "fmugizadzdnqfckujqlw" }],
    ["staging environment", { sourceEnvironment: "staging" }],
    ["unknown contract", { schemaVersion: "other" }],
    ["no manifest digest", { manifestSha256: null }],
    ["malformed inventory digest", { inventoryDigest: "bad" }],
    ["unversioned destination", { manifestVersionId: "null" }],
    ["missing destination version", { manifestVersionId: "" }],
    ["negative count", { objectCount: -1 }],
    ["fractional count", { referenceCount: 0.5 }],
    ["oversized tombstone inventory", { tombstoneCount: 1_000_001 }],
    ["unknown completion assertion", { complete: true }],
    ["future completion", { completedAt: "2026-10-23T22:00:01.000Z" }],
    ["completion before source", { completedAt: "2026-10-23T21:58:00.000Z" }],
  ])("rejects %s", (_label, replacement) => {
    const value = checkpoint(); Object.assign(value.summary, replacement);
    expect(assessProtectedRecoveryCheckpoint(value, sha, now)).toMatchObject({ ready: false, reason: "UNVERIFIED" });
  });

  it("does not let a later completion or heartbeat timestamp freshen old source data", () => {
    const old = checkpoint(14 * 60_000); old.summary.completedAt = new Date(now).toISOString();
    expect(assessProtectedRecoveryCheckpoint(old, sha, now).ready).toBe(false);
    const forged = checkpoint(); forged.last_succeeded_at = new Date(now).toISOString();
    expect(assessProtectedRecoveryCheckpoint(forged, sha, now).ready).toBe(false);
    const future = checkpoint(-1_000);
    expect(assessProtectedRecoveryCheckpoint(future, sha, now).ready).toBe(false);
  });

  it("rejects missing, incomplete and unavailable provider records", async () => {
    for (const data of [null, {}, { summary: {} }]) {
      expect((await readProtectedRecoveryReadiness(client(data).admin)).ready).toBe(false);
    }
    expect((await readProtectedRecoveryReadiness(client(checkpoint(), { code: "unavailable" }).admin)).ready).toBe(false);
    const failed = client(checkpoint()); failed.query.maybeSingle.mockRejectedValue(new Error("private provider details"));
    const response = await newIntakeRecoveryHold(failed.admin);
    expect(response?.status).toBe(503);
    expect(await response?.text()).not.toContain("private provider details");
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
  });

  it("reads only the fixed file/retention rows and immutable database completion, without issuing a write", async () => {
    const mock = client(checkpoint());
    expect(await newIntakeRecoveryHold(mock.admin)).toBeNull();
    expect(mock.from).toHaveBeenCalledWith("operational_heartbeats");
    expect(mock.query.eq).toHaveBeenCalledWith("task_name", "protected_recovery");
    expect(mock.query.eq).toHaveBeenCalledWith("task_name", "protected_recovery_retention");
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith("ap_latest_verified_database_archive");
  });

  it("requires a verified database checkpoint even when files and retention are fresh", async () => {
    for (const database of [null, {}, { ...databaseCompletion(), state: "OPEN" },
      { ...databaseCompletion(), provider_dispatched: false }, { ...databaseCompletion(), result_sha256: "0".repeat(64) }]) {
      const mock = client(checkpoint(), null, retentionCheckpoint(), database);
      expect((await readProtectedRecoveryReadiness(mock.admin)).ready).toBe(false);
    }
    const bad = databaseCompletion(); Object.assign(bad.completion_receipt, { snapshotSchemaVersion: "202610250090" });
    bad.result_sha256 = canonicalSha256(bad.completion_receipt);
    expect((await readProtectedRecoveryReadiness(client(checkpoint(), null, retentionCheckpoint(), bad).admin)).ready).toBe(false);
  });

  it("warns at ten and locks acceptance at twelve minutes for database source coverage", async () => {
    expect(await readProtectedRecoveryReadiness(client(checkpoint(), null, retentionCheckpoint(), databaseCompletion(600_000)).admin))
      .toMatchObject({ ready: true, warning: true, ageSeconds: 600 });
    expect(await readProtectedRecoveryReadiness(client(checkpoint(), null, retentionCheckpoint(), databaseCompletion(720_000)).admin))
      .toMatchObject({ ready: false, warning: true, ageSeconds: 720, reason: "STALE" });
    expect((await newIntakeRecoveryHold(client(checkpoint(), null, retentionCheckpoint(), databaseCompletion(720_000)).admin))?.status).toBe(503);
  });

  it("rejects stale-schema, partial and forged database status projections", () => {
    const status = inspectDatabaseArchiveCompletion(databaseCompletion(), { releaseSha: sha, expectedSchemaVersion: DATABASE_RECOVERY.schemaVersion, now });
    expect(assessDatabaseRecoveryStatus(status, sha, now)).toMatchObject({ ready: true, ageSeconds: 60 });
    for (const patch of [{ sourceProjectRef: "other" }, { releaseSha: "e".repeat(40) }, { providerVerificationSha256: null },
      { schemaVersionOfSnapshot: "202610250090" }, { state: "UNKNOWN" }, { evidenceExpiresAt: new Date(now + 1).toISOString() },
      { databaseSnapshotAt: new Date(now + 1).toISOString() }, { verifiedAt: new Date(now + 1).toISOString() }, { workerUploaded: true }]) {
      expect(assessDatabaseRecoveryStatus({ ...status, ...patch }, sha, now).ready).toBe(false);
    }
  });

  it("fails closed at the read deadline even if one transport ignores cancellation", async () => {
    const mock = client(checkpoint()); mock.query.maybeSingle.mockReset().mockReturnValue(new Promise(() => {}));
    const operation = readProtectedRecoveryReadiness(mock.admin);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await operation).toMatchObject({ ready: false, reason: "UNVERIFIED" });
    expect(vi.getTimerCount()).toBe(0);
    expect(mock.query.abortSignal.mock.calls[0][0].aborted).toBe(true);
  });

  it("requires both archive and deletion cycles, rejects using one receipt for the other, and uses the oldest age", async () => {
    for (const retention of [null, {}, checkpoint()]) {
      expect((await readProtectedRecoveryReadiness(client(checkpoint(), null, retention).admin)).ready).toBe(false);
    }
    expect(await readProtectedRecoveryReadiness(client(checkpoint(), null, retentionCheckpoint(11 * 60_000)).admin))
      .toMatchObject({ ready: true, warning: true, ageSeconds: 660 });
    expect(await readProtectedRecoveryReadiness(client(checkpoint(), null, retentionCheckpoint(12 * 60_000)).admin))
      .toMatchObject({ ready: false, warning: true, reason: "STALE" });
  });

  it("does not waive recovery on a production target with a missing environment setting", async () => {
    vi.stubEnv("APP_DEPLOYMENT_ENV", "");
    expect((await readProtectedRecoveryReadiness(client(checkpoint()).admin)).ready).toBe(false);
  });

  it("rejects a production source or release configuration mismatch", async () => {
    vi.stubEnv("APP_EXPECTED_RELEASE_SHA", "e".repeat(40));
    expect((await readProtectedRecoveryReadiness(client(checkpoint()).admin)).ready).toBe(false);
    vi.stubEnv("APP_EXPECTED_RELEASE_SHA", sha);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://other.supabase.co");
    expect((await readProtectedRecoveryReadiness(client(checkpoint()).admin)).ready).toBe(false);
  });

  it("keeps the production recovery requirement separate from synthetic staging", async () => {
    vi.stubEnv("APP_DEPLOYMENT_ENV", "staging");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fmugizadzdnqfckujqlw.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.example.test");
    const mock = client(null);
    expect(await readProtectedRecoveryReadiness(mock.admin)).toMatchObject({ ready: true, required: false });
    expect(mock.from).not.toHaveBeenCalled();
  });
});

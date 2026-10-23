import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  assessProtectedRecoveryCheckpoint, newIntakeRecoveryHold, readProtectedRecoveryReadiness,
  RECOVERY_ACCEPTANCE_AGE_MS, RECOVERY_SOURCE_PROJECT_REF, RECOVERY_WARNING_AGE_MS,
} from "@/lib/operations/protected-recovery-readiness";

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
function client(data: unknown, error: unknown = null, retention: unknown = retentionCheckpoint()) {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn()
    .mockResolvedValueOnce({ data, error }).mockResolvedValue({ data: retention, error }) };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  const from = vi.fn().mockReturnValue(query);
  return { from, query, admin: { from } as unknown as Parameters<typeof readProtectedRecoveryReadiness>[0] };
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

  it("reads only the fixed checkpoint row, without issuing a write", async () => {
    const mock = client(checkpoint());
    expect(await newIntakeRecoveryHold(mock.admin)).toBeNull();
    expect(mock.from).toHaveBeenCalledWith("operational_heartbeats");
    expect(mock.query.eq).toHaveBeenCalledWith("task_name", "protected_recovery");
    expect(mock.query.eq).toHaveBeenCalledWith("task_name", "protected_recovery_retention");
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

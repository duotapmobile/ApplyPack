// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const aws = vi.hoisted(() => ({ send: vi.fn(), destroy: vi.fn(), configurations: [] as unknown[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/security/aws-workload-credentials", () => ({
  awsWorkloadCredentials: () => async () => ({ accessKeyId: "mock-key", secretAccessKey: "mock-secret" }),
}));
vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class {
    constructor(configuration: unknown) { aws.configurations.push(configuration); }
    send = aws.send;
    destroy = aws.destroy;
  },
  DeleteObjectCommand: class { constructor(readonly input: Record<string, unknown>) {} },
}));

import {
  AWS_TEMPORARY_CLEANUP_MAX_OVERDUE_MS, assertAwsTemporarySubmissionOpen, awsTemporaryObjectKeys, createAwsTemporaryCleanupIntent,
  processAwsTemporaryCleanup, removeAwsTemporaryObject,
} from "@/lib/files/aws-temporary-cleanup";

const operationId = "12345678-1234-4123-8123-123456789abc";
const environment = { APP_AWS_ACCOUNT_ID: "838445019912", APP_DEPLOYMENT_ENV: "staging" };
const bucket = "applypack-838445019912-staging-document-worker-temp";
const created = new Date("2026-10-23T06:00:00.000Z");
const due = new Date("2026-10-23T06:10:00.000Z");
const keys = ["", ".render.pdf", ".page-1.png", ".page-2.png"].map(suffix => `ephemeral/${operationId}${suffix}`);
type Admin = Parameters<typeof processAwsTemporaryCleanup>[0];
type Row = { id: string; operation_id: string; deployment_environment: string; bucket: string; storage_path: string;
  attempts: number; created_at: string; not_before: string; completed_at: string | null; [name: string]: unknown };
const makeRows = (): Row[] => keys.map((key, index) => ({
  id: `row-${index}`, operation_id: operationId, deployment_environment: "staging", bucket,
  storage_path: key, attempts: 0, created_at: created.toISOString(), not_before: due.toISOString(), completed_at: null,
}));

function database(rows = makeRows()) {
  const state = { rows, tables: [] as string[], updates: [] as Record<string, unknown>[],
    ackFailures: 0, retryFailures: 0, queryError: false, overdueQueryError: false };
  const from = vi.fn((table: string) => {
    state.tables.push(table);
    expect(table).toBe("ap_aws_temporary_cleanup");
    const predicates: Array<(row: Row) => boolean> = [];
    let head = false;
    let hasDueFilter = false;
    let limit = Infinity;
    let patch: Record<string, unknown> | undefined;
    const chain: Record<string, unknown> = {};
    chain.select = (_columns: string, options?: { head?: boolean }) => { head = options?.head === true; return chain; };
    chain.is = (name: string, value: unknown) => { predicates.push(row => row[name] === value); return chain; };
    chain.eq = chain.is;
    chain.gte = (name: string, value: number) => { predicates.push(row => Number(row[name]) >= value); return chain; };
    chain.lt = (name: string, value: number) => { predicates.push(row => Number(row[name]) < value); return chain; };
    chain.lte = (name: string, value: string) => { hasDueFilter = true; predicates.push(row => String(row[name]) <= value); return chain; };
    chain.order = () => chain;
    chain.limit = (value: number) => { limit = value; return chain; };
    chain.update = (value: Record<string, unknown>) => { patch = value; return chain; };
    chain.then = (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => Promise.resolve().then(() => {
      const selected = state.rows.filter(row => predicates.every(predicate => predicate(row))).slice(0, limit);
      if (patch) {
        state.updates.push({ ...patch });
        const failure = patch.completed_at ? "ackFailures" : "retryFailures";
        if (state[failure] > 0) { state[failure]--; return { error: { message: "private database failure" } }; }
        selected.forEach(row => Object.assign(row, patch));
        return { error: null, data: null };
      }
      if (state.queryError || (head && hasDueFilter && state.overdueQueryError)) {
        return { data: null, count: null, error: { message: "private query failure" } };
      }
      return { data: head ? null : selected.map(row => ({ ...row })), count: head ? selected.length : null, error: null };
    }).then(resolve, reject);
    return chain;
  });
  return { state, admin: { from } as unknown as Admin };
}

function rpcValue() {
  return { operationId, bucket, keys, createdAt: created.toISOString(), notBefore: due.toISOString(), completed: false };
}

describe("durable AWS temporary-object cleanup", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(created); vi.clearAllMocks(); aws.configurations.length = 0; aws.send.mockResolvedValue({}); });
  afterEach(() => vi.useRealTimers());

  it("accepts only the four exact keys and an immutable live database lease", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: rpcValue(), error: null });
    const result = await createAwsTemporaryCleanupIntent({ rpc } as unknown as Admin, operationId, environment);
    expect(result).toEqual({ operationId, bucket, keys, createdAt: created.getTime(), notBefore: due.getTime() });
    expect(awsTemporaryObjectKeys(operationId)).toEqual(keys);
    expect(() => assertAwsTemporarySubmissionOpen(result, created.getTime() + 59_999)).not.toThrow();
    expect(() => assertAwsTemporarySubmissionOpen(result, created.getTime() + 60_000)).toThrow("aws_temporary_submission_expired");
  });

  it.each([
    { completed: true }, { completed: undefined }, { bucket: "customer-deliveries" },
    { operationId: "12345678-1234-4123-8123-123456789abd" }, { keys: keys.slice(0, 3) },
    { keys: [...keys.slice(0, 3), "ephemeral/../private"] }, { createdAt: "not-a-date" },
    { notBefore: new Date(created.getTime() + 1_000).toISOString() },
  ])("rejects malformed, completed or mismatched durable receipts (%j)", async change => {
    const rpc = vi.fn().mockResolvedValue({ data: { ...rpcValue(), ...change }, error: null });
    await expect(createAwsTemporaryCleanupIntent({ rpc } as unknown as Admin, operationId, environment)).rejects.toThrow();
    expect(aws.send).not.toHaveBeenCalled();
  });

  it("leaves future cleanup pending until the durable ten-minute deadline", async () => {
    const db = database();
    const removeObject = vi.fn();
    expect(await processAwsTemporaryCleanup(db.admin, { environment, now: new Date(due.getTime() - 1), removeObject }))
      .toEqual({ processed: 0, recovered: 0, failed: 0, deadLetter: false, overdue: false });
    expect(removeObject).not.toHaveBeenCalled();
    expect(db.state.rows.every(row => row.completed_at === null)).toBe(true);
  });

  it("acknowledges each exact object only after deletion while retaining immutable receipts", async () => {
    const db = database();
    const removeObject = vi.fn(async (actualBucket: string, key: string) => {
      expect(actualBucket).toBe(bucket);
      expect(db.state.rows.find(row => row.storage_path === key)?.completed_at).toBeNull();
    });
    expect(await processAwsTemporaryCleanup(db.admin, { environment, now: due, removeObject }))
      .toEqual({ processed: 4, recovered: 4, failed: 0, deadLetter: false, overdue: false });
    expect(removeObject).toHaveBeenCalledTimes(4);
    expect(db.state.rows).toHaveLength(4);
    expect(db.state.rows.every(row => row.completed_at === due.toISOString()
      && row.created_at === created.toISOString() && row.not_before === due.toISOString())).toBe(true);
    expect(new Set(db.state.tables)).toEqual(new Set(["ap_aws_temporary_cleanup"]));
  });

  it("retries only the failed object and does not return already completed receipts to pending", async () => {
    const db = database();
    const removeObject = vi.fn(async (_bucket: string, key: string) => { if (key === keys[0]) throw new Error("private provider failure"); });
    expect(await processAwsTemporaryCleanup(db.admin, { environment, now: due, removeObject }))
      .toEqual({ processed: 4, recovered: 3, failed: 1, deadLetter: false, overdue: false });
    expect(db.state.rows[0]).toMatchObject({ completed_at: null, attempts: 1, last_error: "aws_temporary_cleanup_failed" });
    expect(db.state.rows.slice(1).every(row => row.completed_at === due.toISOString())).toBe(true);
    removeObject.mockResolvedValue(undefined);
    expect(await processAwsTemporaryCleanup(db.admin, { environment, now: due, removeObject }))
      .toEqual({ processed: 1, recovered: 1, failed: 0, deadLetter: false, overdue: false });
    expect(removeObject).toHaveBeenCalledTimes(5);
    expect(JSON.stringify(db.state.rows)).not.toContain("private provider failure");
  });

  it("repeats idempotent deletion after an acknowledgment failure instead of losing the pending receipt", async () => {
    const db = database(makeRows().slice(0, 1));
    db.state.ackFailures = 1;
    const objects = new Set([keys[0]]);
    const removeObject = vi.fn(async (_bucket: string, key: string) => { objects.delete(key); });
    expect(await processAwsTemporaryCleanup(db.admin, { environment, now: due, removeObject }))
      .toMatchObject({ recovered: 0, failed: 1 });
    expect(objects.size).toBe(0);
    expect(db.state.rows[0]).toMatchObject({ completed_at: null, attempts: 1 });
    expect(await processAwsTemporaryCleanup(db.admin, { environment, now: due, removeObject }))
      .toMatchObject({ recovered: 1, failed: 0 });
    expect(removeObject).toHaveBeenCalledTimes(2);
    expect(db.state.rows).toHaveLength(1);
    expect(db.state.rows[0].completed_at).toBe(due.toISOString());
  });

  it("removes output written after successful immediate deletion once the remote submission window is closed", async () => {
    const db = database();
    const objects = new Set<string>(); // Immediate deletion succeeded before the remote writer finished.
    objects.add(keys[2]);
    const removeObject = vi.fn(async (_bucket: string, key: string) => { objects.delete(key); });
    await processAwsTemporaryCleanup(db.admin, { environment, now: new Date(created.getTime() + 120_000), removeObject });
    expect(objects.has(keys[2])).toBe(true);
    expect(removeObject).not.toHaveBeenCalled();
    expect(await processAwsTemporaryCleanup(db.admin, { environment, now: due, removeObject }))
      .toMatchObject({ recovered: 4, failed: 0 });
    expect(objects.size).toBe(0);
  });

  it.each([
    { deployment_environment: "production" }, { bucket: "customer-deliveries" },
    { storage_path: `ephemeral/${operationId}.private` }, { storage_path: `private/${operationId}` },
    { operation_id: "not-an-operation" },
  ])("refuses out-of-scope queued deletion (%j)", async change => {
    const db = database([{ ...makeRows()[0], ...change }]);
    const removeObject = vi.fn();
    expect(await processAwsTemporaryCleanup(db.admin, { environment, now: due, removeObject }))
      .toMatchObject({ recovered: 0, failed: 1 });
    expect(removeObject).not.toHaveBeenCalled();
    expect(db.state.rows[0].completed_at).toBeNull();
  });

  it("reports exhausted pending work but excludes completed history from dead letters", async () => {
    const rows = makeRows().slice(0, 1);
    rows[0].attempts = 20;
    const db = database(rows);
    const removeObject = vi.fn();
    expect(await processAwsTemporaryCleanup(db.admin, { environment, now: due, removeObject }))
      .toEqual({ processed: 0, recovered: 0, failed: 0, deadLetter: true, overdue: false });
    rows[0].completed_at = due.toISOString();
    expect(await processAwsTemporaryCleanup(db.admin, { environment, now: due, removeObject }))
      .toEqual({ processed: 0, recovered: 0, failed: 0, deadLetter: false, overdue: false });
    expect(removeObject).not.toHaveBeenCalled();
  });

  it("surfaces retry-ledger and query failures instead of reporting successful recovery", async () => {
    const db = database(makeRows().slice(0, 1));
    db.state.retryFailures = 1;
    const removeObject = vi.fn().mockRejectedValue(new Error("delete unavailable"));
    expect(await processAwsTemporaryCleanup(db.admin, { environment, now: due, removeObject }))
      .toEqual({ processed: 1, recovered: 0, failed: 1, deadLetter: true, overdue: false });
    db.state.queryError = true;
    await expect(processAwsTemporaryCleanup(db.admin, { environment, now: due, removeObject }))
      .rejects.toThrow("aws_temporary_cleanup_query_failed");
  });

  it("uses the explicit bounded AWS delete and releases its client", async () => {
    await removeAwsTemporaryObject(bucket, keys[0], environment);
    expect(aws.configurations).toEqual([expect.objectContaining({
      region: "us-east-1", endpoint: "https://s3.us-east-1.amazonaws.com", maxAttempts: 1,
    })]);
    expect(aws.send).toHaveBeenCalledWith(expect.objectContaining({ input: { Bucket: bucket, Key: keys[0] } }),
      expect.objectContaining({ abortSignal: expect.any(AbortSignal) }));
    expect(aws.destroy).toHaveBeenCalledOnce();
  });

  it("reports overdue backlog beyond the twenty-object batch and clears it only after recovery", async () => {
    const rows = Array.from({ length: 6 }, (_, group) => {
      const id = `12345678-1234-4123-8123-${String(group).padStart(12, "0")}`;
      return makeRows().map((row, index) => ({ ...row, id: `backlog-${group}-${index}`, operation_id: id,
        storage_path: awsTemporaryObjectKeys(id)[index] }));
    }).flat();
    const db = database(rows);
    const removeObject = vi.fn().mockResolvedValue(undefined);
    const now = new Date(due.getTime() + AWS_TEMPORARY_CLEANUP_MAX_OVERDUE_MS);
    expect(await processAwsTemporaryCleanup(db.admin, { environment, now, removeObject }))
      .toEqual({ processed: 20, recovered: 20, failed: 0, deadLetter: false, overdue: true });
    expect(db.state.rows.filter(row => row.completed_at === null)).toHaveLength(4);
    expect(await processAwsTemporaryCleanup(db.admin, { environment, now, removeObject }))
      .toEqual({ processed: 4, recovered: 4, failed: 0, deadLetter: false, overdue: false });
    expect(db.state.rows).toHaveLength(24);
  });

  it("fails the final backlog check visibly even when this batch's object deletions succeeded", async () => {
    const db = database();
    db.state.overdueQueryError = true;
    const removeObject = vi.fn().mockResolvedValue(undefined);
    await expect(processAwsTemporaryCleanup(db.admin, { environment, now: due, removeObject }))
      .rejects.toThrow("aws_temporary_cleanup_query_failed");
    expect(removeObject).toHaveBeenCalledTimes(4);
    expect(db.state.rows.every(row => row.completed_at === due.toISOString())).toBe(true);
  });

  it("rejects provider scope mismatches before creating a client and sanitizes provider failures", async () => {
    await expect(removeAwsTemporaryObject("customer-deliveries", keys[0], environment)).rejects.toThrow("aws_temporary_cleanup_scope_invalid");
    expect(aws.configurations).toHaveLength(0);
    aws.send.mockRejectedValue(new Error("private AWS request details"));
    await expect(removeAwsTemporaryObject(bucket, keys[0], environment)).rejects.toThrow("aws_temporary_delete_failed");
    expect(aws.destroy).toHaveBeenCalledOnce();
  });
});

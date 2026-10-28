import "server-only";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { awsWorkloadCredentials } from "@/lib/security/aws-workload-credentials";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
type Environment = Partial<NodeJS.ProcessEnv>;
const UUID_V4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const CLEANUP_GRACE_MS = 10 * 60_000;
const SUBMISSION_WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 20;
export const AWS_TEMPORARY_CLEANUP_MAX_OVERDUE_MS = 30 * 60_000;

export type AwsTemporaryCleanupIntent = {
  operationId: string;
  bucket: string;
  keys: string[];
  createdAt: number;
  notBefore: number;
};

function expectedBucket(environment: Environment) {
  if (environment.APP_AWS_ACCOUNT_ID !== "838445019912"
    || !["staging", "production"].includes(environment.APP_DEPLOYMENT_ENV || "")) {
    throw new Error("aws_temporary_cleanup_scope_invalid");
  }
  return `applypack-838445019912-${environment.APP_DEPLOYMENT_ENV}-document-worker-temp`;
}

export function awsTemporaryObjectKeys(operationId: string) {
  if (!UUID_V4.test(operationId)) throw new Error("aws_temporary_cleanup_scope_invalid");
  const key = `ephemeral/${operationId}`;
  return [key, `${key}.render.pdf`, `${key}.page-1.png`, `${key}.page-2.png`];
}

export function assertAwsTemporarySubmissionOpen(intent: AwsTemporaryCleanupIntent, now = Date.now()) {
  // Database timestamps are immutable. A delayed process must never revive an
  // operation after maintenance can begin removing its objects.
  if (!Number.isFinite(now) || intent.createdAt > now + 5_000
    || now >= intent.createdAt + SUBMISSION_WINDOW_MS
    || intent.notBefore - intent.createdAt !== CLEANUP_GRACE_MS) {
    throw new Error("aws_temporary_submission_expired");
  }
}

export async function createAwsTemporaryCleanupIntent(
  admin: AdminClient, operationId: string, environment: Environment = process.env,
): Promise<AwsTemporaryCleanupIntent> {
  const bucket = expectedBucket(environment);
  const keys = awsTemporaryObjectKeys(operationId);
  const { data, error } = await admin.rpc("ap_begin_aws_temporary_cleanup", {
    p_operation_id: operationId, p_deployment_environment: environment.APP_DEPLOYMENT_ENV!,
  });
  const value = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown> : null;
  const createdAt = typeof value?.createdAt === "string" ? Date.parse(value.createdAt) : NaN;
  const notBefore = typeof value?.notBefore === "string" ? Date.parse(value.notBefore) : NaN;
  if (error || !value || value.operationId !== operationId || value.bucket !== bucket
    || value.completed !== false || !Array.isArray(value.keys)
    || JSON.stringify([...value.keys].sort()) !== JSON.stringify([...keys].sort())
    || !Number.isFinite(createdAt) || !Number.isFinite(notBefore)) {
    throw new Error("aws_temporary_cleanup_intent_failed");
  }
  const intent = { operationId, bucket, keys, createdAt, notBefore };
  assertAwsTemporarySubmissionOpen(intent);
  return intent;
}

export async function removeAwsTemporaryObject(
  bucket: string, key: string, environment: Environment = process.env,
) {
  const operationId = key.slice("ephemeral/".length).split(".")[0];
  if (bucket !== expectedBucket(environment) || !awsTemporaryObjectKeys(operationId).includes(key)) {
    throw new Error("aws_temporary_cleanup_scope_invalid");
  }
  const client = new S3Client({ region: "us-east-1", endpoint: "https://s3.us-east-1.amazonaws.com",
    credentials: awsWorkloadCredentials(environment), maxAttempts: 1 });
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), {
      abortSignal: AbortSignal.timeout(15_000),
    });
  } catch { throw new Error("aws_temporary_delete_failed"); }
  finally { client.destroy(); }
}

type CleanupRow = { id: string; operation_id: string; deployment_environment: string;
  bucket: string; storage_path: string; attempts: number; not_before: string };

export async function processAwsTemporaryCleanup(admin: AdminClient, options: {
  environment?: Environment;
  now?: Date;
  removeObject?: typeof removeAwsTemporaryObject;
} = {}) {
  const environment = options.environment ?? process.env;
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const removeObject = options.removeObject ?? removeAwsTemporaryObject;
  const [exhausted, pending] = await Promise.all([
    admin.from("ap_aws_temporary_cleanup").select("id", { count: "exact", head: true })
      .is("completed_at", null).gte("attempts", MAX_ATTEMPTS),
    admin.from("ap_aws_temporary_cleanup")
      .select("id,operation_id,deployment_environment,bucket,storage_path,attempts,not_before")
      .is("completed_at", null).lt("attempts", MAX_ATTEMPTS).lte("not_before", nowIso)
      .order("created_at").limit(20),
  ]);
  if (exhausted.error || pending.error) throw new Error("aws_temporary_cleanup_query_failed");
  const result = { processed: 0, recovered: 0, failed: 0, deadLetter: (exhausted.count || 0) > 0, overdue: false };
  const rows = (pending.data || []) as CleanupRow[];
  const processRow = async (row: CleanupRow) => {
    result.processed++;
    try {
      if (row.deployment_environment !== environment.APP_DEPLOYMENT_ENV
        || row.bucket !== expectedBucket(environment)
        || !awsTemporaryObjectKeys(row.operation_id).includes(row.storage_path)
        || !Number.isFinite(Date.parse(row.not_before)) || Date.parse(row.not_before) > now.getTime()) {
        throw new Error("aws_temporary_cleanup_scope_invalid");
      }
      await removeObject(row.bucket, row.storage_path, environment);
      // Retain immutable operation receipts so a retry cannot create a fresh lease.
      const ack = await admin.from("ap_aws_temporary_cleanup").update({ completed_at: nowIso })
        .eq("id", row.id).is("completed_at", null).eq("attempts", row.attempts);
      if (ack.error) throw new Error("aws_temporary_cleanup_ack_failed");
      result.recovered++;
    } catch {
      result.failed++;
      const attempts = Number(row.attempts) + 1;
      const update = await admin.from("ap_aws_temporary_cleanup").update({ attempts,
        last_error: "aws_temporary_cleanup_failed", last_attempt_at: nowIso })
        .eq("id", row.id).is("completed_at", null).eq("attempts", row.attempts);
      if (update.error || attempts >= MAX_ATTEMPTS) result.deadLetter = true;
    }
  };
  // Four bounded deletes at a time keep twenty due rows within one maintenance run.
  for (let offset = 0; offset < rows.length; offset += 4) {
    await Promise.all(rows.slice(offset, offset + 4).map(processRow));
  }
  // Check the queue after this bounded batch: completing twenty objects must not
  // hide older outstanding work beyond the batch or a failed acknowledgment.
  const overdue = await admin.from("ap_aws_temporary_cleanup").select("id", { count: "exact", head: true })
    .is("completed_at", null)
    .lte("not_before", new Date(now.getTime() - AWS_TEMPORARY_CLEANUP_MAX_OVERDUE_MS).toISOString());
  if (overdue.error || typeof overdue.count !== "number" || overdue.count < 0) {
    throw new Error("aws_temporary_cleanup_query_failed");
  }
  result.overdue = overdue.count > 0;
  return result;
}

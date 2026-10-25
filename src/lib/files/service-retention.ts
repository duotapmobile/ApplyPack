import "server-only";
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const bucket = z.enum(["customer-source-documents", "customer-deliveries", "operator-drafts", "operator-render-previews"]);
const safePath = z.string().min(1).max(1024).refine((value) => !/[\\\x00-\x1f\x7f%?#]/u.test(value)
  && value.split("/").every((part) => part.length > 0 && part !== "." && part !== ".."));
const targetSchema = z.object({ id: z.uuid(), bucket, path: safePath, pathSha256: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
const claimSchema = z.object({ claimId: z.uuid(), objects: z.array(targetSchema).max(40000) }).strict();
const claimsSchema = z.array(claimSchema).max(5);
const removalSchema = z.array(z.object({ name: z.string(), bucket_id: z.string().optional() }).passthrough()).max(1);

function createRetentionClient(signal: AbortSignal) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("service_retention_configuration_missing");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: (input, init) => fetch(input, {
      ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(10000), ...(init?.signal ? [init.signal] : [])]),
    }) },
  });
}

async function bounded<T>(signal: AbortSignal, operation: () => PromiseLike<T>): Promise<T> {
  signal.throwIfAborted();
  let rejectAborted: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    rejectAborted = () => reject(new Error("service_retention_deadline_exceeded"));
    signal.addEventListener("abort", rejectAborted, { once: true });
  });
  try {
    const result = await Promise.race([Promise.resolve().then(operation), aborted]);
    signal.throwIfAborted();
    return result;
  } finally { signal.removeEventListener("abort", rejectAborted); }
}

/** The database commits and rechecks every target; callers cannot supply deletion paths. */
export async function processServiceRetention(
  clientFactory: (signal: AbortSignal) => SupabaseClient = createRetentionClient,
  { timeoutMs = 45000 }: { timeoutMs?: number } = {},
) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 45000) throw new Error("service_retention_deadline_invalid");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await processClaims(clientFactory(controller.signal), controller.signal); }
  finally { clearTimeout(timer); controller.abort(); }
}

async function processClaims(admin: SupabaseClient, signal: AbortSignal) {
  const claimed = await bounded(signal, () => admin.rpc("ap_claim_expired_service_retention", { p_limit: 5 }));
  if (claimed.error) throw new Error("service_retention_claim_failed");
  const parsed = claimsSchema.safeParse(claimed.data);
  if (!parsed.success) throw new Error("service_retention_claim_invalid");
  // Validate the whole response before the first irreversible Storage request.
  const ids = new Set<string>();
  for (const claim of parsed.data) {
    if (ids.has(claim.claimId)) throw new Error("service_retention_claim_invalid");
    ids.add(claim.claimId);
    for (const target of claim.objects) {
      if (ids.has(target.id) || createHash("sha256").update(target.path).digest("hex") !== target.pathSha256) {
        throw new Error("service_retention_claim_invalid");
      }
      ids.add(target.id);
    }
  }
  let deleted = 0; let failed = 0; let completed = 0; let attempted = 0;
  for (const claim of parsed.data) {
    for (const target of claim.objects) {
      if (attempted >= 20) break;
      attempted++;
      try {
        const authorized = await bounded(signal, () => admin.rpc("ap_authorize_service_retention_object", { p_claim_id: claim.claimId, p_object_id: target.id }));
        const checked = targetSchema.safeParse(authorized.data);
        if (authorized.error || !checked.success || JSON.stringify(checked.data) !== JSON.stringify(target)) {
          failed++; continue;
        }
        const storage = admin.storage.from(target.bucket);
        const removed = await bounded(signal, () => storage.remove([target.path]));
        const acknowledgement = removalSchema.safeParse(removed.data);
        if (removed.error || !acknowledgement.success || acknowledgement.data.some((item) => item.name !== target.path || (item.bucket_id && item.bucket_id !== target.bucket))) { failed++; continue; }
        // Empty removal acknowledgements are possible on a retry. Only an exact
        // authenticated 404 proves absence; a 400/403/network failure does not.
        const absence = await bounded(signal, () => storage.exists(target.path));
        if (absence.data !== false || absence.error?.status !== 404) { failed++; continue; }
        const finalized = await bounded(signal, () => admin.rpc("ap_finish_service_retention_object", { p_claim_id: claim.claimId, p_object_id: target.id }));
        if (finalized.error || finalized.data !== true) failed++; else deleted++;
      } catch { signal.throwIfAborted(); failed++; }
    }
    // The database independently refuses redaction while any exact object is pending.
    try {
      const finished = await bounded(signal, () => admin.rpc("ap_finish_service_retention_claim", { p_claim_id: claim.claimId }));
      if (finished.error || typeof finished.data !== "boolean") failed++; else if (finished.data === true) completed++;
    } catch { signal.throwIfAborted(); failed++; }
  }
  return { claimed: parsed.data.length, attempted, deleted, completed, failed };
}

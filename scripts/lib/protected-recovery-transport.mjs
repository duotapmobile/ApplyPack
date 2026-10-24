import { recoveryCompletionSchema, recoveryInventorySchema, recoveryObjectSchema, RECOVERY_LIMITS } from "./protected-recovery-protocol.mjs";

const ORIGIN = "https://applypack.work";
const ROOT = `${ORIGIN}/api/internal/protected-recovery`;
const fail = (code) => { throw new Error(`PROTECTED_RECOVERY_${code}`); };
const requireValue = (condition, code) => { if (!condition) fail(code); };
const capability = (value) => typeof value === "string" && /^[A-Za-z0-9_+/=-]{43,256}$/u.test(value);
const forbidden = new Set(["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_KEY",
  "DATABASE_URL", "PGPASSWORD", "APP_RECOVERY_RECEIPT_SECRET", "CRON_SECRET"]);

export async function boundedRecoveryJson(response, maximumBytes) {
  requireValue(response?.status === 200 && response.body && /^application\/json(?:;|$)/iu.test(response.headers.get("content-type") || ""), "HTTP_RESPONSE");
  const chunks = []; let size = 0;
  try {
    for await (const chunk of response.body) {
      requireValue(chunk instanceof Uint8Array, "HTTP_BODY");
      size += chunk.byteLength; requireValue(size <= maximumBytes, "HTTP_BODY_LIMIT"); chunks.push(chunk);
    }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size))); }
    catch { fail("HTTP_JSON"); }
  } finally { for (const chunk of chunks) chunk.fill(0); }
}

/** Only the separate recovery service uses these two capabilities; no provider key is accepted. */
function createTransport(environment, fetchImpl, readerOnly) {
  requireValue(!Object.keys(environment).some((name) => forbidden.has(name.toUpperCase()) && environment[name] !== undefined), "RUNNER_MASTER_CREDENTIAL_FORBIDDEN");
  const releaseSha = environment.APP_EXPECTED_RELEASE_SHA;
  requireValue(environment.APP_DEPLOYMENT_ENV === "production" && environment.APP_BASE_URL === ORIGIN
    && /^[a-f0-9]{40}$/u.test(releaseSha || "")
    && environment.RAILWAY_GIT_COMMIT_SHA === releaseSha, "RUNNER_IDENTITY");
  const reader = environment.APP_RECOVERY_READER_SECRET;
  const completion = environment.APP_RECOVERY_COMPLETION_SECRET;
  requireValue(capability(reader) && (readerOnly || (capability(completion) && reader !== completion)), "RUNNER_CAPABILITY");
  const request = async (url, secret, options = {}) => {
    try {
      return await fetchImpl(url, { ...options, headers: { authorization: `Bearer ${secret}`,
        accept: "application/json", ...(options.body ? { "content-type": "application/json" } : {}) },
      redirect: "error", cache: "no-store", credentials: "omit" });
    } catch { fail("HTTP_TRANSPORT"); }
  };
  return {
    releaseSha,
    source: {
      async readInventory({ signal }) {
        const value = await boundedRecoveryJson(await request(`${ROOT}/inventory`, reader, { method: "GET", signal }), RECOVERY_LIMITS.inventoryBytes);
        const parsed = recoveryInventorySchema.safeParse(value);
        requireValue(parsed.success && parsed.data.releaseSha === releaseSha, "HTTP_INVENTORY");
        return parsed.data;
      },
      async openObject(input) {
        const { signal, ...identity } = input;
        const parsed = recoveryObjectSchema.safeParse(identity);
        requireValue(parsed.success, "HTTP_OBJECT_REQUEST");
        const url = new URL(`${ROOT}/object`);
        for (const field of ["bucket", "key", "sourceVersion"]) url.searchParams.set(field, parsed.data[field]);
        const response = await request(url.href, reader, { method: "GET", signal });
        requireValue(response.status === 200 && response.body
          && response.headers.get("x-recovery-source-version") === identity.sourceVersion
          && response.headers.get("content-length") === String(identity.size)
          && /^[a-f0-9]{64}$/u.test(response.headers.get("x-recovery-sha256") || "")
          && (!identity.expectedSha256 || response.headers.get("x-recovery-sha256") === identity.expectedSha256), "HTTP_OBJECT_IDENTITY");
        return { sourceVersion: identity.sourceVersion, size: identity.size, sha256: response.headers.get("x-recovery-sha256"), body: response.body };
      },
    },
    ...(!readerOnly ? { completion: {
      async submit(input, { signal }) {
        const parsed = recoveryCompletionSchema.safeParse(input);
        requireValue(parsed.success, "HTTP_COMPLETION_REQUEST");
        return boundedRecoveryJson(await request(`${ROOT}/complete`, completion,
          { method: "POST", body: JSON.stringify(parsed.data), signal }), 4096);
      },
    } } : {}),
  };
}

export const createRecoveryHttpTransport = (environment = process.env, fetchImpl = fetch) => createTransport(environment, fetchImpl, false);
export const createRecoveryHttpReader = (environment = process.env, fetchImpl = fetch) => createTransport(environment, fetchImpl, true);

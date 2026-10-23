import { createClient } from "@supabase/supabase-js";
import { Readable } from "node:stream";
import { RECOVERY_BUCKETS, RECOVERY_PROJECT, RECOVERY_TABLES, recoveryKeySchema } from "./protected-recovery-protocol.mjs";
import { buildRecoveryInventory, createSupabaseRecoveryReader, readRecoveryObject, recoverySourceColumns } from "./protected-recovery-source.mjs";
import { canonicalSha256 } from "./protected-recovery-core.mjs";

const ORIGIN = `https://${RECOVERY_PROJECT}.supabase.co`;
const fail = (code) => { throw new Error(`PROTECTED_RECOVERY_BOOTSTRAP_${code}`); };
const requireValue = (condition, code) => { if (!condition) fail(code); };
const sameKeys = (value, fields) => value && typeof value === "object" && !Array.isArray(value)
  && Object.keys(value).sort().join("|") === fields.sort().join("|");

/** The operator credential retains provider privileges. This transport only performs fixed reads. */
export function createBootstrapReadOnlyFetch(fetchImpl = fetch, getRunSignal = () => undefined) {
  return async (input, options = {}) => {
    requireValue(typeof input === "string" || input instanceof URL, "REQUEST_TYPE");
    const url = new URL(String(input));
    requireValue(url.origin === ORIGIN && !url.username && !url.password && !url.hash, "SOURCE_ORIGIN");
    const method = (options.method || "GET").toUpperCase();
    const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    let allowed = false;
    if (method === "GET" && url.pathname === "/storage/v1/bucket" && url.search === "") allowed = true;
    if (method === "GET" && segments.length >= 6 && segments.slice(0, 3).join("/") === "storage/v1/object"
      && ["info", "authenticated"].includes(segments[3]) && RECOVERY_BUCKETS.includes(segments[4])
      && recoveryKeySchema.safeParse(segments.slice(5).join("/")).success && url.search === "") allowed = true;
    if (method === "POST" && segments.length === 5 && segments.slice(0, 4).join("/") === "storage/v1/object/list"
      && RECOVERY_BUCKETS.includes(segments[4]) && url.search === "") {
      let body;
      try { body = JSON.parse(options.body); } catch { fail("LIST_BODY"); }
      allowed = sameKeys(body, ["limit", "offset", "sortBy", "prefix"])
        && body.limit === 100 && Number.isSafeInteger(body.offset) && body.offset >= 0 && body.offset <= 10_000
        && sameKeys(body.sortBy, ["column", "order"]) && body.sortBy.column === "name" && body.sortBy.order === "asc"
        && (body.prefix === "" || recoveryKeySchema.safeParse(body.prefix).success);
    }
    if (method === "GET" && segments.length === 3 && segments.slice(0, 2).join("/") === "rest/v1" && RECOVERY_TABLES.includes(segments[2])) {
      const table = segments[2]; const id = table === "ap_unpaid_source_cleanup" ? "document_id" : "id";
      const names = [...url.searchParams.keys()];
      allowed = names.length === new Set(names).size && names.every((key) => ["select", "order", "limit", id].includes(key))
        && url.searchParams.get("select") === recoverySourceColumns[table]
        && url.searchParams.get("order") === `${id}.asc` && url.searchParams.get("limit") === "250"
        && (!url.searchParams.has(id) || /^gt\.[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(url.searchParams.get(id)));
    }
    requireValue(allowed && (method !== "GET" || options.body === undefined)
      && !new Headers(options.headers).has("cookie"), "MUTATION_OR_QUERY_FORBIDDEN");
    const signals = [options.signal, getRunSignal(), AbortSignal.timeout(30_000)].filter(Boolean);
    try {
      return await fetchImpl(url.href, { ...options, method, redirect: "error", cache: "no-store", credentials: "omit",
        signal: AbortSignal.any(signals) });
    } catch { fail("SOURCE_READ_FAILED"); }
  };
}

/** Operator-only pre-deployment source; the reusable service must never import provider credentials. */
export function createOperatorBootstrapSource({ supabaseKey, releaseSha, fetchImpl = fetch, now = Date.now }) {
  requireValue(typeof supabaseKey === "string" && supabaseKey.length > 20 && supabaseKey.length <= 4096
    && !/[\u0000-\u0020\u007f]/u.test(supabaseKey), "CREDENTIAL_REQUIRED");
  requireValue(/^[a-f0-9]{40}$/u.test(releaseSha || ""), "RELEASE_REQUIRED");
  let runSignal;
  const readOnlyFetch = createBootstrapReadOnlyFetch(fetchImpl, () => runSignal);
  const admin = createClient(ORIGIN, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: readOnlyFetch } });
  const reader = createSupabaseRecoveryReader(admin);
  return {
    async readInventory({ signal }) {
      runSignal = signal;
      return buildRecoveryInventory({ reader, releaseSha, now,
        signReceipt: (inventory) => `operator-bootstrap-not-server-attested:${canonicalSha256(inventory)}` });
    },
    async openObject(object) {
      runSignal = object.signal;
      const result = await readRecoveryObject({ reader, bucket: object.bucket, key: object.key, sourceVersion: object.sourceVersion,
        environment: { NEXT_PUBLIC_SUPABASE_URL: ORIGIN, SUPABASE_SECRET_KEY: supabaseKey }, fetchImpl: readOnlyFetch });
      async function* privateBytes() { try { yield result.bytes; } finally { result.bytes.fill(0); } }
      return { sourceVersion: result.sourceVersion, size: result.size, sha256: result.sha256, body: Readable.from(privateBytes()) };
    },
  };
}

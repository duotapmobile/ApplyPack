import "server-only";
import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function clientAddress(request: Request) {
  // Railway documents X-Real-IP as the edge-provided client address. Do not
  // trust a caller-controlled X-Forwarded-For chain for abuse controls.
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function consumeRateLimit(input: {
  request: Request;
  scope: string;
  identity?: string;
  limit: number;
  windowSeconds: number;
}) {
  const admin = createSupabaseAdminClient();
  if (!admin) return { allowed: false, configured: false };
  const buckets = [
    { scope: input.scope + ":ip", key: clientAddress(input.request) },
    ...(input.identity ? [{ scope: input.scope + ":identity", key: input.identity.trim().toLowerCase() }] : []),
  ];
  const results = await Promise.all(buckets.map(({ scope, key }) => admin.rpc("consume_rate_limit", {
    p_scope: scope,
    p_key_hash: createHash("sha256").update(key).digest("hex"),
    p_limit: input.limit,
    p_window_seconds: input.windowSeconds,
  })));
  if (results.some(({ error }) => error)) return { allowed: false, configured: true };
  return { allowed: results.every(({ data }) => data === true), configured: true };
}

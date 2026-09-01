import "server-only";
import { createHash } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function clientAddress(request: Request) {
  return request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
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
  const rawKey = clientAddress(input.request) + "|" + (input.identity || "");
  const keyHash = createHash("sha256").update(rawKey).digest("hex");
  const { data, error } = await admin.rpc("consume_rate_limit", {
    p_scope: input.scope, p_key_hash: keyHash, p_limit: input.limit, p_window_seconds: input.windowSeconds,
  });
  if (error) return { allowed: false, configured: true };
  return { allowed: data === true, configured: true };
}

import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { authorizeRecoveryRequest, boundedRecoveryOperation, recoverySourceConfiguration } from "../../../scripts/lib/protected-recovery-source.mjs";

export const recoveryHeaders = { "cache-control": "private, no-store", "x-robots-tag": "noindex, nofollow", "x-content-type-options": "nosniff" };

export function protectedRecoveryContext(request: Request, purpose: "inventory" | "read" | "complete" | "retention") {
  const configuration = recoverySourceConfiguration(process.env);
  authorizeRecoveryRequest(request, purpose === "inventory" ? [configuration.readerSecret, configuration.retentionSecret]
    : purpose === "read" ? configuration.readerSecret : purpose === "retention" ? configuration.retentionSecret : configuration.completionSecret);
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("PROTECTED_RECOVERY_SOURCE_UNAVAILABLE");
  return { admin, configuration };
}

export function protectedRecoveryError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const status = code === "PROTECTED_RECOVERY_UNAUTHORIZED" || code === "PROTECTED_RECOVERY_COOKIE_FORBIDDEN" ? 401
    : code === "PROTECTED_RECOVERY_COMPLETION_REPLAY" || code === "PROTECTED_RECOVERY_COMPLETION_INVALID" ? 409 : 503;
  return Response.json({ error: status === 401 ? "Unauthorized recovery connection." : status === 409
    ? "The recovery checkpoint was not accepted." : "Protected recovery is unavailable." }, { status, headers: recoveryHeaders });
}

export async function boundedRecoveryJson(request: Request) {
  if (request.headers.get("content-type") !== "application/json" || !request.body) throw new Error("PROTECTED_RECOVERY_BODY_INVALID");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  const deadline = Date.now() + 10000;
  try {
    for (;;) {
      if (Date.now() >= deadline) throw new Error("PROTECTED_RECOVERY_BODY_TIMEOUT");
      const value = await boundedRecoveryOperation(() => reader.read(), Math.max(1, deadline - Date.now()));
      if (value.done) break;
      size += value.value.byteLength;
      if (size > 16384) throw new Error("PROTECTED_RECOVERY_BODY_LIMIT");
      chunks.push(value.value);
    }
    return JSON.parse(Buffer.concat(chunks, size).toString("utf8")) as unknown;
  } finally { void reader.cancel().catch(() => {}); }
}

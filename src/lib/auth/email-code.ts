import { isSameOriginRequest } from "@/lib/security/origin";

export const DEFAULT_AUTH_DESTINATION = "/get-started";

export function normalizeEmailCode(value: string) {
  return value.replace(/\D/g, "").slice(0, 6);
}

export function safeAuthDestination(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return DEFAULT_AUTH_DESTINATION;
  try {
    const parsed = new URL(value, "https://applypack.invalid");
    if (parsed.origin !== "https://applypack.invalid") return DEFAULT_AUTH_DESTINATION;
    return parsed.pathname + parsed.search + parsed.hash;
  } catch { return DEFAULT_AUTH_DESTINATION; }
}

export function requestOriginIsAllowed(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  // Railway terminates TLS before forwarding the request. Use the configured
  // public origin, never a client-supplied forwarded host or internal URL.
  return isSameOriginRequest(request);
}

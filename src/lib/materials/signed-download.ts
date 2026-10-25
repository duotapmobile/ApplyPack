import "server-only";

// Supabase Storage returns a JWT in the token query parameter, with an absolute
// exp and the signed bucket/object URL. This inspects only a trusted SDK HTTPS
// response to impose a stricter expiry bound; it is not signature verification
// and must never authorize a customer-supplied token.
export function signedDownloadWithinDeadline(input: {
  signedUrl: string; supabaseOrigin: string | undefined; bucket: string; path: string; expiresAt: string; now?: number;
}) {
  try {
    if (!input.supabaseOrigin || input.signedUrl.length > 16_384) return false;
    const origin = new URL(input.supabaseOrigin);
    const url = new URL(input.signedUrl);
    const local = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(origin.hostname);
    if ((origin.protocol !== "https:" && !local) || origin.username || origin.password
      || url.origin !== origin.origin || url.username || url.password || url.hash
      || decodeURIComponent(url.pathname) !== `/storage/v1/object/sign/${input.bucket}/${input.path}`) return false;
    const tokens = url.searchParams.getAll("token");
    if (tokens.length !== 1 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(tokens[0])) return false;
    const payload = JSON.parse(Buffer.from(tokens[0].split(".")[1], "base64url").toString("utf8")) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    const claims = payload as Record<string, unknown>;
    const deadline = Date.parse(input.expiresAt);
    const expiration = typeof claims.exp === "number" ? claims.exp * 1_000 : NaN;
    return Number.isFinite(deadline) && Number.isSafeInteger(claims.exp)
      && expiration > (input.now ?? Date.now()) && expiration <= deadline
      && claims.url === `${input.bucket}/${input.path}`
      && (claims.scope === undefined || claims.scope === "download");
  } catch { return false; }
}

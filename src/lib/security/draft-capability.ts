import "server-only";

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

const TOKEN_BYTES = 32;

export type DraftCapability = {
  draftId: string;
  secret: string;
  secretHash: string;
};

export function createDraftCapability(): DraftCapability {
  const secret = randomBytes(TOKEN_BYTES).toString("base64url");
  return { draftId: randomUUID(), secret, secretHash: hashDraftSecret(secret) };
}

export function hashDraftSecret(secret: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error("invalid_draft_secret");
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function draftSecretMatches(secret: string, expectedHash: string) {
  try {
    const actual = Buffer.from(hashDraftSecret(secret), "hex");
    const expected = Buffer.from(expectedHash, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function serializeDraftCapability(capability: Pick<DraftCapability, "draftId" | "secret">) {
  return `${capability.draftId}.${capability.secret}`;
}

export function parseDraftCapability(value: string | undefined): Pick<DraftCapability, "draftId" | "secret"> | null {
  if (!value) return null;
  const separator = value.indexOf(".");
  if (separator < 1 || value.indexOf(".", separator + 1) !== -1) return null;
  const draftId = value.slice(0, separator);
  const secret = value.slice(separator + 1);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(draftId)) return null;
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
  return { draftId, secret };
}

export function draftSessionLifetimeSeconds(environment: Partial<NodeJS.ProcessEnv> = process.env) {
  const raw = environment.APP_ANONYMOUS_DRAFT_SESSION_SECONDS;
  if (!raw || !/^\d+$/.test(raw)) return null;
  const seconds = Number(raw);
  return Number.isSafeInteger(seconds) && seconds >= 900 && seconds <= 2_592_000 ? seconds : null;
}

export function draftCookieSettings(environment: Partial<NodeJS.ProcessEnv> = process.env) {
  const maxAge = draftSessionLifetimeSeconds(environment);
  if (maxAge === null) return null;
  const production = environment.NODE_ENV === "production";
  return {
    httpOnly: true,
    maxAge,
    name: production ? "__Host-applypack_draft" : "applypack_draft",
    path: "/",
    priority: "high" as const,
    sameSite: "lax" as const,
    secure: production,
  };
}

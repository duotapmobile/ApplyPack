import { z } from "zod";
import { INTAKE_DRAFT_HEADER } from "./verified-intake-contract";

/** Keep the UI's selected draft fixed even if another tab replaces the cookie. */
export function privateIntakeRequest(expectedDraftId: string, path: string, init: RequestInit = {}) {
  if (!z.uuid().safeParse(expectedDraftId).success || !path.startsWith("/") || path.startsWith("//") || path.includes("\\")
    || !["/api/intake/anonymous-draft", "/api/checkout/search"].some(prefix => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`))) {
    throw new Error("Select your saved intake before opening or changing it.");
  }
  const headers = new Headers(init.headers);
  headers.set(INTAKE_DRAFT_HEADER, expectedDraftId);
  return fetch(path, { ...init, headers });
}

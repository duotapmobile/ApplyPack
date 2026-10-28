import { safeAuthDestination } from "@/lib/auth/email-code";

export type CheckoutInvitation = { id: string; secret: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseInvitationFragment(fragment: string): CheckoutInvitation | null {
  if (!fragment.startsWith("#") || fragment.length > 200) return null;
  const entries = [...new URLSearchParams(fragment.slice(1)).entries()];
  if (entries.length !== 2 || new Set(entries.map(([key]) => key)).size !== 2) return null;
  const params = new Map(entries);
  const id = params.get("invitationId");
  const secret = params.get("invitationSecret");
  return id && uuid.test(id) && secret && /^[A-Za-z0-9_-]{43}$/.test(secret) ? { id, secret } : null;
}

export function invitationFragment(fragment: string) {
  const invitation = parseInvitationFragment(fragment);
  return invitation ? `#${new URLSearchParams({ invitationId: invitation.id, invitationSecret: invitation.secret })}` : "";
}

export function invitationSignInHref(fragment: string) {
  return `/sign-in?next=%2Fget-started${invitationFragment(fragment)}`;
}

/** Invitations travel only in the browser fragment, never in OTP request data. */
export function invitationAuthRedirect(value: unknown, fragment = "") {
  const safe = safeAuthDestination(value);
  const target = new URL(safe, "https://applypack.invalid");
  if (target.pathname === "/get-started") {
    target.hash = typeof value === "string" && safe === value ? invitationFragment(fragment) : "";
  } else if (/invitation(?:Id|Secret)/i.test(target.hash)) {
    target.hash = "";
  }
  return target.pathname + target.search + target.hash;
}

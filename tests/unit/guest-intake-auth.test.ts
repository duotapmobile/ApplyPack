import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const guestSession = readFileSync(resolve(process.cwd(), "src/app/api/auth/guest-session/route.ts"), "utf8");
const intake = readFileSync(resolve(process.cwd(), "src/app/api/intake/route.ts"), "utf8");
const checkout = readFileSync(resolve(process.cwd(), "src/app/api/checkout/search/route.ts"), "utf8");
const webhook = readFileSync(resolve(process.cwd(), "src/app/api/stripe/webhook/route.ts"), "utf8");

describe("guest intake ownership", () => {
  it("creates an anonymous authenticated owner behind a same-origin rate limit", () => {
    expect(guestSession).toContain("requestOriginIsAllowed(request)");
    expect(guestSession).toContain('scope: "guest_session"');
    expect(guestSession).toContain("signInAnonymously()");
  });

  it("links the contact email without blocking intake on email verification", () => {
    expect(intake).toContain("authData.user.is_anonymous === true");
    expect(intake).toContain("supabase.auth.updateUser(");
    expect(intake).toContain('.from("profiles").update');
    expect(intake).not.toContain("email_confirm: true");
  });

  it("keeps private ownership and server controlled checkout intact", () => {
    expect(intake).toContain('identity: authData.user.id');
    expect(intake).toContain('admin.rpc("create_completed_intake"');
    expect(checkout).toContain('.eq("customer_id", authData.user.id)');
    expect(checkout).toContain('rpc("prepare_search_checkout"');
    expect(checkout).toContain("customer_email: intake.email");
    expect(webhook).toContain('.from("intakes")');
    expect(webhook).toContain("recipient = paidIntake?.email || null");
  });
});
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const adminPage = readFileSync(resolve(process.cwd(), "src/app/admin/page.tsx"), "utf8");
const mfa = readFileSync(resolve(process.cwd(), "src/components/admin/admin-mfa.tsx"), "utf8");

describe("admin MFA", () => {
  it("keeps server-side email, role, and AAL2 checks before operations render", () => {
    expect(adminPage).toContain("isAdminEmailAllowed");
    expect(adminPage).toContain('["operator", "admin"].includes(profile.role)');
    expect(adminPage).toContain('assurance.currentLevel !== "aal2"');
    expect(adminPage).toContain("<AdminMfa />");
  });

  it("supports TOTP enrollment and challenge verification", () => {
    expect(mfa).toContain('factorType: "totp"');
    expect(mfa).toContain("challengeAndVerify");
    expect(mfa).toContain('pattern="[0-9]{6}"');
  });

  it("serializes enrollment so development effects cannot create duplicate factors", () => {
    expect(mfa).toContain("pendingAdminMfaEnrollment");
    expect(mfa).toContain("if (!pendingAdminMfaEnrollment)");
    expect(mfa).toContain("await enrollAdminMfa(supabase)");
  });
});

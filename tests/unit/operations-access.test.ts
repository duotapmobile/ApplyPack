import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const providers = vi.hoisted(() => ({
  server: vi.fn(),
  admin: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: providers.server }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: providers.admin }));

import { requireAdmin } from "@/lib/auth/require-admin";

function providerState(input: {
  email?: string;
  role?: string;
  aal?: "aal1" | "aal2";
}) {
  const user = input.email ? { id: "operator-fixture", email: input.email } : null;
  const auditInsert = vi.fn().mockResolvedValue({ error: null });
  const profileSingle = vi.fn().mockResolvedValue({ data: input.role ? { role: input.role } : null });
  const admin = {
    from: vi.fn((table: string) => {
      if (table === "audit_logs") return { insert: auditInsert };
      if (table === "profiles") return { select: () => ({ eq: () => ({ maybeSingle: profileSingle }) }) };
      throw new Error("Unexpected table in authorization test");
    }),
  };
  const server = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user } }),
      mfa: {
        getAuthenticatorAssuranceLevel: vi.fn().mockResolvedValue({
          data: { currentLevel: input.aal || "aal1" },
        }),
      },
    },
  };
  providers.server.mockResolvedValue(server);
  providers.admin.mockReturnValue(admin);
  return { admin };
}

describe("operations admin access boundary", () => {
  beforeEach(() => {
    process.env.APP_ADMIN_EMAILS = "operator@example.test";
    providers.server.mockReset();
    providers.admin.mockReset();
  });

  afterEach(() => {
    delete process.env.APP_ADMIN_EMAILS;
  });

  it("rejects an unauthenticated request", async () => {
    providerState({});
    const result = await requireAdmin();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("rejects a signed-in user outside the admin allowlist", async () => {
    providerState({ email: "customer@example.test", role: "admin", aal: "aal2" });
    const result = await requireAdmin();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("rejects a non-admin profile even when the email is allowlisted", async () => {
    providerState({ email: "operator@example.test", role: "customer", aal: "aal2" });
    const result = await requireAdmin();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("rejects an admin/operator session without AAL2", async () => {
    providerState({ email: "operator@example.test", role: "operator", aal: "aal1" });
    const result = await requireAdmin();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("authorizes only an allowlisted admin/operator session with AAL2", async () => {
    const { admin } = providerState({ email: "operator@example.test", role: "admin", aal: "aal2" });
    const result = await requireAdmin();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.admin).toBe(admin);
  });
});

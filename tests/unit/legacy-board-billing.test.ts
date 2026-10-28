import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  access: vi.fn(),
  stripeClient: vi.fn(),
  createPortalSession: vi.fn(),
}));

vi.mock("@/lib/job-board/access", () => ({
  requireLegacyBoardArchiveAccess: dependencies.access,
}));
vi.mock("@/lib/stripe/server", () => ({
  createStripeOperationalClient: dependencies.stripeClient,
}));
vi.mock("@/lib/commerce/server", () => ({
  canonicalApplicationOrigin: () => "https://applypack.example",
}));

import { POST } from "@/app/api/customer/billing/portal/route";

describe("legacy board billing management", () => {
  beforeEach(() => {
    Object.values(dependencies).forEach(mock => mock.mockReset());
    dependencies.stripeClient.mockReturnValue({
      billingPortal: { sessions: { create: dependencies.createPortalSession } },
    });
  });

  it("opens billing management only for an unexpired provider-confirmed legacy entitlement", async () => {
    dependencies.access.mockResolvedValue({
      ok: true,
      providerCustomerId: "cus_legacy",
      accessEndsAt: "2026-11-01T00:00:00Z",
    });
    dependencies.createPortalSession.mockResolvedValue({ url: "https://billing.example/session" });

    const response = await POST();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    await expect(response.json()).resolves.toEqual({ url: "https://billing.example/session" });
    expect(dependencies.createPortalSession).toHaveBeenCalledWith({
      customer: "cus_legacy",
      return_url: "https://applypack.example/my-applypack/job-board",
    });
  });

  it.each([401, 410, 503])("returns 410 and never calls Stripe when archive access fails with %s", async status => {
    dependencies.access.mockResolvedValue({ ok: false, status, error: "controlled" });

    const response = await POST();

    expect(response.status).toBe(410);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(dependencies.stripeClient).not.toHaveBeenCalled();
    expect(dependencies.createPortalSession).not.toHaveBeenCalled();
  });
});

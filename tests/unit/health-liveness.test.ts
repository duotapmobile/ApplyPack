// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  checkoutGate: vi.fn(),
  evaluate: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ provider: "fixture" }),
}));
vi.mock("@/lib/operations/launch-readiness", () => ({
  evaluateLaunchInfrastructure: dependencies.evaluate,
  manualLaunchCheckoutGate: dependencies.checkoutGate,
}));

import { GET as health } from "@/app/api/health/route";
import { GET as live } from "@/app/api/live/route";

describe("production liveness and readiness separation", () => {
  beforeEach(() => {
    dependencies.evaluate.mockReset();
    dependencies.checkoutGate.mockReset();
  });

  it("keeps liveness up while renderer readiness and checkout remain closed", async () => {
    dependencies.evaluate.mockResolvedValue({
      ready: false,
      deployedSha: "a".repeat(40),
      commerceConfigured: true,
      checks: { documentRendering: false },
    });
    dependencies.checkoutGate.mockResolvedValue(false);

    const liveResponse = live();
    expect(liveResponse.status).toBe(200);
    await expect(liveResponse.json()).resolves.toEqual({ status: "ok" });

    const healthResponse = await health();
    expect(healthResponse.status).toBe(503);
    await expect(healthResponse.json()).resolves.toMatchObject({
      status: "not_ready",
      commerceConfigured: true,
      acceptingOrders: false,
      checks: { documentRendering: false },
    });
    expect(dependencies.checkoutGate).toHaveBeenCalledOnce();
  });
});

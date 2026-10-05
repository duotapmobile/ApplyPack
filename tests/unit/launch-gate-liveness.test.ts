// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  manualLaunchCanaryCheckoutGate,
  manualLaunchCheckoutGate,
} from "@/lib/operations/launch-readiness";

const failedRendererInfrastructure = {
  ready: false,
  deployedSha: "a".repeat(40),
  commerceConfigured: true,
  capacityAvailable: true,
  capacityByResource: { SEARCH: true, MATERIALS: true },
  environmentAcceptingOrders: true,
  checks: { documentRendering: false },
};

describe("renderer failure keeps every checkout gate closed", () => {
  it("rejects public and canary checkout before database authorization", async () => {
    vi.stubEnv("APP_CANARY_CHECKOUT_ENABLED", "true");
    const admin = { from: vi.fn(), rpc: vi.fn() };
    try {
      expect(await manualLaunchCheckoutGate(
        admin as never,
        failedRendererInfrastructure as never,
        "SEARCH",
      )).toBe(false);
      expect(await manualLaunchCanaryCheckoutGate(
        admin as never,
        "MATERIALS",
        { expectedCustomerId: "00000000-0000-4000-8000-000000000000" },
        failedRendererInfrastructure as never,
      )).toBe(false);
      expect(admin.from).not.toHaveBeenCalled();
      expect(admin.rpc).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

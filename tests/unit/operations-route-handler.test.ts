import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const dependencies = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  collectOperationsSummary: vi.fn(),
  containsSensitiveOperationsData: vi.fn(),
}));

vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: dependencies.requireAdmin }));
vi.mock("@/lib/operations/summary", () => ({
  collectOperationsSummary: dependencies.collectOperationsSummary,
  containsSensitiveOperationsData: dependencies.containsSensitiveOperationsData,
}));

import { GET } from "@/app/api/admin/operations/summary/route";

const safeSummary = {
  generatedAt: "2026-09-11T12:00:00.000Z",
  environment: "staging",
  releaseSha: "76e42f6",
  readiness: { database: true, payments: true, email: true, fileSafety: true, maintenance: true },
  inventory: {
    registeredSources: 1,
    scheduledSources: 1,
    realAuthorizedAutomatedSources: 1,
    syntheticRuns: 0,
    realRuns: 1,
    syntheticActiveJobs: 0,
    realActiveJobs: 1,
  },
  queues: {
    recompute: { states: {}, oldestItemAgeSeconds: null, stale: false },
    workflow: { states: {}, oldestItemAgeSeconds: null, stale: false },
    outbox: { states: {}, oldestItemAgeSeconds: null, stale: false },
    commerceReconciliation: { states: {}, oldestItemAgeSeconds: null, stale: false },
  },
  maintenance: { heartbeatAgeSeconds: 10, stale: false },
  alerts: { openWarnings: 0, openCritical: 0 },
};

function denied(status: number, error: string) {
  dependencies.requireAdmin.mockResolvedValue({
    ok: false,
    response: NextResponse.json({ error }, { status }),
  });
}

function authorized(auditError: unknown = null) {
  const insert = vi.fn().mockResolvedValue({ error: auditError });
  const admin = { from: vi.fn(() => ({ insert })) };
  dependencies.requireAdmin.mockResolvedValue({
    ok: true,
    user: { id: "operator-fixture" },
    admin,
  });
  return { admin, insert };
}

describe("operations summary route authorization", () => {
  beforeEach(() => {
    dependencies.requireAdmin.mockReset();
    dependencies.collectOperationsSummary.mockReset().mockResolvedValue(safeSummary);
    dependencies.containsSensitiveOperationsData.mockReset().mockReturnValue(false);
  });

  it.each([
    [401, "Authentication required."],
    [403, "Admin access required."],
    [403, "Admin MFA verification required."],
  ])("returns the shared authorization denial (%s) without collecting privileged data", async (status, error) => {
    denied(status, error);
    const response = await GET();
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(await response.json()).toEqual({ error });
    expect(dependencies.collectOperationsSummary).not.toHaveBeenCalled();
  });

  it("returns aggregate data only after the authorized AAL2 boundary and audit succeed", async () => {
    authorized();
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(await response.json()).toEqual(safeSummary);
  });

  it("fails closed if the access audit cannot be persisted", async () => {
    authorized({ code: "AUDIT_UNAVAILABLE" });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Operations summary audit unavailable." });
  });

  it("fails closed if the aggregate response safety guard rejects the result", async () => {
    authorized();
    dependencies.containsSensitiveOperationsData.mockReturnValue(true);
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Operations summary safety check failed." });
  });
});

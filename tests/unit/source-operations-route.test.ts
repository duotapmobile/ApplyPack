import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
const access = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/auth/require-admin", () => access);
import { GET } from "@/app/api/admin/job-sources/route";

function database(failedTable?: string) {
  return { from: vi.fn((table: string) => {
    const query = {
      select: vi.fn(() => query), neq: vi.fn(() => query), order: vi.fn(() => query), limit: vi.fn(() => query),
      then: (resolve: (value: unknown) => void) => resolve({ data: [], error: table === failedTable ? { message: "secret provider detail" } : null }),
    };
    return query;
  }) };
}
describe("source operations availability", () => {
  beforeEach(() => vi.clearAllMocks());
  it("does not expose source data before administrator authorization", async () => {
    access.requireAdmin.mockResolvedValue({ ok: false, response: NextResponse.json({ error: "Admin access required." }, { status: 403 }) });
    expect((await GET()).status).toBe(403);
  });
  it("reports missing source schema as unavailable instead of a healthy empty inventory", async () => {
    access.requireAdmin.mockResolvedValue({ ok: true, admin: database("job_source_schedules") });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(await response.text()).not.toContain("secret provider detail");
  });
  it("returns the registered inventory only when every operations query succeeded", async () => {
    access.requireAdmin.mockResolvedValue({ ok: true, admin: database() });
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await response.json()).sources.length).toBeGreaterThan(0);
  });
});

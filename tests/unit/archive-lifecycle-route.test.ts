import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ admin: vi.fn(), verifier: vi.fn(), close: vi.fn(), store: vi.fn(), service: vi.fn(), execute: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: mocks.admin }));
vi.mock("../../scripts/lib/aws-archive-verifier-credentials.mjs", () => ({ createWorkloadArchiveEvidenceReader: mocks.verifier }));
vi.mock("../../scripts/lib/archive-lifecycle-service.mjs", () => ({ createArchiveLifecycleStore: mocks.store, createArchiveLifecycleService: mocks.service }));
import { POST } from "@/app/api/internal/archive-lifecycle/route";
import { POST as retiredCompletion } from "@/app/api/internal/protected-recovery/retention-complete/route";

const secrets = { file: "F".repeat(43), database: "D".repeat(43), retention: "T".repeat(43) };
const request = (secret = secrets.file, body: BodyInit = JSON.stringify({ action: "WRITER_STATUS", runId: "10000000-0000-4000-8000-000000000001" }),
  headers: Record<string, string> = {}, suffix = "") => new Request(`https://applypack.work/api/internal/archive-lifecycle${suffix}`,
  { method: "POST", headers: { authorization: `Bearer ${secret}`, "content-type": "application/json", ...headers }, body });
beforeEach(() => {
  for (const [name, value] of Object.entries({ APP_ARCHIVE_LIFECYCLE_ENABLED: "true", APP_DEPLOYMENT_ENV: "production",
    NEXT_PUBLIC_APP_URL: "https://applypack.work", NEXT_PUBLIC_SUPABASE_URL: "https://spjaaxndiduhrcleazwb.supabase.co",
    APP_EXPECTED_RELEASE_SHA: "a".repeat(40), RAILWAY_GIT_COMMIT_SHA: "a".repeat(40), APP_RECOVERY_READER_SECRET: "R".repeat(43),
    APP_RECOVERY_COMPLETION_SECRET: secrets.file, APP_DATABASE_BACKUP_LIFECYCLE_SECRET: secrets.database,
    APP_RECOVERY_RETENTION_SECRET: secrets.retention, APP_RECOVERY_RECEIPT_SECRET: "S".repeat(43), CRON_SECRET: "C".repeat(43) })) vi.stubEnv(name, value);
  mocks.admin.mockReturnValue({ from: mocks.from }); mocks.store.mockReturnValue({});
  mocks.verifier.mockReturnValue({ close: mocks.close }); mocks.service.mockReturnValue({ execute: mocks.execute });
  mocks.execute.mockResolvedValue({ state: "OPEN" });
});
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

describe("authenticated archive lifecycle boundary", () => {
  it.each([["file", "FILE_WRITER"], ["database", "DATABASE_WRITER"], ["retention", "RETENTION"]] as const)("selects only the %s capability", async (name, capability) => {
    const result = await POST(request(secrets[name]));
    expect(result.status).toBe(200); expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ action: "WRITER_STATUS" }), { capability, signal: expect.any(AbortSignal) });
    expect(result.headers.get("cache-control")).toBe("private, no-store"); expect(result.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it.each([["bad", {}], ["R".repeat(43), {}], [secrets.file, { cookie: "session=other" }]])("rejects unauthorized or browser credentials before provider access", async (secret, headers) => {
    expect((await POST(request(secret as string, "{}", headers as Record<string, string>))).status).toBe(401);
    expect(mocks.admin).not.toHaveBeenCalled(); expect(mocks.verifier).not.toHaveBeenCalled();
  });
  it.each([["APP_ARCHIVE_LIFECYCLE_ENABLED", "false"], ["APP_EXPECTED_RELEASE_SHA", "b".repeat(40)],
    ["APP_DATABASE_BACKUP_LIFECYCLE_SECRET", secrets.file], ["NEXT_PUBLIC_SUPABASE_URL", "https://wrong.supabase.co"]])("rejects invalid %s before provider access", async (name, value) => {
    vi.stubEnv(name, value); expect((await POST(request())).status).toBe(503); expect(mocks.admin).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.each(["{", "x".repeat(1024 * 1024 + 1), new Uint8Array([0xc3, 0x28])])("rejects malformed, oversized or non-UTF8 requests before private reads", async (body) => {
    expect((await POST(request(secrets.file, body))).status).toBe(503); expect(mocks.admin).not.toHaveBeenCalled(); expect(mocks.verifier).not.toHaveBeenCalled();
  });
  it("rejects caller-selected query parameters and non-JSON content", async () => {
    expect((await POST(request(secrets.file, "{}", {}, "?bucket=foreign"))).status).toBe(503);
    expect((await POST(request(secrets.file, "{}", { "content-type": "text/plain" }))).status).toBe(503); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("does not use a fallback identity when the verifier cannot initialize", async () => {
    mocks.verifier.mockImplementation(() => { throw new Error("private verifier credential"); });
    const result = await POST(request()); expect(result.status).toBe(503); expect(mocks.execute).not.toHaveBeenCalled();
    expect(JSON.stringify(await result.json())).not.toContain("private verifier");
  });
  it("closes verifier resources and hides diagnostics on an ambiguous operation", async () => {
    mocks.execute.mockRejectedValue(new Error(`private provider detail ${secrets.file}`));
    const result = await POST(request()); expect(result.status).toBe(503); expect(mocks.execute).toHaveBeenCalledOnce(); expect(mocks.close).toHaveBeenCalledOnce();
    expect(await result.json()).toEqual({ error: "Archive maintenance is unavailable. Reconcile any unconfirmed operation before retrying." });
  });
  it("rejects success if the caller aborted during service completion", async () => {
    const abort = new AbortController(); mocks.execute.mockImplementation(async () => { abort.abort(); return { state: "COMPLETE" }; });
    const input = request(); const result = await POST(new Request(input, { signal: abort.signal }));
    expect(result.status).toBe(503); expect(mocks.close).toHaveBeenCalledOnce();
  });
});

describe("retired worker-asserted retention completion", () => {
  it("returns authenticated 409 without reading the body or changing any stored receipt", async () => {
    const input = request(secrets.retention, JSON.stringify({ sourceStartedAt: new Date().toISOString(), deletedVersionCount: 0 }));
    const result = await retiredCompletion(input);
    expect(result.status).toBe(409); expect(input.bodyUsed).toBe(false); expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
    expect(await result.json()).toEqual({ error: "Use the verified archive lifecycle completion." }); expect(result.headers.get("cache-control")).toBe("private, no-store");
  });
  it("retains authorization and cookie rejection even though the route is retired", async () => {
    expect((await retiredCompletion(request(secrets.file))).status).toBe(401);
    expect((await retiredCompletion(request(secrets.retention, "{}", { cookie: "session=x" }))).status).toBe(401);
    expect(mocks.admin).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled();
  });
});

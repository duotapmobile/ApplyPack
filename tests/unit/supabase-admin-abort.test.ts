import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

describe("isolated admin request cancellation", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.example.test");
    vi.stubEnv("SUPABASE_SECRET_KEY", "test-service-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("does not create a client without the existing required configuration", () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    expect(createSupabaseAdminClient({ signal: new AbortController().signal })).toBeNull();
  });

  it("aborts an actual Storage SDK upload through its public transport hook", async () => {
    const controller = new AbortController();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const observed: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal;
      expect(signal).toBeInstanceOf(AbortSignal); expect(init?.redirect).toBe("error");
      observed.push(signal!); entered();
      return new Promise<Response>((_resolve, reject) => signal!.addEventListener("abort", () => reject(signal!.reason), { once: true }));
    }));
    const client = createSupabaseAdminClient({ signal: controller.signal })!;
    const uploading = client.storage.from("operator-drafts").upload("synthetic/file.docx", Buffer.from("synthetic"), { upsert: false });
    await started; controller.abort();
    const result = await uploading;
    expect(observed).toHaveLength(1); expect(observed[0].aborted).toBe(true);
    expect(result.data).toBeNull(); expect(result.error).not.toBeNull();
  });

  it("makes no network request when its parent is already aborted", async () => {
    const transport = vi.fn(); vi.stubGlobal("fetch", transport);
    const controller = new AbortController(); controller.abort();
    const result = await createSupabaseAdminClient({ signal: controller.signal })!.storage.from("operator-drafts")
      .upload("synthetic/file.docx", Buffer.from("synthetic"));
    expect(transport).not.toHaveBeenCalled(); expect(result.error).not.toBeNull();
  });

  it("captures the original signal so later options mutation cannot replace its boundary", async () => {
    const transport = vi.fn(); vi.stubGlobal("fetch", transport);
    const controller = new AbortController(), options = { signal: controller.signal };
    const client = createSupabaseAdminClient(options)!;
    options.signal = new AbortController().signal; controller.abort();
    const result = await client.storage.from("operator-drafts").upload("synthetic/file.docx", Buffer.from("synthetic"));
    expect(transport).not.toHaveBeenCalled(); expect(result.error).not.toBeNull();
  });

  it("preserves a narrower database query signal", async () => {
    const parent = new AbortController(), query = new AbortController();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    let observed: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      observed = init?.signal ?? undefined; entered();
      return new Promise<Response>((_resolve, reject) => observed!.addEventListener("abort", () => reject(observed!.reason), { once: true }));
    }));
    const pending = Promise.resolve(createSupabaseAdminClient({ signal: parent.signal })!.from("synthetic_rows").select("id").abortSignal(query.signal));
    await started; query.abort(); const result = await pending;
    expect(parent.signal.aborted).toBe(false); expect(observed?.aborted).toBe(true); expect(result.error).not.toBeNull();
  });

  it("keeps separately created clients independent and preserves default calls", async () => {
    const first = new AbortController(), second = new AbortController(); first.abort();
    const transport = vi.fn(async () => new Response(JSON.stringify({ Id: "file-id", Key: "operator-drafts/synthetic/file.docx" }),
      { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", transport);
    const blocked = await createSupabaseAdminClient({ signal: first.signal })!.storage.from("operator-drafts").upload("synthetic/file.docx", Buffer.from("synthetic"));
    const independent = await createSupabaseAdminClient({ signal: second.signal })!.storage.from("operator-drafts").upload("synthetic/file.docx", Buffer.from("synthetic"));
    const ordinary = await createSupabaseAdminClient()!.storage.from("operator-drafts").upload("synthetic/file.docx", Buffer.from("synthetic"));
    expect(blocked.error).not.toBeNull(); expect(independent.error).toBeNull(); expect(ordinary.error).toBeNull();
    expect(transport).toHaveBeenCalledTimes(2); expect(second.signal.aborted).toBe(false);
  });
});

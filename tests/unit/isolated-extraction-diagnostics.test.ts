import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("node:fs/promises", () => { const readFile = vi.fn(async () => "synthetic worker"); return { readFile, default: { readFile } }; });
vi.mock("node:child_process", () => { const spawn = vi.fn(); return { spawn, default: { spawn } }; });
const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
const secret = "PRIVATE_CUSTOMER_TEXT_AND_SECRET";

beforeEach(() => {
  vi.resetModules();
  Object.defineProperty(process, "platform", { value: "linux", configurable: true });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  Object.defineProperty(process, "platform", originalPlatform);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function launcher(stderr: string, exit = 1, stdout = "", errorCode?: string) {
  const { spawn } = await import("node:child_process");
  vi.mocked(spawn).mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
    child.stdin.once("finish", () => {
      child.stderr.write(Buffer.from(stderr));
      child.stdout.write(Buffer.from(stdout));
      if (errorCode) child.emit("error", Object.assign(new Error(secret), { code: errorCode }));
      child.emit("close", exit);
    });
    return child as unknown as ReturnType<typeof spawn>;
  });
  return import("../../src/lib/files/isolated-extraction");
}

describe("closed isolation diagnostics (mocked launcher, not sandbox proof)", () => {
  it.each([
    ["bwrap: Creating new namespace failed: Operation not permitted", 1, "", undefined, "namespace_or_permission_denied"],
    ["prlimit: failed to execute /usr/bin/bwrap: No such file or directory", 1, "", undefined, "executable_unavailable"],
    [secret, 1, "", "ENOENT", "executable_unavailable"],
    [secret, 1, "", undefined, "process_exit"],
    [secret, 0, secret, undefined, "malformed_output"],
    ["x".repeat(4096) + "\nbwrap: Permission denied", 1, "", undefined, "process_exit"],
  ])("classifies bounded diagnostics without exposing stderr %#", async (stderr, exit, stdout, errorCode, reason) => {
    const { probeDocumentIsolation } = await launcher(stderr + "\n" + secret, exit, stdout, errorCode);
    expect(await probeDocumentIsolation()).toBe(false);
    expect(await probeDocumentIsolation()).toBe(false);
    expect(console.warn).toHaveBeenCalledExactlyOnceWith("document_isolation_probe_failed", { reason });
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(secret);
  });
  it("sanitizes missing worker source errors", async () => {
    const { readFile } = await import("node:fs/promises");
    vi.mocked(readFile).mockRejectedValueOnce(new Error(secret));
    const { probeDocumentIsolation } = await launcher("");
    expect(await probeDocumentIsolation()).toBe(false);
    expect(console.warn).toHaveBeenCalledExactlyOnceWith("document_isolation_probe_failed", { reason: "source_unavailable" });
  });
  it("logs no diagnostic on a successful synthetic probe", async () => {
    const { probeDocumentIsolation } = await launcher(secret, 0, JSON.stringify({ text: "Isolation probe", pageCount: null, paginationStatus: "UNKNOWN", reference: "isolated-extractor-v1" }));
    expect(await probeDocumentIsolation()).toBe(true);
    expect(console.warn).not.toHaveBeenCalled();
  });
  it("reports the unchanged timeout without exposing process output", async () => {
    const { spawn } = await import("node:child_process");
    let expire: (() => void) | undefined;
    const timer = vi.spyOn(globalThis, "setTimeout").mockImplementation(((callback: () => void) => {
      expire = callback;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);
    vi.mocked(spawn).mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
      child.stdin.once("finish", () => { child.stderr.write(secret); expire!(); });
      return child as unknown as ReturnType<typeof spawn>;
    });
    const { probeDocumentIsolation } = await import("../../src/lib/files/isolated-extraction");
    expect(await probeDocumentIsolation()).toBe(false);
    expect(timer).toHaveBeenCalledWith(expect.any(Function), 5000);
    expect(console.warn).toHaveBeenCalledExactlyOnceWith("document_isolation_probe_failed", { reason: "timeout" });
  });
});

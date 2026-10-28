import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { KmsEnvelopeAdapter } from "@/lib/security/sensitive-payload";
vi.mock("server-only", () => ({}));
const captured = vi.hoisted(() => ({ decrypted: [] as Buffer[] }));
vi.mock("@/lib/security/sensitive-payload", async (original) => {
  const real = await original<typeof import("@/lib/security/sensitive-payload")>();
  return { ...real, decryptSensitivePayload: async (input: Parameters<typeof real.decryptSensitivePayload>[0]) => {
    const bytes = await real.decryptSensitivePayload(input); captured.decrypted.push(bytes); return bytes;
  } };
});
import { readServiceRepairPayload, storeServiceRepairPayload } from "@/lib/materials/service-repair-payload";
import { serviceErrorSha256 } from "@/lib/materials/service-error-contract";
const id = (n: number) => `96000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const signal = () => new AbortController().signal;
function fixture() {
  const plaintext = Buffer.from('Fictional name mismatch: "Morgan Example".');
  const input = { customerId: id(1), caseId: id(2), repairVersionId: id(3), payloadId: id(4),
    purpose: "SERVICE_REPAIR_SOURCE" as const, sha256: serviceErrorSha256(plaintext) };
  const configuration = { enabled: true, keyIdentity: "fictional-kms", keyVersion: "1", contextVersion: "fixture-context-v1" };
  const transform = (bytes: Uint8Array) => Buffer.from(bytes.map((value) => value ^ 0x5a));
  const kms = { wrapDataKey: vi.fn(async ({ plaintextDataKey }) => transform(plaintextDataKey)),
    unwrapDataKey: vi.fn(async ({ encryptedDataKey }) => transform(encryptedDataKey)) } satisfies KmsEnvelopeAdapter;
  let row: Record<string, unknown> | null = null, loseInsertResponse = false;
  const calls: { kind: string; signal?: AbortSignal }[] = [];
  const from = vi.fn((table: string) => {
    expect(table).toBe("ap_sensitive_payloads"); let columns = "", inserted: Record<string, unknown> | undefined;
    const call: { kind: string; signal?: AbortSignal } = { kind: "read" };
    const query = { select: (value: string) => { columns = value; return query; }, eq: (key: string, value: string) => {
      expect(key).toBe("id"); expect(value).toBe(input.payloadId); return query;
    }, single: () => query, maybeSingle: () => query, abortSignal: (value: AbortSignal) => { call.signal = value; return query; },
    insert: (value: Record<string, unknown>) => { inserted = value; call.kind = "insert"; return query; },
    then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(() => {
      calls.push(call); if (call.signal?.aborted) throw new Error("ABORTED");
      if (inserted) { row = { ...structuredClone(inserted), retention_state: "ACTIVE" }; if (loseInsertResponse) throw new Error("lost response"); return { data: null, error: null }; }
      return { data: row && Object.fromEntries(columns.split(",").map((key) => [key, row![key]])), error: null };
    }).then(resolve, reject) }; return query;
  });
  const admin = { from } as unknown as SupabaseClient<Database>;
  return { plaintext, input, configuration, kms, calls, admin, row: () => row!, loseResponse: () => { loseInsertResponse = true; },
    store: (s = signal()) => storeServiceRepairPayload(admin, input, plaintext, { signal: s, configuration, kms }),
    read: (s = signal()) => readServiceRepairPayload(admin, input, { signal: s, configuration, kms }) };
}
beforeEach(() => { captured.decrypted.length = 0; }); afterEach(() => vi.useRealTimers());
describe("purpose-bound service-repair private payloads", () => {
  it.each(["caseId", "repairVersionId", "purpose"] as const)("rejects cross-%s reuse before decryption", async (field) => {
    const f = fixture(); await f.store();
    const input = { ...f.input, [field]: field === "purpose" ? "SERVICE_REPAIR_CLAIM_REVIEW" : id(98) };
    await expect(readServiceRepairPayload(f.admin, input, { signal: signal(), configuration: f.configuration, kms: f.kms })).rejects.toThrow("IDENTITY_MISMATCH");
    expect(f.kms.unwrapDataKey).not.toHaveBeenCalled();
  });
  it("rejects mismatched bytes before encryption or insertion and keeps the caller buffer intact", async () => {
    const f = fixture(), bytes = Buffer.from("Different private source");
    await expect(storeServiceRepairPayload(f.admin, f.input, bytes, { signal: signal(), configuration: f.configuration, kms: f.kms })).rejects.toThrow("DIGEST_INVALID");
    expect(f.kms.wrapDataKey).not.toHaveBeenCalled(); expect(f.calls).toHaveLength(0); expect(bytes.toString()).toBe("Different private source");
  });
  it("uses real authenticated encryption and returns caller-owned plaintext only after the current identity reread", async () => {
    const f = fixture(); expect(await f.store()).toEqual({ payloadId: f.input.payloadId, sha256: f.input.sha256 });
    expect(f.row().ciphertext).not.toContain(f.plaintext.toString("hex"));
    const bytes = await f.read(); expect(bytes).toEqual(f.plaintext); expect(bytes).not.toBe(f.plaintext);
    expect(f.calls.every((call) => call.signal instanceof AbortSignal)).toBe(true);
    expect(f.kms.wrapDataKey.mock.calls[0][0].encryptionContext).toMatchObject({ customerId: f.input.customerId,
      caseId: f.input.caseId, repairVersionId: f.input.repairVersionId, payloadId: f.input.payloadId, purpose: "SERVICE_REPAIR_SOURCE" as const });
    bytes.fill(0); expect(f.plaintext.some((byte) => byte !== 0)).toBe(true);
  });
  it("reconciles a lost insert response and exact replay without encrypting or writing again", async () => {
    const f = fixture(); f.loseResponse(); await f.store(); await f.store();
    expect(f.kms.wrapDataKey).toHaveBeenCalledOnce(); expect(f.calls.filter((call) => call.kind === "insert")).toHaveLength(1);
  });
  it.each(["customer_id", "content_sha256", "encryption_context_hash", "retention_state"])("rejects %s mismatch before KMS", async (field) => {
    const f = fixture(); await f.store(); f.row()[field] = field === "customer_id" ? id(99) : field === "retention_state" ? "DELETED" : "0".repeat(64);
    await expect(f.read()).rejects.toThrow(/^SERVICE_REPAIR_/); expect(f.kms.unwrapDataKey).not.toHaveBeenCalled();
  });
  it.each(["customer_id", "content_sha256", "encryption_context_hash", "retention_state"])("rejects %s changed during decrypt and clears real plaintext", async (field) => {
    const f = fixture(); await f.store();
    f.kms.unwrapDataKey.mockImplementationOnce(async ({ encryptedDataKey }) => {
      f.row()[field] = field === "customer_id" ? id(99) : field === "retention_state" ? "DELETED" : "0".repeat(64);
      return Buffer.from(encryptedDataKey.map((value: number) => value ^ 0x5a));
    });
    await expect(f.read()).rejects.toThrow(/^SERVICE_REPAIR_/);
    expect(captured.decrypted).toHaveLength(1); expect(captured.decrypted[0].every((value) => value === 0)).toBe(true);
  });
  it("rejects actual ciphertext tampering without returning private bytes", async () => {
    const f = fixture(); await f.store(); const hex = f.row().ciphertext as string;
    f.row().ciphertext = hex.slice(0, 2) + (hex.slice(2, 4) === "00" ? "01" : "00") + hex.slice(4);
    await expect(f.read()).rejects.toThrow(); expect(captured.decrypted).toHaveLength(0);
  });
  it("clears late real decrypted bytes after cancellation and snapshots aliased configuration", async () => {
    const f = fixture(); await f.store(); let release!: () => void;
    f.kms.unwrapDataKey.mockImplementationOnce(async ({ encryptedDataKey }) => {
      await new Promise<void>((resolve) => { release = resolve; }); return Buffer.from(encryptedDataKey.map((value: number) => value ^ 0x5a));
    });
    const controller = new AbortController(), pending = f.read(controller.signal), rejected = expect(pending).rejects.toThrow("ABORTED");
    await vi.waitFor(() => expect(f.kms.unwrapDataKey).toHaveBeenCalledOnce());
    f.configuration.contextVersion = "changed"; controller.abort(); await rejected; release();
    await vi.waitFor(() => expect(captured.decrypted).toHaveLength(1)); expect(captured.decrypted[0].every((value) => value === 0)).toBe(true);
  });
  it("cannot insert after cancellation while KMS is pending", async () => {
    const f = fixture(); let release!: () => void;
    f.kms.wrapDataKey.mockImplementationOnce(async ({ plaintextDataKey }) => {
      const copy = Buffer.from(plaintextDataKey.map((value: number) => value ^ 0x5a));
      await new Promise<void>((resolve) => { release = resolve; }); return copy;
    });
    const controller = new AbortController(), pending = f.store(controller.signal), rejected = expect(pending).rejects.toThrow("ABORTED");
    await vi.waitFor(() => expect(f.kms.wrapDataKey).toHaveBeenCalledOnce()); controller.abort(); await rejected; release(); await Promise.resolve();
    expect(f.calls.some((call) => call.kind === "insert")).toBe(false); expect(f.row()).toBeNull();
    expect(f.plaintext.some((value) => value !== 0)).toBe(true);
  });
});

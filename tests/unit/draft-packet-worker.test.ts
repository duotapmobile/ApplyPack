import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachDraftPacketForClaim, draftPayloadEncryptionContext, readEncryptedDraftPayload, storeEncryptedDraftPayload, type DraftPacketServices, type DraftPayloadInput } from "@/lib/documents/draft-packet-worker";
import { DraftingEvidenceError, serializeDraftingEvidencePacket, type DraftingEvidencePacket } from "@/lib/documents/drafting-evidence";
import { decryptSensitivePayload, type KmsEnvelopeAdapter } from "@/lib/security/sensitive-payload";
import { parsePostgresBytea } from "@/lib/commerce/server";
vi.mock("server-only", () => ({}));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const now = new Date("2026-10-25T12:00:00.000Z"), due = "2026-10-26T10:00:00.000Z", lease = "2026-10-25T12:05:00.000Z";
const context = "a".repeat(64);
function fixture() {
  const input = { jobId: id(1), ownerId: id(2), leaseToken: id(3) };
  const job = { id: id(1), customer_id: id(4), material_line_id: id(5), line_revision_id: id(6), source_snapshot_id: id(7), state: "PREPARING",
    active_version_id: null as string | null, lease_owner: id(2), lease_token: id(3), lease_generation: 1, lease_expires_at: lease };
  const revision = { id: id(6), line_id: id(5), source_snapshot_id: id(7), version: 1, binding_sha256: "b".repeat(64), due_at: due, superseded_at: null };
  // This fixture isolates orchestration. The production factory uses the real
  // packet loader, whose complete evidence validation has its own suite.
  const body = { binding: { dueAt: due, snapshotId: id(7) }, expected: { bindingSha256: revision.binding_sha256, customerId: id(4), materialLineId: id(5), revisionId: id(6), revisionVersion: 1 },
    validUntil: "2026-10-25T12:30:00.000Z" };
  const packet = { ...body, packetSha256: hash(JSON.stringify(body)) } as unknown as DraftingEvidencePacket;
  const payloads = new Map<string, Record<string, unknown>>(); let version: Record<string, unknown> | null = null;
  const workflow = {
    readJob: vi.fn(async () => ({ ...job })), readVersion: vi.fn(async () => version), renewLease: vi.fn(async () => lease), readContext: vi.fn(async () => context),
    attach: vi.fn(async (args: Parameters<DraftPacketServices["workflow"]["attach"]>[0]) => {
      version = { id: id(8), job_id: job.id, customer_id: job.customer_id, material_line_id: job.material_line_id,
        packet_encrypted_payload_id: args.p_payload_id, packet_sha256: args.p_packet_sha256, context_sha256: args.p_context_sha256, invalidated_at: null };
      job.active_version_id = id(8); job.state = "READY"; return id(8);
    }),
  };
  const services = { workflow, readRevision: vi.fn(async () => revision), readPayload: vi.fn(async (key: string) => payloads.get(key)),
    loadPacket: vi.fn(async () => packet), storePayload: vi.fn(async (data: DraftPayloadInput) => {
      payloads.set(data.payloadId, { id: data.payloadId, customer_id: data.customerId, content_sha256: data.sha256, retention_state: "ACTIVE", encryption_context_hash: "d".repeat(64) });
      return { payloadId: data.payloadId, sha256: data.sha256 };
    }) } satisfies DraftPacketServices;
  return { input, job, revision, packet, payloads, workflow, services, getVersion: () => version,
    run: (signal?: AbortSignal) => attachDraftPacketForClaim(services, input, { now: () => now, signal }) };
}
afterEach(() => { vi.useRealTimers(); });

describe("durable packet attachment", () => {
  it("uses server-owned claim identity, context checks, exact encrypted bytes and attach CAS", async () => {
    const f = fixture(), result = await f.run();
    expect(result).toMatchObject({ status: "ATTACHED", jobId: id(1), versionId: id(8), packetSha256: f.packet.packetSha256, contextSha256: context });
    expect(f.services.loadPacket).toHaveBeenCalledWith(f.packet.expected, expect.objectContaining({ now: expect.any(Function), signal: expect.any(AbortSignal) }));
    expect(f.services.storePayload.mock.calls[0][0]).toEqual({ customerId: id(4), jobId: id(1), payloadId: result.payloadId,
      purpose: "MATERIAL_DRAFT_PACKET", body: serializeDraftingEvidencePacket(f.packet), sha256: f.packet.packetSha256 });
    expect(f.workflow.attach.mock.calls[0][0]).toEqual({ p_job_id: id(1), p_lease_token: id(3), p_payload_id: result.payloadId,
      p_packet_sha256: f.packet.packetSha256, p_context_sha256: context });
    expect(f.workflow.readContext).toHaveBeenCalledTimes(3);
  });
  it("reuses an exact attached packet on replay without rebuilding or inserting private data", async () => {
    const f = fixture(), first = await f.run(); f.services.loadPacket.mockClear(); f.services.storePayload.mockClear(); f.workflow.attach.mockClear();
    expect(await f.run()).toMatchObject({ ...first, status: "ALREADY_ATTACHED" });
    expect(f.services.loadPacket).not.toHaveBeenCalled(); expect(f.services.storePayload).not.toHaveBeenCalled(); expect(f.workflow.attach).not.toHaveBeenCalled();
  });
  it("resolves a lost successful attach response using exact stored identities without deletion", async () => {
    const f = fixture(), attach = f.workflow.attach.getMockImplementation()!;
    f.workflow.attach.mockImplementationOnce(async (args) => { await attach(args); throw new Error("SECRET_NETWORK_FAILURE"); });
    expect(await f.run()).toMatchObject({ status: "ATTACHED_AFTER_AMBIGUOUS_RESPONSE", versionId: id(8) });
    expect(f.payloads.size).toBe(1);
  });
  it("keeps an unattached payload after an unresolved response and does not invent a commit", async () => {
    const f = fixture(); f.workflow.attach.mockRejectedValueOnce(new Error("secret"));
    await expect(f.run()).rejects.toThrow("DRAFT_PACKET_ATTACH_RESULT_UNKNOWN"); expect(f.payloads.size).toBe(1);
  });
  it.each([
    ["foreign job", (f: ReturnType<typeof fixture>) => { f.job.id = id(99); }],
    ["foreign worker", (f: ReturnType<typeof fixture>) => { f.job.lease_owner = id(99); }],
    ["stale token", (f: ReturnType<typeof fixture>) => { f.job.lease_token = id(99); }],
    ["expired lease", (f: ReturnType<typeof fixture>) => { f.job.lease_expires_at = now.toISOString(); }],
    ["invalid stage", (f: ReturnType<typeof fixture>) => { f.job.state = "DRAFTING"; }],
    ["foreign revision", (f: ReturnType<typeof fixture>) => { f.revision.line_id = id(99); }],
    ["foreign source", (f: ReturnType<typeof fixture>) => { f.revision.source_snapshot_id = id(99); }],
    ["past due", (f: ReturnType<typeof fixture>) => { f.revision.due_at = now.toISOString(); }],
  ] as const)("rejects %s before packet persistence", async (_, mutate) => {
    const f = fixture(); mutate(f); await expect(f.run()).rejects.toThrow(/^DRAFT_PACKET_(CLAIM_STALE|REVISION_INVALID)$/);
    expect(f.services.storePayload).not.toHaveBeenCalled(); expect(f.workflow.attach).not.toHaveBeenCalled();
  });
  it("rejects malformed renewal and context receipts", async () => {
    const f = fixture(); f.workflow.renewLease.mockResolvedValueOnce("not-time"); await expect(f.run()).rejects.toThrow("CLAIM_STALE");
    f.workflow.readContext.mockResolvedValueOnce("not-digest"); await expect(f.run()).rejects.toThrow("CONTEXT_INVALID");
    expect(f.services.storePayload).not.toHaveBeenCalled();
  });
  it("detects context changes while loading before writing private data", async () => {
    const f = fixture(); f.workflow.readContext.mockResolvedValueOnce(context).mockResolvedValueOnce("c".repeat(64));
    await expect(f.run()).rejects.toThrow("CONTEXT_CHANGED"); expect(f.services.storePayload).not.toHaveBeenCalled();
  });
  it("rejects forged loader ownership and altered packet content", async () => {
    const f = fixture(); f.packet.expected.customerId = id(99);
    await expect(f.run()).rejects.toThrow("PACKET_BINDING_INVALID"); expect(f.services.storePayload).not.toHaveBeenCalled();
  });
  it("checks persistence receipts instead of assuming a resolved call stored the right payload", async () => {
    const f = fixture(); f.services.storePayload.mockResolvedValueOnce({ payloadId: id(99), sha256: f.packet.packetSha256 });
    await expect(f.run()).rejects.toThrow("PERSIST_IDENTITY_MISMATCH"); expect(f.workflow.attach).not.toHaveBeenCalled();
  });
  it.each(["version", "customer", "context", "payload"])("rejects a mismatched %s after an ambiguous attach", async (field) => {
    const f = fixture(), attach = f.workflow.attach.getMockImplementation()!;
    f.workflow.attach.mockImplementationOnce(async (args) => {
      await attach(args); const version = f.getVersion()!;
      if (field === "version") version.id = id(99);
      if (field === "customer") version.customer_id = id(99);
      if (field === "context") version.context_sha256 = "c".repeat(64);
      if (field === "payload") version.packet_encrypted_payload_id = id(99);
      throw new Error("transport lost response");
    });
    await expect(f.run()).rejects.toThrow("ATTACH_IDENTITY_MISMATCH"); expect(f.payloads.size).toBe(1);
  });
  it("does not persist or attach after cancellation and bounds an unresponsive service", async () => {
    const f = fixture(), controller = new AbortController(); controller.abort();
    await expect(f.run(controller.signal)).rejects.toThrow("ABORTED"); expect(f.workflow.readJob).not.toHaveBeenCalled();
    vi.useFakeTimers(); f.workflow.readJob.mockImplementationOnce(() => new Promise(() => undefined));
    const result = expect(f.run()).rejects.toThrow("ABORTED"); await vi.advanceTimersByTimeAsync(60_000); await result;
    expect(f.services.storePayload).not.toHaveBeenCalled(); expect(f.workflow.attach).not.toHaveBeenCalled();
  });
  it("redacts unexpected database and source exceptions", async () => {
    const f = fixture(); f.services.loadPacket.mockRejectedValueOnce(new Error("Private Customer provider-key SECRET"));
    await expect(f.run()).rejects.toThrow(/^DRAFT_PACKET_SOURCE_UNAVAILABLE$/);
  });
  it("leaves unsupported historical intake as an owner exception without cancelling the paid obligation", async () => {
    const f = fixture(); f.services.loadPacket.mockRejectedValueOnce(new DraftingEvidenceError("LEGACY_INTAKE_UNSUPPORTED"));
    await expect(f.run()).rejects.toThrow(/^DRAFT_PACKET_LEGACY_INTAKE_OWNER_EXCEPTION$/);
    expect(f.services.storePayload).not.toHaveBeenCalled(); expect(f.workflow.attach).not.toHaveBeenCalled();
    expect(f.job.state).toBe("PREPARING");
  });
});

function encryptedStoreFixture() {
  let row: Record<string, unknown> | null = null; let loseInsert = false;
  const insert = vi.fn(async (value: Record<string, unknown>) => { row ??= value; if (loseInsert) throw new Error("lost"); return { error: null }; });
  const read = vi.fn(async () => ({ data: row ? { retention_state: "ACTIVE", ...row } : null, error: null }));
  const query = { eq: () => query, abortSignal: () => query, single: read };
  const from = vi.fn(() => ({ insert: (value: Record<string, unknown>) => ({ abortSignal: () => insert(value) }), select: () => query }));
  const configuration = { enabled: true, keyIdentity: "synthetic-key", keyVersion: "v1", contextVersion: "test-v1" };
  const keys: Uint8Array[] = [];
  const kms: KmsEnvelopeAdapter = { wrapDataKey: vi.fn(async ({ plaintextDataKey }) => { keys.push(Uint8Array.from(plaintextDataKey)); return new Uint8Array([1]); }),
    unwrapDataKey: vi.fn(async () => keys[0]) };
  const input: DraftPayloadInput = { customerId: id(4), jobId: id(1), payloadId: id(9), purpose: "MATERIAL_DRAFT_PACKET",
    body: '{"exact":"  Private  cafe\u0301\\nsource  "}', sha256: "" };
  input.sha256 = hash(input.body);
  return { admin: { from } as unknown as Parameters<typeof storeEncryptedDraftPayload>[0], from, insert, read, configuration, kms, input,
    row: () => row!, lose: () => { loseInsert = true; }, replace: (value: Record<string, unknown>) => { row = value; } };
}

describe("shared encrypted draft payload store", () => {
  it("uses real AES-GCM and preserves exact UTF-8 bytes under a purpose-bound context", async () => {
    const f = encryptedStoreFixture();
    expect(await storeEncryptedDraftPayload(f.admin, f.input, f)).toEqual({ payloadId: id(9), sha256: f.input.sha256, reconciled: false });
    const row = f.row(); expect(JSON.stringify(row)).not.toContain("Private");
    const plaintext = await decryptSensitivePayload({ configuration: f.configuration, kms: f.kms, context: draftPayloadEncryptionContext(f.input),
      envelope: { algorithm: "AES-256-GCM", ciphertext: parsePostgresBytea(row.ciphertext), nonce: parsePostgresBytea(row.nonce),
        authenticationTag: parsePostgresBytea(row.authentication_tag), encryptedDataKey: parsePostgresBytea(row.encrypted_data_key),
        contentSha256: row.content_sha256 as string, keyIdentity: row.kms_key_identity as string, keyVersion: row.kms_key_version as string, encryptionContextHash: row.encryption_context_hash as string } });
    expect(plaintext.toString("utf8")).toBe(f.input.body); plaintext.fill(0);
    expect(f.kms.wrapDataKey).toHaveBeenCalledWith(expect.objectContaining({ encryptionContext: expect.objectContaining({ purpose: "MATERIAL_DRAFT_PACKET", jobId: id(1), customerId: id(4), payloadId: id(9) }) }));
  });
  it("reconciles a lost insert response without deleting or replacing the committed envelope", async () => {
    const f = encryptedStoreFixture(); f.lose();
    expect(await storeEncryptedDraftPayload(f.admin, f.input, f)).toMatchObject({ reconciled: true, payloadId: id(9) });
    expect(f.insert).toHaveBeenCalledTimes(1);
  });
  it("refuses missing encryption configuration, wrong digests and unauthorized purposes before insert", async () => {
    const f = encryptedStoreFixture();
    await expect(storeEncryptedDraftPayload(f.admin, f.input, { ...f, configuration: { ...f.configuration, enabled: false } })).rejects.toThrow("ENCRYPTION_UNAVAILABLE");
    await expect(storeEncryptedDraftPayload(f.admin, { ...f.input, sha256: "a".repeat(64) }, f)).rejects.toThrow("PAYLOAD_DIGEST_INVALID");
    await expect(storeEncryptedDraftPayload(f.admin, { ...f.input, purpose: "REFERENCE_RECORD" } as unknown as DraftPayloadInput, f)).rejects.toThrow("PAYLOAD_INPUT_INVALID");
    expect(f.insert).not.toHaveBeenCalled();
  });
  it("rejects an existing row owned by another customer after an ambiguous insert", async () => {
    const f = encryptedStoreFixture(); await storeEncryptedDraftPayload(f.admin, f.input, f);
    f.replace({ ...f.row(), customer_id: id(99) }); f.lose();
    await expect(storeEncryptedDraftPayload(f.admin, f.input, f)).rejects.toThrow("PERSIST_IDENTITY_MISMATCH");
  });
  it("never overwrites an existing envelope under another draft purpose", async () => {
    const f = encryptedStoreFixture(); await storeEncryptedDraftPayload(f.admin, f.input, f); const original = f.row();
    await expect(storeEncryptedDraftPayload(f.admin, { ...f.input, purpose: "MATERIAL_DRAFT_SOURCE" }, f)).rejects.toThrow("PERSIST_IDENTITY_MISMATCH");
    expect(f.row()).toBe(original);
  });
  it.each(["insert", "receipt"])("bounds a hanging standalone %s without a caller signal", async (step) => {
    const f = encryptedStoreFixture(); vi.useFakeTimers();
    if (step === "insert") f.insert.mockImplementationOnce(() => new Promise(() => undefined));
    else f.read.mockImplementationOnce(() => new Promise(() => undefined));
    const pending = expect(storeEncryptedDraftPayload(f.admin, f.input, f)).rejects.toThrow(/^DRAFT_PACKET_ABORTED$/);
    await vi.advanceTimersByTimeAsync(20_000); await pending;
  });
  it("does not report success if cancellation occurs during its final receipt read", async () => {
    const f = encryptedStoreFixture(), controller = new AbortController(), read = f.read.getMockImplementation()!;
    f.read.mockImplementationOnce(async () => { const result = await read(); controller.abort(); return result; });
    await expect(storeEncryptedDraftPayload(f.admin, f.input, { ...f, signal: controller.signal })).rejects.toThrow(/^DRAFT_PACKET_(ABORTED|PERSIST_RESULT_UNKNOWN)$/);
    expect(f.insert).toHaveBeenCalledTimes(1); expect(f.row().id).toBe(f.input.payloadId);
  });
});

describe("shared encrypted draft payload read", () => {
  const readInput = (f: ReturnType<typeof encryptedStoreFixture>) => {
    const { customerId, jobId, payloadId, purpose, sha256 } = f.input;
    return { customerId, jobId, payloadId, purpose, sha256 };
  };
  it("returns only exact authenticated bytes and leaves buffer ownership with the caller", async () => {
    const f = encryptedStoreFixture(); await storeEncryptedDraftPayload(f.admin, f.input, f);
    const plaintext = await readEncryptedDraftPayload(f.admin, readInput(f), f);
    expect(plaintext.toString("utf8")).toBe(f.input.body);
    expect(hash(plaintext.toString("utf8"))).toBe(f.input.sha256);
    plaintext.fill(0); expect(plaintext.every((byte) => byte === 0)).toBe(true);
    expect(f.kms.unwrapDataKey).toHaveBeenCalledTimes(1);
  });
  it.each(["customer", "payload", "hash", "retired", "oversized", "invalid hex", "algorithm"])("rejects %s without a key unwrap", async (mode) => {
    const f = encryptedStoreFixture(); await storeEncryptedDraftPayload(f.admin, f.input, f);
    const row = { ...f.row() };
    if (mode === "customer") row.customer_id = id(99);
    if (mode === "payload") row.id = id(99);
    if (mode === "hash") row.content_sha256 = "a".repeat(64);
    if (mode === "retired") row.retention_state = "DELETED";
    if (mode === "oversized") row.ciphertext = "\\x" + "00".repeat(4_000_001);
    if (mode === "invalid hex") row.ciphertext = "\\x0z";
    if (mode === "algorithm") row.encryption_algorithm = "PLAINTEXT";
    f.replace(row);
    await expect(readEncryptedDraftPayload(f.admin, readInput(f), f)).rejects.toThrow(/^DRAFT_PACKET_(PAYLOAD_UNAVAILABLE|PAYLOAD_IDENTITY_MISMATCH)$/);
    expect(f.kms.unwrapDataKey).not.toHaveBeenCalled();
  });
  it.each(["job", "purpose", "key"])("rejects a foreign %s context before unwrap", async (mode) => {
    const f = encryptedStoreFixture(); await storeEncryptedDraftPayload(f.admin, f.input, f);
    const input = readInput(f), options = { ...f };
    if (mode === "job") input.jobId = id(99);
    if (mode === "purpose") input.purpose = "MATERIAL_DRAFT_SOURCE";
    if (mode === "key") options.configuration = { ...f.configuration, keyIdentity: "wrong-key" };
    await expect(readEncryptedDraftPayload(f.admin, input, options)).rejects.toThrow(/^DRAFT_PACKET_PAYLOAD_UNAVAILABLE$/);
    expect(f.kms.unwrapDataKey).not.toHaveBeenCalled();
  });
  it("rejects ciphertext tampering and sanitizes decryption exceptions", async () => {
    const f = encryptedStoreFixture(); await storeEncryptedDraftPayload(f.admin, f.input, f);
    const ciphertext = String(f.row().ciphertext); f.replace({ ...f.row(), ciphertext: ciphertext.slice(0, -2) + (ciphertext.endsWith("00") ? "01" : "00") });
    await expect(readEncryptedDraftPayload(f.admin, readInput(f), f)).rejects.toThrow(/^DRAFT_PACKET_PAYLOAD_UNAVAILABLE$/);
  });
  it("rechecks ACTIVE after decrypt rather than returning bytes revoked during key retrieval", async () => {
    const f = encryptedStoreFixture(); await storeEncryptedDraftPayload(f.admin, f.input, f);
    const original = f.kms.unwrapDataKey;
    f.kms.unwrapDataKey = async (value) => { const key = await original(value); f.replace({ ...f.row(), retention_state: "DELETED" }); return key; };
    await expect(readEncryptedDraftPayload(f.admin, readInput(f), f)).rejects.toThrow(/^DRAFT_PACKET_PAYLOAD_UNAVAILABLE$/);
  });
  it("makes no read after abort and bounds metadata and key waits", async () => {
    const f = encryptedStoreFixture(), controller = new AbortController(); controller.abort();
    await expect(readEncryptedDraftPayload(f.admin, readInput(f), { ...f, signal: controller.signal })).rejects.toThrow("ABORTED");
    expect(f.from).not.toHaveBeenCalled();
    await storeEncryptedDraftPayload(f.admin, f.input, f);
    vi.useFakeTimers(); f.kms.unwrapDataKey = vi.fn(() => new Promise<Uint8Array>(() => undefined));
    const pending = expect(readEncryptedDraftPayload(f.admin, readInput(f), f)).rejects.toThrow("ABORTED");
    await vi.advanceTimersByTimeAsync(20_000); await pending;
  });
});

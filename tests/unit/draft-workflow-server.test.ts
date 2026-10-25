import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { DraftGenerationState } from "@/lib/documents/draft-generation-worker";
import type { DraftingEvidencePacket } from "@/lib/documents/drafting-evidence";
const dependency = vi.hoisted(() => ({ read: vi.fn(), store: vi.fn(), load: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/documents/draft-packet-worker", async (original) => ({ ...await original<typeof import("@/lib/documents/draft-packet-worker")>(),
  readEncryptedDraftPayload: dependency.read, storeEncryptedDraftPayload: dependency.store }));
vi.mock("@/lib/documents/drafting-evidence-server", () => ({ loadDraftingEvidencePacket: dependency.load }));
import { createDraftWorkflowServer } from "@/lib/documents/draft-workflow-server";
import { serializeDraftingEvidencePacket } from "@/lib/documents/drafting-evidence";

const id = (n: number) => `99000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const at = new Date("2026-10-25T12:00:00Z"), later = "2026-10-25T12:05:00Z", due = "2026-10-26T12:00:00Z";
const signal = () => new AbortController().signal;
type Call = { kind: "table" | "rpc"; name: string; args?: unknown; columns?: string; filters: Array<[string, unknown]>; signal?: AbortSignal };
type Receipt = { data: unknown; error: unknown };
function fixture() {
  const claim = { jobId: id(1), ownerId: id(2), leaseToken: id(3) };
  const job = { id: id(1), customer_id: id(4), material_line_id: id(5), line_revision_id: id(6), source_snapshot_id: id(7), state: "READY",
    active_version_id: id(8), lease_owner: id(2), lease_token: id(3), lease_generation: 1, lease_expires_at: later };
  const revision = { id: id(6), line_id: id(5), source_snapshot_id: id(7), version: 1, binding_sha256: "a".repeat(64), due_at: due, superseded_at: null };
  const version = { id: id(8), job_id: id(1), customer_id: id(4), material_line_id: id(5), packet_encrypted_payload_id: id(9), packet_sha256: "b".repeat(64),
    context_sha256: "c".repeat(64), encrypted_payload_id: null as string | null, source_sha256: null as string | null, invalidated_at: null as string | null };
  const runtime = { singleton: true, enabled: true, policy_id: id(10) };
  const policy = { id: id(10), provider: "openai", model: "reviewed-model", policy_sha256: "d".repeat(64), privacy_reference_sha256: "e".repeat(64),
    evaluation_reference_sha256: "f".repeat(64), quote_reference_sha256: "a".repeat(64), max_input_tokens: 1000, max_output_tokens: 1000 };
  const attempt = { id: id(11), job_id: id(1), customer_id: id(4), material_line_id: id(5), draft_version_id: id(8), state: "RESULT_RECORDED" };
  const payload = { id: id(12), customer_id: id(4), content_sha256: "e".repeat(64), retention_state: "ACTIVE" };
  const tables: Record<string, unknown> = { ap_material_draft_jobs: job, ap_material_line_revisions: revision, ap_material_draft_versions: version,
    ap_material_draft_runtime: runtime, ap_material_draft_policies: policy, ap_material_draft_attempts: attempt, ap_sensitive_payloads: payload };
  const rpc: Record<string, unknown> = { ap_material_draft_context_sha256: version.context_sha256, ap_renew_material_draft_lease: later,
    ap_attach_material_draft_packet: version.id, ap_assert_material_draft_dispatch_current: true, ap_observe_material_draft_response: "f".repeat(64),
    ap_begin_material_draft_request: { requestId: attempt.id, dispatchAuthorized: false, state: "DISPATCHED", reservedMicrousd: 200 },
    ap_record_material_draft_result: version.id, ap_fail_material_draft_job: "RESULT_UNKNOWN" };
  const calls: Call[] = [], overrides = new Map<string, Array<() => Receipt | Promise<Receipt>>>();
  const request = (call: Call) => {
    calls.push(call);
    const result = async () => {
      const override = overrides.get(call.name)?.shift();
      return override ? await override() : { data: structuredClone((call.kind === "table" ? tables : rpc)[call.name] ?? null), error: null };
    };
    const query = { select: (columns: string) => { call.columns = columns; return query; },
      eq: (key: string, value: unknown) => { call.filters.push([key, value]); return query; },
      abortSignal: (value: AbortSignal) => { call.signal = value; return query; },
      single: result, then: (resolve: (value: Receipt) => unknown, reject?: (reason: unknown) => unknown) => result().then(resolve, reject) };
    return query;
  };
  // Structural DB protocol fake. Production accepts only SupabaseClient<Database>;
  // no network client or credentials are used by this test transport.
  const admin = { from: (name: string) => request({ kind: "table", name, filters: [] }), rpc: (name: string, args: unknown) => request({ kind: "rpc", name, args, filters: [] }) } as unknown as SupabaseClient<Database>;
  let clock = at;
  const services = createDraftWorkflowServer(admin, { now: () => clock });
  const authorize = async () => { await services.generation.readRuntime(signal()); await services.generation.readPolicy(policy.id, signal()); };
  const state = (): DraftGenerationState => ({ ...claim, customerId: job.customer_id, materialLineId: job.material_line_id, revisionId: revision.id,
    revisionVersion: revision.version, bindingSha256: revision.binding_sha256, snapshotId: revision.source_snapshot_id, dueAt: due, leaseGeneration: 1,
    leaseExpiresAt: later, state: "READY", versionId: version.id, packetPayloadId: version.packet_encrypted_payload_id, packetSha256: version.packet_sha256,
    contextSha256: version.context_sha256, sourcePayloadId: null, invalidatedAt: null });
  const storedPacket = () => {
    const expected = { customerId: job.customer_id, materialLineId: job.material_line_id, revisionId: revision.id, revisionVersion: 1, bindingSha256: revision.binding_sha256 };
    const body = { binding: { dueAt: due, snapshotId: job.source_snapshot_id }, confirmationMode: "CUSTOMER_CONFIRMED_V1", expected: {
      bindingSha256: expected.bindingSha256, customerId: expected.customerId, materialLineId: expected.materialLineId, revisionId: expected.revisionId, revisionVersion: 1 },
      schemaVersion: "applypack-drafting-evidence-v1", sourceText: "Exact  spacing\nand é", validUntil: "2026-10-25T12:30:00Z" };
    const bytes = Buffer.from(JSON.stringify(body)); version.packet_sha256 = sha(bytes.toString());
    // The full evidence loader owns the complete graph validation in its suite.
    // This fixture tests that its trusted result cannot replace different bytes.
    const packet = { ...body, packetSha256: version.packet_sha256 } as unknown as DraftingEvidencePacket;
    expect(serializeDraftingEvidencePacket(packet)).toBe(bytes.toString());
    dependency.read.mockResolvedValue(bytes); dependency.load.mockResolvedValue(packet);
    return { packet, bytes };
  };
  return { services, claim, job, version, revision, runtime, policy, attempt, payload, rpc, tables, calls, overrides, authorize, state, storedPacket,
    setClock: (value: Date) => { clock = value; } };
}
beforeEach(() => { vi.stubEnv("APP_MATERIAL_DRAFTING_ENABLED", "true"); vi.stubEnv("OPENAI_API_KEY", "synthetic-only-not-a-real-key"); vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("service-only 091 database adapters", () => {
  it("does no work on construction and keeps both environment and database gates closed", async () => {
    const f = fixture(); expect(f.calls).toEqual([]); expect(() => f.services.generation.readApiKey()).toThrow("PROVIDER_DISABLED");
    vi.stubEnv("APP_MATERIAL_DRAFTING_ENABLED", "false");
    expect(await f.services.generation.readRuntime(signal())).toEqual({ enabled: false, policy_id: null }); expect(f.calls).toEqual([]);
    vi.stubEnv("APP_MATERIAL_DRAFTING_ENABLED", "true"); f.runtime.enabled = false;
    expect(await f.services.generation.readRuntime(signal())).toEqual({ enabled: false, policy_id: f.policy.id });
    await expect(f.services.generation.readPolicy(f.policy.id, signal())).rejects.toThrow("PROVIDER_DISABLED");
    expect(() => f.services.generation.readApiKey()).toThrow("PROVIDER_DISABLED");
  });
  it("reads the credential only after exact approved runtime/policy, and rechecks the environment gate", async () => {
    const f = fixture(); await f.authorize(); expect(f.services.generation.readApiKey()).toBe("synthetic-only-not-a-real-key");
    vi.stubEnv("APP_MATERIAL_DRAFTING_ENABLED", "false"); expect(() => f.services.generation.readApiKey()).toThrow("PROVIDER_DISABLED");
  });
  it.each(["foreign", "missing approval", "wrong provider"])("rejects a %s policy without key access", async (mode) => {
    const f = fixture(); await f.services.generation.readRuntime(signal());
    if (mode === "foreign") f.policy.id = id(90);
    if (mode === "missing approval") f.policy.quote_reference_sha256 = "";
    if (mode === "wrong provider") f.policy.provider = "other";
    await expect(f.services.generation.readPolicy(id(10), signal())).rejects.toThrow("DRAFT_WORKFLOW_");
    expect(() => f.services.generation.readApiKey()).toThrow("PROVIDER_DISABLED");
  });
  it("binds actual job, active version, revision, and current DB context with abortable finite queries", async () => {
    const f = fixture(); expect(await f.services.generation.readState(f.claim, signal())).toEqual(f.state());
    expect(f.calls.map((c) => c.name)).toEqual(["ap_material_draft_jobs", "ap_material_line_revisions", "ap_material_draft_versions", "ap_material_draft_context_sha256", "ap_material_draft_jobs"]);
    expect(f.calls.every((c) => c.signal instanceof AbortSignal)).toBe(true);
    expect(f.calls[0].filters).toEqual([["id", f.claim.jobId]]); expect(f.calls[3].args).toEqual({ p_job_id: f.claim.jobId });
    expect(f.calls.every((c) => c.columns !== "*")).toBe(true);
  });
  it.each(["customer", "line", "revision", "snapshot", "owner", "lease", "source ready", "invalidated", "context", "deadline"])("rejects a mixed or stale %s before decryption", async (mode) => {
    const f = fixture();
    if (mode === "customer") f.version.customer_id = id(99);
    if (mode === "line") f.version.material_line_id = id(99);
    if (mode === "revision") f.revision.id = id(99);
    if (mode === "snapshot") f.revision.source_snapshot_id = id(99);
    if (mode === "owner") f.job.lease_owner = id(99);
    if (mode === "lease") f.job.lease_token = id(99);
    if (mode === "source ready") f.version.encrypted_payload_id = id(12);
    if (mode === "invalidated") f.version.invalidated_at = at.toISOString();
    if (mode === "context") f.rpc.ap_material_draft_context_sha256 = "f".repeat(64);
    if (mode === "deadline") f.revision.due_at = at.toISOString();
    await expect(f.services.generation.readState(f.claim, signal())).rejects.toThrow("DRAFT_WORKFLOW_"); expect(dependency.read).not.toHaveBeenCalled();
  });
  it("detects a lease generation change between database reads", async () => {
    const f = fixture(); f.overrides.set("ap_material_draft_jobs", [() => ({ data: f.job, error: null }), () => ({ data: { ...f.job, lease_generation: 2 }, error: null })]);
    await expect(f.services.generation.readState(f.claim, signal())).rejects.toThrow("CLAIM_CHANGED");
  });
  it("uses exact 091 packet function names and arguments without retrying an ambiguous attachment", async () => {
    const f = fixture(), args = { p_job_id: f.job.id, p_lease_token: f.claim.leaseToken, p_payload_id: id(9), p_packet_sha256: f.version.packet_sha256, p_context_sha256: f.version.context_sha256 };
    expect(await f.services.workflow.attach(args, signal())).toBe(f.version.id);
    f.overrides.set("ap_attach_material_draft_packet", [() => { throw new Error("PRIVATE_PROVIDER_DETAIL"); }]);
    await expect(f.services.workflow.attach(args, signal())).rejects.toThrow("DRAFT_WORKFLOW_UNCONFIRMED");
    expect(f.calls).toHaveLength(2); expect(f.calls[0]).toMatchObject({ name: "ap_attach_material_draft_packet", args });
  });
  it("rejects unexpected operation arguments before reaching the database", async () => {
    const f = fixture(); await expect(f.services.workflow.readContext({ p_job_id: id(1), extra: "secret" } as never, signal())).rejects.toThrow("INPUT_INVALID"); expect(f.calls).toEqual([]);
  });
  it("returns decrypted evidence only when current validated packet bytes exactly equal the frozen stored body", async () => {
    const f = fixture(), { bytes, packet } = f.storedPacket();
    expect(await f.services.generation.loadPacket(f.state(), signal())).toEqual(packet); expect(bytes.every((b) => b === 0)).toBe(true);
    expect(dependency.read).toHaveBeenCalledWith(expect.anything(), { customerId: id(4), jobId: id(1), payloadId: id(9), purpose: "MATERIAL_DRAFT_PACKET", sha256: packet.packetSha256 }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(dependency.load.mock.calls[0][2].now()).toEqual(at);
  });
  it("uses current wall time for unchanged deterministic packets, without backdating validation", async () => {
    const f = fixture(), { packet } = f.storedPacket();
    const laterClock = new Date("2026-10-25T12:02:00Z"); f.setClock(laterClock);
    // The production builder's output has no clock-generated fields.
    dependency.load.mockImplementation(async (_admin, _expected, options) => { expect(options.now().getTime()).toBe(laterClock.getTime()); expect(Date.parse(packet.validUntil)).toBeGreaterThan(laterClock.getTime()); return packet; });
    await f.services.generation.loadPacket(f.state(), signal());
  });
  it.each(["wrong bytes", "changed evidence", "foreign snapshot", "expired", "malformed", "invalid UTF8"])("rejects %s and zeroes plaintext", async (mode) => {
    const f = fixture(), stored = f.storedPacket(); let bytes = stored.bytes;
    if (mode === "wrong bytes") bytes[0] = 0;
    if (mode === "changed evidence") dependency.load.mockResolvedValue({ ...stored.packet, packetSha256: "d".repeat(64) });
    if (mode === "foreign snapshot") f.revision.source_snapshot_id = id(99);
    if (["expired", "malformed", "invalid UTF8"].includes(mode)) {
      bytes = mode === "malformed" ? Buffer.from("{") : mode === "invalid UTF8" ? Buffer.from([0xff, 0xfe]) : Buffer.from(stored.bytes.toString().replace("12:30:00Z", "11:30:00Z"));
      f.version.packet_sha256 = createHash("sha256").update(bytes).digest("hex"); dependency.read.mockResolvedValue(bytes);
    }
    await expect(f.services.generation.loadPacket(f.state(), signal())).rejects.toThrow("DRAFT_WORKFLOW_"); expect(bytes.every((b) => b === 0)).toBe(true);
  });
  it("zeroes plaintext when fresh source validation or context confirmation fails", async () => {
    const f = fixture(), { bytes } = f.storedPacket(); dependency.load.mockRejectedValue(new Error("private customer content"));
    await expect(f.services.generation.loadPacket(f.state(), signal())).rejects.toThrow("DRAFT_WORKFLOW_UNCONFIRMED"); expect(bytes.every((b) => b === 0)).toBe(true);
  });
  it("rejects a changed database context after byte validation and clears decrypted bytes", async () => {
    const f = fixture(), { bytes } = f.storedPacket(); f.rpc.ap_material_draft_context_sha256 = "f".repeat(64);
    await expect(f.services.generation.loadPacket(f.state(), signal())).rejects.toThrow("CONTEXT_CHANGED"); expect(bytes.every((b) => b === 0)).toBe(true);
  });
  it("clears plaintext returned by a decryption operation that ignored cancellation", async () => {
    const f = fixture(), { bytes } = f.storedPacket(), controller = new AbortController();
    dependency.read.mockImplementation(async () => { controller.abort(); return bytes; });
    await expect(f.services.generation.loadPacket(f.state(), controller.signal)).rejects.toThrow("ABORTED");
    expect(bytes.every((b) => b === 0)).toBe(true); expect(dependency.load).not.toHaveBeenCalled();
  });
  it("records actual observed model and usage, including late unknown responses with no policy reactivation", async () => {
    const f = fixture();
    expect(await f.services.generation.observe({ jobId: id(1), requestId: id(11), versionId: id(8), policyId: id(10), outcome: "PROPOSAL_REJECTED",
      responseId: "resp_synthetic", observedModel: "unexpected-model", usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 } }, signal())).toBe("f".repeat(64));
    expect(f.calls[0]).toMatchObject({ name: "ap_observe_material_draft_response", args: { p_job_id: id(1), p_request_id: id(11), p_version_id: id(8), p_policy_id: id(10),
      p_outcome: "PROPOSAL_REJECTED", p_provider_response_id: "resp_synthetic", p_response_model: "unexpected-model", p_input_tokens: 10, p_output_tokens: 20, p_total_tokens: 30 } });
    await f.services.generation.observe({ jobId: id(1), requestId: id(11), versionId: id(8), policyId: id(10), outcome: "RESULT_UNKNOWN", responseId: null, observedModel: null, usage: null }, signal());
    expect(f.calls[1].args).toMatchObject({ p_provider_response_id: null, p_response_model: null, p_input_tokens: null, p_output_tokens: null, p_total_tokens: null });
  });
  it("rejects malformed accounting and extra private fields without a database write", async () => {
    const f = fixture(); await expect(f.services.generation.observe({ jobId: id(1), requestId: id(11), versionId: id(8), policyId: id(10), outcome: "RESULT_UNKNOWN", responseId: null, observedModel: null,
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 99 } }, signal())).rejects.toThrow("OBSERVATION_INVALID"); expect(f.calls).toEqual([]);
  });
  it("leaves replay dispatch permission false and requires a true current-dispatch receipt", async () => {
    const f = fixture(); await f.authorize();
    const args = { p_job_id: id(1), p_lease_token: id(3), p_request_id: id(11), p_version_id: id(8), p_policy_id: id(10) };
    expect(await f.services.generation.reserve({ ...args, p_input_token_cap: 1000, p_output_token_cap: 1000 }, signal())).toMatchObject({ dispatchAuthorized: false });
    expect(f.calls.at(-1)).toMatchObject({ name: "ap_begin_material_draft_request", args: { ...args, p_input_token_cap: 1000, p_output_token_cap: 1000 } });
    f.rpc.ap_assert_material_draft_dispatch_current = false;
    await expect(f.services.generation.recheck(args, signal())).rejects.toThrow("RECEIPT_INVALID");
    expect(f.calls.at(-1)).toMatchObject({ name: "ap_assert_material_draft_dispatch_current", args });
  });
  it("reconciles the exact source attempt/version/payload after a lost result without another mutation", async () => {
    const f = fixture(); f.job.state = "SOURCE_READY"; f.version.encrypted_payload_id = f.payload.id; f.version.source_sha256 = f.payload.content_sha256;
    expect(await f.services.generation.readRecordedSource(f.job.id, f.attempt.id, signal())).toEqual({ jobId: id(1), customerId: id(4), materialLineId: id(5), versionId: id(8), requestId: id(11),
      packetSha256: f.version.packet_sha256, sourceSha256: f.payload.content_sha256, sourcePayloadId: id(12), attemptState: "RESULT_RECORDED", invalidatedAt: null });
    expect(f.calls.every((call) => call.kind === "table")).toBe(true); expect(f.calls[0].filters).toEqual([["id", id(11)], ["job_id", id(1)]]);
  });
  it.each(["foreign attempt", "foreign customer", "superseded version", "purged payload", "different hash", "unknown result"])("does not claim reconciliation for %s", async (mode) => {
    const f = fixture(); f.version.encrypted_payload_id = f.payload.id; f.version.source_sha256 = f.payload.content_sha256;
    if (mode === "foreign attempt") f.attempt.job_id = id(99);
    if (mode === "foreign customer") f.attempt.customer_id = id(99);
    if (mode === "superseded version") f.job.active_version_id = id(99);
    if (mode === "purged payload") f.payload.retention_state = "PURGED";
    if (mode === "different hash") f.payload.content_sha256 = "d".repeat(64);
    if (mode === "unknown result") f.attempt.state = "RESULT_UNKNOWN";
    await expect(f.services.generation.readRecordedSource(id(1), id(11), signal())).rejects.toThrow("DRAFT_WORKFLOW_");
    expect(f.calls.every((call) => call.kind === "table")).toBe(true);
  });
  it("preserves exact fenced source-commit and failure RPC arguments", async () => {
    const f = fixture(), args = { p_job_id: id(1), p_lease_token: id(3), p_request_id: id(11), p_source_payload_id: id(12), p_source_sha256: "e".repeat(64) };
    expect(await f.services.generation.recordSource(args, signal())).toBe(id(8));
    expect(await f.services.generation.fail(f.claim, signal())).toBe("RESULT_UNKNOWN");
    expect(f.calls).toEqual([expect.objectContaining({ name: "ap_record_material_draft_result", args }), expect.objectContaining({ name: "ap_fail_material_draft_job", args: {
      p_job_id: id(1), p_lease_token: id(3), p_error_code: "PROVIDER_UNAVAILABLE" } })]);
  });
  it("blocks pre-aborted reads and sanitizes provider error details", async () => {
    const f = fixture(), controller = new AbortController(); controller.abort();
    await expect(f.services.workflow.readJob(id(1), controller.signal)).rejects.toThrow("ABORTED"); expect(f.calls).toEqual([]);
    f.overrides.set("ap_material_draft_jobs", [() => ({ data: f.job, error: { message: "PRIVATE_SQL_DETAIL" } })]);
    await expect(f.services.workflow.readJob(id(1), signal())).rejects.toThrow(/^DRAFT_WORKFLOW_UNCONFIRMED$/);
  });
  it("bounds ignored transport aborts and rejects a result returned after cancellation", async () => {
    vi.useFakeTimers(); const f = fixture(); f.overrides.set("ap_material_draft_jobs", [() => new Promise(() => undefined)]);
    const pending = f.services.workflow.readJob(id(1), signal()); const rejection = expect(pending).rejects.toThrow("ABORTED");
    await vi.advanceTimersByTimeAsync(20_001); await rejection; expect(f.calls[0].signal?.aborted).toBe(true);
    const controller = new AbortController(); f.overrides.set("ap_material_draft_jobs", [() => { controller.abort(); return { data: f.job, error: null }; }]);
    await expect(f.services.workflow.readJob(id(1), controller.signal)).rejects.toThrow("ABORTED");
  });
});

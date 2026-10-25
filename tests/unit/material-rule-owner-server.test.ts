import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/database.types";
import type { DraftingEvidencePacket } from "@/lib/documents/drafting-evidence";

vi.mock("server-only", () => ({}));
const dependency = vi.hoisted(() => ({ load: vi.fn(), store: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/documents/drafting-evidence-server", () => ({ loadDraftingEvidencePacket: dependency.load }));
vi.mock("@/lib/documents/draft-packet-worker", () => ({ storeEncryptedDraftPayload: dependency.store, readEncryptedDraftPayload: dependency.read }));
import { createMaterialRuleOwnerServer } from "@/lib/documents/material-rule-owner-server";

const id = (n: number) => `79000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const ordered = (value: unknown): unknown => Array.isArray(value) ? value.map(ordered) : value && typeof value === "object"
  ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, ordered(child)])) : value;
const past = "2026-10-25T10:00:00.000Z", fresh = "2026-10-25T11:55:00.000Z", due = "2026-10-26T12:00:00.000Z";
const now = new Date("2026-10-25T12:00:00.000Z");
type Call = { name: string; kind: "rpc" | "table"; args?: Record<string, unknown>; columns?: string; filters: Array<[string, unknown]>; limit?: number; signal?: AbortSignal };
type Result = { data: unknown; error: unknown };
type Row = Record<string, unknown>;

// These finite adapter tests inject the already-validated packet-loader port.
// Full intake/claim truth validation and real SQL locks have separate fixtures.
function database(staleRule = false) {
  const reviewerId = id(90), jobId = id(1), versionId = id(2);
  let clock = now, contextHash = "e".repeat(64), lostReview = false, lostRefresh = false, suppress = false;
  const job = { id: jobId, customer_id: id(3), material_line_id: id(4), line_revision_id: id(5), source_snapshot_id: id(6), state: "OWNER_EXCEPTION", active_version_id: versionId as string | null, lease_generation: 2 };
  const original = { id: versionId, job_id: jobId, customer_id: job.customer_id, material_line_id: job.material_line_id, version: 1, supersedes_id: null as string | null,
    packet_encrypted_payload_id: id(7), packet_sha256: "a".repeat(64), context_sha256: "b".repeat(64), invalidated_at: null as string | null, release_id: null as string | null };
  const revision = { id: id(5), line_id: id(4), source_snapshot_id: id(6), job_snapshot_id: id(8), employer_rule_snapshot_id: id(9), version: 1,
    binding_sha256: "c".repeat(64), due_at: due, superseded_at: null as string | null };
  const rule = { id: id(9), job_snapshot_id: id(8), content_sha256: "d".repeat(64), checked_at: staleRule ? past : fresh };
  const target = { id: id(8), content_sha256: "f".repeat(64) };
  const basis = { lineRevisionId: revision.id, sourceSnapshotId: revision.source_snapshot_id, jobSnapshotId: target.id,
    jobContentSha256: target.content_sha256, ruleId: rule.id, ruleSha256: rule.content_sha256, ruleRecordSha256: "1".repeat(64), sourceAuthoritySha256: "2".repeat(64) };
  const checklist = { applicationAccessReviewed: true as const, liveListingOpened: true as const, submissionInstructionsCompared: true as const, unchangedRuleConfirmed: true as const };
  const receipts = new Map<string, Row>(), versions = new Map<string, Row>([[versionId, original]]), bodies = new Map<string, string>(), buffers: Buffer[] = [];
  const expected = { customerId: job.customer_id, materialLineId: job.material_line_id, revisionId: revision.id, revisionVersion: revision.version, bindingSha256: revision.binding_sha256 };
  const packetBody = { schemaVersion: "applypack-drafting-evidence-v1", expected, binding: { snapshotId: job.source_snapshot_id, dueAt: revision.due_at }, validUntil: "2026-10-25T12:55:00.000Z", ownerEvidence: { marker: "Synthetic private packet" } };
  const packet = { ...packetBody, packetSha256: sha(JSON.stringify(ordered(packetBody))) } as unknown as DraftingEvidencePacket;
  const calls: Call[] = [], overrides = new Map<string, Array<(call: Call) => Result | Promise<Result>>>();
  function projection() {
    const receipt = [...receipts.values()].reverse().find((row) => row.job_id === jobId && JSON.stringify(row.basis) === JSON.stringify(basis)
      && Date.parse(String(row.checked_at)) <= clock.getTime() && Date.parse(String(row.checked_at)) > clock.getTime() - 3_600_000) ?? null;
    return { contractVersion: "applypack-material-rule-revalidation-v1", jobId, activeVersionId: job.active_version_id, leaseGeneration: job.lease_generation,
      basis, originalCheckedAt: rule.checked_at, effectiveCheckedAt: new Date(Math.max(Date.parse(rule.checked_at), receipt ? Date.parse(String(receipt.checked_at)) : -Infinity)).toISOString(), revalidation: receipt };
  }
  function executeRpc(call: Call): Result {
    const args = call.args!;
    if (call.name === "ap_require_material_reviewer") return { data: null, error: null };
    if (call.name === "ap_material_draft_rule_evidence") return { data: structuredClone(projection()), error: null };
    if (call.name === "ap_material_draft_context_sha256") return { data: contextHash, error: null };
    if (call.name === "ap_revalidate_material_draft_rule") {
      const receipt = { id: args.p_receipt_id, customer_id: job.customer_id, material_line_id: job.material_line_id, job_id: jobId,
        line_revision_id: job.line_revision_id, reviewed_version_id: args.p_expected_version_id, reviewed_lease_generation: job.lease_generation,
        review_method: "OWNER_REOPENED_PUBLIC_APPLICATION", basis: args.p_expected_basis, review_checklist: args.p_review_checklist,
        checked_by: args.p_reviewer_id, checked_at: clock.toISOString(), receipt_sha256: "3".repeat(64), created_at: clock.toISOString() };
      if (!suppress) { receipts.set(String(receipt.id), receipt); job.lease_generation++; job.state = job.active_version_id ? "OWNER_EXCEPTION" : "EVIDENCE_PENDING"; }
      if (lostReview) throw new Error("PRIVATE_PROVIDER_DETAIL");
      return { data: { receipt, replayed: false }, error: null };
    }
    if (call.name === "ap_refresh_material_draft_packet") {
      const next = { ...original, id: id(20), version: 2, supersedes_id: original.id, packet_encrypted_payload_id: args.p_payload_id,
        packet_sha256: args.p_packet_sha256, context_sha256: args.p_context_sha256, invalidated_at: null, release_id: null };
      if (!suppress) { original.invalidated_at = clock.toISOString(); versions.set(next.id, next); job.active_version_id = next.id; job.state = "READY"; job.lease_generation++; }
      if (lostRefresh) throw new Error("PRIVATE_PROVIDER_DETAIL");
      return { data: next.id, error: null };
    }
    throw new Error(`Unexpected synthetic RPC ${call.name}`);
  }
  function query(call: Call) {
    calls.push(call);
    async function run(single = false): Promise<Result> {
      const override = overrides.get(call.name)?.shift(); if (override) return override(call);
      if (call.kind === "rpc") return executeRpc(call);
      const table = call.name === "ap_material_draft_jobs" ? [job] : call.name === "ap_material_draft_versions" ? [...versions.values()]
        : call.name === "ap_material_line_revisions" ? [revision] : call.name === "ap_employer_submission_rules" ? [rule]
          : call.name === "ap_job_snapshots" ? [target] : call.name === "ap_material_rule_revalidations" ? [...receipts.values()] : [];
      const rows = (table as Row[]).filter((row) => call.filters.every(([key, value]) => row[key] === value)).slice(0, call.limit ?? Infinity)
        .map((row) => Object.fromEntries(call.columns!.split(",").map((key) => [key, row[key]])));
      return { data: structuredClone(single ? rows[0] ?? null : rows), error: null };
    }
    const builder = { select: (columns: string) => { call.columns = columns; return builder; }, eq: (key: string, value: unknown) => { call.filters.push([key, value]); return builder; },
      limit: (count: number) => { call.limit = count; return builder; }, abortSignal: (signal: AbortSignal) => { call.signal = signal; return builder; },
      single: () => run(true), maybeSingle: () => run(true), then: (resolve: (result: Result) => unknown, reject: (error: unknown) => unknown) => run().then(resolve, reject) };
    return builder;
  }
  const admin = { from: (name: string) => query({ kind: "table", name, filters: [] }), rpc: (name: string, args: Record<string, unknown>) => query({ kind: "rpc", name, args, filters: [] }) } as unknown as SupabaseClient<Database>;
  dependency.load.mockImplementation(async () => packet);
  dependency.store.mockImplementation(async (_admin, args) => { expect(sha(args.body)).toBe(args.sha256); bodies.set(args.payloadId, args.body); return { payloadId: args.payloadId, sha256: args.sha256 }; });
  dependency.read.mockImplementation(async (_admin, args) => { const body = bodies.get(args.payloadId); if (!body) throw new Error("PRIVATE_MISSING_PAYLOAD"); const bytes = Buffer.from(body); buffers.push(bytes); return bytes; });
  const services = createMaterialRuleOwnerServer(admin, reviewerId, { now: () => clock });
  const reviewRequest = () => ({ jobId, expectedVersionId: original.id as string | null, receiptId: id(10), expectedBasis: structuredClone(basis), checklist: structuredClone(checklist) });
  const refreshRequest = () => ({ jobId, expectedVersionId: original.id, expectedPacketSha256: original.packet_sha256, expectedContextSha256: "e".repeat(64), requestId: id(11) });
  const inspect = () => services.inspectRuleEvidence({ jobId }, new AbortController().signal);
  const review = (extra = {}) => services.revalidate({ ...reviewRequest(), ...extra }, new AbortController().signal);
  const refresh = (extra = {}) => services.refreshPacket({ ...refreshRequest(), ...extra }, new AbortController().signal);
  return { services, admin, reviewerId, job, original, revision, rule, target, basis, checklist, receipts, versions, bodies, buffers, packet, calls, overrides,
    reviewRequest, refreshRequest, inspect, review, refresh, projection, rpc: executeRpc, setClock: (value: Date) => { clock = value; },
    setContext: (value: string) => { contextHash = value; }, loseReview: () => { lostReview = true; }, loseRefresh: () => { lostRefresh = true; }, suppress: () => { suppress = true; } };
}
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe("owner rule revalidation and explicit packet refresh", () => {
  it("does not read on construction and rejects injected reviewer/payload fields", async () => {
    const f = database(); expect(f.calls).toEqual([]);
    await expect(f.review({ reviewerId: id(99) })).rejects.toThrow("INPUT_INVALID");
    await expect(f.refresh({ payloadId: id(99) })).rejects.toThrow("INPUT_INVALID"); expect(f.calls).toEqual([]);
  });
  it.each(["inspect", "review", "refresh"] as const)("authorizes before %s private access", async (action) => {
    const f = database(); f.overrides.set("ap_require_material_reviewer", [() => ({ data: null, error: { message: "private denial" } })]);
    await expect(f[action]()).rejects.toThrow("MATERIAL_RULE_OWNER_UNCONFIRMED"); expect(f.calls).toHaveLength(1);
    expect(dependency.load).not.toHaveBeenCalled(); expect(dependency.store).not.toHaveBeenCalled();
  });
  it("exposes the original expired rule basis without claiming a machine fetch or requiring fresh context", async () => {
    const f = database(true), result = await f.inspect();
    expect(result).toMatchObject({ ruleCurrent: false, contextSha256: null, evidence: { originalCheckedAt: past, effectiveCheckedAt: past, revalidation: null, basis: f.basis } });
    expect(f.calls.some((call) => call.name === "ap_material_draft_context_sha256")).toBe(false);
    expect(dependency.load).not.toHaveBeenCalled();
  });
  it("keeps fresh rule status separate from missing listing/packet context", async () => {
    const f = database(); f.overrides.set("ap_material_draft_context_sha256", [() => ({ data: null, error: {} })]);
    expect(await f.inspect()).toMatchObject({ ruleCurrent: true, contextSha256: null });
  });
  it.each(["basis", "rule", "target", "lease", "version", "revision"])("rejects mismatched inspection %s", async (mode) => {
    const f = database();
    f.overrides.set("ap_material_draft_rule_evidence", [() => { const projection = structuredClone(f.projection());
      if (mode === "basis") projection.basis.sourceSnapshotId = id(98);
      if (mode === "rule") projection.basis.ruleSha256 = "9".repeat(64);
      if (mode === "target") projection.basis.jobContentSha256 = "9".repeat(64);
      if (mode === "lease") projection.leaseGeneration++;
      if (mode === "version") projection.activeVersionId = id(98);
      if (mode === "revision") f.revision.source_snapshot_id = id(98);
      return { data: projection, error: null }; }]);
    await expect(f.inspect()).rejects.toThrow("MATERIAL_RULE_OWNER_");
  });
  it("records exact human review with only the authenticated reviewer and preserves original rule time", async () => {
    const f = database(true), result = await f.review();
    expect(result).toMatchObject({ recorded: true, replayed: false, current: true, packetRefreshRequired: true, deliveryAuthorized: false,
      receipt: { checked_by: f.reviewerId, review_method: "OWNER_REOPENED_PUBLIC_APPLICATION", checked_at: now.toISOString() } });
    expect(f.rule.checked_at).toBe(past);
    expect(f.calls.find((call) => call.name === "ap_revalidate_material_draft_rule")?.args).toEqual({ p_job_id: f.job.id,
      p_expected_version_id: f.original.id, p_receipt_id: id(10), p_expected_basis: f.basis, p_review_checklist: f.checklist, p_reviewer_id: f.reviewerId });
    expect(dependency.store).not.toHaveBeenCalled();
  });
  it("supports actual NULL only for the owner-confirmed initial job", async () => {
    const f = database(true); f.job.active_version_id = null; f.job.state = "EVIDENCE_PENDING";
    expect(await f.review({ expectedVersionId: null })).toMatchObject({ recorded: true, current: true, packetRefreshRequired: false });
    expect(f.calls.find((call) => call.name === "ap_revalidate_material_draft_rule")?.args?.p_expected_version_id).toBeNull();
  });
  it.each(["basis", "version", "checklist"])("blocks stale/incomplete review %s before mutation", async (mode) => {
    const f = database();
    const extra = mode === "basis" ? { expectedBasis: { ...f.basis, sourceAuthoritySha256: "9".repeat(64) } }
      : mode === "version" ? { expectedVersionId: id(98) } : { checklist: { ...f.checklist, unchangedRuleConfirmed: false } };
    await expect(f.review(extra)).rejects.toThrow("MATERIAL_RULE_OWNER_");
    expect(f.calls.some((call) => call.name === "ap_revalidate_material_draft_rule")).toBe(false);
  });
  it("reconciles one committed lost review response without a second review", async () => {
    const f = database(true); f.loseReview();
    expect(await f.review()).toMatchObject({ recorded: true, replayed: true, current: true });
    expect(f.calls.filter((call) => call.name === "ap_revalidate_material_draft_rule")).toHaveLength(1);
  });
  it("reconciles the immutable review after expiry without restoring freshness", async () => {
    const f = database(true); await f.review(); const checked = f.receipts.get(id(10))!.checked_at;
    f.setClock(new Date("2026-10-27T12:00:00.000Z"));
    expect(await f.review()).toMatchObject({ recorded: true, replayed: true, current: false, receipt: { checked_at: checked } });
    expect(f.calls.filter((call) => call.name === "ap_revalidate_material_draft_rule")).toHaveLength(1);
  });
  it("does not carry a reconciled human review onto a moved active document version", async () => {
    const f = database(true); await f.review(); f.job.active_version_id = id(98);
    expect(await f.review()).toMatchObject({ recorded: true, replayed: true, current: false });
    expect(f.calls.filter((call) => call.name === "ap_revalidate_material_draft_rule")).toHaveLength(1);
  });
  it.each(["reviewer", "basis", "version", "customer"])("rejects a conflicting existing review %s", async (mode) => {
    const f = database(); await f.review(); const receipt = f.receipts.get(id(10))!;
    if (mode === "reviewer") receipt.checked_by = id(98);
    if (mode === "basis") receipt.basis = { ...f.basis, sourceAuthoritySha256: "9".repeat(64) };
    if (mode === "version") receipt.reviewed_version_id = id(98);
    if (mode === "customer") receipt.customer_id = id(98);
    await expect(f.review()).rejects.toThrow("RECEIPT_CONFLICT");
  });
  it("does not invent a review receipt when the mutation did not commit", async () => {
    const f = database(); f.suppress(); f.loseReview();
    await expect(f.review()).rejects.toThrow("RESULT_UNKNOWN"); expect(f.receipts.size).toBe(0);
  });
  it("refreshes exact current evidence as a new encrypted packet and separate new version", async () => {
    const f = database(), result = await f.refresh();
    expect(result).toMatchObject({ recorded: true, current: true, replayed: false, priorVersionId: f.original.id,
      versionId: id(20), packetSha256: f.packet.packetSha256, contextSha256: "e".repeat(64), deliveryAuthorized: false });
    const call = f.calls.find((item) => item.name === "ap_refresh_material_draft_packet")!;
    expect(Object.keys(call.args!).sort()).toEqual(["p_context_sha256", "p_expected_version_id", "p_job_id", "p_packet_sha256", "p_payload_id", "p_reviewer_id"]);
    expect(call.args).toMatchObject({ p_expected_version_id: f.original.id, p_packet_sha256: f.packet.packetSha256, p_reviewer_id: f.reviewerId });
    expect(dependency.store.mock.calls[0][1]).toMatchObject({ customerId: f.job.customer_id, jobId: f.job.id, purpose: "MATERIAL_DRAFT_PACKET" });
    expect(f.buffers.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
    expect(f.calls.every((item) => item.signal instanceof AbortSignal && item.columns !== "*")).toBe(true);
    expect(f.calls.some((item) => /send|approve|begin_material|record_material_draft_result/.test(item.name))).toBe(false);
  });
  it.each(["context", "old packet", "customer", "active version", "deadline", "invalidated"])("rejects refresh with changed %s before encrypted writes", async (mode) => {
    const f = database();
    if (mode === "context") f.setContext("9".repeat(64));
    if (mode === "old packet") f.original.packet_sha256 = "9".repeat(64);
    if (mode === "customer") f.original.customer_id = id(98);
    if (mode === "active version") f.job.active_version_id = id(98);
    if (mode === "deadline") f.revision.due_at = now.toISOString();
    if (mode === "invalidated") f.original.invalidated_at = now.toISOString();
    await expect(f.refresh(mode === "old packet" ? { expectedPacketSha256: "a".repeat(64) } : {})).rejects.toThrow("MATERIAL_RULE_OWNER_");
    expect(dependency.store).not.toHaveBeenCalled();
  });
  it("rejects a packet returned for a different revision before storage", async () => {
    const f = database(); f.packet.expected.revisionId = id(98);
    await expect(f.refresh()).rejects.toThrow("PACKET_CHANGED"); expect(dependency.store).not.toHaveBeenCalled();
  });
  it("blocks source changes while building the packet", async () => {
    const f = database(); dependency.load.mockImplementationOnce(async () => { f.setContext("9".repeat(64)); return f.packet; });
    await expect(f.refresh()).rejects.toThrow("CONTEXT_CHANGED"); expect(dependency.store).not.toHaveBeenCalled();
  });
  it("preserves a persisted packet if the source changes before the refresh CAS", async () => {
    const f = database(); dependency.store.mockImplementationOnce(async (_admin, args) => { f.bodies.set(args.payloadId, args.body); f.setContext("9".repeat(64)); return { payloadId: args.payloadId, sha256: args.sha256 }; });
    await expect(f.refresh()).rejects.toThrow("CONTEXT_CHANGED"); expect(f.bodies.size).toBe(1);
    expect(f.calls.some((call) => call.name === "ap_refresh_material_draft_packet")).toBe(false);
  });
  it("does not mutate or retry after an unconfirmed packet store", async () => {
    const f = database(); dependency.store.mockRejectedValueOnce(new Error("PRIVATE_STORE_DETAIL"));
    await expect(f.refresh()).rejects.toThrow("MATERIAL_RULE_OWNER_UNCONFIRMED");
    expect(dependency.store).toHaveBeenCalledTimes(1); expect(f.calls.some((call) => call.name === "ap_refresh_material_draft_packet")).toBe(false);
  });
  it("preserves stored bytes and blocks refresh when the packet expires during encryption", async () => {
    const f = database(); dependency.store.mockImplementationOnce(async (_admin, args) => {
      f.bodies.set(args.payloadId, args.body); f.setClock(new Date(f.packet.validUntil)); return { payloadId: args.payloadId, sha256: args.sha256 };
    });
    await expect(f.refresh()).rejects.toThrow("PACKET_EXPIRED"); expect(f.bodies.size).toBe(1);
    expect(f.calls.some((call) => call.name === "ap_refresh_material_draft_packet")).toBe(false);
  });
  it("reconciles committed refresh response loss by exact successor identity", async () => {
    const f = database(); f.loseRefresh(); expect(await f.refresh()).toMatchObject({ recorded: true, replayed: true, current: true });
    expect(f.calls.filter((call) => call.name === "ap_refresh_material_draft_packet")).toHaveLength(1);
    expect(await f.refresh()).toMatchObject({ recorded: true, replayed: true, versionId: id(20) });
    expect(dependency.store).toHaveBeenCalledTimes(1); expect(f.calls.filter((call) => call.name === "ap_refresh_material_draft_packet")).toHaveLength(1);
  });
  it.each(["expired", "moved", "context", "corrupt packet"])("reports recorded refresh but current=false after %s", async (mode) => {
    const f = database(); await f.refresh();
    if (mode === "expired") f.setClock(new Date("2026-10-27T12:00:00.000Z"));
    if (mode === "moved") f.job.active_version_id = id(98);
    if (mode === "context") f.setContext("9".repeat(64));
    if (mode === "corrupt packet") f.bodies.set(String(f.versions.get(id(20))!.packet_encrypted_payload_id), "{}");
    expect(await f.refresh()).toMatchObject({ recorded: true, replayed: true, current: false, deliveryAuthorized: false });
    expect(dependency.store).toHaveBeenCalledTimes(1); expect(f.calls.filter((call) => call.name === "ap_refresh_material_draft_packet")).toHaveLength(1);
    expect(f.buffers.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
  });
  it("does not report a successful refresh without a committed successor", async () => {
    const f = database(); f.suppress(); await expect(f.refresh()).rejects.toThrow("RESULT_UNKNOWN"); expect(f.bodies.size).toBe(1);
  });
  it("preserves the packet when the database rejects an unresolved provider attempt", async () => {
    const f = database(); f.overrides.set("ap_refresh_material_draft_packet", [() => ({ data: null, error: { message: "material_draft_result_unresolved" } })]);
    await expect(f.refresh()).rejects.toThrow("RESULT_UNKNOWN"); expect(f.bodies.size).toBe(1); expect(f.versions.size).toBe(1);
    expect(f.calls.filter((call) => call.name === "ap_refresh_material_draft_packet")).toHaveLength(1);
  });
  it("does not accept a different reported version even if another exact successor exists", async () => {
    const f = database(); f.overrides.set("ap_refresh_material_draft_packet", [(call) => { f.rpc(call); return { data: id(98), error: null }; }]);
    await expect(f.refresh()).rejects.toThrow("RESULT_UNKNOWN");
  });
  it("rejects a conflicting refresh request context and never makes a second replacement", async () => {
    const f = database(); await f.refresh(); await expect(f.refresh({ expectedContextSha256: "9".repeat(64) })).rejects.toThrow("REFRESH_CONFLICT");
    expect(f.calls.filter((call) => call.name === "ap_refresh_material_draft_packet")).toHaveLength(1);
  });
  it("rejects a different request ID after the original version was invalidated", async () => {
    const f = database(); await f.refresh(); await expect(f.refresh({ requestId: id(98) })).rejects.toThrow("VERSION_STALE");
    expect(dependency.store).toHaveBeenCalledTimes(1);
  });
  it("bounds hung private reads and does not continue to a mutation after cancellation", async () => {
    vi.useFakeTimers(); const f = database(); f.overrides.set("ap_material_draft_jobs", [() => new Promise(() => undefined)]);
    const pending = f.inspect(); const check = expect(pending).rejects.toThrow("ABORTED"); await vi.advanceTimersByTimeAsync(60_001); await check;
    expect(dependency.store).not.toHaveBeenCalled(); expect(f.calls.some((call) => call.name === "ap_revalidate_material_draft_rule")).toBe(false);
  });
  it("rejects a preaborted request without database access", async () => {
    const f = database(), abort = new AbortController(); abort.abort();
    await expect(f.services.refreshPacket(f.refreshRequest(), abort.signal)).rejects.toThrow("ABORTED"); expect(f.calls).toEqual([]);
  });
  it("clears late decrypted bytes after a canceled completion read without repeating the refresh", async () => {
    const f = database(); await f.refresh(); const bytes = Buffer.from(f.bodies.values().next().value!);
    let finish: (value: Buffer) => void = () => undefined;
    dependency.read.mockImplementationOnce(() => new Promise<Buffer>((resolve) => { finish = resolve; }));
    const abort = new AbortController(), pending = f.services.refreshPacket(f.refreshRequest(), abort.signal);
    const rejected = expect(pending).rejects.toThrow("ABORTED");
    await vi.waitFor(() => expect(dependency.read).toHaveBeenCalledTimes(2)); abort.abort(); await rejected;
    finish(bytes); await vi.waitFor(() => expect(bytes.every((byte) => byte === 0)).toBe(true));
    expect(f.calls.filter((call) => call.name === "ap_refresh_material_draft_packet")).toHaveLength(1);
  });
});

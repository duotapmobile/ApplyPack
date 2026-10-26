import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
vi.mock("server-only", () => ({}));
const payload = vi.hoisted(() => ({ store: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/materials/service-error-payload", async (original) => ({ ...await original<typeof import("@/lib/materials/service-error-payload")>(),
  storeServiceErrorPayload: payload.store, readServiceErrorPayload: payload.read }));
import { createCustomerRepairFollowups, createOwnerRepairFollowups, type RepairCaseStatePort } from "@/lib/materials/service-repair-followup-server";
import { repairFeedbackBody, repairFollowupCanonicalJson } from "@/lib/materials/service-repair-followup";
const id = (n: number) => `a1020000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const signal = () => new AbortController().signal;
function fixture() {
  const customerId = id(1), reviewerId = id(2), lineId = id(3), caseId = id(4), releaseId = id(5), at = "2026-10-26T12:00:00Z";
  const file = { artifactId: id(6), originalFileVersionId: id(7), fileVersionId: id(8), artifactType: "RESUME", safeFilename: "Example_Resume.pdf",
    checksumSha256: "a".repeat(64), releaseId, deliveredAt: at, accessExpiresAt: "2026-11-25T12:00:00Z" };
  const request = { requestId: id(9), caseId, materialLineId: lineId, releaseId, items: [{ artifactId: file.artifactId,
    fileVersionId: file.fileVersionId, concern: "The name still differs from my confirmed spelling." }], sameAcceptedIssue: true };
  const tables: Record<string, Record<string, unknown>[]> = {
    ap_material_lines: [{ id: lineId, purchase_id: id(10) }],
    ap_material_purchases: [{ id: id(10), customer_id: customerId, checkout_intent_id: id(11) }],
    ap_material_checkout_intents: [{ id: id(11), purchase_id: id(10), customer_id: customerId, source_snapshot_id: id(12) }],
    ap_snapshot_legal_acceptances: [{ snapshot_id: id(12), terms_version: "manual-launch-terms-2026-10-25-v4", privacy_version: "privacy-2026-10-25-v4" }],
    ap_service_error_contracts: [{ material_line_id: lineId, customer_id: customerId, purchase_id: id(10), source_snapshot_id: id(12),
      legal_receipt_id: id(13), intake_review_id: id(14), intake_review_sha256: "b".repeat(64), contract_version: "service-error-only-v1",
      terms_version: "manual-launch-terms-2026-10-25-v4", terms_content_sha256: "c".repeat(64), privacy_version: "privacy-2026-10-25-v4",
      privacy_content_sha256: "d".repeat(64), confirmed_intake_version: "applypack-confirmed-intake-v1", reporting_time_zone: "America/New_York", bound_at: at }],
    ap_service_repair_releases: [{ id: releaseId, case_id: caseId, customer_id: customerId, material_line_id: lineId, repair_version_id: id(15), committed_at: at, access_expires_at: file.accessExpiresAt }],
    ap_service_repair_files: [{ id: file.fileVersionId, customer_id: customerId, material_line_id: lineId, repair_version_id: id(15), artifact_id: file.artifactId,
      original_file_version_id: file.originalFileVersionId, artifact_type: file.artifactType, checksum_sha256: file.checksumSha256 }],
    ap_service_error_reports: [{ id: caseId, customer_id: customerId }], ap_service_repair_feedback: [], ap_service_repair_case_events: [],
    ap_generated_file_versions: [{ id: file.originalFileVersionId, artifact_id: file.artifactId, version: 1, superseded_at: null }],
    ap_generated_artifacts: [{ id: file.artifactId, customer_id: customerId, material_line_id: lineId, artifact_type: file.artifactType, current_file_version: 1 }],
  };
  let reviewer: unknown = true, loseResponse = false, persist = true, now = new Date(at), afterStore: (() => void) | undefined;
  const readCalls: string[] = [], storedBuffers: Uint8Array[] = [], decryptedBuffers: Buffer[] = [];
  const from = vi.fn((table: string) => {
    let columns = "*", one = false; const filters: [string, unknown][] = [];
    const query = { select: (text: string) => { columns = text; return query; }, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      single: () => { one = true; return query; }, maybeSingle: () => { one = true; return query; }, abortSignal: () => query,
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(() => {
        readCalls.push(table); const values = (tables[table] ?? []).filter((row) => filters.every(([key, value]) => row[key] === value))
          .map((row) => columns === "*" ? structuredClone(row) : Object.fromEntries(columns.split(",").map((key) => [key, row[key]])));
        return { data: one ? values[0] ?? null : values, error: null };
      }).then(resolve, reject) }; return query;
  });
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => ({ abortSignal: async () => {
    if (name === "ap_require_material_reviewer") return { data: reviewer, error: null };
    if (name === "ap_customer_service_repair_files") return { data: structuredClone([file]), error: null };
    if (name !== "ap_record_service_repair_feedback") throw new Error("Unexpected RPC");
    if (persist) tables.ap_service_repair_feedback.push({ id: args.p_request_id, case_id: args.p_case_id, customer_id: args.p_customer_id,
      material_line_id: lineId, repair_release_id: args.p_release_id, sensitive_payload_id: args.p_payload_id,
      content_sha256: args.p_content_sha256, members: args.p_members, created_at: at });
    if (loseResponse) throw new Error("lost response"); return { data: args.p_request_id, error: null };
  } }));
  const admin = { from, rpc } as unknown as SupabaseClient<Database>;
  const review = { schemaVersion: "applypack-service-repair-case-review-v1", caseId, customerId, materialLineId: lineId,
    acceptedScopeSha256: "e".repeat(64), reviewContextSha256: "f".repeat(64), state: "OPEN", canResolve: true,
    members: [{ materialLineId: lineId, sourceSnapshotId: id(12), artifactId: file.artifactId, fileVersionId: file.originalFileVersionId,
      releaseId: id(16), artifactType: file.artifactType, completed: true }], feedback: tables.ap_service_repair_feedback, events: tables.ap_service_repair_case_events };
  const stateRequest = { requestId: id(17), caseId, acceptedScopeSha256: review.acceptedScopeSha256, expectedReviewContextSha256: review.reviewContextSha256,
    action: "RESOLVED", explanation: "All accepted affected files and recent feedback were checked.", reviewedRepairFiles: true, reviewedFeedback: true };
  const port = { review: vi.fn(async () => structuredClone(review)), set: vi.fn(async (input) => {
    if (input.expectedReviewContextSha256 !== review.reviewContextSha256) return { data: null, error: { message: "service_repair_case_review_changed" } };
    if (persist) tables.ap_service_repair_case_events.push({ id: input.requestId, case_id: input.caseId, customer_id: customerId, material_line_id: lineId,
      kind: input.resolved ? "RESOLVED" : "REOPENED", accepted_scope_sha256: input.scopeSha256, sensitive_payload_id: input.payloadId,
      content_sha256: input.contentSha256, reviewer_id: input.reviewerId, created_at: at });
    if (loseResponse) throw new Error("lost response"); return { data: input.requestId, error: null };
  }) } satisfies RepairCaseStatePort;
  payload.store.mockImplementation(async (_admin, input, bytes) => { storedBuffers.push(bytes); afterStore?.(); return { payloadId: input.payloadId, sha256: input.sha256 }; });
  payload.read.mockImplementation(async () => { const bytes = Buffer.from(repairFollowupCanonicalJson(repairFeedbackBody(request))); decryptedBuffers.push(bytes); return bytes; });
  return { customerId, reviewerId, lineId, caseId, file, request, tables, rpc, from, port, review, stateRequest, readCalls, storedBuffers, decryptedBuffers,
    role: (value: unknown) => { reviewer = value; }, lose: () => { loseResponse = true; }, absent: () => { persist = false; },
    clock: (value: string) => { now = new Date(value); }, after: (fn: () => void) => { afterStore = fn; },
    customer: createCustomerRepairFollowups(admin, customerId, () => now), owner: createOwnerRepairFollowups(admin, reviewerId, port) };
}
beforeEach(() => vi.clearAllMocks());
describe("authenticated repair follow-ups", () => {
  it("does no I/O while constructing customer and owner adapters", () => { const f = fixture(); expect(f.rpc).not.toHaveBeenCalled(); expect(f.from).not.toHaveBeenCalled(); });
  it("returns only real current repaired-file identities for the exact customer line", async () => {
    const f = fixture(); expect(await f.customer.context(f.lineId, signal())).toEqual({ materialLineId: f.lineId, files: [{ ...f.file, caseId: f.caseId }] });
    expect(payload.read).not.toHaveBeenCalled(); expect(f.rpc.mock.calls.every(([name]) => name === "ap_customer_service_repair_files")).toBe(true);
  });
  it.each(["customer_id", "material_line_id", "repair_version_id", "artifact_id"])("refuses mismatched repaired-file %s", async (field) => {
    const f = fixture(); f.tables.ap_service_repair_files[0][field] = id(99); await expect(f.customer.context(f.lineId, signal())).rejects.toThrow("FOLLOWUP_UNAVAILABLE");
  });
  it("preserves historical policy rather than enabling new feedback", async () => {
    const f = fixture(); f.tables.ap_material_purchases[0].checkout_intent_id = null;
    await expect(f.customer.report(f.request, signal())).rejects.toThrow("HISTORICAL_FLOW_REQUIRED"); expect(payload.store).not.toHaveBeenCalled();
  });
  it("does not offer feedback on expired or not-yet-delivered repairs", async () => {
    const f = fixture(); f.clock("2026-12-01T12:00:00Z"); expect((await f.customer.context(f.lineId, signal())).files).toEqual([]);
    await expect(f.customer.report(f.request, signal())).rejects.toThrow("DELIVERY_MISMATCH"); expect(payload.store).not.toHaveBeenCalled();
  });
  it("does not present a repair superseded by a later ordinary artifact version", async () => {
    const f = fixture(); f.tables.ap_generated_file_versions[0].superseded_at = "2026-10-26T13:00:00Z";
    f.tables.ap_generated_artifacts[0].current_file_version = 2;
    expect((await f.customer.context(f.lineId, signal())).files).toEqual([]);
    await expect(f.customer.report(f.request, signal())).rejects.toThrow("DELIVERY_MISMATCH");
  });
  it("encrypts the purpose-bound feedback, then reconciles exact lost response without another mutation", async () => {
    const f = fixture(); f.lose(); const result = await f.customer.report(f.request, signal());
    expect(result.status).toBe("RECORDED"); expect(result.receipt.members).toEqual(f.request.items.map(({ artifactId, fileVersionId }) => ({ artifactId, fileVersionId })));
    expect(payload.store.mock.calls[0][1]).toMatchObject({ purpose: "SERVICE_REPAIR_FEEDBACK", customerId: f.customerId, materialLineId: f.lineId });
    expect(f.storedBuffers.every((bytes) => bytes.every((value) => value === 0))).toBe(true);
    expect((await f.customer.report(f.request, signal())).replayed).toBe(true); expect(payload.store).toHaveBeenCalledOnce();
    expect(f.rpc.mock.calls.filter(([name]) => name === "ap_record_service_repair_feedback")).toHaveLength(1);
  });
  it("does not infer success from a mutation UUID when the immutable receipt is missing", async () => {
    const f = fixture(); f.absent(); await expect(f.customer.report(f.request, signal())).rejects.toThrow("FOLLOWUP_RESULT_UNKNOWN");
    expect(f.rpc.mock.calls.filter(([name]) => name === "ap_record_service_repair_feedback")).toHaveLength(1);
  });
  it("refuses changed wording on the same request ID without another encryption or write", async () => {
    const f = fixture(); await f.customer.report(f.request, signal());
    await expect(f.customer.report({ ...f.request, items: [{ ...f.request.items[0], concern: "A different concern with this request ID." }] }, signal())).rejects.toThrow("FOLLOWUP_IDENTITY_CONFLICT");
    expect(payload.store).toHaveBeenCalledOnce();
  });
  it.each([false, null, {}, "true"])("requires literal reviewer true before owner evidence (%j)", async (value) => {
    const f = fixture(); f.role(value); await expect(f.owner.review(f.caseId, signal())).rejects.toThrow("REVIEWER_UNCONFIRMED"); expect(f.port.review).not.toHaveBeenCalled();
  });
  it("blocks closing incomplete accepted obligations before persisting an owner note", async () => {
    const f = fixture(); f.review.canResolve = false; await expect(f.owner.set(f.stateRequest, signal())).rejects.toThrow("ACCEPTED_REPAIR_UNFINISHED");
    expect(payload.store).not.toHaveBeenCalled(); expect(f.port.set).not.toHaveBeenCalled();
  });
  it("preserves a close result across response loss and stale-context replay", async () => {
    const f = fixture(); f.lose(); expect((await f.owner.set(f.stateRequest, signal())).status).toBe("RECORDED");
    f.review.reviewContextSha256 = "0".repeat(64);
    expect((await f.owner.set(f.stateRequest, signal())).replayed).toBe(true); expect(f.port.set).toHaveBeenCalledOnce(); expect(payload.store).toHaveBeenCalledOnce();
  });
  it("passes exact review CAS and never retries when feedback changes during encryption", async () => {
    const f = fixture(); f.after(() => { f.review.reviewContextSha256 = "0".repeat(64); });
    await expect(f.owner.set(f.stateRequest, signal())).rejects.toThrow("CASE_CHANGED"); expect(f.port.set).toHaveBeenCalledOnce();
    expect(f.port.set.mock.calls[0][0]).toMatchObject({ expectedReviewContextSha256: "f".repeat(64), resolved: true, reviewerId: f.reviewerId });
    expect(f.tables.ap_service_repair_case_events).toHaveLength(0);
  });
  it("loads only a requested private feedback body then clears it and rereads review/role", async () => {
    const f = fixture(); await f.customer.report(f.request, signal()); const result = await f.owner.feedback(f.caseId, f.request.requestId, signal());
    expect(result.request).toEqual(f.request); expect(f.port.review).toHaveBeenCalledTimes(2);
    expect(f.decryptedBuffers.every((bytes) => bytes.every((value) => value === 0))).toBe(true);
  });
  it("rejects reviewer revocation during decrypt without returning private feedback", async () => {
    const f = fixture(); await f.customer.report(f.request, signal()); payload.read.mockImplementationOnce(async () => {
      f.role(false); const bytes = Buffer.from(repairFollowupCanonicalJson(repairFeedbackBody(f.request))); f.decryptedBuffers.push(bytes); return bytes;
    });
    await expect(f.owner.feedback(f.caseId, f.request.requestId, signal())).rejects.toThrow("REVIEWER_UNCONFIRMED");
    expect(f.decryptedBuffers[0].every((value) => value === 0)).toBe(true);
  });
  it("does not return another customer's receipt", async () => {
    const f = fixture(); await f.customer.report(f.request, signal()); f.tables.ap_service_repair_feedback[0].customer_id = id(99);
    expect(await f.customer.receipt(f.lineId, f.request.requestId, signal())).toBeNull();
  });
});

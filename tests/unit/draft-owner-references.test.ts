import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { draftReferenceFixture } from "../fixtures/draft-reference";
import { draftFixtureNow } from "../fixtures/draft-document";
import { buildDraftingEvidencePacket, serializeDraftingEvidencePacket } from "@/lib/documents/drafting-evidence";
import { bindDraftReferenceMetadata } from "@/lib/documents/drafting-evidence-references";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ decrypt: vi.fn() }));
vi.mock("@/lib/security/remote-kms", () => ({ remoteKmsAdapter: () => ({}) }));
vi.mock("@/lib/security/sensitive-payload", () => ({ decryptSensitivePayload: mocks.decrypt,
  sensitivePayloadConfiguration: () => ({ enabled: true }), sensitivePayloadEncryptionReady: () => true }));
import { draftReferenceRequest, readConfirmedDraftReferences, readServiceRepairReferences, readServiceRepairReviewReferences } from "@/lib/documents/draft-owner-references";
import { bindServiceRepairRenderSource, readServiceRepairSourceForReview, type ServiceRepairBoundMember } from "@/lib/documents/service-repair-source";
import { repairFixtureNow, serviceRepairRenderFixture } from "../fixtures/service-repair-render";
const other = "79000000-0000-4000-8000-000000009999";
type Call = { table: string; columns: string; signal?: AbortSignal; single: boolean; predicates: ((row: Record<string, unknown>) => boolean)[]; limit: number };
function database(count: 1 | 2 | 3 = 1) {
  const f = draftReferenceFixture(count), metadata = structuredClone(f.r.referenceMetadata!);
  const tables: Record<string, Record<string, unknown>[]> = {
    ap_material_lines: [structuredClone(f.r.line)], ap_material_line_revisions: [structuredClone(f.r.revision)],
    ap_material_purchases: [structuredClone(f.r.purchase)], ap_material_checkout_intents: [structuredClone(f.r.intent)],
    ap_material_checkout_items: [structuredClone(f.r.item)], ap_material_checkout_references: f.r.referencePermissionIds.map((reference_permission_id) => ({ checkout_item_id: f.r.item.id, reference_permission_id })),
    ap_reference_permissions: metadata.permissions, ap_reference_record_versions: metadata.versions, ap_reference_records: metadata.records,
    ap_sensitive_payloads: metadata.payloads.map((row) => ({ ...row, encryption_algorithm: "AES-256-GCM", ciphertext: "\\x01", encrypted_data_key: "\\x02",
      nonce: "\\x" + "03".repeat(12), authentication_tag: "\\x" + "04".repeat(16), kms_key_identity: "fixture-key", kms_key_version: "1" })),
  };
  const calls: Call[] = [], buffers: Buffer[] = [], overrides = new Map<string, () => Promise<unknown>>();
  const from = (table: string) => {
    const call: Call = { table, columns: "", single: false, predicates: [], limit: Infinity };
    const query = { select: (columns: string) => { call.columns = columns; return query; },
      eq: (key: string, value: unknown) => { call.predicates.push((row) => row[key] === value); return query; },
      in: (key: string, values: unknown[]) => { call.predicates.push((row) => values.includes(row[key])); return query; },
      limit: (limit: number) => { call.limit = limit; return query; }, single: () => { call.single = true; return query; },
      abortSignal: (signal: AbortSignal) => { call.signal = signal; return query; },
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve().then(async () => {
        calls.push(call); if (overrides.has(table)) return overrides.get(table)!();
        const rows = tables[table].filter((row) => call.predicates.every((predicate) => predicate(row))).slice(0, call.limit)
          .map((row) => Object.fromEntries(call.columns.split(",").map((key) => [key, row[key]])));
        return { data: structuredClone(call.single ? rows[0] ?? null : rows), error: null };
      }).then(resolve, reject) }; return query;
  };
  mocks.decrypt.mockImplementation(async ({ context }) => { const bytes = Buffer.from(f.references.find((entry) => entry.payloadId === context.payloadId)!.plaintext); buffers.push(bytes); return bytes; });
  const admin = { from } as unknown as SupabaseClient<Database>, request = draftReferenceRequest(f.input.packet)!;
  const read = (signal = new AbortController().signal) => readConfirmedDraftReferences(admin, request, signal, { now: () => draftFixtureNow });
  return { f, tables, calls, buffers, overrides, admin, request, read };
}
beforeEach(() => vi.clearAllMocks()); afterEach(() => vi.useRealTimers());
function repairReferenceMember() {
  const f = serviceRepairRenderFixture("SOURCE_PRESERVING_RERENDER"); f.original.artifactType = "REFERENCE_SHEET";
  f.inspection.version.claim_review_metadata = [{ originalFileVersionId: f.original.fileVersionId, renderSourceSha256: f.prior.renderSourceSha256,
    claims: f.prior.ownerReviewClaims.filter((claim) => claim.placement.startsWith("referenceSheet.")).map((claim) => ({
      claimId: claim.claimId, placement: claim.placement, wordingSha256: claim.wordingSha256, decision: "APPROVED", kind: claim.kind,
      qualification: claim.qualification, factRefs: claim.factRefs, jobEvidenceIds: claim.jobEvidenceIds, referencePermissionIds: claim.referencePermissionIds,
      ...(claim.kind === "REFERENCE_PERMISSION" ? { referenceBinding: claim.referenceBinding } : {}),
    })) }];
  return bindServiceRepairRenderSource({ ...f.identity, inspection: f.inspection, ...f.evidence() }, repairFixtureNow).members[0];
}
describe("099 historical selected reference scope", () => {
  it("reads current reference consent with review-only authority without granting render authority", async () => {
    const d = database(3), f = serviceRepairRenderFixture("SOURCE_PRESERVING_RERENDER"); f.original.artifactType = "REFERENCE_SHEET";
    Object.assign(f.inspection.version, { claim_review_encrypted_payload_id: null, claim_review_sha256: null,
      claim_review_metadata: null, claims_reviewed_by: null, claims_reviewed_at: null });
    const member = readServiceRepairSourceForReview({ ...f.identity, inspection: f.inspection, ...f.evidence() }, repairFixtureNow).members[0];
    await expect(readServiceRepairReferences(d.admin, member as unknown as ServiceRepairBoundMember, new AbortController().signal)).rejects.toThrow("MEMBER_UNBOUND");
    await expect(readServiceRepairReviewReferences(d.admin, structuredClone(member), new AbortController().signal)).rejects.toThrow("REVIEW_MEMBER_UNBOUND");
    const values = await readServiceRepairReviewReferences(d.admin, member, new AbortController().signal, { now: () => repairFixtureNow });
    expect(values).toHaveLength(3); values.forEach(value => value.plaintext.fill(0));
    d.tables.ap_reference_permissions[0].revoked_at = repairFixtureNow.toISOString(); mocks.decrypt.mockClear();
    await expect(readServiceRepairReviewReferences(d.admin, member, new AbortController().signal, { now: () => repairFixtureNow })).rejects.toThrow();
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });
  it("keeps ordinary expired paid scope closed while a genuinely bound repair reads exact still-consented references", async () => {
    const d = database(3), member = repairReferenceMember();
    await expect(readConfirmedDraftReferences(d.admin, d.request, new AbortController().signal, { now: () => repairFixtureNow })).rejects.toThrow("SCOPE_MISMATCH");
    expect(mocks.decrypt).not.toHaveBeenCalled(); d.calls.length = 0;
    const values = await readServiceRepairReferences(d.admin, member, new AbortController().signal, { now: () => repairFixtureNow });
    expect(values.map((row) => row.permissionId)).toEqual(d.request.bindings.map((row) => row.permissionId));
    expect(d.calls.some((call) => call.table.startsWith("ap_material_"))).toBe(false);
    expect(d.calls.filter((call) => call.table === "ap_reference_permissions")).toHaveLength(2);
    values.forEach((value) => value.plaintext.fill(0));
  });
  it("does not permit a cloned authority or an unaffected cover letter to decrypt references", async () => {
    const d = database(3), member = repairReferenceMember();
    await expect(readServiceRepairReferences(d.admin, structuredClone(member), new AbortController().signal)).rejects.toThrow("MEMBER_UNBOUND");
    const f = serviceRepairRenderFixture("SOURCE_PRESERVING_RERENDER"), letter = bindServiceRepairRenderSource({ ...f.identity, inspection: f.inspection, ...f.evidence() }, repairFixtureNow).members[0];
    await expect(readServiceRepairReferences(d.admin, letter, new AbortController().signal)).rejects.toThrow("REPAIR_SCOPE_INVALID");
    expect(d.calls).toHaveLength(0); expect(mocks.decrypt).not.toHaveBeenCalled();
  });
  it("still denies revoked permission and a replaced reference version before decrypt", async () => {
    for (const table of ["ap_reference_permissions", "ap_reference_records"]) {
      const d = database(3), member = repairReferenceMember();
      d.tables[table][0][table === "ap_reference_permissions" ? "revoked_at" : "current_version"] = table === "ap_reference_permissions" ? repairFixtureNow.toISOString() : 2;
      await expect(readServiceRepairReferences(d.admin, member, new AbortController().signal, { now: () => repairFixtureNow })).rejects.toThrow();
    }
    expect(mocks.decrypt).not.toHaveBeenCalled();
  });
  it("clears all plaintext when repair consent changes during KMS", async () => {
    const d = database(3), member = repairReferenceMember(); let finish!: (bytes: Buffer) => void;
    mocks.decrypt.mockImplementationOnce(() => new Promise<Buffer>((resolve) => { finish = resolve; }));
    const pending = readServiceRepairReferences(d.admin, member, new AbortController().signal, { now: () => repairFixtureNow });
    await vi.waitFor(() => expect(mocks.decrypt).toHaveBeenCalledOnce()); d.tables.ap_reference_permissions[0].revoked_at = repairFixtureNow.toISOString();
    const first = Buffer.from(d.f.references[0].plaintext); finish(first);
    await expect(pending).rejects.toThrow("DRAFT_OWNER_REFERENCES_INVALID"); expect(first.every((value) => value === 0)).toBe(true);
    expect(d.buffers.every((bytes) => bytes.every((value) => value === 0))).toBe(true);
  });
});
describe("private reference records for the exact paid draft", () => {
  it.each([1, 2, 3] as const)("reads exactly %s selected references with current consent and purpose-bound encryption", async (count) => {
    const d = database(count), records = await d.read();
    expect(records.map((row) => row.permissionId)).toEqual(d.request.bindings.map((row) => row.permissionId));
    expect(mocks.decrypt.mock.calls.map(([input]) => input.context)).toEqual(d.request.bindings.map((binding) => ({ customerId: d.request.customerId, payloadId: binding.payloadId, purpose: "REFERENCE_RECORD" })));
    expect(d.calls.every((call) => call.signal instanceof AbortSignal)).toBe(true);
    expect(d.calls.filter((call) => call.table === "ap_reference_permissions")).toHaveLength(2);
    expect(records[0].plaintext.some((byte) => byte !== 0)).toBe(true); records.forEach((row) => row.plaintext.fill(0));
    expect(d.buffers.every((bytes) => bytes.every((byte) => byte === 0))).toBe(true);
  });
  it("uses an exact current revision override instead of falling back to an old checkout selection", async () => {
    const d = database(); d.tables.ap_material_line_revisions[0].reference_scope = { selected: true, permissionIds: d.request.bindings.map((row) => row.permissionId) };
    d.tables.ap_material_checkout_references[0].reference_permission_id = other;
    const records = await d.read(); records.forEach((row) => row.plaintext.fill(0));
    expect(d.calls.some((call) => call.table === "ap_material_checkout_references")).toBe(false);
  });
  it.each([
    ["foreign customer", "ap_reference_records", "customer_id", other], ["replaced version", "ap_reference_records", "current_version", 2],
    ["removed record", "ap_reference_records", "removed_at", draftFixtureNow.toISOString()], ["retired record", "ap_reference_records", "retention_state", "DELETED"],
    ["revoked permission", "ap_reference_permissions", "revoked_at", draftFixtureNow.toISOString()], ["changed contact", "ap_reference_permissions", "contact_version_changed_at", draftFixtureNow.toISOString()],
    ["foreign job", "ap_reference_permissions", "job_snapshot_id", other], ["foreign release", "ap_reference_permissions", "delivered_release_id", other],
    ["unconfirmed version", "ap_reference_record_versions", "permission_status", "UNCONFIRMED"], ["superseded version", "ap_reference_record_versions", "superseded_at", draftFixtureNow.toISOString()],
    ["future consent", "ap_reference_record_versions", "permission_last_confirmed_at", "2099-10-25T12:00:00Z"],
    ["wrong payload hash", "ap_sensitive_payloads", "content_sha256", "0".repeat(64)], ["foreign payload", "ap_sensitive_payloads", "customer_id", other],
    ["unselected scope", "ap_material_lines", "selected_reference_sheet", false], ["superseded revision", "ap_material_lines", "active_revision", 2],
    ["expired deadline", "ap_material_line_revisions", "due_at", draftFixtureNow.toISOString()], ["unpaid intent", "ap_material_checkout_intents", "state", "OPEN"],
  ])("rejects %s before decrypting", async (_name, table, key, value) => {
    const d = database(); d.tables[String(table)][0][String(key)] = value;
    await expect(d.read()).rejects.toThrow(/^DRAFT_OWNER_REFERENCES_/); expect(mocks.decrypt).not.toHaveBeenCalled();
  });
  it("rejects duplicate or extra bindings and changed checkout scope", async () => {
    const d = database(); d.request.bindings.push({ ...d.request.bindings[0] });
    await expect(d.read()).rejects.toThrow("INVALID"); expect(d.calls).toEqual([]);
    d.request.bindings.pop(); d.tables.ap_material_checkout_references.push({ ...d.tables.ap_material_checkout_references[0], reference_permission_id: other });
    await expect(d.read()).rejects.toThrow("SCOPE_MISMATCH"); expect(mocks.decrypt).not.toHaveBeenCalled();
  });
  it.each(["ap_reference_permissions", "ap_reference_record_versions", "ap_reference_records", "ap_sensitive_payloads", "ap_material_line_revisions"])("rejects %s changed while KMS is pending and clears plaintext", async (table) => {
    const d = database(); let finish!: (bytes: Buffer) => void;
    mocks.decrypt.mockImplementationOnce(() => new Promise<Buffer>((resolve) => { finish = resolve; }));
    const pending = d.read(); await vi.waitFor(() => expect(mocks.decrypt).toHaveBeenCalledOnce());
    const field = table === "ap_reference_permissions" ? "attested_at" : table === "ap_reference_record_versions" ? "permission_last_confirmed_at"
      : table === "ap_reference_records" ? "current_version" : table === "ap_sensitive_payloads" ? "encryption_context_hash" : "reference_scope";
    d.tables[table][0][field] = table === "ap_reference_records" ? 2 : table === "ap_sensitive_payloads" ? "0".repeat(64)
      : table === "ap_material_line_revisions" ? { selected: true, permissionIds: [other] } : "2026-10-25T11:00:00Z";
    const bytes = Buffer.from(d.f.references[0].plaintext); finish(bytes);
    await expect(pending).rejects.toThrow(/^DRAFT_OWNER_REFERENCES_/); expect(bytes.every((byte) => byte === 0)).toBe(true);
  });
  it("clears earlier references when a later payload is invalid", async () => {
    const d = database(2), first = Buffer.from(d.f.references[0].plaintext), bad = Buffer.from("PRIVATE INVALID PAYLOAD");
    mocks.decrypt.mockResolvedValueOnce(first).mockResolvedValueOnce(bad);
    await expect(d.read()).rejects.toThrow("PAYLOAD_INVALID"); expect(first.every((byte) => byte === 0)).toBe(true); expect(bad.every((byte) => byte === 0)).toBe(true);
  });
  it("detaches caller identities and clears late KMS bytes after caller cancellation", async () => {
    const d = database(), controller = new AbortController(); let finish!: (bytes: Buffer) => void;
    mocks.decrypt.mockImplementationOnce(() => new Promise<Buffer>((resolve) => { finish = resolve; }));
    const pending = d.read(controller.signal); await vi.waitFor(() => expect(mocks.decrypt).toHaveBeenCalledOnce());
    d.request.customerId = other; d.request.bindings[0].payloadId = other; controller.abort();
    await expect(pending).rejects.toThrow("ABORTED"); const bytes = Buffer.from(d.f.references[0].plaintext); finish(bytes);
    await vi.waitFor(() => expect(bytes.every((byte) => byte === 0)).toBe(true));
    expect(mocks.decrypt.mock.calls[0][0].context.customerId).toBe(d.f.r.purchase.customer_id);
  });
  it("bounds stalled metadata reads and redacts provider details", async () => {
    vi.useFakeTimers(); const d = database(); d.overrides.set("ap_material_lines", () => new Promise(() => undefined));
    const pending = expect(d.read()).rejects.toThrow("DRAFT_OWNER_REFERENCES_ABORTED"); await vi.advanceTimersByTimeAsync(45_001); await pending;
    expect(mocks.decrypt).not.toHaveBeenCalled(); vi.useRealTimers();
    d.overrides.set("ap_material_lines", async () => { throw new Error("PRIVATE CUSTOMER AND CREDENTIAL"); });
    await expect(d.read()).rejects.toThrow(/^DRAFT_OWNER_REFERENCES_UNAVAILABLE$/);
  });
});

describe("reference packet metadata", () => {
  it("binds all exact selected identities and employer filename locally, with no provider reference contents", () => {
    const f = draftReferenceFixture(2, true, "Surname_References.pdf");
    expect(f.input.packet.ownerEvidence.referenceBindings).toHaveLength(2);
    expect(f.input.packet.ownerEvidence.referenceFilenameInstruction).toBe("Surname_References.pdf");
    const provider = JSON.stringify(f.input.packet.providerView);
    for (const value of ["reference1@example.test", "Morgan Reference", "Private internal context", f.referenceBindings[0].payloadId]) expect(provider).not.toContain(value);
    expect(serializeDraftingEvidencePacket(f.input.packet)).not.toContain("Private capability notes");
  });
  it("requires metadata for selected references and cannot silently extend a paid scope", () => {
    const f = draftReferenceFixture(); delete f.r.referenceMetadata;
    expect(() => buildDraftingEvidencePacket(f.r, f.input.packet.expected, draftFixtureNow)).toThrow("REFERENCE_METADATA_REQUIRED");
    const short = draftReferenceFixture(); short.r.rule.reference_count = 3;
    expect(() => buildDraftingEvidencePacket(short.r, short.input.packet.expected, draftFixtureNow)).toThrow("REQUIRED_REFERENCE_CLARIFICATION");
    short.r.rule.reference_timing = "PROHIBITED_NOW";
    expect(() => buildDraftingEvidencePacket(short.r, short.input.packet.expected, draftFixtureNow)).toThrow("REFERENCE_SCOPE_INVALID");
  });
  it("rejects duplicate selected record/version associations, even with unrelated metadata padding", () => {
    const f = draftReferenceFixture(2), metadata = structuredClone(f.r.referenceMetadata!);
    metadata.permissions[1].reference_record_version_id = metadata.permissions[0].reference_record_version_id;
    expect(() => bindDraftReferenceMetadata(metadata, { customerId: f.r.purchase.customer_id, deliveredReleaseId: f.r.intent.delivered_release_id,
      jobSnapshotId: f.r.job.id, jobSha256: f.r.job.content_sha256, permissionIds: f.r.referencePermissionIds }, draftFixtureNow)).toThrow("DRAFT_REFERENCE_BINDING_INVALID");
  });
});

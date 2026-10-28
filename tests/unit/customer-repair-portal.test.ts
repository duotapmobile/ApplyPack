import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { MaterialDeliveryView } from "@/components/portal/material-deliveries";
vi.mock("server-only", () => ({}));
import { overlayCustomerRepairDeliveries } from "@/lib/materials/customer-repair-portal";

const id = (n: number) => `99000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = "a".repeat(64), now = new Date("2026-10-26T12:00:00Z");
function fixture() {
  const customerId = id(1), lineId = id(2), purchaseId = id(3), intentId = id(4), snapshotId = id(5);
  const line: MaterialDeliveryView = { lineId, company: "Fictional Employer", title: "Coordinator", jobSnapshotId: id(6), stateLabel: "Delivered",
    stateMessage: "Files delivered", dueAt: "2026-10-20T12:00:00Z", accessExpiresAt: "2026-11-24T12:00:00Z", refundState: "NONE", proposal: null, regeneration: null,
    artifacts: ["RESUME", "COVER_LETTER"].map((type, index) => ({ id: id(10 + index), fileVersionId: id(20 + index), type: type as "RESUME" | "COVER_LETTER",
      version: 1, filename: type + ".pdf", checksum: hash, mimeType: "application/pdf", createdAt: "2026-10-20T12:00:00Z", downloadsRevokedAt: null, supersededAt: null })) };
  const repair = { artifactId: id(10), originalFileVersionId: id(20), fileVersionId: id(30), artifactType: "RESUME", safeFilename: "Corrected resume.pdf",
    checksumSha256: "b".repeat(64), releaseId: id(40), deliveredAt: "2026-10-25T12:00:00Z", accessExpiresAt: "2026-11-24T12:00:00Z" };
  const rows: Record<string, unknown> = {
    ap_material_lines: { id: lineId, purchase_id: purchaseId },
    ap_material_purchases: { id: purchaseId, customer_id: customerId, checkout_intent_id: intentId, legacy_cart_id: null },
    ap_material_checkout_intents: { id: intentId, customer_id: customerId, purchase_id: purchaseId, source_snapshot_id: snapshotId },
    ap_snapshot_legal_acceptances: { terms_version: "manual-launch-terms-2026-10-24-v3", privacy_version: "privacy-2026-10-24-v3" },
    ap_service_error_contracts: null,
    ap_service_repair_files: { id: id(30), repair_version_id: id(50), customer_id: customerId, material_line_id: lineId, artifact_id: id(10), original_file_version_id: id(20),
      artifact_type: "RESUME", checksum_sha256: repair.checksumSha256, safe_filename: repair.safeFilename, mime_type: "application/pdf", storage_path: "private/fictional.pdf", registration: {} },
    ap_service_repair_versions: { id: id(50), customer_id: customerId, material_line_id: lineId, version: 1, release_id: id(40), invalidated_at: null },
    ap_service_repair_releases: { id: id(40), repair_version_id: id(50), customer_id: customerId, material_line_id: lineId, committed_at: repair.deliveredAt, access_expires_at: repair.accessExpiresAt },
  };
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const keyedRows: Record<string, Record<string, unknown>> = {};
  let error: string | null = null, list: unknown = [repair], after: ((name: string) => void) | undefined;
  const query = (name: string, value: (filters: Record<string, unknown>) => unknown) => {
    const q: Record<string, unknown> = {};
    const filters: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "single", "maybeSingle", "abortSignal"]) q[method] = (...args: unknown[]) => { calls.push({ table: name, method, args }); if (method === "eq") filters[String(args[0])] = args[1]; return q; };
    q.then = (resolve: (v: unknown) => unknown) => { const result = { data: structuredClone(value(filters)), error: error === name ? { message: "private error" } : null }; after?.(name); return Promise.resolve(result).then(resolve); };
    return q;
  };
  const from = vi.fn((name: string) => query(name, (filters) => keyedRows[name]?.[String(filters.id)] ?? rows[name]));
  const rpc = vi.fn((name: string, args: unknown) => { calls.push({ table: name, method: "rpc", args: [args] }); return query(name, () => list); });
  const admin = { from, rpc } as unknown as SupabaseClient<Database>;
  return { line, repair, rows, keyedRows, customerId, admin, from, rpc, calls, error: (name: string) => { error = name; }, list: (value: unknown) => { list = value; },
    after: (callback: (name: string) => void) => { after = callback; }, run: () => overlayCustomerRepairDeliveries(admin, customerId, [line], { now: () => now }) };
}
function prospective(f: ReturnType<typeof fixture>) {
  f.rows.ap_snapshot_legal_acceptances = { terms_version: "manual-launch-terms-2026-10-25-v4", privacy_version: "privacy-2026-10-25-v4" };
  f.rows.ap_service_error_contracts = { material_line_id: f.line.lineId, customer_id: f.customerId, purchase_id: id(3), source_snapshot_id: id(5), legal_receipt_id: id(60),
    intake_review_id: id(61), intake_review_sha256: hash, contract_version: "service-error-only-v1", terms_version: "manual-launch-terms-2026-10-25-v4",
    terms_content_sha256: hash, privacy_version: "privacy-2026-10-25-v4", privacy_content_sha256: hash, confirmed_intake_version: "applypack-confirmed-intake-v1",
    reporting_time_zone: "America/New_York", bound_at: "2026-10-19T12:00:00Z" };
}
function reference(f: ReturnType<typeof fixture>) {
  const binding = { permissionId: id(70), recordId: id(71), recordVersionId: id(72), recordVersion: 1, payloadId: id(73), contentSha256: hash,
    permissionConfirmedAt: "2026-10-19T12:00:00Z", deliveredReleaseId: id(74), jobSnapshotId: id(6), jobSha256: hash };
  f.line.artifacts[0].type = "REFERENCE_SHEET"; f.repair.artifactType = "REFERENCE_SHEET";
  Object.assign(f.rows.ap_service_repair_files!, { artifact_type: "REFERENCE_SHEET", registration: { p_claim_provenance: { referenceBindings: [binding] } } });
  f.rows.ap_reference_permissions = [{ id: binding.permissionId, customer_id: f.customerId, delivered_release_id: binding.deliveredReleaseId,
    job_snapshot_id: binding.jobSnapshotId, job_snapshot_hash: hash, reference_record_version_id: binding.recordVersionId, attested_at: binding.permissionConfirmedAt,
    revoked_at: null, contact_version_changed_at: null }];
  f.rows.ap_reference_record_versions = [{ id: binding.recordVersionId, reference_record_id: binding.recordId, version: 1, encrypted_payload_id: binding.payloadId,
    payload_sha256: hash, payload_schema_version: "chunk5-reference-record-v1", permission_status: "CONFIRMED", permission_last_confirmed_at: binding.permissionConfirmedAt, superseded_at: null }];
  f.rows.ap_reference_records = [{ id: binding.recordId, customer_id: f.customerId, current_version: 1, removed_at: null, retention_state: "ACTIVE" }];
  f.rows.ap_sensitive_payloads = [{ id: binding.payloadId, customer_id: f.customerId, content_sha256: hash, retention_state: "ACTIVE", encryption_context_hash: hash }];
  return binding;
}
describe("authenticated customer repair portal", () => {
  it("keeps a later ordinary current version instead of overlaying an older repair", async () => {
    const f = fixture(); f.line.artifacts[0].fileVersionId = id(90); f.line.artifacts[0].version = 2;
    f.rows.ap_generated_file_versions = { id: id(20), artifact_id: id(10), version: 1, superseded_at: "2026-10-26T10:00:00Z" };
    f.rows.ap_generated_artifacts = { id: id(10), customer_id: f.customerId, material_line_id: f.line.lineId, artifact_type: "RESUME", current_file_version: 2 };
    expect((await f.run())[0].artifacts).toEqual(f.line.artifacts);
  });
  it("does not ignore a mismatched original without verified supersession", async () => {
    const f = fixture(); f.line.artifacts[0].fileVersionId = id(90); f.line.artifacts[0].version = 2;
    f.rows.ap_generated_file_versions = { id: id(20), artifact_id: id(10), version: 1, superseded_at: null };
    f.rows.ap_generated_artifacts = { id: id(10), customer_id: f.customerId, material_line_id: f.line.lineId, artifact_type: "RESUME", current_file_version: 2 };
    await expect(f.run()).rejects.toThrow();
  });
  it.each(["customer_id", "material_line_id", "repair_version_id", "committed_at", "access_expires_at"])("verifies immutable release %s", async (field) => {
    const f = fixture(); Object.assign(f.rows.ap_service_repair_releases!, { [field]: field.endsWith("_at") ? "2026-10-21T12:00:00Z" : id(999) }); await expect(f.run()).rejects.toThrow();
  });
  it("keeps a current consenting reference replacement without decrypting private values", async () => {
    const f = fixture(); reference(f); expect((await f.run())[0].artifacts[0].downloadsRevokedAt).toBeNull();
    expect(f.calls.filter((call) => call.method === "select").every((call) => !String(call.args[0]).includes("ciphertext"))).toBe(true);
  });
  it.each(["revoked_at", "contact_version_changed_at"])("hides the reference replacement on %s", async (field) => {
    const f = fixture(); reference(f); Object.assign((f.rows.ap_reference_permissions as object[])[0], { [field]: now.toISOString() });
    expect((await f.run())[0].artifacts[0].downloadsRevokedAt).not.toBeNull();
  });
  it("hides a changed or foreign reference payload", async () => {
    const f = fixture(); reference(f); Object.assign((f.rows.ap_sensitive_payloads as object[])[0], { customer_id: id(999) });
    expect((await f.run())[0].artifacts[0].downloadsRevokedAt).not.toBeNull();
  });
  it("overlays only the exact original while preserving unaffected delivery and old terms", async () => {
    const f = fixture(), result = await f.run();
    expect(result[0].artifacts[0]).toMatchObject({ id: id(10), fileVersionId: id(30), filename: "Corrected resume.pdf", checksum: "b".repeat(64), repair: { originalFileVersionId: id(20), releaseId: id(40) } });
    expect(result[0].artifacts[1]).toEqual(f.line.artifacts[1]); expect(result[0].supportPolicy).toBe("HISTORICAL"); expect(result[0].dueAt).toBe(f.line.dueAt);
    expect(f.rpc).toHaveBeenCalledTimes(2); expect(f.rpc).toHaveBeenCalledWith("ap_customer_service_repair_files", { p_customer_id: f.customerId, p_material_line_id: f.line.lineId });
    expect(f.calls.every((call) => ["select", "eq", "in", "single", "maybeSingle", "abortSignal", "rpc"].includes(call.method))).toBe(true);
    expect(f.calls.some((call) => call.method === "select" && String(call.args[0]).includes("ciphertext"))).toBe(false);
  });
  it("uses an actual prospective immutable binding without consulting or activating current config", async () => {
    const f = fixture(); prospective(f); expect((await f.run())[0].supportPolicy).toBe("SERVICE_ERROR_ONLY");
    expect(f.from).not.toHaveBeenCalledWith("ap_commerce_configuration");
  });
  it("does not misclassify a missing v4 binding as historical", async () => { const f = fixture(); prospective(f); f.rows.ap_service_error_contracts = null; await expect(f.run()).rejects.toThrow("CONTRACT_BINDING_MISSING"); });
  it("rejects a contract tied to another paid source", async () => { const f = fixture(); prospective(f); Object.assign(f.rows.ap_service_error_contracts!, { source_snapshot_id: id(999) }); await expect(f.run()).rejects.toThrow(); });
  it("preserves explicitly legacy-cart purchase support", async () => { const f = fixture(); Object.assign(f.rows.ap_material_purchases!, { checkout_intent_id: null, legacy_cart_id: id(9) }); expect((await f.run())[0].supportPolicy).toBe("HISTORICAL"); expect(f.from).not.toHaveBeenCalledWith("ap_material_checkout_intents"); });
  it("does not infer historical terms from an incomplete purchase", async () => { const f = fixture(); Object.assign(f.rows.ap_material_purchases!, { checkout_intent_id: null }); await expect(f.run()).rejects.toThrow(); });
  it.each(["customer_id", "material_line_id", "artifact_id", "original_file_version_id", "checksum_sha256", "mime_type", "storage_path"])("rejects wrong repair %s", async (field) => {
    const f = fixture(); Object.assign(f.rows.ap_service_repair_files!, { [field]: field === "storage_path" ? null : "wrong" }); await expect(f.run()).rejects.toThrow();
  });
  it.each(["artifactId", "originalFileVersionId", "artifactType"])("rejects unmatched returned %s", async (field) => { const f = fixture(); f.list([{ ...f.repair, [field]: field === "artifactType" ? "COVER_LETTER" : id(999) }]); await expect(f.run()).rejects.toThrow(); });
  it("rejects duplicate replacement originals and never falls back to the faulty original", async () => { const f = fixture(); f.list([f.repair, { ...f.repair, fileVersionId: id(32) }]); await expect(f.run()).rejects.toThrow(); });
  it("preserves the latest immutable delivered file while a successor draft is open", async () => {
    const f = fixture(); Object.assign(f.rows.ap_service_repair_versions!, { invalidated_at: now.toISOString() });
    expect((await f.run())[0].artifacts[0]).toMatchObject({ fileVersionId: id(30), downloadsRevokedAt: null, repair: { releaseId: id(40), accessExpired: false } });
  });
  it("rejects a mismatched delivered repair version release", async () => { const f = fixture(); Object.assign(f.rows.ap_service_repair_versions!, { release_id: id(999) }); await expect(f.run()).rejects.toThrow(); });
  it("does not expose repaired metadata for an expired line", async () => { const f = fixture(); f.line.accessExpiresAt = "2026-10-25T12:00:00Z"; expect((await f.run())[0]).toMatchObject({ artifacts: [], supportPolicy: "UNAVAILABLE" }); expect(f.from).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled(); });
  it("keeps the expired replacement unavailable without hiding a later active corrected companion", async () => {
    const f = fixture(); f.repair.deliveredAt = "2026-09-25T12:00:00Z"; f.repair.accessExpiresAt = "2026-10-25T12:00:00Z";
    const second = { ...f.repair, artifactId: id(11), originalFileVersionId: id(21), fileVersionId: id(31), artifactType: "COVER_LETTER",
      releaseId: id(41), safeFilename: "Corrected letter.pdf", deliveredAt: "2026-10-25T12:00:00Z", accessExpiresAt: "2026-11-24T12:00:00Z" };
    Object.assign(f.rows.ap_service_repair_releases!, { committed_at: f.repair.deliveredAt, access_expires_at: f.repair.accessExpiresAt });
    f.keyedRows.ap_service_repair_files = { [id(31)]: { ...f.rows.ap_service_repair_files as object, id: id(31), repair_version_id: id(51), artifact_id: id(11),
      original_file_version_id: id(21), artifact_type: "COVER_LETTER", safe_filename: second.safeFilename } };
    f.keyedRows.ap_service_repair_releases = { [id(41)]: { ...f.rows.ap_service_repair_releases as object, id: id(41), repair_version_id: id(51),
      committed_at: second.deliveredAt, access_expires_at: second.accessExpiresAt } };
    f.keyedRows.ap_service_repair_versions = { [id(51)]: { ...f.rows.ap_service_repair_versions as object, id: id(51), version: 2, release_id: id(41) } };
    f.list([f.repair, second]); const result = (await f.run())[0];
    expect(result.artifacts[0]).toMatchObject({ fileVersionId: id(30), repair: { accessExpired: true } });
    expect(result.artifacts[1]).toMatchObject({ fileVersionId: id(31), downloadsRevokedAt: null, repair: { accessExpired: false } });
    expect(result.artifacts.map((value) => value.fileVersionId)).not.toContain(id(20));
  });
  it("rejects an impossible immutable release interval", async () => {
    const f = fixture(); f.repair.accessExpiresAt = f.repair.deliveredAt;
    Object.assign(f.rows.ap_service_repair_releases!, { access_expires_at: f.repair.accessExpiresAt }); await expect(f.run()).rejects.toThrow();
  });
  it("fails closed on listing errors", async () => { const f = fixture(); f.error("ap_customer_service_repair_files"); await expect(f.run()).rejects.toThrow(); });
  it("rejects release movement during the read", async () => { const f = fixture(); f.after((name) => { if (name === "ap_service_repair_versions") f.list([]); }); await expect(f.run()).rejects.toThrow(); });
  it("marks per-file expiry crossed during the read without reopening the original", async () => { const f = fixture(); f.line.accessExpiresAt = "2026-12-25T12:00:00Z"; let date = now; f.after((name) => { if (name === "ap_service_repair_versions") date = new Date("2026-11-25T12:00:00Z"); });
    const result = (await overlayCustomerRepairDeliveries(f.admin, f.customerId, [f.line], { now: () => date }))[0];
    expect(result.artifacts[0]).toMatchObject({ fileVersionId: id(30), repair: { accessExpired: true } }); expect(result.artifacts[1]).toEqual(f.line.artifacts[1]);
  });
  it("rejects a foreign purchase before the privileged listing RPC", async () => { const f = fixture(); Object.assign(f.rows.ap_material_purchases!, { customer_id: id(999) }); await expect(f.run()).rejects.toThrow(); expect(f.rpc).not.toHaveBeenCalled(); });
  it("does not read anything after cancellation", async () => { const f = fixture(); const controller = new AbortController(); controller.abort(); await expect(overlayCustomerRepairDeliveries(f.admin, f.customerId, [f.line], { signal: controller.signal })).rejects.toThrow(); expect(f.from).not.toHaveBeenCalled(); });
  it("suppresses only the repaired reference link when current reference evidence is missing", async () => {
    const f = fixture(); f.line.artifacts[0].type = "REFERENCE_SHEET"; f.repair.artifactType = "REFERENCE_SHEET"; Object.assign(f.rows.ap_service_repair_files!, { artifact_type: "REFERENCE_SHEET" });
    const result = await f.run(); expect(result[0].artifacts[0].downloadsRevokedAt).not.toBeNull(); expect(result[0].artifacts[0].fileVersionId).toBe(id(30)); expect(result[0].artifacts[1]).toEqual(f.line.artifacts[1]);
  });
});

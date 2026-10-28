// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
vi.mock("server-only", () => ({}));
import { createServiceRepairDelivery } from "@/lib/materials/service-repair-delivery-server";
import { repairDeliveryFixture, repairId } from "../fixtures/service-repair-delivery";

function setup() {
  const f = repairDeliveryFixture(), reads: string[] = [], mutations: { name: string; args: Record<string, unknown> }[] = [];
  const state = { files: [f.file], version: f.version, approved: false, sent: false, reviewerAllowed: true, loseReply: false,
    badReturned: false, failReads: false, hang: false, inspections: 0, mutateInspection: false, changedContext: false };
  const getVersion = () => ({ ...state.version, ...(state.approved ? { approval_sha256: f.approvalSha256, approved_by: f.reviewer,
    approved_at: f.time, review_checklist: f.approve.action === "APPROVE" ? f.approve.checklist : null } : {}), ...(state.sent ? { release_id: f.release.id } : {}) });
  const respond = (work: () => unknown) => ({ abortSignal: vi.fn(function(this: unknown) { return this; }), then: (yes: (value: unknown) => unknown, no?: (error: unknown) => unknown) =>
    (state.hang ? new Promise(() => {}) : Promise.resolve().then(work)).then(data => ({ data, error: null })).then(yes, no) });
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => respond(() => {
    reads.push(name); if (name === "ap_require_material_reviewer") return state.reviewerAllowed;
    if (name === "ap_inspect_service_repair") { state.inspections++; return { ...f.inspection, version: getVersion(),
      contextSha256: state.changedContext || state.mutateInspection && state.inspections % 2 === 0 ? "9".repeat(64) : f.inspection.contextSha256 }; }
    mutations.push({ name, args });
    if (name === "ap_approve_service_repair") state.approved = true;
    else if (name === "ap_send_service_repair") state.sent = true; else throw new Error("unexpected RPC");
    if (state.loseReply) throw new Error("private provider error");
    return state.badReturned ? "wrong" : name === "ap_approve_service_repair" ? f.approvalSha256 : f.release.id;
  }));
  const from = vi.fn((table: string) => {
    const filters = new Map<string, unknown>(); let one = false;
    const query = { select: vi.fn(() => query), eq: vi.fn((key: string, value: unknown) => { filters.set(key, value); return query; }),
      order: vi.fn(() => query), limit: vi.fn(() => query), abortSignal: vi.fn(() => query), single: vi.fn(() => { one = true; return query; }),
      then: (yes: (value: unknown) => unknown, no?: (error: unknown) => unknown) => Promise.resolve().then(() => {
        reads.push(table); if (state.failReads) throw new Error("private read error");
        const rows = table === "ap_service_repair_versions" ? [getVersion()] : table === "ap_service_repair_files" ? state.files
          : table === "ap_service_repair_releases" ? state.sent ? [f.release] : [] : [];
        const selected = rows.filter(row => [...filters].every(([key, value]) => (row as Record<string, unknown>)[key] === value));
        return { data: one ? selected[0] ?? null : structuredClone(selected), error: null };
      }).then(yes, no) };
    return query;
  });
  const sign = vi.fn(async () => ({ data: { signedUrl: "https://storage.example.invalid/signed-preview" }, error: null }));
  const storage = { from: vi.fn(() => ({ createSignedUrl: sign })) };
  const admin = { rpc, from, storage } as unknown as SupabaseClient<Database>;
  const service = createServiceRepairDelivery(admin, f.reviewer), signal = new AbortController().signal;
  return { f, state, reads, mutations, rpc, sign, service, signal };
}
describe("099 exact owner repair approval and separate Send", () => {
  it("loads finite metadata and local fresh-MFA preview routes without approving or signing", async () => {
    const s = setup(), summary = await s.service.inspect({ caseId: s.f.caseId, materialLineId: s.f.line }, s.signal);
    expect(summary).toEqual(s.f.summary); expect(s.mutations).toEqual([]); expect(s.sign).not.toHaveBeenCalled();
    expect(JSON.stringify(summary)).not.toContain(s.f.customer); expect(s.state.inspections).toBe(2);
  });
  it("requires the exact reviewer before private data access", async () => {
    const s = setup(); s.state.reviewerAllowed = false;
    await expect(s.service.act(s.f.approve, false, s.signal)).rejects.toThrow("UNCONFIRMED");
    expect(s.reads).toEqual(["ap_require_material_reviewer"]); expect(s.mutations).toEqual([]);
  });
  it("requires all seven actual checks and rejects additional client authority", async () => {
    for (const checklist of [{}, { acceptedErrorScopeReviewed: true }, { ...repairDeliveryFixture().approve, approved: true }]) {
      const s = setup(); await expect(s.service.act({ ...s.f.approve, checklist }, false, s.signal)).rejects.toThrow("INVALID"); expect(s.mutations).toEqual([]);
    }
  });
  it("approves only the displayed source/member identity and never sends", async () => {
    const s = setup(), result = await s.service.act(s.f.approve, false, s.signal);
    expect(result).toMatchObject({ status: "RECORDED", action: "APPROVE", approvalSha256: s.f.approvalSha256, releaseId: null });
    expect(s.mutations).toEqual([{ name: "ap_approve_service_repair", args: { p_version_id: s.f.version.id,
      p_source_sha256: s.f.expected.sourceSha256, p_member_set_sha256: s.f.expected.memberSetSha256,
      p_checklist: s.f.approve.action === "APPROVE" ? s.f.approve.checklist : null, p_reviewer_id: s.f.reviewer } }]);
    await s.service.act(s.f.approve, false, s.signal); expect(s.mutations).toHaveLength(1); expect(s.state.sent).toBe(false);
  });
  it("reconciles committed approval or Send after reply loss with one mutation", async () => {
    const s = setup(); s.state.loseReply = true;
    await expect(s.service.act(s.f.approve, false, s.signal)).resolves.toMatchObject({ status: "RECORDED" });
    await expect(s.service.act(s.f.send, false, s.signal)).resolves.toMatchObject({ status: "RECORDED", releaseId: s.f.release.id, outboxId: s.f.release.outbox_id });
    await s.service.act(s.f.send, false, s.signal); expect(s.mutations.map(call => call.name)).toEqual(["ap_approve_service_repair", "ap_send_service_repair"]);
  });
  it("CHECK remains read-only and never interprets unavailable data as absence", async () => {
    const s = setup(); await expect(s.service.act(s.f.approve, true, s.signal)).resolves.toMatchObject({ status: "ABSENT" });
    expect(s.mutations).toEqual([]); s.state.failReads = true;
    await expect(s.service.act(s.f.approve, true, s.signal)).rejects.toThrow("UNCONFIRMED"); expect(s.mutations).toEqual([]);
  });
  it.each(["sourceSha256", "contextSha256", "memberSetSha256", "acceptedScopeSha256"] as const)("rejects changed displayed %s before mutation", async key => {
    const s = setup(); await expect(s.service.act({ ...s.f.approve, expected: { ...s.f.expected, [key]: "9".repeat(64) } }, false, s.signal)).rejects.toThrow("CHANGED");
    expect(s.mutations).toEqual([]);
  });
  it.each(["customer_id", "repair_version_id", "artifact_id", "original_file_version_id", "source_snapshot_id"] as const)("rejects foreign file %s before approval or preview", async key => {
    const s = setup(); s.state.files[0][key] = repairId(90);
    await expect(s.service.act(s.f.approve, false, s.signal)).rejects.toThrow();
    await expect(s.service.preview({ caseId: s.f.caseId, materialLineId: s.f.line, versionId: s.f.version.id, fileVersionId: s.f.file.id }, s.signal)).rejects.toThrow();
    expect(s.sign).not.toHaveBeenCalled(); expect(s.mutations).toEqual([]);
  });
  it("rejects a partial or duplicate member set and changed preview bytes", async () => {
    for (const change of ["partial", "duplicate", "checksum"] as const) {
      const s = setup(); if (change === "partial") s.state.files = []; else if (change === "duplicate") s.state.files.push({ ...s.state.files[0] }); else s.state.files[0].preview_sha256 = "9".repeat(64);
      await expect(s.service.act(s.f.approve, false, s.signal)).rejects.toThrow(); expect(s.mutations).toEqual([]);
    }
  });
  it("holds stale or changed-during-read context without mutation", async () => {
    for (const mode of ["changedContext", "mutateInspection"] as const) {
      const s = setup(); s.state[mode] = true; await expect(s.service.act(s.f.approve, false, s.signal)).rejects.toThrow("CHANGED"); expect(s.mutations).toEqual([]);
    }
  });
  it("reconciles an immutable saved approval after later invalidation without approving again", async () => {
    const s = setup(); s.state.approved = true; s.state.version.invalidated_at = s.f.time; s.state.changedContext = true;
    await expect(s.service.act(s.f.approve, true, s.signal)).resolves.toMatchObject({ status: "RECORDED" }); expect(s.mutations).toEqual([]); expect(s.state.inspections).toBe(0);
  });
  it("never sends an unapproved version or changes recorded release/outbox IDs", async () => {
    const s = setup(); await expect(s.service.act(s.f.send, false, s.signal)).rejects.toThrow("CHANGED"); expect(s.mutations).toEqual([]);
    s.state.approved = true; s.state.sent = true;
    for (const change of [{ releaseId: repairId(95) }, { outboxId: repairId(96) }, { approvalSha256: "9".repeat(64) }]) {
      await expect(s.service.act({ ...s.f.send, ...change }, true, s.signal)).rejects.toThrow("CHANGED");
    }
  });
  it("signs only an exact current owned preview for60seconds and rechecks after signing", async () => {
    const s = setup(), input = { caseId: s.f.caseId, materialLineId: s.f.line, versionId: s.f.version.id, fileVersionId: s.f.file.id };
    await expect(s.service.preview(input, s.signal)).resolves.toBe("https://storage.example.invalid/signed-preview");
    expect(s.sign).toHaveBeenCalledExactlyOnceWith(s.f.file.preview_path, 60, { download: false }); expect(s.state.inspections).toBe(4);
    s.state.files[0].preview_path = "foreign/private.pdf"; await expect(s.service.preview(input, s.signal)).rejects.toThrow("CHANGED"); expect(s.sign).toHaveBeenCalledOnce();
  });
  it("rejects signing results if source currentness changes while signing", async () => {
    const s = setup(); s.sign.mockImplementationOnce(async () => { s.state.changedContext = true; return { data: { signedUrl: "https://storage.example.invalid/secret" }, error: null }; });
    await expect(s.service.preview({ caseId: s.f.caseId, materialLineId: s.f.line, versionId: s.f.version.id, fileVersionId: s.f.file.id }, s.signal)).rejects.toThrow("CHANGED");
  });
  it("has finite cancellation even if an underlying request ignores abort", async () => {
    vi.useFakeTimers(); try { const s = setup(); s.state.hang = true;
      const result = s.service.inspect({ caseId: s.f.caseId, materialLineId: s.f.line }, s.signal); const check = expect(result).rejects.toThrow("UNCONFIRMED");
      await vi.advanceTimersByTimeAsync(20_001); await check; expect(s.mutations).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), refresh: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/security/origin", () => ({ isSameOriginRequest: () => true }));
import { Chunk5MaterialStaffQueue, type MaterialStaffLine } from "@/components/admin/chunk5-material-staff-queue";
import { MATERIAL_RELEASE_CHECKS } from "@/lib/materials/release-checklist";
import { POST } from "@/app/api/admin/material-lines/[id]/route";
import { DOCUMENT_GENERATOR_VERSION } from "@/lib/documents/requirements";

const lineId = "11111111-1111-4111-8111-111111111111";
const revisionId = "22222222-2222-4222-8222-222222222222";
const releaseCheckId = "33333333-3333-4333-8333-333333333333";
const line: MaterialStaffLine = {
  lineId, fulfillment: "READY_TO_RELEASE", substitution: "NONE", dueAt: "2026-10-26T16:00:00Z", activeRevision: 1,
  revisionId, jobSnapshotId: "job", sourceSnapshotId: "snapshot", company: "Example", title: "Receptionist",
  submissionRuleId: "rule", ruleSha256: "a".repeat(64), generationCheckAt: "2026-10-25T16:00:00Z",
  releaseCheckAt: "2026-10-25T16:10:00Z", releaseCheckId, openProposalKind: null, openSupportCases: 0, regeneration: null,
  files: ["RESUME", "COVER_LETTER"].map((artifactType, index) => ({ artifactType, fileVersionId: `44444444-4444-4444-8444-44444444444${index}`, version: 1,
    filename: artifactType + ".pdf", automatedPassed: true, contentApproved: true, visualApproved: true,
    checksumSha256: "f".repeat(64), contentApprovedAt: "2026-10-25T16:05:00Z", contentApprovedBy: lineId,
    visualApprovedAt: "2026-10-25T16:06:00Z", visualApprovedBy: lineId,
    rendererIdentity: "renderer", fontFamily: "Liberation Sans", fontResolved: true, currentStandard: true, referenceRegenerationId: null })),
};
const fullChecks = Object.fromEntries(MATERIAL_RELEASE_CHECKS.map(({ key }) => [key, true]));
const expectedBinding = { revisionId, ruleSha256: line.ruleSha256, releaseCheckId, releaseCheckAt: line.releaseCheckAt,
  files: line.files.map((file) => ({ fileVersionId: file.fileVersionId, version: file.version, checksumSha256: file.checksumSha256,
    contentApprovedAt: file.contentApprovedAt, contentApprovedBy: file.contentApprovedBy,
    visualApprovedAt: file.visualApprovedAt, visualApprovedBy: file.visualApprovedBy })) };
const rationale = "I reviewed these exact customer documents before sending.";
const releaseButton = () => screen.getByRole("button", { name: "Commit atomic customer release" });
function checkEveryBox() { MATERIAL_RELEASE_CHECKS.forEach(({ label }) => fireEvent.click(screen.getByRole("checkbox", { name: label }))); }

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({ ok: true, user: { id: lineId }, admin: { from: mocks.from, rpc: mocks.rpc } });
  mocks.rpc.mockResolvedValue({ data: "released", error: null });
  mocks.from.mockImplementation((table: string) => {
    const data = table === "ap_material_lines" ? { id: lineId, purchase_id: "purchase", active_revision: 1 }
      : table === "ap_material_line_revisions" ? { id: "revision" } : [{ generator_version: DOCUMENT_GENERATOR_VERSION }];
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "is"]) query[method] = () => query;
    query.maybeSingle = () => Promise.resolve({ data, error: null });
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve);
    return query;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("actual owner release review", () => {
  it("starts unchecked and requires each individual review before sending", () => {
    render(<Chunk5MaterialStaffQueue lines={[line]} />);
    fireEvent.change(screen.getByLabelText(/Approval or release attestation/), { target: { value: rationale } });
    expect(screen.getAllByRole("checkbox")).toHaveLength(7);
    expect(screen.getAllByRole("checkbox").every((box) => !(box as HTMLInputElement).checked)).toBe(true);
    expect(releaseButton()).toBeDisabled();
    checkEveryBox(); expect(releaseButton()).toBeEnabled();
    fireEvent.click(screen.getByRole("checkbox", { name: MATERIAL_RELEASE_CHECKS[4].label }));
    expect(releaseButton()).toBeDisabled();
  });

  it.each(["revision", "files", "rule", "listing", "check identity", "content approval", "visual approval", "checksum"])("clears review when the displayed %s changes", (change) => {
    const { rerender } = render(<Chunk5MaterialStaffQueue lines={[line]} />);
    fireEvent.change(screen.getByLabelText(/Approval or release attestation/), { target: { value: rationale } });
    checkEveryBox(); expect(releaseButton()).toBeEnabled();
    const updated = structuredClone(line);
    if (change === "revision") updated.revisionId = "new-revision";
    if (change === "files") updated.files[0].fileVersionId = "new-file";
    if (change === "rule") updated.ruleSha256 = "b".repeat(64);
    if (change === "listing") updated.releaseCheckAt = "2026-10-25T16:20:00Z";
    if (change === "check identity") updated.releaseCheckId = "new-check";
    if (change === "content approval") updated.files[0].contentApprovedAt = "2026-10-25T16:20:00Z";
    if (change === "visual approval") updated.files[0].visualApprovedBy = revisionId;
    if (change === "checksum") updated.files[0].checksumSha256 = "c".repeat(64);
    rerender(<Chunk5MaterialStaffQueue lines={[updated]} />);
    expect(releaseButton()).toBeDisabled();
    expect(screen.getAllByRole("checkbox").every((box) => !(box as HTMLInputElement).checked)).toBe(true);
  });

  it("sends only the manually selected checklist", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ releaseId: "released" }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    render(<Chunk5MaterialStaffQueue lines={[line]} />);
    fireEvent.change(screen.getByLabelText(/Approval or release attestation/), { target: { value: rationale } });
    checkEveryBox(); fireEvent.click(releaseButton());
    expect(fetcher).toHaveBeenCalledOnce();
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ action: "RELEASE", rationale, checklist: fullChecks, expectedBinding });
    await screen.findByText("The guarded staff action was recorded.");
  });

  it.each([undefined, {}, { ...fullChecks, visualReviewed: false }, { ...fullChecks, contentReviewed: "true" }])(
    "rejects missing, incomplete or non-boolean review without touching the database", async (checklist) => {
      const result = await POST(new Request("https://applypack.test/api/admin/material-lines/" + lineId, {
        method: "POST", body: JSON.stringify({ action: "RELEASE", rationale, checklist, expectedBinding }),
      }), { params: Promise.resolve({ id: lineId }) });
      expect(result.status).toBe(400); expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
    });

  it("persists the supplied complete review and keeps private response headers", async () => {
    const result = await POST(new Request("https://applypack.test/api/admin/material-lines/" + lineId, {
      method: "POST", body: JSON.stringify({ action: "RELEASE", rationale, checklist: fullChecks, expectedBinding }),
    }), { params: Promise.resolve({ id: lineId }) });
    expect(result.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("ap_commit_material_release_expected", expect.objectContaining({
      p_review_checklist: fullChecks, p_expected_binding: expectedBinding,
    }));
    expect(result.headers.get("Cache-Control")).toBe("no-store, private");
  });

  it.each([undefined, {}, { ...expectedBinding, files: [] }, { ...expectedBinding, files: [expectedBinding.files[0], expectedBinding.files[0]] }])(
    "rejects absent or ambiguous reviewed-file binding before database work", async (binding) => {
      const result = await POST(new Request("https://applypack.test/api/admin/material-lines/" + lineId, {
        method: "POST", body: JSON.stringify({ action: "RELEASE", rationale, checklist: fullChecks, expectedBinding: binding }),
      }), { params: Promise.resolve({ id: lineId }) });
      expect(result.status).toBe(400); expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
    });

  it("fails closed when the database rejects a changed reviewed pair", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "release_review_binding_changed" } });
    const result = await POST(new Request("https://applypack.test/api/admin/material-lines/" + lineId, {
      method: "POST", body: JSON.stringify({ action: "RELEASE", rationale, checklist: fullChecks, expectedBinding }),
    }), { params: Promise.resolve({ id: lineId }) });
    expect(result.status).toBe(409); expect(mocks.rpc).toHaveBeenCalledOnce();
  });
});

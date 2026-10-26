import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DraftOwnerEdit } from "@/components/admin/draft-owner-edit";
import type { DraftOwnerEditModel } from "@/lib/documents/draft-owner-edit";
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const id = (n: number) => `79000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function props() {
  const claim = { text: "Organized event schedules.", sourceAtomIds: ["a".repeat(64)], jobEvidenceIds: [], questionIds: [], relation: "DIRECT" as const };
  const model: DraftOwnerEditModel = { output: { schemaVersion: "applypack-draft-proposal-v1", language: "en-US", resume: { summary: [], skills: [],
    sections: [{ anchorFactId: id(6), bullets: [claim] }], educationFactIds: [] }, coverLetter: { body: [{ sentences: [{ ...claim, text: "I bring experience organizing community schedules." }] }] } },
    sections: [{ anchorFactId: id(6), label: "Volunteer coordinator · Community center · 2024–2025" }], sources: [
      { id: "a".repeat(64), factId: id(6), parentFactId: null, label: "Confirmed responsibility", value: "Organized event schedules", disposition: "CONFIRMED", localOnly: false },
      { id: "b".repeat(64), factId: id(6), parentFactId: null, label: "Limited skill", value: "Learning spreadsheet formulas", disposition: "LIMITED_OR_UNKNOWN_DO_NOT_UPGRADE", localOnly: false },
      { id: "c".repeat(64), factId: id(7), parentFactId: null, label: "Negative skill", value: "Cannot drive", disposition: "NEGATIVE_DO_NOT_ASSERT", localOnly: false },
      { id: "d".repeat(64), factId: id(7), parentFactId: null, label: "Other role", value: "Different project duties", disposition: "CONFIRMED", localOnly: false },
    ] };
  return { jobId: id(1), versionId: id(2), sourceSha256: "e".repeat(64), packetSha256: "f".repeat(64), validUntil: "2099-01-01T00:00:00Z", model, disabled: false, onLockChange: vi.fn() };
}
function change() { fireEvent.click(screen.getByRole("button", { name: "Edit wording" })); fireEvent.change(screen.getByLabelText("Letter paragraph 1 sentence 1 wording"), { target: { value: "I organized community event schedules." } }); }
function confirm() { fireEvent.click(screen.getByLabelText(/I want to save these edits/)); }
beforeEach(() => vi.clearAllMocks()); afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("readable owner wording editor", () => {
  it("opens by keyboard, keeps identity fields out of inputs, and restricts role sources", async () => {
    const value = props(); render(<DraftOwnerEdit {...value} />); const user = userEvent.setup();
    await user.tab(); expect(screen.getByRole("button", { name: "Edit wording" })).toHaveFocus(); await user.keyboard("{Enter}");
    expect(value.onLockChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole("heading", { name: "Volunteer coordinator · Community center · 2024–2025" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/employer name|phone|education name/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Negative skill/)).not.toBeInTheDocument();
    expect(screen.getAllByLabelText(/Other role/)).toHaveLength(1); // Letter only; not the unrelated role bullet.
    expect(screen.getByRole("button", { name: "Save new review version" })).toBeDisabled();
  });
  it("requires explicit save confirmation and resets it after another edit", () => {
    render(<DraftOwnerEdit {...props()} />); change(); expect(screen.getByRole("button", { name: "Save new review version" })).toBeDisabled(); confirm();
    expect(screen.getByRole("button", { name: "Save new review version" })).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Experience 1 bullet 1 wording"), { target: { value: "Organized community event schedules." } });
    expect(screen.getByLabelText(/I want to save/)).not.toBeChecked();
  });
  it("supports add/remove prose with actual source choices and limited evidence labels", () => {
    render(<DraftOwnerEdit {...props()} />); change(); fireEvent.click(screen.getByRole("button", { name: "Add skill" }));
    expect(screen.getByLabelText("Skill 1 wording")).toHaveValue(""); expect(screen.getAllByLabelText(/keep the recorded limit/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Remove skill 1" })); expect(screen.queryByLabelText("Skill 1 wording")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add letter paragraph" })); expect(screen.getByLabelText("Letter paragraph 2 sentence 1 wording")).toBeInTheDocument();
  });
  it("cancels without writes and resets the private buffer on reopening", () => {
    const value = props(), fetch = vi.fn(); vi.stubGlobal("fetch", fetch); render(<DraftOwnerEdit {...value} />); change();
    fireEvent.click(screen.getByRole("button", { name: "Cancel edits" })); expect(value.onLockChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: "Edit wording" })); expect(screen.getByLabelText("Letter paragraph 1 sentence 1 wording")).toHaveValue(value.model.output.coverLetter.body[0].sentences[0].text); expect(fetch).not.toHaveBeenCalled();
  });
  it("sends one exact edit request and requires a matching new-version receipt", async () => {
    const value = props(), fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)); return new Response(JSON.stringify({ action: "SAVE_OWNER_EDIT", result: { jobId: value.jobId, requestId: body.requestId,
        versionId: id(9), packetSha256: value.packetSha256, sourceSha256: "9".repeat(64), state: "OWNER_REVIEW_REQUIRED", deliveryAuthorized: false } })); });
    vi.stubGlobal("fetch", fetch); const storage = vi.spyOn(Storage.prototype, "setItem"); render(<DraftOwnerEdit {...value} />); change(); confirm();
    const button = screen.getByRole("button", { name: "Save new review version" }); fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(router.refresh).toHaveBeenCalledOnce()); expect(fetch).toHaveBeenCalledOnce();
    const body = JSON.parse(String(fetch.mock.calls[0][1].body)); expect(body).toMatchObject({ action: "SAVE_OWNER_EDIT", expectedVersionId: value.versionId, expectedSourceSha256: value.sourceSha256 });
    expect(body).not.toHaveProperty("reviewerId"); expect(body).not.toHaveProperty("approved"); expect(storage).not.toHaveBeenCalled(); storage.mockRestore();
    expect(screen.getByRole("status")).toHaveTextContent("Previous wording review");
  });
  it.each(["lost", "foreign receipt"])("keeps controls locked after %s without retry", async (mode) => {
    const fetch = mode === "lost" ? vi.fn().mockRejectedValue(new Error("private error")) : vi.fn().mockResolvedValue(new Response(JSON.stringify({ action: "SAVE_OWNER_EDIT", result: { deliveryAuthorized: false } })));
    vi.stubGlobal("fetch", fetch); render(<DraftOwnerEdit {...props()} />); change(); confirm(); fireEvent.click(screen.getByRole("button", { name: "Save new review version" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("could not be confirmed"));
    expect(screen.getByRole("button", { name: "Cancel edits" })).toBeDisabled(); expect(router.refresh).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Letter paragraph 1 sentence 1 wording")).toHaveValue("I organized community event schedules.");
  });
  it("reconciles only the same frozen body and request ID after an uncertain save", async () => {
    const value = props(), fetch = vi.fn().mockRejectedValueOnce(new Error("lost")).mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)); return new Response(JSON.stringify({ action: "SAVE_OWNER_EDIT", result: { jobId: value.jobId, requestId: body.requestId,
        versionId: id(9), packetSha256: value.packetSha256, sourceSha256: "9".repeat(64), state: "OWNER_REVIEW_REQUIRED", deliveryAuthorized: false } })); });
    vi.stubGlobal("fetch", fetch); render(<DraftOwnerEdit {...value} />); change(); confirm(); fireEvent.click(screen.getByRole("button", { name: "Save new review version" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Reconcile saved edit" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Reconcile saved edit" })); await waitFor(() => expect(router.refresh).toHaveBeenCalledOnce());
    expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body); expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each([400, 422])("permits correcting a confirmed pre-write %s rejection and resets consent", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(status === 400 ? { error: "The document action is incomplete. Review the current version and try again." } : { editRejected: true }), { status })));
    render(<DraftOwnerEdit {...props()} />); change(); confirm(); fireEvent.click(screen.getByRole("button", { name: "Save new review version" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("rejected before a new version"));
    expect(screen.getByLabelText("Letter paragraph 1 sentence 1 wording")).toBeEnabled(); expect(screen.getByLabelText(/I want to save/)).not.toBeChecked();
    expect(screen.queryByRole("button", { name: "Reconcile saved edit" })).not.toBeInTheDocument(); expect(router.refresh).not.toHaveBeenCalled();
  });
  it("does not transmit once evidence expires", () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); render(<DraftOwnerEdit {...props()} validUntil="2000-01-01T00:00:00Z" />);
    fireEvent.click(screen.getByRole("button", { name: "Edit wording" })); expect(screen.queryByLabelText("Experience 1 bullet 1 wording")).not.toBeInTheDocument(); expect(fetch).not.toHaveBeenCalled();
  });
});

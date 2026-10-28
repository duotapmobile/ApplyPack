import { webcrypto } from "node:crypto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceRepairWorkspace } from "@/components/admin/service-repair-workspace";
import { repairAuthoringFixture, repairAuthoringReceipt, authoringId } from "../fixtures/service-repair-authoring";

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
beforeEach(() => { vi.stubGlobal("crypto", webcrypto); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function setup(refresh: "CURRENT" | "STALE" | "UNAVAILABLE" = "CURRENT") {
  const source = repairAuthoringFixture(); let sourceSaved = false, reviewed = false, registered = false;
  const identity = { caseId: source.caseId, materialLineId: source.materialLineId };
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (url.includes("/source")) {
      if (init.method === "POST") {
        sourceSaved = true; return json({ receipt: repairAuthoringReceipt(JSON.parse(String(init.body)).request) });
      }
      return json({ view: { ...source, sourceSaved } });
    }
    if (url.includes("/wording")) {
      if (init.method === "POST") {
        reviewed = true; const request = JSON.parse(String(init.body)).request;
        return json({ result: { requestId: request.requestId, expected: request.expected, status: "RECORDED", reviewSha256: "8".repeat(64), renderingAuthorized: false, deliveryAuthorized: false } });
      }
      const claim = { claimId: authoringId(33), wordingSha256: "7".repeat(64), placement: "coverLetter.body.0", text: "Helped customers with routine questions.",
        qualification: "EXACT", sources: [{ label: "Confirmed duties", value: "Helped customers with routine questions." }], jobEvidence: [], questions: [] };
      return json({ view: { expected: { ...identity, versionId: source.versionId, sourceSha256: "9".repeat(64),
        acceptedScopeSha256: source.acceptedScopeSha256, contextSha256: source.contextSha256,
        members: [{ originalFileVersionId: source.members[0].originalFileVersionId, renderSourceSha256: "6".repeat(64), claims: [{ claimId: claim.claimId, wordingSha256: claim.wordingSha256 }] }] },
      reviewed, members: [{ originalFileVersionId: source.members[0].originalFileVersionId, artifactType: "COVER_LETTER", claims: [claim] }], renderingAuthorized: false, deliveryAuthorized: false } });
    }
    if (url.includes("/render")) {
      if (init.method === "POST") {
        registered = true; const request = JSON.parse(String(init.body)).request;
        return json({ result: { requestId: request.requestId, expected: request.expected, status: "REVIEW_READY", memberSetSha256: "2".repeat(64), busyUntil: null,
          retryAllowed: false, renderingAuthorized: false, deliveryAuthorized: false } });
      }
      return json({ view: { ...identity, versionId: source.versionId, status: !reviewed ? "WORDING_REQUIRED" : registered ? "REVIEW_READY" : "READY",
        expected: !reviewed ? null : { ...identity, versionId: source.versionId, sourceSha256: "9".repeat(64), reviewSha256: "8".repeat(64),
          acceptedScopeSha256: source.acceptedScopeSha256, contextSha256: source.contextSha256,
          members: [{ originalFileVersionId: source.members[0].originalFileVersionId, artifactType: "COVER_LETTER", originalSourceSha256: "d".repeat(64), packetSha256: "f".repeat(64), renderSourceSha256: "6".repeat(64) }] },
        busyUntil: null, memberSetSha256: registered ? "2".repeat(64) : null, deliveryAuthorized: false } });
    }
    if (url.includes("/delivery")) return json({ summary: { ...identity, state: "NOT_READY", expected: null, approvalSha256: null, canSend: false, releaseId: null, files: [] } });
    if (sourceSaved && refresh === "UNAVAILABLE") return json({}, 503);
    return json({ summary: { ...identity, acceptedScopeSha256: source.acceptedScopeSha256, contextSha256: source.contextSha256,
      originals: [{ artifactId: authoringId(30), fileVersionId: source.members[0].originalFileVersionId, artifactType: "COVER_LETTER", deliveredAt: "2026-10-25T12:00:00Z" }],
      current: { id: source.versionId, requestId: authoringId(31), ...identity, supersedesId: null, version: 1,
        acceptedScopeSha256: source.acceptedScopeSha256, contextSha256: sourceSaved && refresh === "STALE" ? "0".repeat(64) : source.contextSha256,
        sourceSaved, invalidatedAt: null, approvedAt: null, releaseId: null } } });
  });
  vi.stubGlobal("fetch", fetch); render(<ServiceRepairWorkspace {...identity} title="Example employer — Office assistant" />);
  return { fetch };
}
async function saveSource() {
  fireEvent.click(await screen.findByRole("radio", { name: /keep the exact original content/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /I reviewed these repair choices/ }));
  fireEvent.click(screen.getByRole("button", { name: "Save repair source for review" }));
}
describe("connected owner repair workspace", () => {
  it("loads wording only after a verified source save, then refreshes its recorded review without approval or Send", async () => {
    const { fetch } = setup(); await screen.findByRole("button", { name: "Save repair source for review" });
    expect(fetch.mock.calls.some(([url]) => url.includes("/wording"))).toBe(false);
    await saveSource();
    fireEvent.click(await screen.findByRole("checkbox", { name: /I checked Cover letter · affected file 1 · statement 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "Record checked repair wording" }));
    await screen.findByText(/already has a recorded review/);
    expect(fetch.mock.calls.filter(([, init]) => init.method === "POST").map(([url]) => url.split("/").at(-1))).toEqual(["source", "wording"]);
    expect(screen.queryByRole("button", { name: /^(Approve|Send) these repaired files/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /I checked Cover letter/ })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Create reviewed repair files" }));
    await screen.findByText(/repaired files are ready for the separate preview/);
    expect(fetch.mock.calls.filter(([, init]) => init.method === "POST").map(([url]) => url.split("/").at(-1))).toEqual(["source", "wording", "render"]);
  });
  it.each(["STALE", "UNAVAILABLE"] as const)("hides subsequent controls when the saved source refresh is %s", async refresh => {
    const { fetch } = setup(refresh); await saveSource();
    await screen.findByText(refresh === "STALE" ? /This version needs a new review/ : /action was saved, but the current repair could not be reloaded/);
    await waitFor(() => expect(screen.queryByRole("region", { name: "Review and send repaired files" })).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Record checked repair wording" })).not.toBeInTheDocument();
    expect(fetch.mock.calls.filter(([, init]) => init.method === "POST")).toHaveLength(1);
    expect(fetch.mock.calls.some(([url]) => url.includes("/wording"))).toBe(false);
  });
});

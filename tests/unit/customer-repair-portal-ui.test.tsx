import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MaterialDeliveries, type MaterialDeliveryView } from "@/components/portal/material-deliveries";
vi.mock("@/components/portal/service-repair-feedback", () => ({ ServiceRepairFeedback: ({ materialLineId }: { materialLineId: string }) =>
  <section aria-label="Existing repair feedback" data-line-id={materialLineId} /> }));
const id = (n: number) => `99000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const line = (): MaterialDeliveryView => ({ lineId: id(1), company: "Example employer", title: "Office assistant", jobSnapshotId: id(2),
  stateLabel: "Delivered", stateMessage: "Your files are ready.", dueAt: null, accessExpiresAt: "2099-10-30T12:00:00Z", refundState: "NONE",
  proposal: null, regeneration: null, supportPolicy: "SERVICE_ERROR_ONLY", artifacts: [{ id: id(3), fileVersionId: id(4), type: "RESUME", version: 2,
    filename: "Corrected_resume.pdf", checksum: "a".repeat(64), mimeType: "application/pdf", createdAt: "2026-10-25T12:00:00Z", downloadsRevokedAt: null, supersededAt: null,
    repair: { originalFileVersionId: id(5), releaseId: id(6), deliveredAt: "2026-10-25T12:00:00Z", accessExpiresAt: "2099-10-30T12:00:00Z" } }] });
beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ references: [] }), { status: 200 }))));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("customer corrected-document presentation", () => {
  it("links only the exact replacement ID and separately explains its access date", () => {
    const value = line(); render(<MaterialDeliveries lines={[value]} />);
    expect(screen.getByRole("link", { name: "Download corrected file" })).toHaveAttribute("href", `/api/customer/artifacts/${id(3)}/download?fileVersionId=${id(4)}`);
    expect(screen.getByText("Corrected_resume.pdf")).toBeInTheDocument(); expect(screen.getByText(/Corrected document delivered/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Download current file" })).not.toBeInTheDocument();
  });
  it("uses prospective factual-error support without promising an included edit round", () => {
    render(<MaterialDeliveries lines={[line()]} />);
    expect(screen.getByRole("link", { name: "Report a factual error or view your report" })).toHaveAttribute("href", `/my-applypack/material-lines/${id(1)}/service-error`);
    expect(screen.queryByRole("button", { name: "Request the included factual correction" })).not.toBeInTheDocument();
    expect(screen.getByText(/not an editing round/)).toBeInTheDocument(); expect(screen.getByText(/original delivery/, { selector: ".deadline-note" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Existing repair feedback" })).toHaveAttribute("data-line-id", id(1));
  });
  it("does not offer repaired-file feedback before an actual repair release", () => {
    const value = line(); delete value.artifacts[0].repair; render(<MaterialDeliveries lines={[value]} />);
    expect(screen.queryByRole("region", { name: "Existing repair feedback" })).not.toBeInTheDocument();
  });
  it("does not expose prospective repair feedback under a historical contract", () => {
    const value = line(); value.supportPolicy = "HISTORICAL"; render(<MaterialDeliveries lines={[value]} />);
    expect(screen.queryByRole("region", { name: "Existing repair feedback" })).not.toBeInTheDocument();
  });
  it("preserves the historical request flow and its original promise", () => {
    const value = line(); value.supportPolicy = "HISTORICAL"; delete value.artifacts[0].repair; render(<MaterialDeliveries lines={[value]} />);
    fireEvent.click(screen.getByRole("button", { name: "Request the included factual correction" }));
    expect(screen.getByRole("combobox", { name: "Document" })).toBeInTheDocument(); expect(screen.getByRole("button", { name: "Submit factual correction" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: /Report a factual error/ })).not.toBeInTheDocument();
  });
  it.each([undefined, "UNAVAILABLE"] as const)("offers no guessed contract action when policy is %s", (policy) => {
    const value = line(); value.supportPolicy = policy; render(<MaterialDeliveries lines={[value]} />);
    expect(screen.queryByRole("button", { name: /included factual/ })).not.toBeInTheDocument(); expect(screen.queryByRole("link", { name: /Report a factual/ })).not.toBeInTheDocument();
    expect(screen.getByText(/support options are temporarily unavailable/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Existing repair feedback" })).not.toBeInTheDocument();
  });
  it("hides a revoked replacement link without offering its prior file", () => {
    const value = line(); value.artifacts[0].downloadsRevokedAt = "2026-10-25T12:00:00Z"; render(<MaterialDeliveries lines={[value]} />);
    expect(screen.queryByRole("link", { name: /Download/ })).not.toBeInTheDocument(); expect(screen.getByText("Download unavailable")).toBeInTheDocument();
  });
  it("hides an expired correction even when another delivery keeps the line accessible", () => {
    const value = line(); value.artifacts[0].repair!.accessExpiresAt = "2020-10-30T12:00:00Z"; render(<MaterialDeliveries lines={[value]} />);
    expect(screen.queryByRole("link", { name: /Download/ })).not.toBeInTheDocument(); expect(screen.getByText("Download unavailable")).toBeInTheDocument();
  });
  it("preserves a later active companion when the server has marked the earlier correction expired", () => {
    const value = line(); value.artifacts.push({ ...value.artifacts[0], id: id(7), fileVersionId: id(8), type: "COVER_LETTER", filename: "Corrected_letter.pdf",
      repair: { ...value.artifacts[0].repair!, originalFileVersionId: id(9), releaseId: id(10) } });
    value.artifacts[0].repair!.accessExpired = true; render(<MaterialDeliveries lines={[value]} />);
    expect(screen.getByText("Download unavailable")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download corrected file" })).toHaveAttribute("href", `/api/customer/artifacts/${id(7)}/download?fileVersionId=${id(8)}`);
    expect(screen.queryByRole("link", { name: "Download current file" })).not.toBeInTheDocument();
  });
  it("hides private files and support controls after access expiry", () => {
    const value = line(); value.accessExpiresAt = "2020-10-30T12:00:00Z"; render(<MaterialDeliveries lines={[value]} />);
    expect(screen.getByRole("heading", { name: "Private document access ended" })).toBeInTheDocument(); expect(screen.queryByText("Corrected_resume.pdf")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Download|Report a factual/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Existing repair feedback" })).not.toBeInTheDocument();
  });
});

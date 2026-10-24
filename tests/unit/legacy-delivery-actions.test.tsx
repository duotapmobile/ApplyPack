import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeliveryActions } from "@/components/portal/delivery-actions";
import { safeAuthDestination } from "@/lib/auth/email-code";
const itemId = "10000000-0000-4000-8000-000000000003";
const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const show = () => render(<DeliveryActions itemId={itemId} deliveredAt="2026-09-01T12:00:00Z" jobLabel="Example Support role" />);
describe("historical customer delivery controls", () => {
  it("offers both files and a safe sign-in return to the same historical delivery", () => {
    show();
    expect(screen.getByRole("link", { name: "Download resume" })).toHaveAttribute("href", `/api/customer/deliveries/${itemId}?kind=resume`);
    expect(screen.getByRole("link", { name: "Download cover letter" })).toHaveAttribute("href", `/api/customer/deliveries/${itemId}?kind=cover_letter`);
    const returnLink = new URL(screen.getByRole("link", { name: "Sign in again and return to these documents" }).getAttribute("href")!, "https://example.test");
    expect(safeAuthDestination(returnLink.searchParams.get("next"))).toBe(`/my-applypack#historical-delivery-${itemId}`);
    expect(document.getElementById(`historical-delivery-${itemId}`)).toBeInTheDocument();
  });
  it("keeps expired-authentication instructions and sign-in action inside the portal", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: "Sign in again before requesting a new 15-minute download.", reauthenticationRequired: true }) });
    show(); fireEvent.click(screen.getByRole("button", { name: "Show document versions" }));
    expect(await screen.findByText("Sign in again before requesting a new 15-minute download.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in again and return to these documents" })).toBeInTheDocument();
  });
  it("opens preserved versions by ID and clearly labels records requiring review", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ versions: [
      { id: "revision-one", version: 1, deliveredAt: "2026-09-01T12:00:00Z", available: true },
      { id: "revision-two", version: 2, deliveredAt: "2026-09-02T12:00:00Z", available: false },
    ] }) });
    show(); fireEvent.click(screen.getByRole("button", { name: "Show document versions" }));
    expect(await screen.findByRole("link", { name: "Resume version 1" })).toHaveAttribute("href", `/api/customer/deliveries/${itemId}?kind=resume&revisionId=revision-one`);
    expect(screen.queryByRole("link", { name: "Resume version 2" })).not.toBeInTheDocument();
    expect(screen.getByText(/This version needs support review/)).toBeInTheDocument();
  });
});

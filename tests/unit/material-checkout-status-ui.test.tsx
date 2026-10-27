import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MaterialCheckoutStatus } from "@/components/commerce/material-checkout-status";
const fetchMock = vi.fn(), id = "a1150000-0000-4000-8000-000000000002", order = "a1150000-0000-4000-8000-000000000003";
const paid = { checkoutIntentId: id, state: "PAYMENT_VERIFIED", orderId: order, lineCount: 1, amountCents: 799, currency: "USD" };
const reply = (body: unknown, ok = true) => ({ ok, json: async () => body });
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("Apply Pack return status", () => {
  it("reads only the selected pack on canceled return and does not invent cancellation or change search state", async () => {
    fetchMock.mockResolvedValue(reply(paid)); render(<MaterialCheckoutStatus checkoutIntentId={id} cancelled />);
    expect(await screen.findByRole("heading", { name: "Apply Pack payment verified" })).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(`/api/checkout/apply-packs/${id}/status`, { cache: "no-store", credentials: "same-origin" });
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).includes("/search/") || init.method)).toBe(false);
    expect(screen.getByRole("link", { name: "Open My ApplyPack" })).toHaveAttribute("href", `/my-applypack?order=${order}`);
  });
  it("treats an interrupted return as pending, not canceled or refunded", async () => {
    fetchMock.mockResolvedValue(reply({ ...paid, state: "CONFIRMING_PAYMENT" })); render(<MaterialCheckoutStatus checkoutIntentId={id} cancelled />);
    expect(await screen.findByRole("heading", { name: "You returned from Apply Pack checkout" })).toBeVisible();
    expect(screen.getByText(/does not confirm cancellation or a refund/)).toBeVisible();
  });
  it("recovers a lost status response with a read-only retry for exactly the same pack", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(reply(paid)); render(<MaterialCheckoutStatus checkoutIntentId={id} />);
    expect(await screen.findByRole("heading", { name: "Apply Pack status is unavailable" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByRole("heading", { name: "Apply Pack payment verified" })).toBeVisible();
    expect(new Set(fetchMock.mock.calls.map(([url]) => url))).toEqual(new Set([`/api/checkout/apply-packs/${id}/status`]));
  });
  it.each([null, { ...paid, checkoutIntentId: order }, { ...paid, state: "SEARCH_ACTIVE" }, { ...paid, secret: "unexpected" }])("rejects mismatched/malformed receipts (%#)", async body => {
    fetchMock.mockResolvedValue(reply(body)); render(<MaterialCheckoutStatus checkoutIntentId={id} />);
    expect(await screen.findByRole("heading", { name: "Apply Pack status is unavailable" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Open My ApplyPack" })).toHaveAttribute("href", "/my-applypack");
  });
  it("clears stale status on account recheck and ignores an earlier successful response after rejection", async () => {
    let first: ((value: ReturnType<typeof reply>) => void) | undefined;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { first = resolve; })).mockResolvedValueOnce(reply({}, false));
    render(<MaterialCheckoutStatus checkoutIntentId={id} />); fireEvent.focus(window);
    expect(await screen.findByRole("heading", { name: "Apply Pack status is unavailable" })).toBeVisible(); first!(reply(paid));
    await waitFor(() => expect(screen.getByRole("link", { name: "Open My ApplyPack" })).toHaveAttribute("href", "/my-applypack"));
    expect(screen.queryByRole("heading", { name: "Apply Pack payment verified" })).not.toBeInTheDocument();
  });
  it("does not carry a previous pack's order link into a different return", async () => {
    fetchMock.mockResolvedValueOnce(reply(paid)).mockImplementationOnce(() => new Promise(() => undefined));
    const view = render(<MaterialCheckoutStatus checkoutIntentId={id} />);
    expect(await screen.findByRole("heading", { name: "Apply Pack payment verified" })).toBeVisible();
    view.rerender(<MaterialCheckoutStatus checkoutIntentId={order} />);
    expect(screen.getByRole("link", { name: "Open My ApplyPack" })).toHaveAttribute("href", "/my-applypack");
    expect(screen.queryByRole("heading", { name: "Apply Pack payment verified" })).not.toBeInTheDocument();
  });
});

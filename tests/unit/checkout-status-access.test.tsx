import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckoutStatus } from "@/components/commerce/checkout-status";
const fetchMock = vi.fn();
const orderId = "51000000-0000-4000-8000-000000000021";
const paid = { state: "SEARCH_ACTIVE", orderId, deliveryDueAt: "2026-11-01T10:00:00Z" };
const reply = (body: unknown, ok = true) => ({ ok, json: async () => body });
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("checkout status account access", () => {
  it("offers ordinary account access when a status capability is unavailable", async () => {
    fetchMock.mockResolvedValue(reply({}, false)); render(<CheckoutStatus />);
    expect(await screen.findByRole("heading", { name: "Checkout status is unavailable" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Open My ApplyPack" })).toHaveAttribute("href", "/my-applypack");
    expect(screen.getByText(/sign in with the account that placed the order/)).toBeVisible();
  });
  it("clears the old order and deadline on account-change recheck and rejected access", async () => {
    let finish: ((value: ReturnType<typeof reply>) => void) | undefined;
    fetchMock.mockResolvedValueOnce(reply(paid)).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(<CheckoutStatus />);
    expect(await screen.findByRole("heading", { name: "Your search has started" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Open My ApplyPack" })).toHaveAttribute("href", `/my-applypack?order=${orderId}`);
    fireEvent.focus(window);
    expect(screen.queryByText(/exact deadline/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open My ApplyPack" })).toHaveAttribute("href", "/my-applypack");
    finish!(reply({}, false));
    expect(await screen.findByRole("heading", { name: "Checkout status is unavailable" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Open My ApplyPack" })).toHaveAttribute("href", "/my-applypack");
  });
  it("does not restore an obsolete successful response after a newer ownership rejection", async () => {
    let first: ((value: ReturnType<typeof reply>) => void) | undefined;
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { first = resolve; })).mockResolvedValueOnce(reply({}, false));
    render(<CheckoutStatus />); fireEvent.focus(window);
    expect(await screen.findByRole("heading", { name: "Checkout status is unavailable" })).toBeVisible();
    first!(reply(paid));
    await waitFor(() => expect(screen.getByRole("link", { name: "Open My ApplyPack" })).toHaveAttribute("href", "/my-applypack"));
    expect(screen.queryByRole("heading", { name: "Your search has started" })).not.toBeInTheDocument();
  });
  it.each([null, { state: "SEARCH_ACTIVE", orderId: "bad" }, { ...paid, deliveryDueAt: "not-a-date" }])("fails closed on malformed status without exposing a stale order (%#)", async value => {
    fetchMock.mockResolvedValue(reply(value)); render(<CheckoutStatus />);
    expect(await screen.findByRole("heading", { name: "Checkout status is unavailable" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Open My ApplyPack" })).toHaveAttribute("href", "/my-applypack");
  });
  it("handles a lost network response without claiming successful cancellation", async () => {
    fetchMock.mockRejectedValue(new Error("offline")); render(<CheckoutStatus cancelled />);
    expect(await screen.findByRole("heading", { name: "Checkout status is unavailable" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Checkout was cancelled" })).not.toBeInTheDocument();
  });
  it("never cancels a checkout because of a return parameter, including focus and history restoration", async () => {
    fetchMock.mockResolvedValue(reply({ state: "CONFIRMING_PAYMENT" })); render(<CheckoutStatus cancelled />);
    expect(screen.queryByRole("heading", { name: "Checkout was cancelled" })).not.toBeInTheDocument();
    expect(await screen.findByText(/does not confirm cancellation or a refund/)).toBeVisible();
    fireEvent.focus(window); fireEvent(window, new Event("pageshow"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    for (const [path, options] of fetchMock.mock.calls) {
      expect(path).toBe("/api/checkout/search/status");
      expect(options).toEqual({ cache: "no-store", credentials: "same-origin" });
    }
  });
  it("shows verified server payment state even when the browser return says cancelled", async () => {
    fetchMock.mockResolvedValue(reply(paid)); render(<CheckoutStatus cancelled />);
    expect(await screen.findByRole("heading", { name: "Your search has started" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Checkout was cancelled" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open My ApplyPack" })).toHaveAttribute("href", `/my-applypack?order=${orderId}`);
  });
  it("reports cancellation only when the server's verified projection reports it", async () => {
    fetchMock.mockResolvedValue(reply({ state: "CANCELED" })); render(<CheckoutStatus />);
    expect(await screen.findByRole("heading", { name: "Checkout was cancelled" })).toBeVisible();
  });
  it("rejects a cancellation acknowledgement where a current status projection is required", async () => {
    fetchMock.mockResolvedValue(reply({ cancelled: true })); render(<CheckoutStatus cancelled />);
    expect(await screen.findByRole("heading", { name: "Checkout status is unavailable" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Checkout was cancelled" })).not.toBeInTheDocument();
  });
});

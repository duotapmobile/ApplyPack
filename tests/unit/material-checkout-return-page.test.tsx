import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const boundary = vi.hoisted(() => ({ cookies: vi.fn(), from: vi.fn(), user: { id: "a1150000-0000-4000-8000-000000000001" } as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: boundary.cookies }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => ({ from: boundary.from }) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: boundary.user } }) } }) }));
vi.mock("@/components/commerce/checkout-status", () => ({ CheckoutStatus: () => <div>SEARCH STATUS</div> }));
vi.mock("@/components/commerce/material-checkout-status", () => ({ MaterialCheckoutStatus: (props: { checkoutIntentId: string; cancelled: boolean }) => <div>PACK STATUS {props.checkoutIntentId} {props.cancelled ? "RETURNED" : "CHECKING"}</div> }));
import Page from "@/app/checkout/return/page";
import { serializeCheckoutCapability } from "@/lib/commerce/server";
const id = "a1150000-0000-4000-8000-000000000002";
beforeEach(() => { vi.resetAllMocks(); boundary.cookies.mockResolvedValue({ get: () => ({ value: serializeCheckoutCapability({ checkoutAttemptId: id, secret: "a".repeat(43) }) }) }); });
afterEach(cleanup);
describe("checkout return selects an explicit product before cookie-based search", () => {
  it.each([undefined, "1"])("routes the pack return despite a surviving search cookie (cancel=%s)", async cancelled => {
    render(await Page({ searchParams: Promise.resolve({ checkout_kind: "apply_pack", material_checkout_id: id, cancelled }) }));
    expect(screen.getByText(new RegExp(`PACK STATUS ${id}`))).toBeVisible(); expect(screen.queryByText("SEARCH STATUS")).not.toBeInTheDocument();
    expect(boundary.cookies).not.toHaveBeenCalled(); expect(boundary.from).not.toHaveBeenCalled();
  });
  it.each([undefined, "", "bad", [id, id]])("fails closed for missing or ambiguous pack locator (%#)", async material_checkout_id => {
    render(await Page({ searchParams: Promise.resolve({ checkout_kind: "apply_pack", material_checkout_id }) }));
    expect(screen.getByRole("heading", { name: "Apply Pack checkout cannot be identified" })).toBeVisible(); expect(boundary.cookies).not.toHaveBeenCalled();
  });
  it("does not reinterpret a wrong product as search", async () => {
    render(await Page({ searchParams: Promise.resolve({ checkout_kind: "search", material_checkout_id: id }) }));
    expect(screen.queryByText("SEARCH STATUS")).not.toBeInTheDocument(); expect(boundary.cookies).not.toHaveBeenCalled();
  });
  it("preserves the search cookie path with an explicit search marker", async () => {
    render(await Page({ searchParams: Promise.resolve({ checkout_kind: "search" }) })); expect(screen.getByText("SEARCH STATUS")).toBeVisible();
  });
  it.each([undefined, "1"])("keeps old unmarked provider returns neutral despite a surviving search cookie (cancel=%s)", async cancelled => {
    render(await Page({ searchParams: Promise.resolve({ cancelled }) }));
    expect(screen.getByRole("heading", { name: "Check your order in My ApplyPack" })).toBeVisible();
    expect(screen.queryByText("SEARCH STATUS")).not.toBeInTheDocument(); expect(boundary.cookies).not.toHaveBeenCalled();
  });
  it.each(["unknown", ["search", "apply_pack"], ["search"]])("does not use a malformed or duplicated product marker (%#)", async checkout_kind => {
    render(await Page({ searchParams: Promise.resolve({ checkout_kind }) }));
    expect(screen.queryByText("SEARCH STATUS")).not.toBeInTheDocument(); expect(boundary.cookies).not.toHaveBeenCalled();
  });
  it("requires a valid search cookie for explicit search cancellation", async () => {
    boundary.cookies.mockResolvedValue({ get: () => ({ value: "invalid" }) });
    render(await Page({ searchParams: Promise.resolve({ checkout_kind: "search", cancelled: "1" }) }));
    expect(screen.getByRole("heading", { name: "Search checkout cannot be identified" })).toBeVisible(); expect(screen.queryByText("SEARCH STATUS")).not.toBeInTheDocument();
  });
  it("prioritizes legacy authenticated session lookup over a surviving search cookie and cancel flag", async () => {
    const eq = vi.fn(); boundary.from.mockImplementation(() => { const query = { select: () => query, eq: (...args: unknown[]) => { eq(...args); return query; }, maybeSingle: async () => ({ data: null, error: null }) }; return query; });
    render(await Page({ searchParams: Promise.resolve({ session_id: "cs_test_legacy", cancelled: "1" }) }));
    expect(screen.getByRole("heading", { name: "Payment verification is still processing" })).toBeVisible();
    expect(eq).toHaveBeenCalledWith("customer_id", "a1150000-0000-4000-8000-000000000001");
    expect(boundary.cookies).not.toHaveBeenCalled();
  });
});

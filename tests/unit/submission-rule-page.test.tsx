import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { auth, queue } = vi.hoisted(() => ({ auth: vi.fn(), queue: vi.fn() }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: auth }));
vi.mock("@/lib/documents/submission-rule-supabase", async (original) => ({ ...await original<typeof import("@/lib/documents/submission-rule-supabase")>(), loadSubmissionRuleQueue: queue }));
vi.mock("@/components/admin/submission-rule-review", () => ({ SubmissionRuleReview: ({ jobSnapshotId }: { jobSnapshotId: string }) => <div data-testid="selected-review">{jobSnapshotId}</div> }));
import Page, { dynamic, metadata } from "@/app/admin/submission-rules/page";
const id = "a1160000-0000-4000-8000-000000000001";
beforeEach(() => { auth.mockReset().mockResolvedValue({ ok: true, user: { id }, admin: {} }); queue.mockReset().mockResolvedValue({ jobs: [], nextCursor: null, unavailable: false }); });
afterEach(cleanup);
describe("actual employer instruction admin page", () => {
  it("requires fresh admin verification before any queue read or selected mount", async () => {
    auth.mockResolvedValue({ ok: false, response: Response.json({}, { status: 403 }) });
    render(await Page({ searchParams: Promise.resolve({ job: id }) })); expect(screen.getByRole("heading", { name: "Verify administrator access" })).toBeTruthy();
    expect(queue).not.toHaveBeenCalled(); expect(screen.queryByTestId("selected-review")).toBeNull();
    expect(dynamic).toBe("force-dynamic"); expect(metadata.robots).toEqual({ index: false, follow: false, noarchive: true });
  });
  it.each([{ job: [id, id] }, { unknown: "1" }, { job: "bad" }, { cursor: "bad!!" }, { cursor: ["a", "b"] }])("rejects invalid locators%j without queue access", async (searchParams) => {
    render(await Page({ searchParams: Promise.resolve(searchParams) })); expect(screen.getByRole("heading", { name: "Review locator unavailable" })).toBeTruthy(); expect(queue).not.toHaveBeenCalled();
  });
  it("shows bounded navigation and one explicitly selected review with escaped employer text", async () => {
    const cursor = Buffer.from(JSON.stringify({ liveVerifiedAt: "2026-10-27T11:00:00.000Z", id })).toString("base64url");
    queue.mockResolvedValue({ jobs: [{ id, company: "<script>bad()</script>", title: "Support", verifiedAt: "2026-10-27T11:00:00.000Z" }], nextCursor: cursor, unavailable: false });
    const { container } = render(await Page({ searchParams: Promise.resolve({ job: id }) }));
    expect(screen.getByTestId("selected-review")).toHaveTextContent(id); expect(screen.getAllByTestId("selected-review")).toHaveLength(1);
    expect(container.querySelector("script")).toBeNull(); expect(screen.getByRole("link", { name: /Support/ }).getAttribute("href")).toBe(`/admin/submission-rules?job=${id}`);
    expect(screen.getByRole("link", { name: "Next page of source snapshots" }).getAttribute("href")).toBe(`/admin/submission-rules?cursor=${cursor}`);
    expect(screen.getByText(/does not renew the listing verification time/)).toBeTruthy();
  });
  it("distinguishes unavailable queue from empty and does not mount an automatic selected job", async () => {
    queue.mockResolvedValue({ jobs: [], nextCursor: null, unavailable: true }); render(await Page({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("alert")).toHaveTextContent("queue is unavailable"); expect(screen.queryByText(/No current sources/)).toBeNull(); expect(screen.queryByTestId("selected-review")).toBeNull();
  });
});

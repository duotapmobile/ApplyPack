import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { PendingIntakes } from "@/components/admin/pending-intakes";
import { feasibilityQueuePage, loadFeasibilityQueue } from "@/lib/matching/feasibility-queue";

const now = Date.parse("2026-10-25T12:00:00Z");
const tables: Record<string, { data: unknown[] | null; error: unknown }> = {};
const calls: Array<[string, string, ...unknown[]]> = [];
const admin = { from(table: string) {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "neq", "in", "order", "range"]) query[method] = (...args: unknown[]) => {
    calls.push([table, method, ...args]); return query;
  };
  query.returns = () => Promise.resolve(tables[table]);
  return query;
} } as unknown as Parameters<typeof loadFeasibilityQueue>[0];
const request = { id: "request", snapshot_id: "snapshot", state: "COMPLETED", created_at: "2026-10-25T11:00:00Z",
  updated_at: "2026-10-25T11:05:00Z", error_code: null, completed_assessment_id: "assessment" };
const assessment = { id: "assessment", snapshot_id: "snapshot", state: "COMPLETE", outcome: "LIMITED",
  resolution_blocker: "NONE", reasons: ["INVENTORY_SHORTAGE"], preliminarily_deliverable_count: 7,
  invalidated_at: null, expires_at: "2026-10-25T13:00:00Z" };
const snapshot = { id: "snapshot", access_email_normalized: "customer@example.test", desired_activities: ["CUSTOMER_SUPPORT"],
  search_breadth: "BROAD", guidance_requested: false, work_modes: ["REMOTE"], preferred_work_mode: null,
  us_state_or_dc: "FL", employment_types: ["FULL_TIME"], preferred_employment_type: null,
  benefits: {}, work_condition_preferences: {}, dealbreakers: [], employer_unknown_policy: {},
  salary_hard_minimum_cents: null, salary_period: null };

beforeEach(() => {
  calls.length = 0;
  tables.ap_feasibility_requests = { data: [{ ...request }], error: null };
  tables.ap_feasibility_assessments = { data: [{ ...assessment }], error: null };
  tables.ap_intake_snapshots = { data: [{ ...snapshot }], error: null };
});
afterEach(cleanup);

describe("owner intake research queue", () => {
  it.each([
    { state: "ERROR", outcome: null, expected: /Research failed/ },
    { state: "CLAIMED", outcome: null, expected: /Research in progress/ },
    { state: "PENDING", outcome: null, expected: /Waiting for research/ },
    { state: "COMPLETED", outcome: "LIMITED", expected: /Limited matches/ },
    { state: "COMPLETED", outcome: "INFEASIBLE", expected: /Search not currently feasible/ },
  ])("keeps $state/$outcome visible with its next step", async ({ state, outcome, expected }) => {
    tables.ap_feasibility_requests.data = [{ ...request, state, completed_assessment_id: outcome ? "assessment" : null }];
    tables.ap_feasibility_assessments.data = outcome ? [{ ...assessment, outcome }] : [];
    const queue = await loadFeasibilityQueue(admin, "1");
    render(<PendingIntakes {...queue} now={now} />);
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.getByText("customer@example.test")).toBeInTheDocument();
    expect(calls).toContainEqual(["ap_feasibility_requests", "neq", "state", "STALE"]);
    expect(calls).not.toContainEqual(["ap_feasibility_requests", "eq", "state", "PENDING"]);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it.each(["ap_feasibility_requests", "ap_feasibility_assessments", "ap_intake_snapshots"])("does not turn a %s failure into an empty queue", async (table) => {
    tables[table] = { data: null, error: { message: "private provider failure" } };
    render(<PendingIntakes {...await loadFeasibilityQueue(admin, "1")} now={now} />);
    expect(screen.getByRole("alert")).toHaveTextContent("workload is unknown");
    expect(screen.queryByText("No current intake research requests.")).not.toBeInTheDocument();
    expect(screen.queryByText(/private provider failure/)).not.toBeInTheDocument();
  });

  it("pages deterministically without hiding the next batch", async () => {
    tables.ap_feasibility_requests.data = Array.from({ length: 51 }, (_, index) => ({ ...request, id: `request-${index}` }));
    const queue = await loadFeasibilityQueue(admin, "2");
    expect(queue.requests).toHaveLength(50);
    expect(queue.hasMore).toBe(true);
    expect(calls).toContainEqual(["ap_feasibility_requests", "range", 50, 100]);
    expect(calls.filter((call) => call[0] === "ap_feasibility_requests" && call[1] === "order").map((call) => call[2])).toEqual(["created_at", "id"]);
    render(<PendingIntakes {...queue} now={now} />);
    const navigation = screen.getByRole("navigation", { name: "Intake research pages" });
    expect(within(navigation).getByRole("link", { name: "Previous intake page" })).toHaveAttribute("href", "/admin?intakePage=1#intake-feasibility");
    expect(within(navigation).getByRole("link", { name: "Next intake page" })).toHaveAttribute("href", "/admin?intakePage=3#intake-feasibility");
  });

  it.each([
    { snapshot_id: "different-snapshot" }, { id: "different-assessment" },
  ])("does not display a different assessment as this request's result", async (change) => {
    tables.ap_feasibility_assessments.data = [{ ...assessment, ...change, outcome: "LIKELY", preliminarily_deliverable_count: 10 }];
    render(<PendingIntakes {...await loadFeasibilityQueue(admin, "1")} now={now} />);
    expect(screen.getByText(/Assessment unavailable/)).toBeInTheDocument();
    expect(screen.queryByText(/Enough preliminary matches/)).not.toBeInTheDocument();
  });

  it.each([{ invalidated_at: "2026-10-25T11:55:00Z" }, { expires_at: "2026-10-25T11:59:00Z" }, { expires_at: "invalid" }])("flags stale assessments instead of presenting them as current", async (change) => {
    tables.ap_feasibility_assessments.data = [{ ...assessment, ...change }];
    render(<PendingIntakes {...await loadFeasibilityQueue(admin, "1")} now={now} />);
    expect(screen.getByText(/Assessment expired or replaced/)).toBeInTheDocument();
  });

  it("shows a verified empty response as empty without extra reads", async () => {
    tables.ap_feasibility_requests.data = [];
    render(<PendingIntakes {...await loadFeasibilityQueue(admin, "1")} now={now} />);
    expect(screen.getByText("No current intake research requests.")).toBeInTheDocument();
    expect(calls.every((call) => call[0] === "ap_feasibility_requests")).toBe(true);
  });

  it.each([undefined, "0", "-1", "1.5", "1e3", ["2", "3"], "999999999999999999"])("rejects an invalid page value %j", (page) => {
    expect(feasibilityQueuePage(page)).toBe(1);
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MatchingGuidedControls } from "@/components/admin/matching-guided-controls";
import { matchingReviewRequestSchema } from "@/lib/matching/review";

const id = (n: number) => `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const packet = {
  ap_intake_snapshots: [{ id: id(1), travel: { zipCode: "23220", commuteDistanceMiles: 25 } }],
  inventoryMembers: [{ id: id(2), selected_by_deduplication: true, job_snapshot_id: id(3), job_snapshot: { company: "Fictional company", exact_title: "Support" } }],
  requirementNodes: [{ id: id(4), job_snapshot_id: id(3), node_kind: "CRITERION", typed_value: { kind: "WORK_MODE" }, source_locator: "line:1", source_excerpt: "Onsite work at 100 Example Street" }],
};
const change = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
function form() {
  const callback = vi.fn(); const view = render(<MatchingGuidedControls snapshotId={id(1)} packet={packet} onPrepare={callback} />);
  change("Research action", "COMMUTE"); change("Job to review", id(2));
  return { callback, ...view };
}
function fill(miles = "12.4") {
  change("Employer worksite evidence", id(4)); change("Exact worksite name or address from that evidence", "100 Example Street");
  change("Worksite detail", "STREET_ADDRESS"); change("Travel method", "DRIVE");
  change("One-way route distance in miles", miles); change("One-way route time in minutes", "28");
  change("Route source link", "https://maps.example.invalid/fictional"); change(/When you checked/, "2026-10-25T10:00");
  change(/Route conditions/, "Checked fictional route with the confirmed starting ZIP area.");
}
afterEach(cleanup);
describe("owner commute review controls", () => {
  it("shows confirmed origin and prepares a typed measurement with explicit review", () => {
    const { callback } = form(); expect(screen.getByText("23220")).toBeVisible();
    fill(); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Prepare commute review" }));
    expect(callback).toHaveBeenCalledTimes(1); const operation = callback.mock.calls[0][0];
    expect(matchingReviewRequestSchema.safeParse(operation.payload).success).toBe(true);
    expect(operation.payload).toMatchObject({ disposition: "RESOLVED_PASS", customerCriterionKey: "customer:commute:25-miles", commuteObservation: { method: "DRIVE", oneWayMiles: 12.4, oneWayMinutes: 28 } });
  });
  it("derives a failing result when measured distance exceeds the confirmed limit", () => {
    const { callback } = form(); fill("26"); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Prepare commute review" }));
    expect(callback.mock.calls[0][0].payload.disposition).toBe("RESOLVED_FAIL");
  });
  it("requires renewed attestation after a measurement changes", () => {
    const { callback, container } = form(); fill(); fireEvent.click(screen.getByRole("checkbox")); change("One-way route distance in miles", "40");
    expect(screen.getByRole("checkbox")).not.toBeChecked(); fireEvent.submit(container.querySelector("form")!); expect(callback).not.toHaveBeenCalled();
  });
  it("rejects a destination absent from the exact cited employer evidence", () => {
    const { callback } = form(); fill(); change("Exact worksite name or address from that evidence", "Another workplace"); fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "Prepare commute review" }));
    expect(callback).not.toHaveBeenCalled(); expect(screen.getByRole("alert")).toHaveTextContent("Copy the actual worksite");
  });
});

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MatchingGuidedControls } from "@/components/admin/matching-guided-controls";
import { MatchingWorkbench } from "@/components/admin/matching-workbench";
import { matchingReviewRequestSchema } from "@/lib/matching/review";

const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const snapshot = id(1), job = id(2), member = id(3), node = id(4), fact = id(5), criterion = id(6);
const reviews = ["MATCH_EVIDENCE", "CATEGORICAL_USEFULNESS", "COMPENSATION_COMPARABILITY"].map((review_kind, index) => ({
  id: id(20 + index), snapshot_id: snapshot, job_snapshot_id: job, review_kind,
  rationale: `Current reviewed ${review_kind}`, decision: { disposition: "RESOLVED_PASS" },
}));
const packet = {
  ap_intake_snapshots: [{ id: snapshot, schema_version: "intake-v2", content_sha256: "a".repeat(64) }],
  inventoryMembers: [{ id: member, job_snapshot_id: job, selected_by_deduplication: true,
    job_snapshot: { company: "Example employer", exact_title: "Support specialist" } },
  { id: id(40), job_snapshot_id: id(41), selected_by_deduplication: false, job_snapshot: { company: "Excluded duplicate", exact_title: "Do not select" } }],
  requirementNodes: [{ id: node, job_snapshot_id: job, node_kind: "CRITERION", stable_criterion_id: criterion,
    criterion_type: "COMPENSATION", source_excerpt: "Published employer requirement" },
  { id: id(42), job_snapshot_id: id(41), node_kind: "CRITERION", source_excerpt: "Another customer's listing" }],
  ap_candidate_facts: [{ id: fact, snapshot_id: snapshot, verification: "CUSTOMER_CONFIRMED", customer_display_label: "Confirmed experience", customer_display_value: "Customer support" },
    { id: id(43), snapshot_id: snapshot, verification: "EXTRACTED_UNCONFIRMED", customer_display_label: "Unconfirmed experience" },
    { id: id(44), snapshot_id: id(45), verification: "CUSTOMER_CONFIRMED", customer_display_label: "Another customer's fact" }],
  ap_human_review_records: [...reviews, { ...reviews[0], id: id(46), invalidated_at: "2026-10-23T00:00:00Z", rationale: "Stale review" },
    { ...reviews[0], id: id(47), snapshot_id: id(45), rationale: "Another customer's review" }],
  ap_match_evaluations: [{ job_snapshot_id: job, active_root_keys: ["customer:work-mode"] }],
  sourceConfigurations: [{ id: id(10), config_version: "Manual source review v1", result_bound: 20 }],
};
function change(label: string | RegExp, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
function check(name: string | RegExp) { fireEvent.click(screen.getByRole("checkbox", { name })); }
function action(value: string) {
  change("Research action", value);
  if (value !== "BEGIN") change("Job to review", member);
}
function common() {
  fireEvent.click(within(screen.getByRole("group", { name: "Employer evidence reviewed" })).getByRole("checkbox"));
  fireEvent.click(within(screen.getByRole("group", { name: "Confirmed candidate facts reviewed" })).getByRole("checkbox"));
  change("Evidence findings or changes, one per line", "Compared the published requirement with the confirmed experience.");
  change("Your review rationale", "The exact source and candidate evidence were reviewed independently.");
}
function prepare() { check(/I reviewed these choices/); fireEvent.click(screen.getByRole("button", { name: "Prepare reviewed operation" })); }
function preparedPayload(callback: ReturnType<typeof vi.fn>) {
  expect(callback).toHaveBeenCalledTimes(1);
  const operation = callback.mock.calls[0][0];
  expect(operation.endpoint).toBe("matching-reviews");
  const parsed = matchingReviewRequestSchema.safeParse(operation.payload);
  expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  return operation.payload;
}

describe("guided matching evidence review", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("requires explicit current source selection, a round, and a human review before preparing research", () => {
    const callback = vi.fn();
    const { container } = render(<MatchingGuidedControls snapshotId={snapshot} packet={packet} onPrepare={callback} />);
    expect(screen.getAllByRole("checkbox").every((input) => !(input as HTMLInputElement).checked)).toBe(true);
    fireEvent.submit(container.querySelector("form")!);
    expect(callback).not.toHaveBeenCalled();
    check("Manual source review v1 — maximum 20 results"); change("Research round", "1"); prepare();
    expect(callback).toHaveBeenCalledWith({ endpoint: "matching-research", payload: { action: "BEGIN", snapshotId: snapshot, configurationIds: [id(10)], round: 1 }, summary: expect.any(String) });
    expect(screen.queryByLabelText(/JSON|identifier|payload/i)).not.toBeInTheDocument();
  });

  it("submits a schema-valid exact criterion and confirmed fact version, excluding other customer and unconfirmed evidence", () => {
    const callback = vi.fn(); render(<MatchingGuidedControls snapshotId={snapshot} packet={packet} onPrepare={callback} />);
    action("MATCH_EVIDENCE"); change("Exact employer requirement", node); common();
    expect(screen.queryByText("Unconfirmed experience")).not.toBeInTheDocument();
    expect(screen.queryByText("Another customer's fact")).not.toBeInTheDocument();
    expect(screen.queryByText("Excluded duplicate — Do not select")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Review finding")).toHaveValue("REQUIRES_MORE_EVIDENCE");
    change("Review finding", "RESOLVED_PASS"); prepare();
    expect(preparedPayload(callback)).toMatchObject({ snapshotId: snapshot, jobSnapshotId: job, stableCriterionId: criterion,
      sourceEvidenceNodeIds: [node], candidateFactIds: [fact], candidateFactVersionIds: [fact], evidenceRelation: "DIRECT" });
  });

  it("clears the human attestation after evidence edits and after switching actions", () => {
    const callback = vi.fn(); const { container } = render(<MatchingGuidedControls snapshotId={snapshot} packet={packet} onPrepare={callback} />);
    action("MATCH_EVIDENCE"); change("Exact employer requirement", node); common(); check(/I reviewed these choices/);
    change("Your review rationale", "This changed evidence needs another explicit human review.");
    expect(screen.getByRole("checkbox", { name: /I reviewed these choices/ })).not.toBeChecked();
    fireEvent.submit(container.querySelector("form")!); expect(callback).not.toHaveBeenCalled();
    change("Research action", "PARSER_CORRECTION");
    expect(screen.getByRole("checkbox", { name: /I reviewed these choices/ })).not.toBeChecked();
    expect(screen.getByLabelText("Your review rationale")).toHaveValue("");
  });

  it("requires explicit evidence for all five suitability explanations and no-padding approval", () => {
    const callback = vi.fn(); render(<MatchingGuidedControls snapshotId={snapshot} packet={packet} onPrepare={callback} />);
    action("CATEGORICAL_USEFULNESS"); common();
    for (const label of ["What the job involves", "Why it belongs on this list", "How the candidate's experience connects", "What may be new for the candidate", "What the candidate should know"]) {
      fireEvent.click(screen.getByText(label, { selector: "summary" }));
      fireEvent.click(within(screen.getByRole("group", { name: `${label}: employer evidence` })).getByRole("checkbox"));
      fireEvent.click(within(screen.getByRole("group", { name: `${label}: candidate facts` })).getByRole("checkbox"));
    }
    change("Application readiness", "READY"); change("Presentation risk", "LOW");
    change("Why this opportunity is worth applying to", "The role uses this customer's documented support experience.");
    check(/I independently reviewed this opportunity/); prepare();
    expect(preparedPayload(callback)).toMatchObject({ certifiedNotQuotaFiller: true, applicationReadiness: "READY", presentationRisk: "LOW" });
  });

  it("preserves the saved consent version for an explicitly permitted employer omission", () => {
    const callback = vi.fn(); render(<MatchingGuidedControls snapshotId={snapshot} packet={packet} onPrepare={callback} />);
    action("CUSTOMER_CRITERION"); common(); change("Customer requirement", "customer:work-mode");
    change("Why the requirement is unresolved", "EMPLOYER_OMITTED"); check(/exact saved criteria permit/);
    change("Warning the customer must see", "The employer has not specified its work arrangement."); prepare();
    expect(preparedPayload(callback)).toMatchObject({ disposition: "REQUIRES_MORE_EVIDENCE", resolutionIssue: "EMPLOYER_OMITTED",
      unknownTreatment: "ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING", consentVersion: `intake-v2:${"a".repeat(64)}` });
  });

  it("records explicit compensation findings against the selected published range", () => {
    const callback = vi.fn(); render(<MatchingGuidedControls snapshotId={snapshot} packet={packet} onPrepare={callback} />);
    action("COMPENSATION_COMPARABILITY"); common(); change("Published compensation range being compared", node);
    change("Is this the correct range for the candidate's location?", "yes"); change("Is the employment and pay basis comparable?", "no"); prepare();
    expect(preparedPayload(callback)).toMatchObject({ selectedCompensationCriterionId: criterion, correctLocationRange: true, workerBasisComparable: false });
  });

  it("uses the current inventory member when correcting captured listing text", () => {
    const callback = vi.fn(); render(<MatchingGuidedControls snapshotId={snapshot} packet={packet} onPrepare={callback} />);
    action("PARSER_CORRECTION"); common(); change("Corrected exact listing text", "The exact listing text reviewed from the employer's official page.");
    change("Review finding", "RESOLVED_PASS"); prepare();
    expect(preparedPayload(callback)).toMatchObject({ inventoryMemberId: member, reviewKind: "PARSER_CORRECTION" });
  });

  it("evaluates only selected current reviews and never sends operator-supplied scores", () => {
    const callback = vi.fn(); render(<MatchingGuidedControls snapshotId={snapshot} packet={packet} onPrepare={callback} />);
    action("EVALUATE");
    expect(screen.queryByText(/Stale review|Another customer's review/)).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("group", { name: "Current requirement evidence reviews" })).getByRole("checkbox"));
    change("Current suitability review", id(21)); prepare();
    expect(callback).toHaveBeenCalledWith({ endpoint: "matching-evaluations", payload: { snapshotId: snapshot, inventoryMemberId: member,
      jobSnapshotId: job, evidenceReviewIds: [id(20)], usefulnessReviewId: id(21), compensationReviewId: null }, summary: expect.any(String) });
  });
});

describe("guided workbench confirmation and refresh", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  async function setup(postFails = false) {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        if (postFails) throw new Error("Connection interrupted");
        return { ok: true, json: async () => ({}) };
      }
      return { ok: true, json: async () => url === "/api/admin/job-sources" ? { sources: [] } : packet };
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<MatchingWorkbench intakes={[{ id: snapshot, label: "Customer awaiting review" }]} />);
    change("Customer intake", snapshot); fireEvent.click(screen.getByRole("button", { name: "Load or refresh review evidence" }));
    await screen.findByRole("heading", { name: "Review research and evidence" });
    return fetchMock;
  }
  function prepareRound() { check("Manual source review v1 — maximum 20 results"); change("Research round", "1"); prepare(); }

  it("requires a separate final confirmation, freezes prepared inputs, then reloads without carrying approvals", async () => {
    const fetchMock = await setup(); prepareRound();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    expect(screen.getByLabelText("Research action")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Record reviewed operation" })).toBeDisabled();
    check(/I confirm this exact prepared operation/); fireEvent.click(screen.getByRole("button", { name: "Record reviewed operation" }));
    await screen.findByText(/Reviewed operation recorded/);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Confirm this reviewed operation" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /I reviewed these choices/ })).not.toBeChecked();
    expect(screen.getByLabelText("Research round")).toHaveValue("");
  });

  it("requires a packet reload after an uncertain write and clears all previous approvals on that reload", async () => {
    const fetchMock = await setup(true); prepareRound(); check(/I confirm this exact prepared operation/);
    fireEvent.click(screen.getByRole("button", { name: "Record reviewed operation" }));
    await screen.findByText(/prior request may have completed/);
    expect(screen.getByRole("button", { name: "Record reviewed operation" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /I confirm this exact/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Load or refresh review evidence" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Confirm this reviewed operation" })).not.toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: /I reviewed these choices/ })).not.toBeChecked();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
});

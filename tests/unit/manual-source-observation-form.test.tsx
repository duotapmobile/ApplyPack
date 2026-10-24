import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManualSourceObservation, type ManualObservationSource } from "@/components/admin/manual-source-observation";
import { manualSourceObservationSchema } from "@/lib/jobs/manual-source-inventory";

const permitted: ManualObservationSource = { id: "vipdesk-connect", name: "VIPdesk Connect", isActive: true,
  policy: { authorization: { state: "AUTHORIZED_MANUAL_ONLY", allowed_actions: ["MANUAL_REVIEW"] } } };
const instant = new Date("2026-10-23T16:00:00Z");
const form = () => screen.getByRole("form", { name: "Record an official job listing" });
function change(label: string | RegExp, value: string) { fireEvent.change(within(form()).getByLabelText(label), { target: { value } }); }
function fill() {
  change("Approved source", permitted.id); change("Employer name", "VIPdesk Connect"); change("Job title", "Operations Coordinator");
  change("Official listing address", "https://jobs.lever.co/vipdesk/manual-1");
  change("Official application address", "https://jobs.lever.co/vipdesk/manual-1/apply");
  change("Exact text copied from the listing", "Required: 3 years of customer operations experience. Responsibilities: coordinate service recovery.");
  change("Evidence notes", "I opened and inspected the employer listing and working application page.");
  change("Why this observation is being recorded", "This official listing is being recorded for the current customer search.");
}
function affirm() { for (const checkbox of within(form()).getAllByRole("checkbox")) fireEvent.click(checkbox); }

describe("guided manual source observations", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(instant); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("offers only active sources with current manual-only review permission", () => {
    const sources = [permitted, { ...permitted, id: "inactive", name: "Inactive source", isActive: false },
      { ...permitted, id: "automatic", name: "Automatic-only source", policy: { authorization: { state: "AUTHORIZED_AUTOMATED", allowed_actions: ["MANUAL_REVIEW"] } } },
      { ...permitted, id: "no-action", name: "Source missing action", policy: { authorization: { state: "AUTHORIZED_MANUAL_ONLY", allowed_actions: [] } } },
      { ...permitted, id: "no-policy", name: "Unreviewed source", policy: null }];
    render(<ManualSourceObservation sources={sources} onPrepare={vi.fn()} />);
    const source = within(form()).getByRole("combobox", { name: "Approved source" });
    expect(within(source).getAllByRole("option")).toHaveLength(2);
    expect(within(source).getByRole("option", { name: permitted.name })).toBeInTheDocument();
    expect(screen.queryByLabelText(/UUID|JSON|observation ID/i)).not.toBeInTheDocument();
  });

  it("requires every explicit human check and complete details even for direct form submission", () => {
    const onPrepare = vi.fn(); render(<ManualSourceObservation sources={[permitted]} onPrepare={onPrepare} />);
    for (const checkbox of within(form()).getAllByRole("checkbox")) expect(checkbox).not.toBeChecked();
    fireEvent.submit(form()); expect(onPrepare).not.toHaveBeenCalled();
    fill();
    expect(within(form()).getByRole("button", { name: "Review observation before saving" })).toBeDisabled();
    const checks = within(form()).getAllByRole("checkbox"); checks.slice(0, 3).forEach((checkbox) => fireEvent.click(checkbox));
    fireEvent.submit(form()); expect(onPrepare).not.toHaveBeenCalled();
    fireEvent.click(checks[3]); fireEvent.submit(form()); expect(onPrepare).toHaveBeenCalledOnce();
  });

  it("prepares a schema-valid observation while preserving unknown details and a readable review", () => {
    const onPrepare = vi.fn(); render(<ManualSourceObservation sources={[permitted]} onPrepare={onPrepare} />);
    fill(); affirm(); fireEvent.submit(form());
    const [payload, summary] = onPrepare.mock.calls[0];
    expect(manualSourceObservationSchema.safeParse(payload).success).toBe(true);
    expect(payload.posting).toMatchObject({ sourceId: permitted.id, externalJobId: null, location: null,
      employmentType: null, salaryMin: null, salaryMax: null, salaryCurrency: null, payPeriod: "unknown",
      eligibleStates: [], eligibleCountries: [] });
    expect(payload.review.checkedAt).toBe(instant.toISOString());
    expect(summary).toContain("Operations Coordinator at VIPdesk Connect");
    expect(summary).toContain(payload.review.capturedText);
    expect(summary).not.toContain(payload.observationId);
    expect(summary).toContain("Pay: Not stated");
  });

  it("keeps an identical retry's identifier and original review time while re-reviewing changed inputs", () => {
    const onPrepare = vi.fn(); render(<ManualSourceObservation sources={[permitted]} onPrepare={onPrepare} />);
    fill(); affirm(); fireEvent.submit(form());
    const original = onPrepare.mock.calls[0][0];
    vi.setSystemTime(new Date(instant.getTime() + 60_000)); fireEvent.submit(form());
    expect(onPrepare.mock.calls[1][0]).toEqual(original);
    change("Job title", "Senior Operations Coordinator");
    for (const checkbox of within(form()).getAllByRole("checkbox")) expect(checkbox).not.toBeChecked();
    fireEvent.submit(form()); expect(onPrepare).toHaveBeenCalledTimes(2);
    affirm(); fireEvent.submit(form());
    expect(onPrepare.mock.calls[2][0].observationId).not.toBe(original.observationId);
    expect(onPrepare.mock.calls[2][0].review.checkedAt).not.toBe(original.review.checkedAt);
  });

  it("requires another live check after fifteen minutes instead of silently refreshing the timestamp", () => {
    const onPrepare = vi.fn(); render(<ManualSourceObservation sources={[permitted]} onPrepare={onPrepare} />);
    fill(); affirm(); vi.setSystemTime(new Date(instant.getTime() + 15 * 60_000 + 1));
    fireEvent.submit(form()); expect(onPrepare).not.toHaveBeenCalled();
    expect(within(form()).getByRole("status")).toHaveTextContent("over 15 minutes old");
    for (const checkbox of within(form()).getAllByRole("checkbox")) expect(checkbox).not.toBeChecked();
    affirm(); fireEvent.submit(form()); expect(onPrepare).toHaveBeenCalledOnce();
  });

  it("blocks unsafe URLs and contradictory pay without preparing or linking them", () => {
    const onPrepare = vi.fn(); render(<ManualSourceObservation sources={[permitted]} onPrepare={onPrepare} />);
    fill(); change("Official listing address", "javascript:alert(1)"); affirm(); fireEvent.submit(form());
    expect(onPrepare).not.toHaveBeenCalled(); expect(within(form()).queryByRole("link", { name: "Open official listing" })).not.toBeInTheDocument();
    change("Official listing address", "https://user:password@example.com/private"); affirm(); fireEvent.submit(form());
    expect(onPrepare).not.toHaveBeenCalled();
    change("Official listing address", "https://jobs.lever.co/vipdesk/manual-1");
    change("Minimum stated pay", "25"); change("Maximum stated pay", "20"); affirm(); fireEvent.submit(form());
    expect(onPrepare).not.toHaveBeenCalled();
  });

  it("preserves optional employer facts and explicit listing changes without inventing missing facts", () => {
    const onPrepare = vi.fn(); render(<ManualSourceObservation sources={[permitted]} onPrepare={onPrepare} />);
    fill(); change("Employer job reference", "manual-1"); change("Location", "Remote in Virginia");
    change("Employment type", "Full-time"); change("Minimum stated pay", "20"); change("Maximum stated pay", "25");
    change(/Currency, if stated/, "usd"); change("Pay period", "hour");
    change("Eligible states, separated by commas", "VA, NC"); change("Eligible countries, separated by commas", "US");
    change("Listing change", "REOPENED"); affirm(); fireEvent.submit(form());
    const payload = onPrepare.mock.calls[0][0];
    expect(manualSourceObservationSchema.safeParse(payload).success).toBe(true);
    expect(payload.posting).toMatchObject({ externalJobId: "manual-1", location: "Remote in Virginia", employmentType: "Full-time",
      salaryMin: 20, salaryMax: 25, salaryCurrency: "USD", payPeriod: "hour", eligibleStates: ["VA", "NC"], eligibleCountries: ["US"] });
    expect(payload.review.lifecycleAction).toBe("REOPENED");
    expect(payload.posting.closingAt).toBeUndefined();
  });

  it("blocks preparation while saving or after the source permission disappears", () => {
    const onPrepare = vi.fn(); const { rerender } = render(<ManualSourceObservation sources={[permitted]} onPrepare={onPrepare} />);
    fill(); affirm(); rerender(<ManualSourceObservation sources={[permitted]} busy onPrepare={onPrepare} />);
    fireEvent.submit(form()); expect(onPrepare).not.toHaveBeenCalled();
    rerender(<ManualSourceObservation sources={[]} onPrepare={onPrepare} />);
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("No active source currently permits manual review");
  });
});

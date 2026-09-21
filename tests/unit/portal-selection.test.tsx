import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApplyPackSelector, type MatchForSelection } from "@/components/portal/apply-pack-selector-v2";

const match: MatchForSelection = {
  id: "11111111-1111-4111-8111-111111111111",
  position: 1,
  fit_summary: "A reviewed synthetic match.",
  matching_experience: ["Coordinated customer operations."],
  primary_outcome: "Keep records accurate.",
  core_responsibilities: ["Process documents."],
  requirements: ["Clear written communication."],
  hidden_job_functions: [],
  concerns: [],
  job_snapshot_id: "22222222-2222-4222-8222-222222222222",
  submission_rule_id: "33333333-3333-4333-8333-333333333333",
  reference_timing: "OPTIONAL_NOW",
  reference_count: 3,
  job: {
    company: "Synthetic Employer",
    title: "Operations Assistant",
    source_url: "https://example.com/jobs/1",
    official_application_url: "https://example.com/jobs/1",
    location_text: "Remote - Florida",
    salary_text: null,
    checked_at: new Date().toISOString(),
    listing_status: "open",
    is_active: true,
    review_status: "approved",
  },
};

describe("Tailored Resume + Cover Letter customer selection", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("lets a customer select a fresh reviewed job after capacity loads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ availableUnits: 2 }) }));
    render(<ApplyPackSelector
      matches={[match]}
      evaluatedAt={new Date().toISOString()}
      deliveredOrderId="44444444-4444-4444-8444-444444444444"
      deliveredReleaseId="55555555-5555-4555-8555-555555555555"
      sourceSnapshotId="66666666-6666-4666-8666-666666666666"
      initialEmail="synthetic@example.invalid"
    />);
    const checkbox = screen.getByRole("checkbox", { name: /Select Tailored Resume \+ Cover Letter for Operations Assistant/ });
    await waitFor(() => expect(checkbox).toBeEnabled());
    await userEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(screen.getByText("Selected")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /1 document set.*\$8 total/ })).toBeInTheDocument();
  });

  it("keeps the development-only manual fixture self-contained and gives every job card a meaningful name", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<ApplyPackSelector
      matches={[match]}
      evaluatedAt={new Date().toISOString()}
      deliveredOrderId="44444444-4444-4444-8444-444444444444"
      deliveredReleaseId="55555555-5555-4555-8555-555555555555"
      sourceSnapshotId="66666666-6666-4666-8666-666666666666"
      initialEmail="synthetic@example.invalid"
      fixtureAvailableUnits={10}
    />);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("article", { name: "Operations Assistant Synthetic Employer" })).toBeInTheDocument();
    const checkbox = screen.getByRole("checkbox", { name: /Select Tailored Resume \+ Cover Letter for Operations Assistant/ });
    expect(checkbox).toBeEnabled();
    await userEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(screen.getByRole("heading", { name: /1 document set.*\$8 total/ })).toBeInTheDocument();
  });

  it("renders the immutable exact-ten release with all five explanations and plain-language warnings", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ availableUnits: 10 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ references: [] }) }));
    const evaluatedAt = "2026-09-07T16:00:00.000Z";
    const matches = Array.from({ length: 10 }, (_, index): MatchForSelection => ({
      ...match,
      id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
      position: index + 1,
      job_snapshot_id: `22222222-2222-4222-8222-${String(index + 1).padStart(12, "0")}`,
      submission_rule_id: `33333333-3333-4333-8333-${String(index + 1).padStart(12, "0")}`,
      allowed_unknown_warnings: index === 0 ? ["UNPUBLISHED_PAY"] : [],
      source_provenance: { applicationHostType: "EMPLOYER_HOSTED" },
      release_explanation: {
        whatJobInvolves: "Coordinate current customer operations.",
        whyMadeList: "Every confirmed hard gate passed.",
        howExperienceConnects: "Confirmed coordination experience supports the role.",
        whatMayBeNew: "The employer workflow may be new.",
        whatToKnow: "Use the current employer-hosted application path.",
      },
      job: {
        ...match.job,
        company: `Synthetic Employer ${index + 1}`,
        title: `Operations Assistant ${index + 1}`,
        checked_at: "2026-09-07T15:30:00.000Z",
        official_application_url: `https://employer${index + 1}.example/apply`,
        salary_text: index === 0 ? null : "$70,000 annual base pay",
        w2_or_contractor: "w2",
        work_mode: "remote",
        benefits_status: "published",
      },
    }));
    render(<ApplyPackSelector
      matches={matches}
      evaluatedAt={evaluatedAt}
      deliveredOrderId="44444444-4444-4444-8444-444444444444"
      deliveredReleaseId="55555555-5555-4555-8555-555555555555"
      sourceSnapshotId="66666666-6666-4666-8666-666666666666"
      initialEmail="synthetic@example.invalid"
    />);

    expect(screen.getByRole("heading", { name: "10 Researched Job Matches" })).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(10);
    expect(screen.getAllByRole("heading", { name: "What this job actually involves" })).toHaveLength(10);
    expect(screen.getAllByRole("heading", { name: "Why this job made the list" })).toHaveLength(10);
    expect(screen.getAllByRole("heading", { name: "How your experience connects" })).toHaveLength(10);
    expect(screen.getAllByRole("heading", { name: "What may be new" })).toHaveLength(10);
    expect(screen.getAllByRole("heading", { name: "What to know" })).toHaveLength(10);
    expect(screen.getByText(/Compensation was not published\. Verify pay/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /View official application listing/ })).toHaveLength(10);
    expect(document.body.textContent).not.toContain("UNPUBLISHED_PAY");
    expect(document.body.textContent).not.toContain("EMPLOYER_HOSTED");
  });

  it("keeps stale delivered matches visible but unavailable for a new purchase", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ availableUnits: 10 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ references: [] }) }));
    render(<ApplyPackSelector
      matches={[{ ...match, job: { ...match.job, checked_at: "2026-09-05T12:00:00.000Z" } }]}
      evaluatedAt="2026-09-07T16:00:00.000Z"
      deliveredOrderId="44444444-4444-4444-8444-444444444444"
      deliveredReleaseId="55555555-5555-4555-8555-555555555555"
      sourceSnapshotId="66666666-6666-4666-8666-666666666666"
      initialEmail="synthetic@example.invalid"
    />);
    const checkbox = screen.getByRole("checkbox", { name: /Select Tailored Resume \+ Cover Letter/ });
    await waitFor(() => expect(screen.getByText(/Historical delivery/)).toBeInTheDocument());
    expect(checkbox).toBeDisabled();
  });
});

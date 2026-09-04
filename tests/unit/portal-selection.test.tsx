import { render, screen, waitFor } from "@testing-library/react";
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
  afterEach(() => vi.unstubAllGlobals());

  it("lets a customer select a fresh reviewed job after capacity loads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ availableUnits: 2 }) }));
    render(<ApplyPackSelector matches={[match]} evaluatedAt={new Date().toISOString()} />);
    const checkbox = screen.getByRole("checkbox", { name: /Select Tailored Resume \+ Cover Letter for Operations Assistant/ });
    await waitFor(() => expect(checkbox).toBeEnabled());
    await userEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(screen.getByText("Selected")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /1 document set.*\$8 total/ })).toBeInTheDocument();
  });
});

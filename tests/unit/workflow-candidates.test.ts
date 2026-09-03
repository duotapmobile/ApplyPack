import { describe, expect, it } from "vitest";
import { candidatePayload } from "@/lib/workflow/candidates";

describe("workflow candidate review payload", () => {
  it("prefers the official application URL and preserves unknown salary", () => {
    const result = candidatePayload(
      { fit_summary: "Official direct posting with transparent matching reasons.", concerns: ["State eligibility must be rechecked."] },
      {
        employer_display_name: "Example Employer",
        raw_title: "Support Coordinator",
        source_id: "example",
        source_name: "Example Careers",
        source_job_url: "https://jobs.example.com/123",
        official_application_url: "https://jobs.example.com/123/apply",
        last_verified_at: "2026-09-02T12:00:00.000Z",
      },
    );
    expect(result.sourceUrl).toBe("https://jobs.example.com/123/apply");
    expect(result.salary).toBe("Not listed");
    expect(result.concerns).toEqual(["State eligibility must be rechecked."]);
  });
});

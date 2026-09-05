import { afterEach, describe, expect, it, vi } from "vitest";
import { createSourceAdapter } from "@/lib/jobs/adapters";
import { LeverAdapter } from "@/lib/jobs/adapters/lever";
import { getSource } from "@/lib/jobs/source-registry";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.APP_JOB_SOURCE_MAX_POSTINGS;
});

function syntheticAuthorizedLever(sourceId: string) {
  return new LeverAdapter({ ...getSource(sourceId)!, isActive: true, authorizationStatus: "AUTHORIZED_AUTOMATED", authorizationEvidenceId: "synthetic-recorded-fixture-v1" });
}

describe("job source adapters", () => {
  it("keeps unsupported employer pages as official-link-only instead of scraping", async () => {
    const adapter = createSourceAdapter("foundever");
    await expect(adapter.fetchJobs()).resolves.toEqual([]);
    await expect(adapter.healthCheck()).resolves.toMatchObject({ status: "link_only", sourceId: "foundever" });
  });

  it("maps a bounded public Lever posting without applying or inventing fields", async () => {
    process.env.APP_JOB_SOURCE_MAX_POSTINGS = "250";
    const responseBody = [{
      id: "lever-123",
      text: "Customer Care Associate",
      descriptionPlain: "Full-time remote role in Texas. Email and chat support.",
      hostedUrl: "https://jobs.lever.co/vipdesk/lever-123",
      applyUrl: "https://jobs.lever.co/vipdesk/lever-123/apply",
      createdAt: Date.parse("2026-09-01T12:00:00.000Z"),
      categories: { location: "Texas, Remote", commitment: "Full-time", department: "Customer Care" },
    }];
    const response = new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const adapter = syntheticAuthorizedLever("vipdesk-connect");
    const jobs = await adapter.fetchJobs();
    expect(jobs).toEqual([expect.objectContaining({
      sourceId: "vipdesk-connect",
      employerName: "VIPdesk Connect",
      externalJobId: "lever-123",
      title: "Customer Care Associate",
      sourceJobUrl: "https://jobs.lever.co/vipdesk/lever-123",
      officialApplicationUrl: "https://jobs.lever.co/vipdesk/lever-123/apply",
      employmentType: "Full-time",
    })]);
    expect(jobs[0].salaryMin).toBeUndefined();
    expect(jobs[0].applicantCost).toBeUndefined();
  });

  it("reports a rate-limited Lever source without retrying", async () => {
    const mocked = vi.fn().mockResolvedValue(new Response("", { status: 429, headers: { "retry-after": "60" } }));
    vi.stubGlobal("fetch", mocked);
    const health = await syntheticAuthorizedLever("five-star-call-centers").healthCheck();
    expect(health).toMatchObject({ status: "rate_limited", httpStatus: 429 });
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it("fails closed before an unverified connector can access the network", () => {
    expect(() => createSourceAdapter("vipdesk-connect")).toThrow("documentarily authorized");
  });
});

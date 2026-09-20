import { afterEach, describe, expect, it, vi } from "vitest";
import { createSourceAdapter } from "@/lib/jobs/adapters";
import { AshbyAdapter } from "@/lib/jobs/adapters/ashby";
import { GreenhouseAdapter } from "@/lib/jobs/adapters/greenhouse";
import { LeverAdapter } from "@/lib/jobs/adapters/lever";
import { RecruiteeAdapter } from "@/lib/jobs/adapters/recruitee";
import { TeamtailorAdapter } from "@/lib/jobs/adapters/teamtailor";
import { fetchOfficialJson, readBoundedText } from "@/lib/jobs/adapters/fetch-policy";
import { getSource } from "@/lib/jobs/source-registry";
import type { SourceDefinition } from "@/lib/jobs/types";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.APP_JOB_SOURCE_MAX_POSTINGS;
});

function syntheticAuthorizedSource(sourceId: string): SourceDefinition {
  return { ...getSource(sourceId)!, isActive: true, authorizationStatus: "AUTHORIZED_AUTOMATED", authorizationEvidenceId: "synthetic-recorded-fixture-v1" };
}

function syntheticAuthorizedLever(sourceId: string) {
  return new LeverAdapter(syntheticAuthorizedSource(sourceId));
}

function syntheticSource(input: Partial<SourceDefinition> & Pick<SourceDefinition, "id" | "employerDisplayName" | "officialUrl" | "adapterKind">): SourceDefinition {
  return {
    canonicalEmployerId: input.id,
    sourceName: `${input.employerDisplayName} Careers`,
    category: "selective_broad_employer",
    authorizationStatus: "AUTHORIZED_AUTOMATED",
    authorizationEvidenceId: "synthetic-recorded-fixture-v1",
    authorizationVersion: "source-auth-test-v1",
    authorizationAllowedHosts: [],
    automationStatus: "automated",
    isOfficial: true,
    isDirectEmployer: true,
    isActive: true,
    priority: 50,
    ...input,
  };
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

  it("stops paginated Lever enumeration before exceeding its request bound", async () => {
    const page = Array.from({ length: 100 }, (_, index) => ({
      id: `lever-${index}`,
      text: `Role ${index}`,
      hostedUrl: `https://jobs.lever.co/vipdesk/lever-${index}`,
    }));
    const mocked = vi.fn().mockResolvedValue(new Response(JSON.stringify(page), { status: 200 }));
    vi.stubGlobal("fetch", mocked);
    const result = await syntheticAuthorizedLever("vipdesk-connect").enumerateJobs({ resultBound: 200, pageBound: 5, requestBound: 1 });
    expect(result).toMatchObject({
      completion: "partial",
      checkpoint: { cursor: "100", stopReason: "REQUEST_BOUND_REACHED" },
      counts: { pagesRequested: 1, pagesCompleted: 1, received: 100, mapped: 100, rejected: 0 },
    });
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it("fails closed before an unverified connector can access the network", () => {
    expect(() => createSourceAdapter("vipdesk-connect")).toThrow("documentarily authorized");
  });

  it("maps a configured Greenhouse tenant without employer-specific code", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ jobs: [{
      id: 123, title: "Operations Associate", absolute_url: "https://job-boards.greenhouse.io/duolingo/jobs/123",
      content: "<p>Remote operations role</p>", location: { name: "Remote - US" }, updated_at: "2026-09-08T12:00:00Z",
    }] }), { status: 200, headers: { "content-type": "application/json" } })));
    const jobs = await new GreenhouseAdapter(syntheticAuthorizedSource("duolingo")).fetchJobs();
    expect(jobs).toEqual([expect.objectContaining({ sourceId: "duolingo", externalJobId: "123", employerName: "Duolingo" })]);
  });

  it("upgrades an employer-owned Greenhouse HTTP link and rejects an unrelated host", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ jobs: [
      { id: 1, title: "Support", absolute_url: "http://block.xyz/careers/jobs/1" },
      { id: 2, title: "Injected", absolute_url: "https://example.com/jobs/2" },
    ] }), { status: 200, headers: { "content-type": "application/json" } })));
    const jobs = await new GreenhouseAdapter(syntheticAuthorizedSource("block")).fetchJobs();
    expect(jobs).toEqual([expect.objectContaining({ officialApplicationUrl: "https://block.xyz/careers/jobs/1" })]);
  });

  it("maps a configured Ashby tenant and excludes unlisted postings", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ jobs: [
      { title: "Support Specialist", jobUrl: "https://jobs.ashbyhq.com/brightwheel/abc", applyUrl: "https://jobs.ashbyhq.com/brightwheel/abc/application", location: "Remote", isListed: true },
      { title: "Hidden", jobUrl: "https://jobs.ashbyhq.com/brightwheel/hidden", isListed: false },
    ] }), { status: 200, headers: { "content-type": "application/json" } })));
    const jobs = await new AshbyAdapter(syntheticAuthorizedSource("brightwheel")).fetchJobs();
    expect(jobs).toEqual([expect.objectContaining({ sourceId: "brightwheel", externalJobId: "abc", employerName: "Brightwheel" })]);
  });

  it("maps a bounded Recruitee JSON offer from the authorized tenant", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ offers: [{
      id: 42,
      title: "Customer Support Specialist",
      careers_url: "https://acme.recruitee.com/o/customer-support-specialist",
      apply_url: "https://acme.recruitee.com/o/customer-support-specialist/c/new",
      location: { city: "Remote", country: "US" },
    }] }), { status: 200 })));
    const source = syntheticSource({
      id: "acme-recruitee",
      employerDisplayName: "Acme",
      officialUrl: "https://acme.recruitee.com/",
      adapterKind: "recruitee",
      adapterKey: "acme",
      authorizationAllowedHosts: ["acme.recruitee.com"],
    });
    const result = await new RecruiteeAdapter(source).enumerateJobs({ resultBound: 10, maximumResponseBytes: 50_000 });
    expect(result).toMatchObject({ completion: "complete", counts: { received: 1, mapped: 1, rejected: 0 } });
    expect(result.jobs[0]).toMatchObject({ externalJobId: "42", employerName: "Acme", location: "Remote, US" });
  });

  it("maps Teamtailor RSS and rejects XML entity declarations", async () => {
    const source = syntheticSource({
      id: "acme-teamtailor",
      employerDisplayName: "Acme",
      officialUrl: "https://careers.acme.test/",
      adapterKind: "teamtailor",
      adapterKey: "https://careers.acme.test/jobs.rss",
      authorizationAllowedHosts: ["careers.acme.test"],
    });
    const valid = `<rss><channel><item><title>Support Agent</title><link>https://careers.acme.test/jobs/1</link><guid>job-1</guid><description><![CDATA[Remote support]]></description><pubDate>Tue, 01 Sep 2026 12:00:00 GMT</pubDate></item></channel></rss>`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(valid, { status: 200 }))
      .mockResolvedValueOnce(new Response(`<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss><channel/></rss>`, { status: 200 })));
    const adapter = new TeamtailorAdapter(source);
    const complete = await adapter.enumerateJobs({ resultBound: 10, maximumResponseBytes: 50_000 });
    expect(complete).toMatchObject({ completion: "complete", counts: { received: 1, mapped: 1, rejected: 0 } });
    expect(complete.jobs[0]).toMatchObject({ externalJobId: "job-1", title: "Support Agent" });
    const rejected = await adapter.enumerateJobs({ resultBound: 10, maximumResponseBytes: 50_000 });
    expect(rejected).toMatchObject({ completion: "failed", responseClassification: "invalid_payload" });
  });

  it("rejects IP literals before any source request", async () => {
    const mocked = vi.fn();
    vi.stubGlobal("fetch", mocked);
    await expect(fetchOfficialJson("https://127.0.0.1/jobs", ["127.0.0.1"])).rejects.toThrow("outside the adapter allowlist");
    expect(mocked).not.toHaveBeenCalled();
  });

  it("rejects bracketed IPv6 literals before any source request", async () => {
    const mocked = vi.fn();
    vi.stubGlobal("fetch", mocked);
    await expect(fetchOfficialJson("https://[::1]/jobs", ["[::1]"])).rejects.toThrow("outside the adapter allowlist");
    expect(mocked).not.toHaveBeenCalled();
  });

  it("cancels a streaming response as soon as its byte bound is exceeded", async () => {
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
        controller.close();
      },
    }));
    await expect(readBoundedText(response, 5)).rejects.toThrow("configured size limit");
  });
});

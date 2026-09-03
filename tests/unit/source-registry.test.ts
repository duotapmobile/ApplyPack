import { describe, expect, it } from "vitest";
import { affiliateDirectories, heldOrExcludedSources, jobSources, sourceUrlMatchesDefinition } from "@/lib/jobs/source-registry";

describe("approved source registry", () => {
  it("registers every approved named employer in its separate category", () => {
    const employerSources = jobSources.filter((source) => source.canonicalEmployerId);
    expect(employerSources).toHaveLength(66);
    expect(employerSources.filter((source) => source.category === "core_direct_employer")).toHaveLength(30);
    expect(employerSources.filter((source) => source.category === "remote_first_employer")).toHaveLength(3);
    expect(employerSources.filter((source) => source.category === "selective_broad_employer")).toHaveLength(26);
    expect(employerSources.filter((source) => source.category === "contractor_staffing_flexible")).toHaveLength(7);
  });

  it("keeps Indeed and HiringCafe as explicit third-party compatibility sources", () => {
    for (const id of ["indeed", "hiringcafe"]) {
      expect(jobSources.find((source) => source.id === id)).toMatchObject({
        category: "third_party_aggregator",
        adapterKind: "existing_import",
        isOfficial: false,
        isDirectEmployer: false,
      });
    }
  });

  it("automates only the verified public Lever endpoints", () => {
    expect(jobSources.filter((source) => source.automationStatus === "automated").map((source) => source.id).sort()).toEqual(["five-star-call-centers", "vipdesk-connect"]);
    expect(jobSources.filter((source) => source.adapterKind === "lever").every((source) => Boolean(source.adapterKey))).toBe(true);
  });

  it("does not create generic Blue Cross Blue Shield or AAA employers", () => {
    expect(jobSources.some((source) => source.employerDisplayName === "Blue Cross Blue Shield" || source.employerDisplayName === "AAA")).toBe(false);
    expect(affiliateDirectories.map((directory) => directory.id).sort()).toEqual(["aaa-affiliate-directory", "bcbs-affiliate-directory"]);
  });

  it("never registers Liveops as a source", () => {
    expect(jobSources.some((source) => /live\s*ops/i.test(JSON.stringify(source)))).toBe(false);
    expect(heldOrExcludedSources.find((source) => source.name === "Liveops")?.status).toBe("hard_excluded");
  });

  it("uses only HTTPS official URLs and clearly labels aggregators", () => {
    for (const source of jobSources) {
      if (source.officialUrl) expect(source.officialUrl.startsWith("https://")).toBe(true);
      if (!source.isOfficial) expect(source.category).toBe("third_party_aggregator");
    }
  });

  it("accepts only configured official hosts for direct-source attribution", () => {
    const foundever = jobSources.find((source) => source.id === "foundever")!;
    expect(sourceUrlMatchesDefinition(foundever, "https://jobs.foundever.com/job/123")).toBe(true);
    expect(sourceUrlMatchesDefinition(foundever, "https://foundever.example/job/123")).toBe(false);
    expect(sourceUrlMatchesDefinition(foundever, "javascript:alert(1)")).toBe(false);
  });
});

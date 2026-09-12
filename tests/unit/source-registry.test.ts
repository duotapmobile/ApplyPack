import { describe, expect, it } from "vitest";
import { affiliateDirectories, heldOrExcludedSources, jobSources, sourceUrlMatchesDefinition } from "@/lib/jobs/source-registry";
import { normalizeJob } from "@/lib/jobs/normalize";

describe("approved source registry", () => {
  it("registers every approved named employer in its separate category", () => {
    const employerSources = jobSources.filter((source) => source.canonicalEmployerId);
    expect(employerSources).toHaveLength(75);
    expect(employerSources.filter((source) => source.category === "core_direct_employer")).toHaveLength(30);
    expect(employerSources.filter((source) => source.category === "remote_first_employer")).toHaveLength(3);
    expect(employerSources.filter((source) => source.category === "selective_broad_employer")).toHaveLength(35);
    expect(employerSources.filter((source) => source.category === "contractor_staffing_flexible")).toHaveLength(7);
  });

  it("keeps Indeed and HiringCafe as explicit third-party compatibility sources", () => {
    for (const id of ["indeed", "hiringcafe"]) {
      expect(jobSources.find((source) => source.id === id)).toMatchObject({
        category: "third_party_aggregator",
        adapterKind: "existing_import",
        isOfficial: false,
        isDirectEmployer: false,
        authorizationStatus: "UNVERIFIED_DISABLED",
        isActive: false,
      });
    }
  });

  it("keeps every automated connector disabled until documentary authorization exists", () => {
    expect(jobSources.filter((source) => source.authorizationStatus === "AUTHORIZED_AUTOMATED")).toEqual([]);
    expect(jobSources.filter((source) => ["lever", "greenhouse", "ashby"].includes(source.adapterKind)).every((source) => source.authorizationStatus === "UNVERIFIED_DISABLED")).toBe(true);
  });

  it("keeps implemented adapters distinct from scheduled activation", () => {
    expect(jobSources.filter((source) => source.automationStatus === "automated")).toHaveLength(9);
    expect(jobSources.filter((source) => ["lever", "greenhouse", "ashby"].includes(source.adapterKind)).every((source) => Boolean(source.adapterKey))).toBe(true);
    expect(jobSources.filter((source) => source.scheduleEnabled)).toEqual([]);
  });

  it("has no duplicate source IDs, official URLs, or configured ATS tenants", () => {
    const ids = jobSources.map((source) => source.id);
    const urls = jobSources.map((source) => source.officialUrl?.replace(/\/+$/, "").toLowerCase()).filter(Boolean);
    const tenants = jobSources.map((source) => {
      if (!source.atsPlatform || ["none", "unknown"].includes(source.atsPlatform) || !source.atsTenantIdentifier || source.atsTenantIdentifier === "unknown") return null;
      return `${source.atsPlatform}:${source.atsTenantIdentifier}`.toLowerCase();
    }).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(urls).size).toBe(urls.length);
    expect(new Set(tenants).size).toBe(tenants.length);
  });

  it("reconciles the requested employer batch without claiming unsupported ATS coverage", () => {
    const requested = ["duolingo", "ultimate-medical-academy", "stride", "brightwheel", "classdojo", "capella-university", "outschool", "stripe", "block", "coinbase"];
    expect(requested.every((id) => jobSources.some((source) => source.id === id))).toBe(true);
    expect(jobSources.find((source) => source.id === "stride")).toMatchObject({ atsPlatform: "workday", automationStatus: "official_link_only" });
    expect(jobSources.find((source) => source.id === "classdojo")).toMatchObject({ atsPlatform: "unknown", automationStatus: "official_link_only" });
    expect(jobSources.find((source) => source.id === "capella-university")).toMatchObject({ atsPlatform: "workday", automationStatus: "official_link_only" });
  });

  it("keeps EdTech.com disabled pending explicit ingestion and paid-display permission", () => {
    expect(jobSources.find((source) => source.id === "edtech-com-fully-remote")).toMatchObject({
      isActive: false,
      accessMethod: "blocked",
      ingestionPermissionStatus: "requires_license_or_written_permission",
      paidDisplayPermissionStatus: "requires_license_or_written_permission",
    });
    expect(normalizeJob({
      sourceId: "edtech-com-fully-remote",
      employerName: "Example Employer",
      title: "Remote Support",
      sourceJobUrl: "https://www.edtech.com/jobs/example",
    })).toMatchObject({ isActive: false, reviewStatus: "rejected", rejectionReason: "source_disabled:edtech-com-fully-remote" });
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

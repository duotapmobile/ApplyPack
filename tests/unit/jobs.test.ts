import { describe, expect, it } from "vitest";
import { canonicalizeEmployer, exclusionReason, isLiveopsReference } from "@/lib/jobs/canonicalize";
import { deduplicateJobs } from "@/lib/jobs/deduplicate";
import { defaultJobFilters, filterJobs } from "@/lib/jobs/filter";
import { normalizeJob } from "@/lib/jobs/normalize";
import { rankJob } from "@/lib/jobs/rank";
import { inferSourceId, jobPayloadSchema } from "@/lib/jobs/schemas";
import { shouldReplacePreferredJob } from "@/lib/jobs/persistence";
import type { NormalizedJob, RawJobPosting } from "@/lib/jobs/types";

const now = new Date("2026-09-02T12:00:00.000Z");

function raw(overrides: Partial<RawJobPosting> = {}): RawJobPosting {
  return {
    sourceId: "foundever",
    employerName: "Foundever",
    externalJobId: "job-1",
    title: "Customer Operations Coordinator",
    description: "Entry-level full-time remote role available anywhere in the United States. Support customers by email and chat.",
    sourceJobUrl: "https://jobs.foundever.com/job/job-1",
    officialApplicationUrl: "https://jobs.foundever.com/job/job-1",
    location: "United States - Remote",
    employmentType: "Full-time",
    lastVerifiedAt: now.toISOString(),
    ...overrides,
  };
}

function job(overrides: Partial<RawJobPosting> = {}): NormalizedJob {
  return normalizeJob(raw(overrides), now);
}

describe("canonical employer aliases", () => {
  it.each([
    ["Sitel Group", "Foundever", "foundever"],
    ["SYKES", "Foundever", "foundever"],
    ["Teleperformance", "TP", "tp"],
    ["Aetna", "CVS Health", "cvs-health"],
    ["TurboTax", "Intuit", "intuit"],
    ["Discover", "Capital One", "capital-one"],
  ])("maps %s to %s", (alias, expected, id) => {
    expect(canonicalizeEmployer(alias)).toMatchObject({ canonicalName: expected, canonicalId: id });
  });

  it("prevents aliases from creating duplicate jobs", () => {
    const direct = job();
    const alias = job({ sourceId: "indeed", employerName: "SYKES", externalJobId: "job-1", sourceJobUrl: "https://www.indeed.com/viewjob?jk=1", officialApplicationUrl: "https://jobs.foundever.com/job/job-1" });
    const result = deduplicateJobs([alias, direct]);
    expect(result).toHaveLength(1);
    expect(result[0].job.employerDisplayName).toBe("Foundever");
    expect(result[0].sourceReferences.map((reference) => reference.sourceId)).toEqual(expect.arrayContaining(["indeed", "foundever"]));
  });
});

describe("hard exclusions", () => {
  it.each([
    ["Liveops", "https://example.com/job"],
    ["Join Liveops", "https://example.com/job"],
    ["Different Employer", "https://join.liveops.com/opportunity"],
  ])("rejects every Liveops name or URL variant", (employerName, sourceJobUrl) => {
    expect(isLiveopsReference(employerName, sourceJobUrl)).toBe(true);
    const normalized = job({ employerName, sourceJobUrl, officialApplicationUrl: sourceJobUrl });
    expect(normalized).toMatchObject({ isActive: false, reviewStatus: "rejected", rejectionReason: "hard_exclusion:liveops" });
    expect(filterJobs([normalized], { workerRelationship: "all" })).toEqual([]);
  });

  it("rejects a Liveops source label even when the employer and URL are disguised", () => {
    const normalized = job({ employerName: "Different Employer", sourceName: "Liveops Agent Opportunities", sourceJobUrl: "https://example.com/job", officialApplicationUrl: "https://example.com/job" });
    expect(normalized).toMatchObject({ isActive: false, reviewStatus: "rejected", rejectionReason: "hard_exclusion:liveops" });
  });

  it("holds ambiguous and excluded sources out of results", () => {
    expect(exclusionReason({ employerName: "NoGigiddy" })).toBe("source_held:nogigiddy");
    expect(exclusionReason({ employerName: "Blue Cross Blue Shield" })).toBe("source_held:blue_cross_blue_shield");
  });
});

describe("normalization and classification", () => {
  it("distinguishes nationwide remote from state-limited remote", () => {
    expect(job().workMode).toBe("remote_us_nationwide");
    const limited = job({ description: "Remote role. Applicants must reside in Texas.", location: "Austin, TX" });
    expect(limited.workMode).toBe("remote_us_state_limited");
    expect(limited.eligibleStates).toContain("TX");
  });

  it("does not infer nationwide eligibility from remote alone", () => {
    const unknown = job({ description: "This is a remote customer support role.", location: "Remote" });
    expect(unknown.workMode).toBe("unknown");
    expect(unknown.remoteScope).toMatch(/verification/i);
  });

  it("classifies hybrid and required in-person training", () => {
    expect(job({ description: "Remote after required in-person training in Phoenix, Arizona.", location: "Phoenix, AZ" }).workMode).toBe("hybrid");
  });

  it("classifies phone intensity without deleting phone jobs", () => {
    const high = job({ description: "Contact center work handling 100 customer service calls per day with talk time metrics." });
    expect(high.phoneIntensity).toBe("high");
    expect(high.highVolumeContactCenterFlag).toBe(true);
    expect(filterJobs([high], { ...defaultJobFilters })).toHaveLength(1);
    expect(rankJob(high).reasonCodes.map((reason) => reason.code)).toContain("HIGH_PHONE");

    const low = job({ description: "Email-only and chat-based non-phone support." });
    expect(low.phoneIntensity).toBe("low");
  });

  it("sets sales, commission, and marketing flags from descriptions", () => {
    const sales = job({ title: "Customer Advisor", description: "Meet a quota through retention, upselling, cross-selling, and commission." });
    expect(sales).toMatchObject({ salesFlag: true, commissionFlag: true });
    const marketing = job({ title: "Coordinator", description: "Support demand generation, paid media, and brand marketing." });
    expect(marketing.marketingFlag).toBe(true);
  });

  it("classifies W-2 and contractor sources separately", () => {
    expect(job({ employmentType: "Full-time" })).toMatchObject({ employmentType: "w2_full_time", w2OrContractor: "w2" });
    const contractor = job({ sourceId: "nexrep", employerName: "NexRep", employmentType: "", sourceJobUrl: "https://nexrep.com/agents/opportunities/", officialApplicationUrl: "https://nexrep.com/agents/opportunities/" });
    expect(contractor).toMatchObject({ employmentType: "independent_contractor", w2OrContractor: "contractor", benefitsStatus: "not_provided" });
  });

  it("preserves disclosed costs, equipment, language, and missing salary/location", () => {
    const normalized = job({
      description: "Applicant is responsible for a $35 background-check fee. Must provide own computer and internet. Bilingual in Spanish required.",
      location: null,
      salaryMin: null,
      salaryMax: null,
    });
    expect(normalized.applicantCost).toBe(35);
    expect(normalized.equipmentCostResponsibility).toBe("applicant");
    expect(normalized.languageRequirements).toContain("Bilingual in Spanish");
    expect(normalized.salaryMin).toBeNull();
    expect(normalized.salaryMax).toBeNull();
    expect(normalized.locationText).toBeNull();
  });
});

describe("deduplication, filtering, and ranking", () => {
  it("deduplicates Indeed, HiringCafe, and direct copies while preferring the direct URL", () => {
    const shared = { employerName: "Foundever", title: "Support Coordinator", description: "Full-time remote within the United States. Email support.", location: "United States", externalJobId: null };
    const indeed = job({ ...shared, sourceId: "indeed", sourceJobUrl: "https://www.indeed.com/viewjob?jk=abc", officialApplicationUrl: null });
    const cafe = job({ ...shared, sourceId: "hiringcafe", sourceJobUrl: "https://hiring.cafe/view/abc", officialApplicationUrl: null });
    const direct = job({ ...shared, sourceId: "foundever", sourceJobUrl: "https://jobs.foundever.com/job/abc", officialApplicationUrl: "https://jobs.foundever.com/job/abc" });
    const result = deduplicateJobs([indeed, cafe, direct]);
    expect(result).toHaveLength(1);
    expect(result[0].job.sourceId).toBe("foundever");
    expect(result[0].job.officialApplicationUrl).toBe("https://jobs.foundever.com/job/abc");
    expect(result[0].sourceReferences).toHaveLength(3);
  });

  it("does not let a later aggregator update replace an official direct record", () => {
    expect(shouldReplacePreferredJob(
      { is_official_source: true, is_direct_employer_source: true },
      { isOfficialSource: false, isDirectEmployerSource: false },
    )).toBe(false);
    expect(shouldReplacePreferredJob(
      { is_official_source: false, is_direct_employer_source: false },
      { isOfficialSource: true, isDirectEmployerSource: true },
    )).toBe(true);
  });

  it("uses default W-2, non-sales, non-marketing, no-cost filters", () => {
    const accepted = job();
    const contractor = job({ sourceId: "nexrep", employerName: "NexRep", sourceJobUrl: "https://nexrep.com/agents/opportunities/", officialApplicationUrl: "https://nexrep.com/agents/opportunities/" });
    const sales = job({ description: "Full-time remote in the United States with upselling quota." });
    const marketing = job({ description: "Full-time remote in the United States supporting paid media marketing." });
    const cost = job({ applicantCost: 20 });
    expect(filterJobs([accepted, contractor, sales, marketing, cost])).toEqual([accepted]);
    expect(filterJobs([contractor], { workerRelationship: "contractor" })).toEqual([contractor]);
  });

  it("filters full-time and part-time employment explicitly", () => {
    const fullTime = job({ employmentType: "Full-time" });
    const partTime = job({ externalJobId: "job-2", employmentType: "Part-time" });
    expect(filterJobs([fullTime, partTime], { workerRelationship: "w2", employmentTypes: ["w2_part_time"] })).toEqual([partTime]);
  });

  it("filters explicit state eligibility and removes stale/inactive jobs", () => {
    const texas = job({ description: "Remote role. Must reside in Texas.", location: "Texas" });
    expect(filterJobs([texas], { workerRelationship: "w2", state: "TX" })).toHaveLength(1);
    expect(filterJobs([texas], { workerRelationship: "w2", state: "CA" })).toHaveLength(0);
    const stale = normalizeJob(raw({ lastVerifiedAt: "2026-08-01T00:00:00.000Z" }), now);
    expect(stale).toMatchObject({ sourceFreshnessStatus: "stale", isActive: false });
    expect(filterJobs([stale], { workerRelationship: "all", includeStale: true })).toEqual([]);
  });

  it("emits explainable ranking reason codes", () => {
    const ranked = rankJob(job({ salaryMin: 45_000, salaryMax: 55_000 }), { state: "NY" });
    expect(ranked.reasonCodes.map((reason) => reason.code)).toEqual(expect.arrayContaining([
      "OFFICIAL_DIRECT_SOURCE", "W2_EMPLOYMENT", "EARLY_CAREER", "FRESH_POSTING", "STATE_ELIGIBLE", "SALARY_TRANSPARENT", "DIRECT_APPLICATION_URL",
    ]));
    expect(ranked.score).toBe(ranked.reasonCodes.reduce((sum, reason) => sum + reason.points, 0));
  });
});

describe("reviewed admin payload contract", () => {
  const legacy = {
    company: "Foundever",
    title: "Customer Support Representative",
    sourceUrl: "https://jobs.foundever.com/job/1",
    location: "Remote",
    salary: "Not listed",
    fitSummary: "A reviewed explanation long enough for the existing API contract.",
    requirements: [],
    concerns: [],
    checkedAt: now.toISOString(),
  };
  const reviewed = {
    ...legacy,
    officialApplicationUrl: "https://employer.example/jobs/role/apply",
    matchingExperience: ["Confirmed customer-support experience"],
    primaryOutcome: "Resolve customer issues accurately and efficiently.",
    coreResponsibilities: ["Respond to customer requests"],
    requirements: ["Clear written communication"],
    hiddenJobFunctions: [],
    matchCategory: "DIRECT",
    packetStrongConnections: [{
      kind: "DIRECT",
      statement: "Confirmed customer-support experience maps directly to the role.",
      evidenceIds: ["candidate-fact:60000000-0000-4000-8000-000000000001", "job-field:description"],
    }],
    packetThingsToConsider: [{
      kind: "GAP",
      statement: "The specific support platform has not been confirmed.",
      evidenceIds: ["job-field:description"],
    }],
    packetUnknownWarnings: [{
      field: "Health benefits",
      status: "NOT_CONFIRMED",
      evidenceIds: ["job-field:benefits_status"],
    }],
    criteriaChecks: {
      dutiesAligned: true,
      experienceConfirmed: true,
      levelAcceptable: true,
      scheduleAcceptable: true,
      locationAcceptable: true,
      compensationAcceptable: true,
      nonNegotiablesSatisfied: true,
    },
  } as const;

  it("rejects the old payload when human-review evidence is missing", () => {
    expect(jobPayloadSchema.safeParse(legacy).success).toBe(false);
    expect(jobPayloadSchema.safeParse(reviewed).success).toBe(true);
  });

  it("rejects broken application URLs but allows missing salary and location", () => {
    expect(jobPayloadSchema.safeParse({ ...reviewed, officialApplicationUrl: undefined }).success).toBe(false);
    expect(jobPayloadSchema.safeParse({ ...reviewed, sourceUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(jobPayloadSchema.safeParse({ ...reviewed, sourceUrl: undefined }).success).toBe(false);
    expect(jobPayloadSchema.safeParse({ ...reviewed, location: undefined, salary: undefined }).success).toBe(true);
  });

  it("does not infer an official employer source from the company name alone", () => {
    expect(inferSourceId("Foundever", "https://jobs.foundever.com/job/1")).toBe("foundever");
    expect(inferSourceId("Foundever", "https://unverified.example/job/1")).toBe("manual-reviewed");
    expect(job({ sourceId: "foundever", sourceJobUrl: "https://unverified.example/job/1", officialApplicationUrl: "https://unverified.example/apply" })).toMatchObject({
      isOfficialSource: false,
      isDirectEmployerSource: false,
      officialApplicationUrl: null,
    });
  });
});

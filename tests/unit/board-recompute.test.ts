import { describe, expect, it, vi } from "vitest";
import { evaluatePersistedBoardAdmission, type BoardProfileEvidence, type PersistedBoardJob } from "@/lib/job-board/recompute";

vi.mock("server-only", () => ({}));

const profile: BoardProfileEvidence = {
  desiredActivities: [], avoidedActivities: [], optionalTitles: [], titleRestricted: false,
  optionalIndustries: [], blockedIndustries: [], searchBreadth: "ADJACENT_OPPORTUNITIES",
  workModes: ["REMOTE"], stateOrDc: "VA", employmentTypes: ["FULL_TIME"], schedules: [], mustHaveBenefits: [],
  workConditionPreferences: {}, commuteDistanceMiles: null, customDealbreaker: null, dealbreakers: ["SALES"],
  employerUnknownPolicies: { "work_condition:WORK_MODE": "EXCLUDE_IF_UNKNOWN", "work_condition:EMPLOYMENT_TYPE": "EXCLUDE_IF_UNKNOWN" },
  salaryHardMinimumCents: 5_000_000, salaryPeriod: "YEAR", salaryUnpublishedPolicy: "INCLUDE_WITH_WARNING",
  capabilityKeys: ["EXCEL_DATA_CLEANING", "SYSTEM_RECORD_ENTRY"],
};

const job: PersistedBoardJob = {
  id: "job-1", title: "Operations Data Coordinator", description: "Use Excel for data cleaning and maintain accurate records.",
  department: "Operations", locationText: "Remote", scheduleType: "daytime", employmentType: "w2_full_time", workMode: "remote_us_nationwide", eligibleStates: [],
  salaryMin: 55_000, salaryMax: 70_000, salaryCurrency: "USD", payPeriod: "year", salesFlag: false,
  commissionFlag: false, phoneIntensity: "low", highVolumeContactCenterFlag: false, benefitsStatus: "provided",
  isActive: true, listingStatus: "open", sourceFreshnessStatus: "fresh", closingAt: null, rejectionReason: null,
  applicationUrl: "https://jobs.example.invalid/operations", sourceAuthorizedForPaidDisplay: true, syntheticStaging: false,
};

describe("persisted subscription-board admission", () => {
  it("admits on evidence and hard filters without producing a score or rank", () => {
    const result = evaluatePersistedBoardAdmission(profile, job);
    expect(result).toEqual({ admitted: true, connectionCodes: ["CAPABILITY_EXCEL_DATA_CLEANING"], exclusionCodes: [], warningCodes: [] });
    expect(result).not.toHaveProperty("score");
    expect(result).not.toHaveProperty("rank");
  });

  it("fails closed for source permission, stale links, and confirmed hard mismatches", () => {
    const result = evaluatePersistedBoardAdmission(profile, { ...job, sourceAuthorizedForPaidDisplay: false,
      sourceFreshnessStatus: "stale", workMode: "onsite", salesFlag: true });
    expect(result.admitted).toBe(false);
    expect(result.exclusionCodes).toEqual(expect.arrayContaining([
      "SOURCE_NOT_AUTHORIZED_FOR_PAID_DISPLAY", "SOURCE_STALE", "CONFIRMED_WORK_MODE_MISMATCH", "CONFIRMED_DEALBREAKER_SALES",
    ]));
  });

  it("allows unknown compensation only with the profile's explicit warning policy", () => {
    const allowed = evaluatePersistedBoardAdmission(profile, { ...job, salaryMax: null });
    expect(allowed.admitted).toBe(true);
    expect(allowed.warningCodes).toContain("UNKNOWN_COMPENSATION");
    const blocked = evaluatePersistedBoardAdmission({ ...profile, salaryUnpublishedPolicy: "EXCLUDE" }, { ...job, salaryMax: null });
    expect(blocked.admitted).toBe(false);
    expect(blocked.exclusionCodes).toContain("UNKNOWN_COMPENSATION_BLOCKED");
  });

  it("enforces confirmed title, activity, industry, benefit, and commute gates without ranking", () => {
    const result = evaluatePersistedBoardAdmission({ ...profile,
      optionalTitles: ["Customer Success"], titleRestricted: true,
      avoidedActivities: ["cold calling"], blockedIndustries: ["gambling"],
      workConditionPreferences: { "activity:cold calling": "DEALBREAKER" },
      mustHaveBenefits: ["Health insurance"],
    }, { ...job, title: "Gambling Sales Representative", description: "Cold calling customers", benefitsStatus: "not_provided" });
    expect(result.admitted).toBe(false);
    expect(result.exclusionCodes).toEqual(expect.arrayContaining([
      "CONFIRMED_TITLE_FAMILY_MISMATCH", "CONFIRMED_BLOCKED_INDUSTRY_GAMBLING",
      "CONFIRMED_AVOIDED_ACTIVITY_COLD_CALLING", "CONFIRMED_REQUIRED_BENEFIT_MISSING_HEALTH_INSURANCE",
    ]));
    expect(result).not.toHaveProperty("rank");
  });

  it("permits synthetic inventory only behind the non-live staging fixture gate", () => {
    const result = evaluatePersistedBoardAdmission(profile, { ...job, sourceAuthorizedForPaidDisplay: false, syntheticStaging: true });
    expect(result.admitted).toBe(true);
  });
});

import { describe, expect, it, vi } from "vitest";
import { evaluatePersistedBoardAdmission, type BoardProfileEvidence, type PersistedBoardJob } from "@/lib/job-board/recompute";

vi.mock("server-only", () => ({}));

const profile: BoardProfileEvidence = {
  workModes: ["REMOTE"], stateOrDc: "VA", employmentTypes: ["FULL_TIME"], dealbreakers: ["SALES"],
  employerUnknownPolicies: { "work_condition:WORK_MODE": "EXCLUDE_IF_UNKNOWN", "work_condition:EMPLOYMENT_TYPE": "EXCLUDE_IF_UNKNOWN" },
  salaryHardMinimumCents: 5_000_000, salaryPeriod: "YEAR", salaryUnpublishedPolicy: "INCLUDE_WITH_WARNING",
  capabilityKeys: ["EXCEL_DATA_CLEANING", "SYSTEM_RECORD_ENTRY"],
};

const job: PersistedBoardJob = {
  id: "job-1", title: "Operations Data Coordinator", description: "Use Excel for data cleaning and maintain accurate records.",
  department: "Operations", employmentType: "w2_full_time", workMode: "remote_us_nationwide", eligibleStates: [],
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

  it("permits synthetic inventory only behind the non-live staging fixture gate", () => {
    const result = evaluatePersistedBoardAdmission(profile, { ...job, sourceAuthorizedForPaidDisplay: false, syntheticStaging: true });
    expect(result.admitted).toBe(true);
  });
});

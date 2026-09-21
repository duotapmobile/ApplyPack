import { describe, expect, it } from "vitest";
import type { NormalizedJob } from "@/lib/jobs/types";
import { buildResponsibilityFirstQueries } from "@/lib/matching/retrieval";
import { calculateVerifiedDuration } from "@/lib/matching/requirements";
import { selectIndependentInventory } from "@/lib/matching/deduplication";
import { baseRank, type RankCandidate } from "@/lib/matching/evaluation-engine";

function rotate<T>(items: readonly T[], offset: number) { return [...items.slice(offset), ...items.slice(0, offset)]; }

function normalizedJob(id: string, externalJobId: string | null, fingerprint: string): NormalizedJob {
  return { canonicalEmployerId: "employer", employerDisplayName: "Example", employerAliases: [], sourceId: "manual-reviewed", sourceName: "Manual", sourceCategory: "third_party_aggregator", isOfficialSource: false, isDirectEmployerSource: false, officialApplicationUrl: externalJobId ? `https://employer.invalid/${externalJobId}` : null, sourceJobUrl: `https://source.invalid/${id}`, normalizedSourceUrl: `https://source.invalid/${id}`, externalJobId, externalJobIdReliable: externalJobId != null, normalizedTitle: "coordinator", rawTitle: "Coordinator", description: "Coordinate work.", department: null, employmentType: "w2_full_time", w2OrContractor: "w2", workMode: "remote_us_nationwide", remoteScope: null, eligibleStates: [], eligibleCountries: ["US"], timezoneRequirement: null, scheduleType: null, salaryMin: null, salaryMax: null, salaryCurrency: null, payPeriod: null, payModel: "unknown", phoneIntensity: "low", salesFlag: false, commissionFlag: false, marketingFlag: false, highVolumeContactCenterFlag: false, degreeRequired: null, experienceLevel: "early_career", equipmentRequirement: null, equipmentCostResponsibility: "unknown", applicantCost: null, benefitsStatus: "unknown", languageRequirements: [], postedAt: null, closingAt: null, lastVerifiedAt: "2026-09-05T00:00:00.000Z", sourceFreshnessStatus: "unknown", contentHash: id, deduplicationKey: fingerprint, isActive: true, reviewStatus: "pending", rejectionReason: null, locationText: "Remote", firstSeenAt: "2026-09-04T00:00:00.000Z" };
}

describe("Chunk 3 deterministic properties", () => {
  it("preserves neutral responsibility families across generated soft hints", () => {
    for (let index = 0; index < 40; index += 1) {
      const core = { breadth: "ADJACENT_OPPORTUNITIES" as const, desiredResponsibilities: ["coordinate workflows"], verifiedResponsibilities: [{ id: "r", label: "organize records", relation: "DIRECT" as const, verified: true, nearbyRoleFamilies: ["coordinator"], relatedRoleFamilies: ["specialist"] }], capabilities: ["filter records"], acceptedWorkModes: ["REMOTE"], stateOrDc: "VA", acceptedEmploymentTypes: ["FULL_TIME"], hardRestrictions: ["blocked gambling"] };
      const baseline = buildResponsibilityFirstQueries(core);
      const changed = buildResponsibilityFirstQueries({ ...core, targetTitles: [`Generated Title ${index}`], industryInterests: [`Industry ${index}`], softAvoidances: [`Soft ${index}`] });
      expect(changed.map((item) => [item.responsibilities, item.hardFilters])).toEqual(baseline.map((item) => [item.responsibilities, item.hardFilters]));
    }
  });

  it("keeps graph selection and ranking independent of input order", () => {
    const jobs = [normalizedJob("a", "A", "bridge"), normalizedJob("b", null, "bridge"), normalizedJob("c", "C", "bridge")];
    const expected = selectIndependentInventory(jobs).selected.map((job) => job.contentHash);
    const ranks: RankCandidate[] = jobs.map((job, index) => ({ jobId: job.contentHash, employerId: String(index % 2), titleFamily: "ops", discoverySourceId: "manual-reviewed", fit: 90 - index, preference: 0.5, confidence: 80, confidenceLabel: "HIGH", postedOn: null, firstSeenAt: job.firstSeenAt!, eligible: true, evidenceSufficient: true }));
    const expectedRank = baseRank(ranks).map((candidate) => candidate.jobId);
    for (let offset = 0; offset < jobs.length; offset += 1) {
      expect(selectIndependentInventory(rotate(jobs, offset)).selected.map((job) => job.contentHash)).toEqual(expected);
      expect(baseRank(rotate(ranks, offset)).map((candidate) => candidate.jobId)).toEqual(expectedRank);
    }
  });

  it("never double-counts overlapping months and is period-order independent", () => {
    const periods = [
      { startMonth: "2025-01", endMonth: "2025-12", intensityLower: 0.75, intensityUpper: 0.75, verified: true, relation: "DIRECT" as const, kind: "PAID_EMPLOYMENT" as const },
      { startMonth: "2025-04", endMonth: "2025-09", intensityLower: 0.75, intensityUpper: 0.75, verified: true, relation: "DIRECT" as const, kind: "CONTRACT_FREELANCE" as const },
    ];
    const forward = calculateVerifiedDuration(periods);
    const reverse = calculateVerifiedDuration([...periods].reverse());
    expect(forward).toEqual(reverse);
    expect(forward.calendarMonths).toBe(12);
    expect(forward.fteUpperMonths).toBeLessThanOrEqual(forward.calendarMonths);
  });
});

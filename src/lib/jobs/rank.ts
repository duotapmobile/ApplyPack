import { isEligibleForState } from "./filter";
import type { JobFilterOptions, NormalizedJob, RankedJob, RankingAdjustment } from "./types";

export function rankJobs(jobs: readonly NormalizedJob[], context: Pick<JobFilterOptions, "state"> = {}): RankedJob[] {
  return jobs.map((job) => rankJob(job, context)).sort((a, b) => b.score - a.score || b.job.lastVerifiedAt.localeCompare(a.job.lastVerifiedAt));
}

export function rankJob(job: NormalizedJob, context: Pick<JobFilterOptions, "state"> = {}): RankedJob {
  const reasons: RankingAdjustment[] = [];
  add(reasons, job.isOfficialSource && job.isDirectEmployerSource, "OFFICIAL_DIRECT_SOURCE", 40, "Official direct-employer posting.");
  add(reasons, !job.isDirectEmployerSource, "THIRD_PARTY_SOURCE", -20, "Third-party source; an official direct posting is preferred.");
  add(reasons, job.w2OrContractor === "w2", "W2_EMPLOYMENT", 30, "W-2 employment matches the default view.");
  add(reasons, ["contractor", "staffing"].includes(job.w2OrContractor), "CONTRACTOR_OR_STAFFING", -30, "Flexible-work source is separated from the default W-2 view.");
  add(reasons, job.phoneIntensity === "low", "LOW_PHONE", 20, "Posting indicates low-phone work.");
  add(reasons, job.phoneIntensity === "high", "HIGH_PHONE", -25, "Posting indicates high phone intensity.");
  add(reasons, job.salesFlag, "SALES", -50, "Posting contains sales, quota, retention, or related duties.");
  add(reasons, job.marketingFlag, "MARKETING", -45, "Posting contains marketing duties.");
  add(reasons, ["entry_level", "early_career"].includes(job.experienceLevel), "EARLY_CAREER", 25, "Experience level fits entry or early-career searches.");
  add(reasons, job.sourceFreshnessStatus === "fresh", "FRESH_POSTING", 20, "Listing was verified within the fresh window.");
  add(reasons, job.sourceFreshnessStatus === "aging", "AGING_POSTING", -10, "Listing should be rechecked soon.");
  add(reasons, job.sourceFreshnessStatus === "stale", "STALE_POSTING", -60, "Listing is stale and should not appear by default.");
  if (context.state) {
    add(reasons, isEligibleForState(job, context.state), "STATE_ELIGIBLE", 20, "Posting explicitly includes the requested state.");
    add(reasons, !isEligibleForState(job, context.state), "STATE_ELIGIBILITY_UNCLEAR_OR_EXCLUDED", -25, "Posting does not establish eligibility for the requested state.");
  }
  add(reasons, job.salaryMin !== null || job.salaryMax !== null, "SALARY_TRANSPARENT", 8, "Posting includes structured compensation.");
  add(reasons, job.workMode === "unknown" && /remote/i.test(job.remoteScope || ""), "REMOTE_CLAIM_UNCLEAR", -20, "Remote wording does not establish nationwide or state eligibility.");
  add(reasons, Boolean(job.officialApplicationUrl), "DIRECT_APPLICATION_URL", 15, "A verified official application URL is available.");
  return { job, score: reasons.reduce((total, reason) => total + reason.points, 0), reasonCodes: reasons };
}

function add(reasons: RankingAdjustment[], condition: boolean, code: string, points: number, explanation: string) {
  if (condition) reasons.push({ code, points, explanation });
}

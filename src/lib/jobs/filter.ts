import type { JobFilterOptions, NormalizedJob } from "./types";

export const defaultJobFilters: Readonly<JobFilterOptions> = {
  workerRelationship: "w2",
  includeSales: false,
  includeMarketing: false,
  includeApplicantCost: false,
  includeStale: false,
};

export function filterJobs(jobs: readonly NormalizedJob[], options: JobFilterOptions = defaultJobFilters): NormalizedJob[] {
  const filters = { ...defaultJobFilters, ...options };
  return jobs.filter((job) => {
    if (job.rejectionReason || job.reviewStatus === "rejected" || !job.isActive) return false;
    if (!filters.includeStale && job.sourceFreshnessStatus === "stale") return false;
    if (filters.workerRelationship && filters.workerRelationship !== "all" && job.w2OrContractor !== filters.workerRelationship) return false;
    if (!filters.includeSales && job.salesFlag) return false;
    if (!filters.includeMarketing && job.marketingFlag) return false;
    if (!filters.includeApplicantCost && job.applicantCost !== null && job.applicantCost > 0) return false;
    if (filters.remoteScopes?.length && !filters.remoteScopes.includes(job.workMode)) return false;
    if (filters.phoneIntensities?.length && !filters.phoneIntensities.includes(job.phoneIntensity)) return false;
    if (filters.entryLevelOnly && !["entry_level", "early_career"].includes(job.experienceLevel)) return false;
    if (filters.employmentTypes?.length && !filters.employmentTypes.includes(job.employmentType)) return false;
    if (filters.scheduleTypes?.length && (!job.scheduleType || !filters.scheduleTypes.some((value) => job.scheduleType!.toLowerCase().includes(value.toLowerCase())))) return false;
    if (filters.salaryMinimum !== undefined && (job.salaryMax === null || job.salaryMax < filters.salaryMinimum)) return false;
    if (filters.sourceCategories?.length && !filters.sourceCategories.includes(job.sourceCategory)) return false;
    if (filters.directEmployerOnly && !job.isDirectEmployerSource) return false;
    if (filters.timezone && (!job.timezoneRequirement || !job.timezoneRequirement.toLowerCase().includes(filters.timezone.toLowerCase()))) return false;
    if (filters.state && !isEligibleForState(job, filters.state)) return false;
    return true;
  });
}

export function isEligibleForState(job: NormalizedJob, state: string): boolean {
  const normalized = state.toUpperCase();
  if (job.workMode === "remote_us_nationwide") return true;
  if (["remote_us_state_limited", "remote_us_timezone_limited", "hybrid", "onsite"].includes(job.workMode)) {
    return job.eligibleStates.includes(normalized);
  }
  return false;
}

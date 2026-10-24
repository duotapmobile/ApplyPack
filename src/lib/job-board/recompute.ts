import "server-only";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
export const BOARD_ADMISSION_VERSION = "board-admission-v4";

export type BoardProfileEvidence = {
  desiredActivities: string[];
  avoidedActivities: string[];
  optionalTitles: string[];
  titleRestricted: boolean;
  optionalIndustries: string[];
  blockedIndustries: string[];
  searchBreadth: string;
  workModes: string[];
  stateOrDc: string | null;
  employmentTypes: string[];
  schedules: string[];
  mustHaveBenefits: string[];
  workConditionPreferences: Record<string, string>;
  commuteDistanceMiles: number | null;
  customDealbreaker: string | null;
  dealbreakers: string[];
  employerUnknownPolicies: Record<string, string>;
  salaryHardMinimumCents: number | null;
  salaryPeriod: string | null;
  salaryUnpublishedPolicy: string;
  capabilityKeys: string[];
};

export type PersistedBoardJob = {
  id: string;
  title: string;
  description: string | null;
  department: string | null;
  locationText: string | null;
  scheduleType: string | null;
  employmentType: string;
  workMode: string;
  eligibleStates: string[];
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  payPeriod: string | null;
  salesFlag: boolean;
  commissionFlag: boolean;
  phoneIntensity: string;
  highVolumeContactCenterFlag: boolean;
  benefitsStatus: string;
  isActive: boolean;
  listingStatus: string;
  sourceFreshnessStatus: string;
  applicationPathStatus?: string;
  lastSuccessfullyVerifiedAt?: string | null;
  closingAt: string | null;
  rejectionReason: string | null;
  applicationUrl: string | null;
  sourceAuthorizedForPaidDisplay: boolean;
  syntheticStaging: boolean;
};

export type PersistedAdmissionDecision = {
  admitted: boolean;
  connectionCodes: string[];
  exclusionCodes: string[];
  warningCodes: string[];
};

const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const code = (value: string) => value.replace(/[^A-Z0-9]+/gi, "_").replace(/^_|_$/g, "").toUpperCase();

function unknownOutcome(profile: BoardProfileEvidence, criterion: string, exclusions: string[], warnings: string[]) {
  if (profile.employerUnknownPolicies[criterion] === "ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING") {
    warnings.push(`UNKNOWN_${code(criterion)}`);
  } else exclusions.push(`UNKNOWN_BLOCKED_${code(criterion)}`);
}

function allowedWorkModes(profile: BoardProfileEvidence) {
  const modes = new Set(profile.workModes);
  return {
    remote: modes.has("REMOTE"),
    hybrid: modes.has("HYBRID"),
    onsite: modes.has("ONSITE"),
  };
}

function allowedEmploymentTypes(profile: BoardProfileEvidence) {
  const map: Record<string, string[]> = {
    FULL_TIME: ["w2_full_time"], PART_TIME: ["w2_part_time"],
    CONTRACT: ["1099", "independent_contractor", "staffing_assignment"],
    TEMPORARY: ["temporary", "seasonal"],
  };
  return new Set(profile.employmentTypes.flatMap((value) => map[value] || []));
}

function capabilityConnections(profile: BoardProfileEvidence, job: PersistedBoardJob) {
  const haystack = normalized([job.title, job.department, job.description].filter(Boolean).join(" "));
  return profile.capabilityKeys.filter((key) => {
    const words = normalized(key).split(" ").filter((word) => word.length >= 3 && !["can", "done", "before", "basic"].includes(word));
    return words.length > 0 && words.every((word) => haystack.includes(word));
  }).map((key) => `CAPABILITY_${code(key)}`);
}

export function evaluatePersistedBoardAdmission(profile: BoardProfileEvidence, job: PersistedBoardJob, now = new Date()): PersistedAdmissionDecision {
  const exclusions: string[] = [];
  const warnings: string[] = [];
  const haystack = normalized([job.title, job.department, job.description].filter(Boolean).join(" "));
  if (!job.sourceAuthorizedForPaidDisplay && !job.syntheticStaging) exclusions.push("SOURCE_NOT_AUTHORIZED_FOR_PAID_DISPLAY");
  if (!job.isActive || job.listingStatus !== "open") exclusions.push("LISTING_NOT_ACTIVE");
  if (!["fresh", "aging"].includes(job.sourceFreshnessStatus)) exclusions.push("SOURCE_STALE_OR_UNKNOWN");
  const verifiedAt = Date.parse(job.lastSuccessfullyVerifiedAt || "");
  if (job.applicationPathStatus !== "verified_actionable" || !Number.isFinite(verifiedAt)
    || verifiedAt > now.getTime() || now.getTime() - verifiedAt > 72 * 60 * 60 * 1_000) exclusions.push("DIRECT_VERIFICATION_REQUIRED");
  if (job.closingAt && Date.parse(job.closingAt) <= now.getTime()) exclusions.push("LISTING_EXPIRED");
  if (job.rejectionReason) exclusions.push("PARSER_OR_POLICY_REJECTED");
  if (!job.applicationUrl || !safeHttps(job.applicationUrl)) exclusions.push("APPLICATION_LINK_UNSAFE_OR_MISSING");

  if (profile.titleRestricted && profile.optionalTitles.length
    && !profile.optionalTitles.some((title) => haystack.includes(normalized(title)))) {
    exclusions.push("CONFIRMED_TITLE_FAMILY_MISMATCH");
  }
  for (const industry of profile.blockedIndustries) {
    if (normalized(industry) && haystack.includes(normalized(industry))) exclusions.push(`CONFIRMED_BLOCKED_INDUSTRY_${code(industry)}`);
  }
  for (const activity of profile.avoidedActivities) {
    const strength = profile.workConditionPreferences[`activity:${activity}`];
    if (["DO_NOT_SHOW", "DEALBREAKER"].includes(strength) && normalized(activity) && haystack.includes(normalized(activity))) {
      exclusions.push(`CONFIRMED_AVOIDED_ACTIVITY_${code(activity)}`);
    }
  }
  if (profile.customDealbreaker) exclusions.push("CUSTOM_DEALBREAKER_REQUIRES_HUMAN_REVIEW");

  const modes = allowedWorkModes(profile);
  if (job.workMode === "unknown") unknownOutcome(profile, "work_condition:WORK_MODE", exclusions, warnings);
  else if (job.workMode.startsWith("remote_") && !modes.remote) exclusions.push("CONFIRMED_WORK_MODE_MISMATCH");
  else if (job.workMode === "hybrid" && !modes.hybrid) exclusions.push("CONFIRMED_WORK_MODE_MISMATCH");
  else if (job.workMode === "onsite" && !modes.onsite) exclusions.push("CONFIRMED_WORK_MODE_MISMATCH");
  if ((job.workMode === "remote_us_state_limited" || job.workMode === "hybrid" || job.workMode === "onsite")
    && profile.stateOrDc && job.eligibleStates.length && !job.eligibleStates.includes(profile.stateOrDc)) {
    exclusions.push("CONFIRMED_LOCATION_MISMATCH");
  }

  const employment = allowedEmploymentTypes(profile);
  if (job.employmentType === "unknown") unknownOutcome(profile, "work_condition:EMPLOYMENT_TYPE", exclusions, warnings);
  else if (!employment.has(job.employmentType)) exclusions.push("CONFIRMED_EMPLOYMENT_TYPE_MISMATCH");

  if (profile.salaryHardMinimumCents !== null) {
    const salaryComparable = job.salaryCurrency === "USD" && ((profile.salaryPeriod === "YEAR" && job.payPeriod === "year")
      || (profile.salaryPeriod === "HOUR" && job.payPeriod === "hour"));
    if (!salaryComparable || job.salaryMax === null) {
      if (profile.salaryUnpublishedPolicy === "INCLUDE_WITH_WARNING") warnings.push("UNKNOWN_COMPENSATION");
      else exclusions.push("UNKNOWN_COMPENSATION_BLOCKED");
    } else if (Math.round(job.salaryMax * 100) < profile.salaryHardMinimumCents) exclusions.push("CONFIRMED_COMPENSATION_BELOW_MINIMUM");
  }

  const dealbreakers = new Set(profile.dealbreakers);
  const hardConditions = new Set(Object.entries(profile.workConditionPreferences)
    .filter(([, strength]) => ["DO_NOT_SHOW", "DEALBREAKER"].includes(strength)).map(([key]) => key));
  if ((dealbreakers.has("SALES") || hardConditions.has("SALES")) && job.salesFlag) exclusions.push("CONFIRMED_DEALBREAKER_SALES");
  if (dealbreakers.has("COMMISSION_ONLY") && job.commissionFlag) exclusions.push("CONFIRMED_DEALBREAKER_COMMISSION");
  if ((dealbreakers.has("HEAVY_PHONE") || dealbreakers.has("COLD_CALLING") || hardConditions.has("PHONE_INTENSITY"))
    && (job.phoneIntensity === "high" || job.highVolumeContactCenterFlag)) exclusions.push("CONFIRMED_DEALBREAKER_PHONE");
  if (profile.employerUnknownPolicies["benefit:EMPLOYER_PROVIDED"] && job.benefitsStatus === "unknown") {
    unknownOutcome(profile, "benefit:EMPLOYER_PROVIDED", exclusions, warnings);
  }

  for (const requiredBenefit of profile.mustHaveBenefits) {
    if (job.benefitsStatus === "not_provided") exclusions.push(`CONFIRMED_REQUIRED_BENEFIT_MISSING_${code(requiredBenefit)}`);
    else if (job.benefitsStatus !== "provided") unknownOutcome(profile, `benefit:${requiredBenefit}`, exclusions, warnings);
  }
  if (profile.schedules.length && !job.scheduleType && hardConditions.has("FLEXIBILITY")) {
    unknownOutcome(profile, "work_condition:FLEXIBILITY", exclusions, warnings);
  }
  if (profile.commuteDistanceMiles !== null && ["hybrid", "onsite"].includes(job.workMode)) {
    exclusions.push("COMMUTE_DISTANCE_NOT_VERIFIED");
  }

  const connections = capabilityConnections(profile, job);
  for (const activity of profile.desiredActivities) if (normalized(activity) && haystack.includes(normalized(activity))) connections.push(`ACTIVITY_${code(activity)}`);
  for (const title of profile.optionalTitles) if (normalized(title) && haystack.includes(normalized(title))) connections.push(`TITLE_${code(title)}`);
  for (const industry of profile.optionalIndustries) if (normalized(industry) && haystack.includes(normalized(industry))) connections.push(`INDUSTRY_${code(industry)}`);
  if (!connections.length) exclusions.push("NO_DEFENSIBLE_CAPABILITY_CONNECTION");
  return { admitted: exclusions.length === 0, connectionCodes: [...new Set(connections)], exclusionCodes: [...new Set(exclusions)], warningCodes: [...new Set(warnings)] };
}

function safeHttps(value: string) {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

export async function processBoardRecomputeJobs(admin: AdminClient, limit = 10) {
  void admin;
  void limit;
  return { status: "retired" as const, reason: "LEGACY_BOARD_ARCHIVE_IS_READ_ONLY", processed: 0, completed: 0, decisions: 0 };
}

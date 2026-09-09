import "server-only";

import { createHash } from "node:crypto";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
export const BOARD_ADMISSION_VERSION = "board-admission-v2";

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
  if (job.sourceFreshnessStatus === "stale") exclusions.push("SOURCE_STALE");
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

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function profileEvidence(snapshot: Record<string, unknown>, facts: Array<Record<string, unknown>>): BoardProfileEvidence {
  const capabilities = facts.filter((fact) => fact.verification === "CUSTOMER_CONFIRMED"
    && ["CAN_DO_NOW", "DONE_BEFORE_NEEDS_REFRESHER"].includes(String(fact.capability_status || "")))
    .map((fact) => String(fact.semantic_key || "").replace(/^capability:/, "")).filter(Boolean);
  const benefits = object(snapshot.benefits);
  const travel = object(snapshot.travel);
  return {
    desiredActivities: strings(snapshot.desired_activities),
    avoidedActivities: strings(snapshot.avoided_activities),
    optionalTitles: strings(snapshot.optional_titles),
    titleRestricted: Boolean(snapshot.confirmed_title_restriction),
    optionalIndustries: strings(snapshot.optional_industries),
    blockedIndustries: strings(snapshot.blocked_industries),
    searchBreadth: String(snapshot.search_breadth || "ADJACENT_OPPORTUNITIES"),
    workModes: strings(snapshot.work_modes),
    stateOrDc: snapshot.us_state_or_dc ? String(snapshot.us_state_or_dc) : null,
    employmentTypes: strings(snapshot.employment_types),
    schedules: strings(snapshot.schedules),
    mustHaveBenefits: strings(benefits.mustHave),
    workConditionPreferences: object(snapshot.work_condition_preferences) as Record<string, string>,
    commuteDistanceMiles: numeric(travel.commuteDistanceMiles),
    customDealbreaker: travel.customDealbreaker ? String(travel.customDealbreaker) : null,
    dealbreakers: strings(snapshot.dealbreakers),
    employerUnknownPolicies: snapshot.employer_unknown_policy && typeof snapshot.employer_unknown_policy === "object"
      ? snapshot.employer_unknown_policy as Record<string, string> : {},
    salaryHardMinimumCents: typeof snapshot.salary_hard_minimum_cents === "number" ? snapshot.salary_hard_minimum_cents : null,
    salaryPeriod: snapshot.salary_period ? String(snapshot.salary_period) : null,
    salaryUnpublishedPolicy: String(snapshot.salary_unpublished_policy || "EXCLUDE"),
    capabilityKeys: [...new Set(capabilities)],
  };
}

function persistedJob(row: Record<string, unknown>): PersistedBoardJob {
  const source = Array.isArray(row.source) ? row.source[0] : row.source;
  const sourceRecord = source && typeof source === "object" ? source as Record<string, unknown> : {};
  const synthetic = row.source_id === "synthetic-staging" && process.env.APP_STAGING_SYNTHETIC_JOBS === "true"
    && process.env.APP_PAYMENT_MODE !== "live";
  return {
    id: String(row.id), title: String(row.title || row.raw_title || ""),
    description: row.description ? String(row.description) : null,
    department: row.department ? String(row.department) : null,
    locationText: row.location_text ? String(row.location_text) : null,
    scheduleType: row.schedule_type ? String(row.schedule_type) : null,
    employmentType: String(row.employment_type || "unknown"), workMode: String(row.work_mode || "unknown"),
    eligibleStates: strings(row.eligible_states), salaryMin: numeric(row.salary_min), salaryMax: numeric(row.salary_max),
    salaryCurrency: row.salary_currency ? String(row.salary_currency) : null,
    payPeriod: row.pay_period ? String(row.pay_period).toLowerCase() : null,
    salesFlag: Boolean(row.sales_flag), commissionFlag: Boolean(row.commission_flag),
    phoneIntensity: String(row.phone_intensity || "none_or_unknown"),
    highVolumeContactCenterFlag: Boolean(row.high_volume_contact_center_flag),
    benefitsStatus: String(row.benefits_status || "unknown"), isActive: Boolean(row.is_active),
    listingStatus: String(row.listing_status || "inactive"), sourceFreshnessStatus: String(row.source_freshness_status || "unknown"),
    closingAt: row.closing_at ? String(row.closing_at) : null, rejectionReason: row.rejection_reason ? String(row.rejection_reason) : null,
    applicationUrl: row.official_application_url ? String(row.official_application_url) : row.source_job_url ? String(row.source_job_url) : null,
    sourceAuthorizedForPaidDisplay: sourceRecord.paid_display_permission_status === "documented_paid_display_authorized"
      && Boolean(sourceRecord.permission_evidence_url) && Boolean(sourceRecord.is_active),
    syntheticStaging: synthetic,
  };
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numeric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function inputHash(profile: BoardProfileEvidence, job: PersistedBoardJob) {
  return createHash("sha256").update(JSON.stringify({ profile, job, version: BOARD_ADMISSION_VERSION })).digest("hex");
}

async function recomputeProfile(admin: AdminClient, customerId: string, snapshotId: string, onlyJobId?: string) {
  const snapshotResult = await admin.from("ap_intake_snapshots")
    .select("id,customer_id,desired_activities,avoided_activities,optional_titles,confirmed_title_restriction,optional_industries,blocked_industries,search_breadth,work_modes,us_state_or_dc,employment_types,schedules,travel,benefits,work_condition_preferences,dealbreakers,employer_unknown_policy,salary_hard_minimum_cents,salary_period,salary_unpublished_policy")
    .eq("id", snapshotId).maybeSingle();
  if (snapshotResult.error || !snapshotResult.data) throw snapshotResult.error || new Error("BOARD_PROFILE_NOT_FOUND");
  if (snapshotResult.data.customer_id !== customerId) {
    const claim = await admin.from("ap_board_profile_claims").select("profile_snapshot_id")
      .eq("profile_snapshot_id", snapshotId).eq("customer_id", customerId).maybeSingle();
    if (claim.error || !claim.data) throw claim.error || new Error("BOARD_PROFILE_NOT_OWNED");
  }
  const factsResult = await admin.from("ap_candidate_facts").select("semantic_key,capability_status,verification")
    .eq("snapshot_id", snapshotId).is("superseded_at", null);
  if (factsResult.error) throw factsResult.error;
  let jobsQuery = admin.from("jobs").select("id,title,raw_title,description,department,location_text,schedule_type,employment_type,work_mode,eligible_states,salary_min,salary_max,salary_currency,pay_period,sales_flag,commission_flag,phone_intensity,high_volume_contact_center_flag,benefits_status,is_active,listing_status,source_freshness_status,closing_at,rejection_reason,official_application_url,source_job_url,source_id,source:job_sources(paid_display_permission_status,permission_evidence_url,is_active)");
  if (onlyJobId) jobsQuery = jobsQuery.eq("id", onlyJobId);
  const jobsResult = await jobsQuery.limit(5_000);
  if (jobsResult.error) throw jobsResult.error;
  const profile = profileEvidence(snapshotResult.data as Record<string, unknown>, (factsResult.data || []) as Array<Record<string, unknown>>);
  const evaluatedAt = new Date().toISOString();
  const rows = (jobsResult.data || []).map((raw) => {
    const job = persistedJob(raw as Record<string, unknown>);
    const decision = evaluatePersistedBoardAdmission(profile, job);
    return { customer_id: customerId, profile_snapshot_id: snapshotId, job_id: job.id,
      decision: decision.admitted ? "ADMITTED" : "EXCLUDED", capability_connection_codes: decision.connectionCodes,
      exclusion_codes: decision.exclusionCodes, warning_codes: decision.warningCodes,
      admission_version: BOARD_ADMISSION_VERSION, evaluated_at: evaluatedAt, input_sha256: inputHash(profile, job), superseded_at: null };
  });
  if (rows.length) {
    const upsert = await admin.from("ap_board_admissions").upsert(rows, { onConflict: "customer_id,profile_snapshot_id,job_id,admission_version" });
    if (upsert.error) throw upsert.error;
  }
  if (!onlyJobId) {
    const jobIds = rows.map((row) => row.job_id);
    let stale = admin.from("ap_board_admissions").update({ superseded_at: evaluatedAt })
      .eq("customer_id", customerId).eq("profile_snapshot_id", snapshotId).eq("admission_version", BOARD_ADMISSION_VERSION).is("superseded_at", null);
    if (jobIds.length) stale = stale.not("job_id", "in", `(${jobIds.join(",")})`);
    const staleResult = await stale;
    if (staleResult.error) throw staleResult.error;
  }
  return rows.length;
}

type RecomputeJob = { id: string; scope: "PROFILE" | "JOB" | "POLICY"; customer_id: string | null; profile_snapshot_id: string | null; job_id: string | null };

async function currentProfilesForRecompute(admin: AdminClient) {
  const [direct, claimed] = await Promise.all([
    admin.from("ap_intake_snapshots").select("id,customer_id,version")
      .not("customer_id", "is", null).not("finalized_at", "is", null).order("version", { ascending: false }).limit(5_000),
    admin.from("ap_board_profile_claims").select("profile_snapshot_id,customer_id,profile_version")
      .order("profile_version", { ascending: false }).limit(5_000),
  ]);
  if (direct.error) throw direct.error;
  if (claimed.error) throw claimed.error;
  const newest = new Map<string, { id: string; customer_id: string; version: number }>();
  for (const row of direct.data || []) if (row.customer_id) {
    const prior = newest.get(row.customer_id);
    if (!prior || row.version > prior.version) newest.set(row.customer_id, { id: row.id, customer_id: row.customer_id, version: row.version });
  }
  for (const row of claimed.data || []) {
    const prior = newest.get(row.customer_id);
    if (!prior || row.profile_version >= prior.version) newest.set(row.customer_id,
      { id: row.profile_snapshot_id, customer_id: row.customer_id, version: row.profile_version });
  }
  return [...newest.values()];
}

export async function processBoardRecomputeJobs(admin: AdminClient, limit = 10) {
  const owner = process.env.APP_BOARD_WORKER_ID?.trim();
  if (!owner || owner.length < 3) return { status: "disabled" as const, reason: "APP_BOARD_WORKER_ID_UNSET", processed: 0, decisions: 0 };
  const claimed = await admin.rpc("ap_claim_board_recompute_jobs", { p_owner: owner, p_limit: Math.max(1, Math.min(50, limit)) });
  if (claimed.error) throw claimed.error;
  const jobs = (Array.isArray(claimed.data) ? claimed.data : []) as RecomputeJob[];
  let decisions = 0;
  let completed = 0;
  for (const job of jobs) {
    try {
      if (job.scope === "PROFILE" && job.customer_id && job.profile_snapshot_id) {
        decisions += await recomputeProfile(admin, job.customer_id, job.profile_snapshot_id);
      } else if (job.scope === "JOB" && job.job_id) {
        for (const snapshot of await currentProfilesForRecompute(admin)) decisions += await recomputeProfile(admin, snapshot.customer_id, snapshot.id, job.job_id);
      } else if (job.scope === "POLICY") {
        for (const snapshot of await currentProfilesForRecompute(admin)) decisions += await recomputeProfile(admin, snapshot.customer_id, snapshot.id);
      } else throw new Error("BOARD_RECOMPUTE_BINDING_INVALID");
      const finished = await admin.rpc("ap_finish_board_recompute_job", { p_job_id: job.id, p_owner: owner, p_success: true, p_error_code: null });
      if (finished.error || !finished.data) throw finished.error || new Error("BOARD_RECOMPUTE_FINISH_FAILED");
      completed += 1;
    } catch (error) {
      await admin.rpc("ap_finish_board_recompute_job", { p_job_id: job.id, p_owner: owner, p_success: false,
        p_error_code: error instanceof Error ? error.message.slice(0, 100) : "BOARD_RECOMPUTE_FAILED" });
    }
  }
  return { status: "enabled" as const, processed: jobs.length, completed, decisions };
}

import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { rankJob } from "./rank";
import type { NormalizedJob, SourceCategory } from "./types";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

export function toJobDatabaseRow(job: NormalizedJob, salaryText: string | null = null) {
  return {
    canonical_employer_id: job.canonicalEmployerId,
    employer_display_name: job.employerDisplayName,
    employer_aliases: job.employerAliases,
    source_id: job.sourceId,
    source_name: job.sourceName,
    source_category: job.sourceCategory,
    is_official_source: job.isOfficialSource,
    is_direct_employer_source: job.isDirectEmployerSource,
    official_application_url: job.officialApplicationUrl,
    source_job_url: job.sourceJobUrl,
    normalized_source_url: job.normalizedSourceUrl,
    external_job_id: job.externalJobId,
    normalized_title: job.normalizedTitle,
    raw_title: job.rawTitle,
    description: job.description,
    department: job.department,
    employment_type: job.employmentType,
    w2_or_contractor: job.w2OrContractor,
    work_mode: job.workMode,
    remote_scope: job.remoteScope,
    eligible_states: job.eligibleStates.length ? job.eligibleStates : null,
    eligible_countries: job.eligibleCountries.length ? job.eligibleCountries : null,
    timezone_requirement: job.timezoneRequirement,
    schedule_type: job.scheduleType,
    salary_min: job.salaryMin,
    salary_max: job.salaryMax,
    salary_currency: job.salaryCurrency,
    pay_period: job.payPeriod,
    pay_model: job.payModel,
    phone_intensity: job.phoneIntensity,
    sales_flag: job.salesFlag,
    commission_flag: job.commissionFlag,
    marketing_flag: job.marketingFlag,
    high_volume_contact_center_flag: job.highVolumeContactCenterFlag,
    degree_required: job.degreeRequired,
    experience_level: job.experienceLevel,
    equipment_requirement: job.equipmentRequirement,
    equipment_cost_responsibility: job.equipmentCostResponsibility,
    applicant_cost: job.applicantCost,
    benefits_status: job.benefitsStatus,
    language_requirements: job.languageRequirements.length ? job.languageRequirements : null,
    posted_at: job.postedAt,
    closing_at: job.closingAt,
    last_verified_at: job.lastVerifiedAt,
    source_freshness_status: job.sourceFreshnessStatus,
    content_hash: job.contentHash,
    deduplication_key: job.deduplicationKey,
    is_active: job.isActive,
    review_status: job.reviewStatus,
    rejection_reason: job.rejectionReason,
    company: job.employerDisplayName,
    title: job.rawTitle,
    source_url: job.officialApplicationUrl || job.sourceJobUrl,
    location_text: job.locationText,
    salary_text: salaryText,
    checked_at: job.lastVerifiedAt,
    listing_status: job.isActive ? "open" : "inactive",
  };
}

export function rankingDatabaseValues(job: NormalizedJob, state?: string) {
  const ranked = rankJob(job, { state });
  return { ranking_score: ranked.score, ranking_reason_codes: ranked.reasonCodes };
}

export function shouldReplacePreferredJob(
  existing: { is_official_source?: boolean | null; is_direct_employer_source?: boolean | null },
  incoming: Pick<NormalizedJob, "isOfficialSource" | "isDirectEmployerSource">,
): boolean {
  const existingIsOfficialDirect = Boolean(existing.is_official_source && existing.is_direct_employer_source);
  const incomingIsOfficialDirect = incoming.isOfficialSource && incoming.isDirectEmployerSource;
  return !existingIsOfficialDirect || incomingIsOfficialDirect;
}

export function fromJobDatabaseRow(row: Record<string, unknown>): NormalizedJob {
  return {
    canonicalEmployerId: String(row.canonical_employer_id || "unknown-employer"),
    employerDisplayName: String(row.employer_display_name || row.company || "Unknown employer"),
    employerAliases: stringArray(row.employer_aliases),
    sourceId: String(row.source_id || "manual-reviewed"),
    sourceName: String(row.source_name || "Manual reviewed source"),
    sourceCategory: (row.source_category || "third_party_aggregator") as SourceCategory,
    isOfficialSource: Boolean(row.is_official_source),
    isDirectEmployerSource: Boolean(row.is_direct_employer_source),
    officialApplicationUrl: nullableString(row.official_application_url),
    sourceJobUrl: nullableString(row.source_job_url || row.source_url),
    normalizedSourceUrl: nullableString(row.normalized_source_url),
    externalJobId: nullableString(row.external_job_id),
    normalizedTitle: String(row.normalized_title || row.title || "").toLowerCase(),
    rawTitle: String(row.raw_title || row.title || ""),
    description: nullableString(row.description),
    department: nullableString(row.department),
    employmentType: String(row.employment_type || "unknown") as NormalizedJob["employmentType"],
    w2OrContractor: String(row.w2_or_contractor || "unknown") as NormalizedJob["w2OrContractor"],
    workMode: String(row.work_mode || "unknown") as NormalizedJob["workMode"],
    remoteScope: nullableString(row.remote_scope),
    eligibleStates: stringArray(row.eligible_states),
    eligibleCountries: stringArray(row.eligible_countries),
    timezoneRequirement: nullableString(row.timezone_requirement),
    scheduleType: nullableString(row.schedule_type),
    salaryMin: nullableNumber(row.salary_min),
    salaryMax: nullableNumber(row.salary_max),
    salaryCurrency: nullableString(row.salary_currency),
    payPeriod: nullableString(row.pay_period),
    payModel: String(row.pay_model || "unknown") as NormalizedJob["payModel"],
    phoneIntensity: String(row.phone_intensity || "none_or_unknown") as NormalizedJob["phoneIntensity"],
    salesFlag: Boolean(row.sales_flag),
    commissionFlag: Boolean(row.commission_flag),
    marketingFlag: Boolean(row.marketing_flag),
    highVolumeContactCenterFlag: Boolean(row.high_volume_contact_center_flag),
    degreeRequired: typeof row.degree_required === "boolean" ? row.degree_required : null,
    experienceLevel: String(row.experience_level || "unknown") as NormalizedJob["experienceLevel"],
    equipmentRequirement: nullableString(row.equipment_requirement),
    equipmentCostResponsibility: String(row.equipment_cost_responsibility || "unknown") as NormalizedJob["equipmentCostResponsibility"],
    applicantCost: nullableNumber(row.applicant_cost),
    benefitsStatus: String(row.benefits_status || "unknown") as NormalizedJob["benefitsStatus"],
    languageRequirements: stringArray(row.language_requirements),
    postedAt: nullableString(row.posted_at),
    closingAt: nullableString(row.closing_at),
    lastVerifiedAt: String(row.last_verified_at || row.checked_at || new Date(0).toISOString()),
    sourceFreshnessStatus: String(row.source_freshness_status || "unknown") as NormalizedJob["sourceFreshnessStatus"],
    contentHash: String(row.content_hash || ""),
    deduplicationKey: String(row.deduplication_key || ""),
    isActive: Boolean(row.is_active),
    reviewStatus: String(row.review_status || "pending") as NormalizedJob["reviewStatus"],
    rejectionReason: nullableString(row.rejection_reason),
    locationText: nullableString(row.location_text),
  };
}

export async function persistNormalizedJob(admin: AdminClient, job: NormalizedJob, salaryText: string | null = null): Promise<string> {
  if (job.rejectionReason || !job.isActive) throw new Error(job.rejectionReason || "Inactive jobs cannot be ingested.");
  if (!job.sourceJobUrl && !job.officialApplicationUrl) throw new Error("A source or application URL is required.");

  const employer = await admin.from("employers").upsert({
    id: job.canonicalEmployerId,
    display_name: job.employerDisplayName,
    source_category: employerCategory(job.sourceCategory),
    aliases: job.employerAliases,
    is_active: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: "id" });
  if (employer.error) throw employer.error;

  let existing: { id: string; is_official_source: boolean | null; is_direct_employer_source: boolean | null } | null = null;
  if (job.externalJobId) {
    const { data } = await admin.from("jobs").select("id,is_official_source,is_direct_employer_source").eq("canonical_employer_id", job.canonicalEmployerId).eq("external_job_id", job.externalJobId).maybeSingle();
    existing = data || null;
  }
  if (!existing && job.normalizedSourceUrl) {
    const { data } = await admin.from("jobs").select("id,is_official_source,is_direct_employer_source").eq("canonical_employer_id", job.canonicalEmployerId).eq("normalized_source_url", job.normalizedSourceUrl).maybeSingle();
    existing = data || null;
  }
  if (!existing) {
    const { data } = await admin.from("jobs").select("id,is_official_source,is_direct_employer_source").eq("canonical_employer_id", job.canonicalEmployerId).eq("deduplication_key", job.deduplicationKey).maybeSingle();
    existing = data || null;
  }

  const row = toJobDatabaseRow(job, salaryText);
  let jobId = existing?.id || null;
  if (jobId && existing) {
    if (shouldReplacePreferredJob(existing, job)) {
      const { error } = await admin.from("jobs").update(row).eq("id", jobId);
      if (error) throw error;
    }
  } else {
    const { data, error } = await admin.from("jobs").insert(row).select("id").single();
    if (error || !data) throw error || new Error("Normalized job was not returned after insert.");
    jobId = data.id;
  }

  let referenceQuery = admin.from("job_source_references").select("id").eq("job_id", jobId).eq("source_id", job.sourceId);
  referenceQuery = job.externalJobId ? referenceQuery.eq("external_job_id", job.externalJobId) : referenceQuery.is("external_job_id", null);
  const { data: existingReference } = await referenceQuery.maybeSingle();
  const referenceRow = {
    job_id: jobId,
    source_id: job.sourceId,
    source_name: job.sourceName,
    source_job_url: job.sourceJobUrl,
    normalized_source_url: job.normalizedSourceUrl,
    official_application_url: job.officialApplicationUrl,
    external_job_id: job.externalJobId,
    is_official: job.isOfficialSource,
    is_direct_employer: job.isDirectEmployerSource,
    last_verified_at: job.lastVerifiedAt,
    is_active: true,
  };
  const { error: referenceError } = existingReference
    ? await admin.from("job_source_references").update(referenceRow).eq("id", existingReference.id)
    : await admin.from("job_source_references").insert(referenceRow);
  if (referenceError) throw referenceError;
  if (!jobId) throw new Error("Normalized job has no persistent identifier.");
  return jobId;
}

function employerCategory(category: NormalizedJob["sourceCategory"]) {
  return category === "third_party_aggregator" || category === "local_affiliate_directory" ? "unclassified" : category;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function nullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

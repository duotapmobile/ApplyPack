export const sourceCategories = [
  "core_direct_employer",
  "remote_first_employer",
  "selective_broad_employer",
  "contractor_staffing_flexible",
  "local_affiliate_directory",
  "third_party_aggregator",
] as const;

export type SourceCategory = (typeof sourceCategories)[number];

export const employmentTypes = [
  "w2_full_time",
  "w2_part_time",
  "1099",
  "independent_contractor",
  "temporary",
  "staffing_assignment",
  "seasonal",
  "unknown",
] as const;
export type EmploymentType = (typeof employmentTypes)[number];

export const workerRelationships = ["w2", "contractor", "staffing", "unknown"] as const;
export type WorkerRelationship = (typeof workerRelationships)[number];

export const benefitsStatuses = ["provided", "not_provided", "varies", "unknown"] as const;
export type BenefitsStatus = (typeof benefitsStatuses)[number];

export const payModels = ["hourly", "salary", "per_minute", "commission", "contract_rate", "unknown"] as const;
export type PayModel = (typeof payModels)[number];

export const equipmentResponsibilities = ["employer", "applicant", "shared", "unknown"] as const;
export type EquipmentResponsibility = (typeof equipmentResponsibilities)[number];

export const workModes = [
  "remote_us_nationwide",
  "remote_us_state_limited",
  "remote_us_timezone_limited",
  "remote_country_limited",
  "remote_global",
  "hybrid",
  "onsite",
  "unknown",
] as const;
export type WorkMode = (typeof workModes)[number];

export const phoneIntensities = ["none_or_unknown", "low", "mixed", "high"] as const;
export type PhoneIntensity = (typeof phoneIntensities)[number];

export const experienceLevels = ["entry_level", "early_career", "mid_level", "senior", "unknown"] as const;
export type ExperienceLevel = (typeof experienceLevels)[number];

export type SourceAdapterKind = "lever" | "official_link_only" | "existing_import";
export type SourceAutomationStatus = "automated" | "official_link_only" | "existing_import" | "pending_verification";

export type SourceDefinition = {
  id: string;
  canonicalEmployerId: string | null;
  employerDisplayName: string | null;
  sourceName: string;
  category: SourceCategory;
  officialUrl: string | null;
  alternateOfficialUrls?: readonly string[];
  adapterKind: SourceAdapterKind;
  adapterKey?: string;
  automationStatus: SourceAutomationStatus;
  isOfficial: boolean;
  isDirectEmployer: boolean;
  isActive: boolean;
  priority: number;
  defaultWorkerRelationship?: WorkerRelationship;
  defaultEmploymentType?: EmploymentType;
  defaultBenefitsStatus?: BenefitsStatus;
  notes?: string;
};

export type AffiliateDirectory = {
  id: string;
  name: string;
  officialUrl: string;
  notes: string;
};

export type RawJobPosting = {
  sourceId: string;
  sourceName?: string | null;
  employerName: string;
  employerAliases?: readonly string[];
  externalJobId?: string | null;
  title: string;
  description?: string | null;
  department?: string | null;
  sourceJobUrl?: string | null;
  officialApplicationUrl?: string | null;
  location?: string | null;
  employmentType?: string | null;
  remoteScope?: string | null;
  eligibleStates?: readonly string[] | null;
  eligibleCountries?: readonly string[] | null;
  timezoneRequirement?: string | null;
  scheduleType?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  payPeriod?: string | null;
  payModel?: string | null;
  benefitsStatus?: string | null;
  equipmentRequirement?: string | null;
  applicantCost?: number | null;
  postedAt?: string | null;
  closingAt?: string | null;
  lastVerifiedAt?: string | null;
  languageRequirements?: readonly string[] | null;
};

export type NormalizedJob = {
  canonicalEmployerId: string;
  employerDisplayName: string;
  employerAliases: string[];
  sourceId: string;
  sourceName: string;
  sourceCategory: SourceCategory;
  isOfficialSource: boolean;
  isDirectEmployerSource: boolean;
  officialApplicationUrl: string | null;
  sourceJobUrl: string | null;
  normalizedSourceUrl: string | null;
  externalJobId: string | null;
  normalizedTitle: string;
  rawTitle: string;
  description: string | null;
  department: string | null;
  employmentType: EmploymentType;
  w2OrContractor: WorkerRelationship;
  workMode: WorkMode;
  remoteScope: string | null;
  eligibleStates: string[];
  eligibleCountries: string[];
  timezoneRequirement: string | null;
  scheduleType: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  payPeriod: string | null;
  payModel: PayModel;
  phoneIntensity: PhoneIntensity;
  salesFlag: boolean;
  commissionFlag: boolean;
  marketingFlag: boolean;
  highVolumeContactCenterFlag: boolean;
  degreeRequired: boolean | null;
  experienceLevel: ExperienceLevel;
  equipmentRequirement: string | null;
  equipmentCostResponsibility: EquipmentResponsibility;
  applicantCost: number | null;
  benefitsStatus: BenefitsStatus;
  languageRequirements: string[];
  postedAt: string | null;
  closingAt: string | null;
  lastVerifiedAt: string;
  sourceFreshnessStatus: "fresh" | "aging" | "stale" | "unknown";
  contentHash: string;
  deduplicationKey: string;
  isActive: boolean;
  reviewStatus: "pending" | "approved" | "needs_review" | "rejected";
  rejectionReason: string | null;
  locationText: string | null;
};

export type JobSourceReference = {
  sourceId: string;
  sourceName: string;
  sourceJobUrl: string | null;
  officialApplicationUrl: string | null;
  externalJobId: string | null;
  isOfficial: boolean;
  isDirectEmployer: boolean;
  lastVerifiedAt: string;
};

export type DeduplicatedJob = {
  job: NormalizedJob;
  sourceReferences: JobSourceReference[];
  matchedBy: "external_job_id" | "source_url" | "content" | "new";
};

export type JobFilterOptions = {
  workerRelationship?: WorkerRelationship | "all";
  remoteScopes?: readonly WorkMode[];
  state?: string;
  timezone?: string;
  phoneIntensities?: readonly PhoneIntensity[];
  includeSales?: boolean;
  includeMarketing?: boolean;
  entryLevelOnly?: boolean;
  employmentTypes?: readonly EmploymentType[];
  scheduleTypes?: readonly string[];
  salaryMinimum?: number;
  sourceCategories?: readonly SourceCategory[];
  directEmployerOnly?: boolean;
  includeApplicantCost?: boolean;
  includeStale?: boolean;
};

export type RankingAdjustment = {
  code: string;
  points: number;
  explanation: string;
};

export type RankedJob = {
  job: NormalizedJob;
  score: number;
  reasonCodes: RankingAdjustment[];
};

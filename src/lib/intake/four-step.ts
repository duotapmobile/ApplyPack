import { z } from "zod";

export const FOUR_STEP_FLOW_VERSION = "FOUR_STEP_RESPONSIBILITY_V1" as const;
export const FOUR_STEP_SCHEMA_VERSION = "applypack-intake-v2" as const;
export const ACTIVITY_CATALOG_VERSION = "applypack-activities-2026-09-04" as const;
export const CAPABILITY_CATALOG_VERSION = "applypack-capabilities-2026-09-04" as const;

export const activityCatalog = [
  ["COORDINATING_PROJECTS", "Coordinating projects"],
  ["ORGANIZING_RECORDS", "Organizing records"],
  ["PREPARING_REPORTS", "Preparing reports"],
  ["SUPPORTING_CUSTOMERS", "Supporting customers"],
  ["HANDLING_BILLING", "Handling billing"],
  ["SCHEDULING", "Scheduling"],
  ["TRAINING", "Training people"],
  ["PURCHASING", "Purchasing"],
  ["TRACKING_INVENTORY", "Tracking inventory"],
  ["IMPROVING_PROCESSES", "Improving processes"],
  ["SUPERVISING", "Supervising people"],
  ["DOCUMENTING_PROCEDURES", "Documenting procedures"],
  ["MANAGING_WORKFLOWS", "Managing workflows"],
] as const;

export const industryCatalog = [
  ["HEALTHCARE", "Healthcare", "Organizations that provide or support health services."],
  ["EDUCATION", "Education", "Schools, training organizations, and education services."],
  ["FINANCIAL_SERVICES", "Financial services", "Banking, insurance, lending, and related services."],
  ["LOGISTICS", "Logistics", "Shipping, warehousing, distribution, and supply-chain work."],
  ["SOFTWARE_TECHNOLOGY", "Software and technology", "Companies that build or support software and digital products."],
  ["PUBLIC_NONPROFIT", "Public service and nonprofit", "Government, community, and mission-led organizations."],
  ["RETAIL_CONSUMER", "Retail and consumer services", "Businesses that sell or support consumer products and services."],
] as const;

export const breadthChoices = [
  ["CLOSE_TO_PREVIOUS_WORK", "Stay close to work I've already done"],
  ["ADJACENT_OPPORTUNITIES", "Show me related roles that use the same abilities"],
  ["BROADEST_SUPPORTED_SCOPE", "Show me the broadest range my experience supports"],
] as const;

export const capabilityChoices = [
  ["CAN_DO_NOW", "I can do this now"],
  ["DONE_BEFORE_NEEDS_REFRESHER", "I've done this before but may need a refresher"],
  ["BASIC_EXPOSURE", "I've had basic exposure"],
  ["NOT_DONE", "I haven't done this"],
  ["UNSURE", "I'm not sure"],
] as const;

export const excelTasks = [
  ["EXCEL_DATA_ENTRY_FORMATTING", "Data entry and formatting"],
  ["EXCEL_SORT_FILTER", "Sorting and filtering"],
  ["EXCEL_BASIC_FORMULAS", "Basic formulas"],
  ["EXCEL_SUMIF_COUNTIF", "SUMIF or COUNTIF"],
  ["EXCEL_LOOKUPS", "XLOOKUP or VLOOKUP"],
  ["EXCEL_PIVOT_TABLES", "Pivot tables"],
  ["EXCEL_CHARTS", "Charts"],
  ["EXCEL_DATA_CLEANING", "Data cleaning"],
  ["EXCEL_POWER_QUERY", "Power Query"],
  ["EXCEL_MACROS", "Macros"],
] as const;

export const businessSystemTasks = [
  ["SYSTEM_RECORD_ENTRY", "Entering or updating records"],
  ["SYSTEM_USE", "Using CRM, ERP, EHR, HRIS, or ticketing software"],
  ["SYSTEM_FILTER_REPORT", "Filtering and reporting"],
  ["SYSTEM_IMPORT_EXPORT", "Importing or exporting data"],
  ["SYSTEM_WORKFLOW_PERMISSIONS", "Managing workflows or permissions"],
  ["SYSTEM_SQL", "Writing SQL"],
  ["SYSTEM_DATABASE_ADMIN", "Database design or administration"],
] as const;

export const factTiers = ["SEARCH_CRITICAL", "MATCH_ENHANCING", "DOCUMENT_ONLY"] as const;
export const factReviewDecisions = ["CONFIRM", "REJECT", "SKIP", "CORRECT"] as const;
export const experienceKinds = [
  "PAID_EMPLOYMENT",
  "SELF_EMPLOYMENT_BUSINESS",
  "CONTRACT_FREELANCE",
  "EDUCATION_CERTIFICATION",
  "VOLUNTEER",
  "PROJECT",
  "CAREGIVING",
  "OTHER_RELEVANT_LIFE_CONTEXT",
] as const;

export const experienceKindLabels: Record<(typeof experienceKinds)[number], string> = {
  PAID_EMPLOYMENT: "Paid employment",
  SELF_EMPLOYMENT_BUSINESS: "Self-employment or business ownership",
  CONTRACT_FREELANCE: "Contract or freelance work",
  EDUCATION_CERTIFICATION: "Education or certification",
  VOLUNTEER: "Volunteer work",
  PROJECT: "Project",
  CAREGIVING: "Caregiving",
  OTHER_RELEVANT_LIFE_CONTEXT: "Other relevant life context",
};

export const workModes = ["REMOTE", "HYBRID", "ONSITE"] as const;
export const employmentTypes = ["FULL_TIME", "PART_TIME", "CONTRACT", "TEMPORARY"] as const;
export const employerUnknownPolicies = ["EXCLUDE_IF_UNKNOWN", "ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING"] as const;
export const salaryPeriods = ["HOUR", "YEAR"] as const;
export const salaryBases = ["BASE", "GUARANTEED_TOTAL"] as const;
export const permissionPolicies = ["EXCLUDE", "INCLUDE_WITH_WARNING"] as const;

export const dealbreakerCatalog = [
  ["SALES", "Sales"],
  ["COMMISSION_ONLY", "Commission-only pay"],
  ["COLD_CALLING", "Cold calling"],
  ["HEAVY_PHONE", "Heavy phone work"],
  ["REQUIRED_TRAVEL", "Required travel"],
  ["PHYSICAL_LABOR", "Physical labor"],
  ["SOMETHING_ELSE", "Something else"],
] as const;

export const stateOrDcOptions = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"],
  ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"],
  ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"],
  ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"],
  ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"],
  ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"],
  ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"],
  ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"],
  ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"],
  ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"],
  ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"],
  ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"],
  ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
] as const;

const boundedText = (max: number) => z.string().trim().max(max);
const optionalDate = z.union([z.literal(""), z.iso.date()]);
const optionalChoice = <T extends readonly [string, ...string[]]>(values: T) => z.union([z.literal(""), z.enum(values)]);

export const factSuggestionSchema = z.object({
  id: z.uuid(),
  semanticKey: z.string().trim().min(1).max(300),
  displayLabel: z.string().trim().min(1).max(300),
  displayValue: z.string().trim().min(1).max(1_000),
  tier: z.enum(factTiers),
  verification: z.enum(["EXTRACTED_UNCONFIRMED", "CUSTOMER_CONFIRMED", "CUSTOMER_REJECTED", "DISPUTED"]),
  documentVersionId: z.uuid(),
  sourceLocator: z.string().trim().min(1).max(1_000),
});

export type FactSuggestion = z.infer<typeof factSuggestionSchema>;

const factCorrectionSchema = z.object({
  value: z.string().trim().min(1).max(500),
  category: z.enum(["IDENTITY", "ROLE", "DATE", "RESPONSIBILITY", "TOOL", "EDUCATION", "CERTIFICATION", "OTHER"]),
});

export const experienceAdditionSchema = z.object({
  clientId: z.string().uuid(),
  kind: z.enum(experienceKinds),
  organizationOrProject: boundedText(200),
  roleOrRelationship: boundedText(200),
  startsOn: optionalDate,
  endsOn: optionalDate,
  datePrecision: z.enum(["EXACT_DAY", "MONTH", "YEAR", "UNKNOWN"]),
  responsibilities: z.array(z.string().trim().min(1).max(200)).max(20),
  tools: z.array(z.string().trim().min(1).max(120)).max(30),
  scope: boundedText(500),
  outcome: boundedText(500),
  intensityPercent: z.number().min(0).max(100).nullable(),
  educationLevel: boundedText(120),
  educationField: boundedText(200),
  completionStatus: boundedText(120),
  certifications: z.array(z.string().trim().min(1).max(200)).max(20),
  relevantCoursework: z.array(z.string().trim().min(1).max(200)).max(30),
  optionalDetail: boundedText(500),
});

export type ExperienceAddition = z.infer<typeof experienceAdditionSchema>;

const benefitSelectionSchema = z.object({
  mustHave: z.array(z.string().trim().min(1).max(120)).max(20),
  wouldPrefer: z.array(z.string().trim().min(1).max(120)).max(20),
  openTo: z.array(z.string().trim().min(1).max(120)).max(20),
});

export const fourStepDraftSchema = z.object({
  flowVersion: z.literal(FOUR_STEP_FLOW_VERSION),
  fullName: boundedText(200),
  email: boundedText(320),
  priorCoverLetterUse: z.enum(["FACT_EXTRACTION_ONLY", "FACT_EXTRACTION_AND_VOICE", "NEITHER"]),
  desiredActivities: z.array(z.string().trim().min(1).max(120)).max(30),
  avoidedActivities: z.array(z.string().trim().min(1).max(120)).max(30),
  guidanceRequested: z.boolean(),
  targetTitles: z.array(z.string().trim().min(1).max(160)).max(20),
  titleRestrictionConfirmed: z.boolean(),
  industryInterests: z.array(z.string().trim().min(1).max(120)).max(20),
  blockedIndustries: z.array(z.string().trim().min(1).max(120)).max(20),
  searchBreadth: z.enum(["CLOSE_TO_PREVIOUS_WORK", "ADJACENT_OPPORTUNITIES", "BROADEST_SUPPORTED_SCOPE"]),
  factReviews: z.record(z.string(), z.enum(factReviewDecisions)),
  factCorrections: z.record(z.string(), factCorrectionSchema),
  experienceAdditions: z.array(experienceAdditionSchema).max(30),
  capabilities: z.record(z.string(), z.enum(["CAN_DO_NOW", "DONE_BEFORE_NEEDS_REFRESHER", "BASIC_EXPOSURE", "NOT_DONE", "UNSURE"])),
  workModes: z.array(z.enum(workModes)).max(3),
  preferredWorkMode: optionalChoice(workModes),
  stateOrDc: boundedText(2),
  zipCode: boundedText(10),
  commuteDistanceMiles: z.number().int().min(1).max(250).nullable(),
  employmentTypes: z.array(z.enum(employmentTypes)).max(4),
  preferredEmploymentType: optionalChoice(employmentTypes),
  schedules: z.array(z.string().trim().min(1).max(120)).max(20),
  benefits: benefitSelectionSchema,
  workConditionPreferences: z.record(z.string(), z.enum(["MUST_HAVE", "WOULD_PREFER", "OPEN_TO", "DO_NOT_SHOW", "DEALBREAKER"])),
  dealbreakers: z.array(z.string().trim().min(1).max(120)).max(20),
  employerUnknownPolicies: z.record(z.string(), z.enum(employerUnknownPolicies)),
  customDealbreaker: boundedText(500),
  salaryTargetCents: z.number().int().nonnegative().nullable(),
  salaryHardMinimumCents: z.number().int().nonnegative().nullable(),
  salaryMinimumFlexible: z.boolean(),
  salaryPeriod: optionalChoice(salaryPeriods),
  salaryBasis: optionalChoice(salaryBases),
  salaryUnpublishedPolicy: z.enum(permissionPolicies),
  salaryOverlapPolicy: z.enum(permissionPolicies),
  salaryNoncomparablePolicy: z.enum(permissionPolicies),
  salaryVariablePayPolicy: z.enum(permissionPolicies),
  termsAccepted: z.boolean(),
}).strict();

export type FourStepDraft = z.infer<typeof fourStepDraftSchema>;

export const emptyFourStepDraft: FourStepDraft = {
  flowVersion: FOUR_STEP_FLOW_VERSION,
  fullName: "",
  email: "",
  priorCoverLetterUse: "NEITHER",
  desiredActivities: [],
  avoidedActivities: [],
  guidanceRequested: false,
  targetTitles: [],
  titleRestrictionConfirmed: false,
  industryInterests: [],
  blockedIndustries: [],
  searchBreadth: "ADJACENT_OPPORTUNITIES",
  factReviews: {},
  factCorrections: {},
  experienceAdditions: [],
  capabilities: {},
  workModes: [],
  preferredWorkMode: "",
  stateOrDc: "",
  zipCode: "",
  commuteDistanceMiles: null,
  employmentTypes: [],
  preferredEmploymentType: "",
  schedules: [],
  benefits: { mustHave: [], wouldPrefer: [], openTo: [] },
  workConditionPreferences: {},
  dealbreakers: [],
  employerUnknownPolicies: {},
  customDealbreaker: "",
  salaryTargetCents: null,
  salaryHardMinimumCents: null,
  salaryMinimumFlexible: false,
  salaryPeriod: "",
  salaryBasis: "",
  salaryUnpublishedPolicy: "EXCLUDE",
  salaryOverlapPolicy: "EXCLUDE",
  salaryNoncomparablePolicy: "EXCLUDE",
  salaryVariablePayPolicy: "EXCLUDE",
  termsAccepted: false,
};

export type IntakeDocument = {
  id: string;
  version: number;
  kind: "RESUME" | "PRIOR_COVER_LETTER";
  name: string;
  size: number;
  mimeType: string;
  processingState: "UPLOADED" | "QUARANTINED" | "SCANNING" | "EXTRACTING" | "READY" | "FAILED" | "SUPERSEDED";
  failureCode: string | null;
};

export type StepError = { fieldId: string; message: string };

export function validateFourStep(step: 0 | 1 | 2 | 3, draft: FourStepDraft, input: {
  resume: IntakeDocument | null;
  facts: readonly FactSuggestion[];
  presentedFactIds: ReadonlySet<string>;
}) {
  const errors: StepError[] = [];
  if (step === 0) {
    if (draft.fullName.trim().length < 2) errors.push({ fieldId: "full-name", message: "Enter your full name." });
    if (!z.email().safeParse(draft.email.trim()).success) errors.push({ fieldId: "email", message: "Enter a valid email address." });
    if (!input.resume) errors.push({ fieldId: "resume", message: "Upload your current resume." });
    if (input.resume?.processingState === "FAILED") errors.push({ fieldId: "resume", message: "Replace the resume or use the retry option." });
  }
  if (step === 1 && !draft.desiredActivities.length && !draft.guidanceRequested) {
    errors.push({ fieldId: "desired-activities", message: "Choose work you would like to do or select Help me decide from my experience." });
  }
  if (step === 2) {
    for (const experience of draft.experienceAdditions) {
      if (experience.startsOn && experience.endsOn && experience.endsOn < experience.startsOn) errors.push({ fieldId: `experience-${experience.clientId}-end`, message: "End date cannot be before start date." });
      if (experience.kind === "EDUCATION_CERTIFICATION" && !experience.educationLevel && !experience.certifications.length) errors.push({ fieldId: `experience-${experience.clientId}-education`, message: "Add the actual education level or a certification." });
      if (!["CAREGIVING", "OTHER_RELEVANT_LIFE_CONTEXT", "EDUCATION_CERTIFICATION"].includes(experience.kind) && (!experience.organizationOrProject || !experience.roleOrRelationship)) errors.push({ fieldId: `experience-${experience.clientId}-organization`, message: "Add the actual employer, organization, business, or project and your real role." });
    }
    for (const fact of input.facts.filter((item) => item.tier === "SEARCH_CRITICAL" && item.verification === "EXTRACTED_UNCONFIRMED")) {
      if (!input.presentedFactIds.has(fact.id) || !draft.factReviews[fact.id]) {
        errors.push({ fieldId: `fact-${fact.id}`, message: `Review ${fact.displayLabel}.` });
      } else if (draft.factReviews[fact.id] === "CORRECT" && !draft.factCorrections[fact.id]?.value) {
        errors.push({ fieldId: `fact-correction-${fact.id}`, message: `Enter the corrected value for ${fact.displayLabel}.` });
      }
    }
  }
  if (step === 3) {
    if (!draft.workModes.length) errors.push({ fieldId: "work-modes", message: "Choose at least one work mode." });
    if (!stateOrDcOptions.some(([code]) => code === draft.stateOrDc)) errors.push({ fieldId: "state-or-dc", message: "Choose your U.S. state or the District of Columbia." });
    const commuteApplies = draft.workModes.includes("HYBRID") || draft.workModes.includes("ONSITE");
    if (commuteApplies && !/^\d{5}(?:-\d{4})?$/.test(draft.zipCode)) errors.push({ fieldId: "zip-code", message: "Enter the ZIP code to use for commute checks." });
    if (commuteApplies && draft.commuteDistanceMiles === null) errors.push({ fieldId: "commute-distance", message: "Enter the maximum commute distance in miles." });
    if (!draft.employmentTypes.length) errors.push({ fieldId: "employment-types", message: "Choose at least one employment type." });
    const hasPay = draft.salaryTargetCents !== null || draft.salaryHardMinimumCents !== null;
    if (hasPay && !draft.salaryPeriod) errors.push({ fieldId: "salary-period", message: "Choose annual or hourly pay." });
    if (hasPay && !draft.salaryBasis) errors.push({ fieldId: "salary-basis", message: "Choose base pay or guaranteed total pay." });
    if (!draft.salaryMinimumFlexible && draft.salaryTargetCents !== null && draft.salaryHardMinimumCents !== null && draft.salaryTargetCents < draft.salaryHardMinimumCents) {
      errors.push({ fieldId: "salary-target", message: "Your target cannot be below a firm hard minimum." });
    }
    for (const criterion of draft.dealbreakers.filter((value) => value !== "SOMETHING_ELSE")) {
      if (!draft.employerUnknownPolicies[criterion]) errors.push({ fieldId: `unknown-${criterion.toLowerCase()}`, message: "Choose what to do when the employer does not state this detail." });
    }
    if (draft.dealbreakers.includes("SOMETHING_ELSE") && !draft.customDealbreaker) {
      errors.push({ fieldId: "custom-dealbreaker", message: "Describe what else should be left out." });
    }
    if (!draft.termsAccepted) errors.push({ fieldId: "terms-accepted", message: "Agree to the Terms and Privacy Policy to finish your intake." });
  }
  return errors;
}

export function clearInapplicableCommute(draft: FourStepDraft): FourStepDraft {
  return draft.workModes.includes("HYBRID") || draft.workModes.includes("ONSITE")
    ? draft
    : { ...draft, zipCode: "", commuteDistanceMiles: null };
}

export function relevantToolFamilies(draft: FourStepDraft, semanticKeys: readonly string[] = []) {
  const activities = new Set(draft.desiredActivities);
  const keys = semanticKeys.join(" ").toLowerCase();
  const excel = ["ORGANIZING_RECORDS", "PREPARING_REPORTS", "HANDLING_BILLING", "TRACKING_INVENTORY", "IMPROVING_PROCESSES"].some((item) => activities.has(item)) || /excel|spreadsheet/.test(keys);
  const systems = ["SUPPORTING_CUSTOMERS", "ORGANIZING_RECORDS", "MANAGING_WORKFLOWS"].some((item) => activities.has(item)) || /crm|erp|ehr|hris|ticket|database/.test(keys);
  return { excel, systems };
}

export function parseCompensationInput(value: string) {
  const normalized = value.trim().replace(/[$,\s]/g, "");
  if (!normalized) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100_000_000) return Number.NaN;
  return Math.round(amount * 100);
}

export function formatCompensation(cents: number | null, period: FourStepDraft["salaryPeriod"]) {
  if (cents === null) return "Not set";
  const amount = (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: period === "HOUR" ? 2 : 0 });
  return `${amount} ${period === "HOUR" ? "per hour" : "per year"}`;
}

export function safeIntakeEvent(input: unknown) {
  return z.object({
    event: z.enum(["STEP_VIEWED", "DRAFT_SAVED", "DRAFT_RESTORED", "SAVE_CONFLICT", "UPLOAD_STARTED", "UPLOAD_REPLACED", "UPLOAD_REMOVED", "EXTRACTION_RETRY", "FACT_PRESENTED", "INTAKE_FINALIZED", "INTAKE_UNAVAILABLE"]),
    step: z.number().int().min(1).max(4),
  }).strict().safeParse(input);
}

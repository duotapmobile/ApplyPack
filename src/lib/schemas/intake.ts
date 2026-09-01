import { z } from "zod";
import { resumeMimeTypes } from "@/lib/files/signatures";

const bounded = (max = 2000) => z.string().trim().max(max).default("");
const choice = (...values: [string, ...string[]]) => z.enum(values);

export const intakeSchema = z.object({
  email: z.email(),
  fullName: z.string().trim().min(2).max(200),
  city: z.string().trim().min(2).max(120),
  state: z.string().trim().min(2).max(80),
  timezone: z.string().trim().min(2).max(100),
  linkedin: z.string().trim().url().max(500).or(z.literal("")).default(""),
  resumeFormat: choice("keep", "applypack", "decide"),
  coverLetterPreference: choice("voice", "facts", "fresh", "not_uploaded"),
  backgroundTypes: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  backgroundDetails: z.string().trim().min(20).max(6000),
  tools: bounded(2000),
  credentials: bounded(2000),
  resumeCorrections: bounded(3000),
  remoteRequirement: choice("required", "preferred", "not_important"),
  hybridPolicy: choice("open", "exclude"),
  onSitePolicy: choice("open", "exclude"),
  remoteDetail: bounded(300),
  minimumSalary: bounded(100),
  preferredSalary: bounded(100),
  minimumHourly: bounded(100),
  preferredHourly: bounded(100),
  unknownSalaryPolicy: choice("exclude", "include_mark_unknown"),
  employmentTypes: z.array(z.string().trim().min(1).max(100)).min(1).max(10),
  schedulePreferences: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  requiredBenefits: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  preferredBenefits: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  unknownBenefitsPolicy: choice("exclude", "include_mark_unknown"),
  neverInclude: z.array(z.string().trim().min(1).max(100)).min(1).max(30),
  tryAvoid: z.array(z.string().trim().min(1).max(100)).max(30).default([]),
  previousDislikes: bounded(2000),
  excludedIndustries: bounded(2000),
  directionChoice: choice("exact", "ideas", "different", "unknown"),
  targetTitles: bounded(1000),
  searchDistance: choice("close", "adjacent", "bigger_change"),
  oldCareerExclusion: bounded(1000),
  workAuthorization: z.string().trim().min(2).max(500),
  needsSponsorship: choice("yes", "no", "unsure"),
  travelPreference: z.string().trim().min(2).max(500),
  commuteDistance: bounded(300),
  eligibilityRestrictions: bounded(2000),
  criteriaApproved: z.literal(true),
  researchAcknowledged: z.literal(true),
  noGuaranteeAcknowledged: z.literal(true),
  listingChangesAcknowledged: z.literal(true),
  termsAccepted: z.literal(true),
  accuracyConfirmed: z.literal(true),
});

export type IntakeInput = z.infer<typeof intakeSchema>;
export const allowedResumeTypes = resumeMimeTypes;

export function parseIntakeForm(formData: FormData) {
  const list = (name: string) => {
    const raw = formData.get(name);
    if (typeof raw !== "string") return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  return intakeSchema.safeParse({
    email: formData.get("email"),
    fullName: formData.get("fullName"),
    city: formData.get("city"),
    state: formData.get("state"),
    timezone: formData.get("timezone"),
    linkedin: formData.get("linkedin"),
    resumeFormat: formData.get("resumeFormat"),
    coverLetterPreference: formData.get("coverLetterPreference"),
    backgroundTypes: list("backgroundTypes"),
    backgroundDetails: formData.get("backgroundDetails"),
    tools: formData.get("tools"),
    credentials: formData.get("credentials"),
    resumeCorrections: formData.get("resumeCorrections"),
    remoteRequirement: formData.get("remoteRequirement"),
    hybridPolicy: formData.get("hybridPolicy"),
    onSitePolicy: formData.get("onSitePolicy"),
    remoteDetail: formData.get("remoteDetail"),
    minimumSalary: formData.get("minimumSalary"),
    preferredSalary: formData.get("preferredSalary"),
    minimumHourly: formData.get("minimumHourly"),
    preferredHourly: formData.get("preferredHourly"),
    unknownSalaryPolicy: formData.get("unknownSalaryPolicy"),
    employmentTypes: list("employmentTypes"),
    schedulePreferences: list("schedulePreferences"),
    requiredBenefits: list("requiredBenefits"),
    preferredBenefits: list("preferredBenefits"),
    unknownBenefitsPolicy: formData.get("unknownBenefitsPolicy"),
    neverInclude: list("neverInclude"),
    tryAvoid: list("tryAvoid"),
    previousDislikes: formData.get("previousDislikes"),
    excludedIndustries: formData.get("excludedIndustries"),
    directionChoice: formData.get("directionChoice"),
    targetTitles: formData.get("targetTitles"),
    searchDistance: formData.get("searchDistance"),
    oldCareerExclusion: formData.get("oldCareerExclusion"),
    workAuthorization: formData.get("workAuthorization"),
    needsSponsorship: formData.get("needsSponsorship"),
    travelPreference: formData.get("travelPreference"),
    commuteDistance: formData.get("commuteDistance"),
    eligibilityRestrictions: formData.get("eligibilityRestrictions"),
    criteriaApproved: formData.get("criteriaApproved") === "true",
    researchAcknowledged: formData.get("researchAcknowledged") === "true",
    noGuaranteeAcknowledged: formData.get("noGuaranteeAcknowledged") === "true",
    listingChangesAcknowledged: formData.get("listingChangesAcknowledged") === "true",
    termsAccepted: formData.get("termsAccepted") === "true",
    accuracyConfirmed: formData.get("accuracyConfirmed") === "true",
  });
}

import { z } from "zod";
import { canonicalizeEmployer } from "./canonicalize";
import { getEmployerSource, sourceUrlMatchesDefinition } from "./source-registry";
import type { RawJobPosting } from "./types";

const httpUrl = z.url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol));

export const jobPayloadSchema = z.object({
  company: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  sourceUrl: httpUrl,
  sourceId: z.string().trim().min(1).max(100).optional(),
  sourceName: z.string().trim().max(200).optional(),
  officialApplicationUrl: httpUrl.optional(),
  externalJobId: z.string().trim().max(300).optional(),
  description: z.string().trim().max(100_000).optional().default(""),
  department: z.string().trim().max(300).optional().default(""),
  location: z.string().trim().max(500).optional().default(""),
  employmentType: z.string().trim().max(200).optional().default(""),
  remoteScope: z.string().trim().max(2000).optional().default(""),
  eligibleStates: z.array(z.string().trim().min(2).max(100)).max(60).optional(),
  eligibleCountries: z.array(z.string().trim().min(2).max(100)).max(250).optional(),
  timezoneRequirement: z.string().trim().max(300).optional().default(""),
  scheduleType: z.string().trim().max(300).optional().default(""),
  salaryMin: z.number().nonnegative().nullable().optional(),
  salaryMax: z.number().nonnegative().nullable().optional(),
  salaryCurrency: z.string().trim().max(10).optional().default(""),
  payPeriod: z.string().trim().max(100).optional().default(""),
  payModel: z.string().trim().max(100).optional().default(""),
  applicantCost: z.number().nonnegative().nullable().optional(),
  benefitsStatus: z.string().trim().max(100).optional().default(""),
  languageRequirements: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  postedAt: z.iso.datetime().nullable().optional(),
  closingAt: z.iso.datetime().nullable().optional(),
  checkedAt: z.iso.datetime(),
  salary: z.string().trim().max(200).optional().default(""),
  fitSummary: z.string().trim().min(20).max(3000),
  matchingExperience: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
  primaryOutcome: z.string().trim().min(10).max(1000),
  coreResponsibilities: z.array(z.string().trim().min(1).max(500)).min(1).max(30),
  requirements: z.array(z.string().trim().min(1).max(500)).min(1).max(30),
  hiddenJobFunctions: z.array(z.string().trim().min(1).max(500)).max(20),
  concerns: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
  criteriaChecks: z.object({
    dutiesAligned: z.literal(true),
    experienceConfirmed: z.literal(true),
    levelAcceptable: z.literal(true),
    scheduleAcceptable: z.literal(true),
    locationAcceptable: z.literal(true),
    compensationAcceptable: z.literal(true),
    nonNegotiablesSatisfied: z.literal(true),
  }),
});

export type JobPayload = z.infer<typeof jobPayloadSchema>;

export function payloadToRawJob(payload: JobPayload): RawJobPosting {
  return {
    sourceId: payload.sourceId || inferSourceId(payload.company, payload.sourceUrl),
    sourceName: payload.sourceName,
    employerName: payload.company,
    externalJobId: payload.externalJobId,
    title: payload.title,
    description: payload.description,
    department: payload.department,
    sourceJobUrl: payload.sourceUrl,
    officialApplicationUrl: payload.officialApplicationUrl,
    location: payload.location,
    employmentType: payload.employmentType,
    remoteScope: payload.remoteScope,
    eligibleStates: payload.eligibleStates,
    eligibleCountries: payload.eligibleCountries,
    timezoneRequirement: payload.timezoneRequirement,
    scheduleType: payload.scheduleType,
    salaryMin: payload.salaryMin,
    salaryMax: payload.salaryMax,
    salaryCurrency: payload.salaryCurrency,
    payPeriod: payload.payPeriod,
    payModel: payload.payModel,
    applicantCost: payload.applicantCost,
    benefitsStatus: payload.benefitsStatus,
    languageRequirements: payload.languageRequirements,
    postedAt: payload.postedAt,
    closingAt: payload.closingAt,
    lastVerifiedAt: payload.checkedAt,
  };
}

export function inferSourceId(employerName: string, url: string): string {
  const hostname = new URL(url).hostname.toLowerCase();
  if (hostname === "indeed.com" || hostname.endsWith(".indeed.com")) return "indeed";
  if (hostname === "hiring.cafe" || hostname.endsWith(".hiring.cafe")) return "hiringcafe";
  const canonical = canonicalizeEmployer(employerName);
  const source = getEmployerSource(canonical.canonicalId);
  return source && sourceUrlMatchesDefinition(source, url) ? source.id : "manual-reviewed";
}

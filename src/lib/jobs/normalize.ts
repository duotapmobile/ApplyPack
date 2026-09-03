import { createHash } from "node:crypto";
import { canonicalizeEmployer, exclusionReason } from "./canonicalize";
import {
  classifyDegreeRequired,
  classifyEmployment,
  classifyEquipmentResponsibility,
  classifyExperience,
  classifyFlags,
  classifyPhoneIntensity,
  classifyWorkMode,
  normalizeBenefitsStatus,
  normalizePayModel,
} from "./classify";
import { getEmployerSource, getSource, sourceUrlMatchesDefinition } from "./source-registry";
import type { NormalizedJob, RawJobPosting } from "./types";

export function normalizeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|fbclid$|gclid$|ref$|source$)/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase();
    url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
    url.searchParams.sort();
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeTitle(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\b(?:remote|hybrid)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

export function normalizeJob(raw: RawJobPosting, now = new Date()): NormalizedJob {
  const source = getSource(raw.sourceId);
  if (!source) throw new Error(`Unknown job source: ${raw.sourceId}`);
  const employer = canonicalizeEmployer(raw.employerName);
  const employerSource = getEmployerSource(employer.canonicalId);
  const description = cleanText(raw.description);
  const location = cleanText(raw.location);
  const combined = `${raw.title}\n${description || ""}\n${location || ""}`;
  const flags = classifyFlags(raw.title, description || "");
  const phone = classifyPhoneIntensity(raw.title, description || "");
  const remote = classifyWorkMode({
    title: raw.title,
    description: description || "",
    location: location || "",
    explicitStates: raw.eligibleStates,
    explicitCountries: raw.eligibleCountries,
    explicitTimezone: raw.timezoneRequirement,
  });
  const employment = classifyEmployment(`${raw.employmentType || ""}\n${description || ""}`, {
    relationship: source.defaultWorkerRelationship,
    employmentType: source.defaultEmploymentType,
  });
  const sourceJobUrl = normalizeUrl(raw.sourceJobUrl);
  const suppliedApplicationUrl = normalizeUrl(raw.officialApplicationUrl);
  const officialApplicationUrl = source.isOfficial && source.isDirectEmployer
    ? [suppliedApplicationUrl, sourceJobUrl].find((url) => sourceUrlMatchesDefinition(source, url)) || null
    : suppliedApplicationUrl && employerSource && sourceUrlMatchesDefinition(employerSource, suppliedApplicationUrl)
      ? suppliedApplicationUrl
      : null;
  const rejected = exclusionReason({ employerName: raw.employerName, sourceName: raw.sourceName || source.sourceName, sourceUrl: sourceJobUrl, applicationUrl: officialApplicationUrl });
  const normalizedTitle = normalizeTitle(raw.title);
  const contentHash = sha256([normalizedTitle, description || "", location || ""].join("\n"));
  const locationKey = (location || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const deduplicationKey = sha256([employer.canonicalId, normalizedTitle, locationKey, contentHash].join("|"));
  const verifiedAt = validIso(raw.lastVerifiedAt) || now.toISOString();
  const ageHours = Math.max(0, now.getTime() - new Date(verifiedAt).getTime()) / 3_600_000;
  const sourceFreshnessStatus = ageHours <= 24 ? "fresh" : ageHours <= 72 ? "aging" : "stale";
  const payModel = normalizePayModel(raw.payModel, combined);
  const benefits = normalizeBenefitsStatus(raw.benefitsStatus, source.defaultBenefitsStatus);

  return {
    canonicalEmployerId: employer.canonicalId,
    employerDisplayName: employer.canonicalName,
    employerAliases: [...new Set([...employer.aliases, ...(raw.employerAliases || [])])],
    sourceId: source.id,
    sourceName: raw.sourceName || source.sourceName,
    sourceCategory: source.category,
    isOfficialSource: source.isOfficial && Boolean(officialApplicationUrl),
    isDirectEmployerSource: source.isDirectEmployer && Boolean(officialApplicationUrl),
    officialApplicationUrl,
    sourceJobUrl,
    normalizedSourceUrl: sourceJobUrl,
    externalJobId: cleanText(raw.externalJobId),
    normalizedTitle,
    rawTitle: raw.title.normalize("NFKC").trim(),
    description,
    department: cleanText(raw.department),
    employmentType: employment.employmentType,
    w2OrContractor: employment.relationship,
    workMode: remote.workMode,
    remoteScope: cleanText(raw.remoteScope) || remote.remoteScope,
    eligibleStates: remote.states,
    eligibleCountries: remote.countries,
    timezoneRequirement: cleanText(raw.timezoneRequirement) || remote.timezone,
    scheduleType: cleanText(raw.scheduleType),
    salaryMin: finiteOrNull(raw.salaryMin),
    salaryMax: finiteOrNull(raw.salaryMax),
    salaryCurrency: cleanText(raw.salaryCurrency),
    payPeriod: cleanText(raw.payPeriod),
    payModel,
    phoneIntensity: phone.intensity,
    salesFlag: flags.salesFlag,
    commissionFlag: flags.commissionFlag,
    marketingFlag: flags.marketingFlag,
    highVolumeContactCenterFlag: phone.highVolume,
    degreeRequired: classifyDegreeRequired(description || ""),
    experienceLevel: classifyExperience(raw.title, description || ""),
    equipmentRequirement: extractEquipmentRequirement(combined),
    equipmentCostResponsibility: classifyEquipmentResponsibility(combined),
    applicantCost: finiteOrNull(raw.applicantCost) ?? extractApplicantCost(combined),
    benefitsStatus: benefits,
    languageRequirements: [...new Set([...(raw.languageRequirements || []), ...extractLanguageRequirements(combined)])],
    postedAt: validIso(raw.postedAt),
    closingAt: validIso(raw.closingAt),
    lastVerifiedAt: verifiedAt,
    sourceFreshnessStatus,
    contentHash,
    deduplicationKey,
    isActive: !rejected && sourceFreshnessStatus !== "stale",
    reviewStatus: rejected ? "rejected" : source.isOfficial ? "pending" : "needs_review",
    rejectionReason: rejected,
    locationText: location,
  };
}

function cleanText(value: string | null | undefined): string | null {
  const cleaned = value?.normalize("NFKC").replace(/\0/g, "").replace(/\s+/g, " ").trim();
  return cleaned || null;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function validIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function extractEquipmentRequirement(text: string): string | null {
  const sentence = text.split(/(?<=[.!?])\s+|\n+/).find((part) => /equipment|computer|internet|headset|home office/i.test(part));
  return sentence?.trim().slice(0, 2000) || null;
}

function extractApplicantCost(text: string): number | null {
  const sentence = text.split(/(?<=[.!?])\s+|\n+/).find((part) => /applicant[- ]paid|applicant\s+(?:is\s+)?responsible|background[- ]check\s+(?:fee|cost)|must\s+pay/i.test(part));
  if (!sentence) return null;
  const amount = sentence.match(/\$\s*(\d+(?:\.\d{1,2})?)/)?.[1];
  return amount ? Number(amount) : null;
}

function extractLanguageRequirements(text: string): string[] {
  const matches = text.match(/(?:bilingual|fluent|proficient)\s+(?:in\s+)?(?:english|spanish|french|german|mandarin|cantonese|portuguese|arabic)/gi) || [];
  return [...new Set(matches.map((value) => value.trim()))];
}

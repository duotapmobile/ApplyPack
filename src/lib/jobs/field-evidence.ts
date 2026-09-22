import type { RawJobPosting } from "./types";

export const SOURCE_NORMALIZATION_VERSION = "source-normalization-v2";

/** Describes evidence, never turns a classifier guess into a provider statement. */
export function sourceFieldEvidence(posting: RawJobPosting) {
  const direct = ["title", "description", "location", "department", "employmentType", "salaryMin", "salaryMax",
    "salaryCurrency", "payPeriod", "eligibleStates", "eligibleCountries", "timezoneRequirement", "postedAt", "closingAt"] as const;
  const observed = Object.fromEntries(direct.map((field) => [field, {
    method: posting[field] === null || posting[field] === undefined ? "UNKNOWN" : "PROVIDER_STRUCTURED_FIELD",
    locator: `captured_listing.${field}`,
    rawPayloadSha256: posting.rawSourceEvidence?.payloadSha256 || null,
    sourceUrl: posting.sourceJobUrl || null,
    normalizationVersion: SOURCE_NORMALIZATION_VERSION,
    confidence: null,
  }]));
  const inferred = Object.fromEntries(["phoneIntensity", "degreeRequired", "experienceLevel", "salesFlag",
    "commissionFlag", "workMode", "equipmentCostResponsibility"].map((field) => [field, {
    method: "HEURISTIC_REQUIRES_REVIEW", locator: "captured_listing.title+description+location",
    rawPayloadSha256: posting.rawSourceEvidence?.payloadSha256 || null,
    sourceUrl: posting.sourceJobUrl || null, normalizationVersion: SOURCE_NORMALIZATION_VERSION,
    confidence: null,
  }]));
  return { ...observed, ...inferred };
}

export function sourceCompensation(posting: RawJobPosting) {
  const minimum = Number.isFinite(posting.salaryMin) ? posting.salaryMin : null;
  const maximum = Number.isFinite(posting.salaryMax) ? posting.salaryMax : null;
  if (minimum === null && maximum === null) return { text: null, source: null, completeness: 0 };
  const amount = minimum !== null && maximum !== null ? `${minimum}–${maximum}` : String(minimum ?? maximum);
  return {
    text: [posting.salaryCurrency || "Currency unspecified", amount, posting.payPeriod || "period unspecified"].join(" "),
    source: posting.sourceJobUrl || null,
    completeness: posting.salaryCurrency && posting.payPeriod && posting.sourceJobUrl ? 100 : 50,
  };
}

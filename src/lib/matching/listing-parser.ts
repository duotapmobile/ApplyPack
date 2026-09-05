import { createHash } from "node:crypto";
import { semanticComparisonKey, type RequirementNode, type TypedCriterion } from "@/lib/domain/foundation";

export const LISTING_PARSER_VERSION = "listing-requirements-v2";

export type ListingParserIssue = {
  locator: string;
  code: "AMBIGUOUS_HARD_REQUIREMENT" | "UNSUPPORTED_REQUIREMENT" | "NO_REQUIREMENTS_FOUND";
  text: string;
};

export type ListingParseResult = {
  status: "COMPLETE" | "NEEDS_HUMAN_REVIEW";
  tree: RequirementNode | null;
  criteria: TypedCriterion[];
  issues: ListingParserIssue[];
  parserVersion: typeof LISTING_PARSER_VERSION;
};

function stableUuid(seed: string) {
  const value = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  value[12] = "4";
  value[16] = ((Number.parseInt(value[16], 16) & 0x3) | 0x8).toString(16);
  return `${value.slice(0, 8).join("")}-${value.slice(8, 12).join("")}-${value.slice(12, 16).join("")}-${value.slice(16, 20).join("")}-${value.slice(20).join("")}`;
}

function base(snapshotId: string, locator: string, text: string, strength: TypedCriterion["strength"]) {
  return {
    stableCriterionId: stableUuid(`${snapshotId}|${locator}|${semanticComparisonKey(text)}`),
    semanticKey: semanticComparisonKey(text),
    strength,
    sourceLocator: locator,
    parserCertainty: 1,
    version: LISTING_PARSER_VERSION,
  };
}

function parseMoney(text: string) {
  const matches = [...text.matchAll(/\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*([kK])?/gu)];
  return matches.map((match) => Math.round(Number(match[1].replaceAll(",", "")) * (match[2] ? 100_000 : 100)));
}

function strengthFor(line: string): TypedCriterion["strength"] {
  if (/\b(required|must|minimum|need to|shall)\b/iu.test(line)) return "REQUIRED";
  if (/\b(preferred|nice to have|plus)\b/iu.test(line)) return "PREFERRED";
  return "INFORMATIONAL";
}

function criterionFor(snapshotId: string, locator: string, text: string): TypedCriterion | null {
  const strength = strengthFor(text);
  const common = base(snapshotId, locator, text, strength);
  const modes = [
    /\bremote\b/iu.test(text) ? "REMOTE" as const : null,
    /\bhybrid\b/iu.test(text) ? "HYBRID" as const : null,
    /\b(on[ -]?site|in[ -]?office)\b/iu.test(text) ? "ONSITE" as const : null,
  ].filter((value): value is "REMOTE" | "HYBRID" | "ONSITE" => value !== null);
  if (modes.length) return { ...common, kind: "WORK_MODE", modes: [...new Set(modes)], locationRestrictions: [] };

  if (/\b(sponsor(?:ship)?|authorized to work|work authorization|visa)\b/iu.test(text)) {
    return { ...common, kind: "AUTHORIZATION_SPONSORSHIP", employerRule: text, customerStatus: "REQUIRES_TARGETED_CONFIRMATION", inferred: false };
  }

  const experience = text.match(/\b(\d{1,2})\+?\s*(?:years?|yrs?)\b\s*(?:of\s+)?(.+)?/iu);
  if (experience) return {
    ...common,
    kind: "EXPERIENCE",
    responsibilityOrDomain: (experience[2] || text).slice(0, 300),
    minimumMonths: Number(experience[1]) * 12,
    fteExplicit: /\b(full[ -]?time|fte)\b/iu.test(text),
    permittedEquivalents: [],
    seniorityOrScope: null,
  };

  const education = text.match(/\b(high school|associate(?:'s)?|bachelor(?:'s)?|master(?:'s)?|doctorate|ph\.?d\.?)\b/iu);
  if (education) return { ...common, kind: "EDUCATION", level: education[1], allowedFields: [], completionStatus: "REQUIRED_BY_LISTING", equivalencyLanguage: /equivalent/iu.test(text) ? text : null };

  const money = parseMoney(text);
  if (money.length) {
    const period = /\b(hour|hourly|\/hr|per hour)\b/iu.test(text) ? "HOUR" as const : "YEAR" as const;
    return { ...common, kind: "COMPENSATION", currency: "USD", period, lowerCents: money[0] ?? null, upperCents: money[1] ?? money[0] ?? null, basis: /\b(ote|commission|variable)\b/iu.test(text) ? "VARIABLE_OTE" : "BASE", workerClass: "EMPLOYEE", source: "EMPLOYER_LISTING", comparisonMethod: "PUBLISHED_TEXT_ONLY" };
  }

  if (/\b(responsibilit(?:y|ies)|you will|duties include)\b/iu.test(text)) return { ...common, kind: "RESPONSIBILITY", activity: text.slice(0, 300), centrality: "CENTRAL", complexity: null, autonomy: null, scope: null, frequency: null };
  return null;
}

export function parseListingRequirements(input: { jobSnapshotId: string; listingText: string }): ListingParseResult {
  if (!input.jobSnapshotId || !input.listingText.trim()) throw new Error("job_snapshot_and_listing_required");
  const lines = input.listingText.split(/\r?\n/u).map((text, index) => ({ text: text.trim().replace(/^[-*•]\s*/u, ""), locator: `line:${index + 1}` })).filter(({ text }) => text.length > 0);
  const criteria: TypedCriterion[] = [];
  const issues: ListingParserIssue[] = [];
  for (const line of lines) {
    const criterion = criterionFor(input.jobSnapshotId, line.locator, line.text);
    if (criterion) criteria.push(criterion);
    else if (/\b(required|must|minimum|qualification|license|certification|experience|degree|clearance)\b/iu.test(line.text)) {
      issues.push({ locator: line.locator, code: "UNSUPPORTED_REQUIREMENT", text: line.text });
    }
  }
  if (!criteria.some((criterion) => criterion.strength === "REQUIRED")) {
    issues.push({ locator: "listing", code: "NO_REQUIREMENTS_FOUND", text: "No required criterion was deterministically extracted." });
  }
  return {
    status: issues.length ? "NEEDS_HUMAN_REVIEW" : "COMPLETE",
    tree: criteria.length ? { kind: "ALL_OF", children: criteria.map((criterion) => ({ kind: "CRITERION", criterion })) } : null,
    criteria,
    issues,
    parserVersion: LISTING_PARSER_VERSION,
  };
}

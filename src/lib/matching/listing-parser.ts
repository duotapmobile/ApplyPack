import { createHash } from "node:crypto";
import { semanticComparisonKey, typedCriterionSchema, type TypedCriterion } from "@/lib/domain/foundation";
import { industryCatalog, stateOrDcOptions } from "@/lib/intake/four-step";

export const LISTING_PARSER_VERSION = "listing-requirements-v7";

export type ListingParserIssue = {
  locator: string;
  code: "AMBIGUOUS_HARD_REQUIREMENT" | "UNSUPPORTED_REQUIREMENT" | "INVALID_TYPED_REQUIREMENT" | "NO_REQUIREMENTS_FOUND";
  text: string;
};

export type ListingParseResult = {
  status: "COMPLETE" | "NEEDS_HUMAN_REVIEW";
  tree: ParsedRequirementNode | null;
  criteria: TypedCriterion[];
  issues: ListingParserIssue[];
  parserVersion: typeof LISTING_PARSER_VERSION;
};

export type ParsedRequirementNode =
  | { nodeId: string; semanticKey: string; kind: "ALL_OF" | "ANY_OF"; children: ParsedRequirementNode[] }
  | { nodeId: string; semanticKey: string; kind: "CRITERION"; criterion: TypedCriterion };

function stableUuid(seed: string) {
  const value = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  value[12] = "4";
  value[16] = ((Number.parseInt(value[16], 16) & 0x3) | 0x8).toString(16);
  return `${value.slice(0, 8).join("")}-${value.slice(8, 12).join("")}-${value.slice(12, 16).join("")}-${value.slice(16, 20).join("")}-${value.slice(20).join("")}`;
}

function base(snapshotId: string, locator: string, text: string, strength: TypedCriterion["strength"], discriminator = "requirement") {
  return {
    stableCriterionId: stableUuid(`${snapshotId}|${locator}|${discriminator}|${semanticComparisonKey(text)}`),
    semanticKey: semanticComparisonKey(text),
    strength,
    sourceLocator: locator,
    parserCertainty: 1,
    version: LISTING_PARSER_VERSION,
  };
}

function parseMoney(text: string) {
  const matches = [...text.matchAll(/(?:(USD|CAD|EUR|GBP)\s*)?(US\$|CA\$|C\$|\$)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*([kK])?(?:\s*(USD|CAD|EUR|GBP))?/giu)];
  return matches.map((match) => {
    const symbol = match[2].toLocaleUpperCase("en-US");
    const currency = (match[5] || match[1] || (symbol === "C$" || symbol === "CA$" ? "CAD" : "USD")).toLocaleUpperCase("en-US");
    return { cents: Math.round(Number(match[3].replaceAll(",", "")) * (match[4] ? 100_000 : 100)), currency };
  });
}

function strengthFor(line: string): TypedCriterion["strength"] {
  if (/\b(required|must|minimum|need to|shall|required to|ability to|must be able to|capable of|essential function|successful candidate)\b/iu.test(line)) return "REQUIRED";
  if (/\b(preferred|nice to have|plus)\b/iu.test(line)) return "PREFERRED";
  return "INFORMATIONAL";
}

function stateCodesFrom(text: string) {
  const matches: string[] = [];
  for (const [code, name] of stateOrDcOptions) {
    const codeMatch = code === "OR"
      ? /(?:,\s*OR\b|\bOR\s+\d{5}(?:-\d{4})?\b)/u.test(text)
      : new RegExp(`\\b${code}\\b`, "u").test(text);
    if (new RegExp(`\\b${name.replaceAll(" ", "\\s+")}\\b`, "iu").test(text) || codeMatch) matches.push(code);
  }
  return [...new Set(matches)];
}

function locationApplicability(text: string) {
  const beforeColon = text.match(/^\s*([^:]{2,80})\s*:/u)?.[1]?.trim() ?? null;
  if (beforeColon && !/^(salary|pay|compensation|range)$/iu.test(beforeColon)) return beforeColon;
  const states = stateCodesFrom(text);
  if (states.length === 1) return stateOrDcOptions.find(([code]) => code === states[0])?.[1] ?? states[0];
  return null;
}

function listingFactsFor(snapshotId: string, locator: string, text: string, strength = strengthFor(text)): TypedCriterion[] {
  const criteria: TypedCriterion[] = [];
  const makeBase = (kind: string) => base(snapshotId, locator, text, strength, kind);
  const remoteNegated = /\b(?:not|no)\s+(?:available\s+)?remote\b|\bremote\s+(?:work\s+)?(?:is\s+)?(?:not|unavailable)\b/iu.test(text);
  const hybridNegated = /\b(?:not|no)\s+hybrid\b/iu.test(text);
  const modes = [
    /\bremote\b/iu.test(text) && !remoteNegated ? "REMOTE" as const : null,
    /\bhybrid\b/iu.test(text) && !hybridNegated ? "HYBRID" as const : null,
    /\b(on[ -]?site|in[ -]?office)\b/iu.test(text) ? "ONSITE" as const : null,
  ].filter((value): value is "REMOTE" | "HYBRID" | "ONSITE" => value !== null);
  const states = stateCodesFrom(text);
  if (modes.length) criteria.push({ ...makeBase("WORK_MODE"), kind: "WORK_MODE", modes: [...new Set(modes)], locationRestrictions: states });
  if (states.length && /\b(location|located|based|role|position|remote|hybrid|on[ -]?site|in)\b/iu.test(text)) {
    criteria.push({ ...makeBase("GEOGRAPHY"), kind: "GEOGRAPHY", country: "US", statesOrDc: states, polarity: /\b(not available|excluding|except)\b/iu.test(text) ? "DENY" : "ALLOW", relocationRequired: /\brelocat/iu.test(text) ? true : null });
  }
  const employmentTypes = [
    /\bfull[ -]?time\b/iu.test(text) ? "FULL_TIME" as const : null,
    /\bpart[ -]?time\b/iu.test(text) ? "PART_TIME" as const : null,
    /\b(contract(?:or)?|1099)\b/iu.test(text) ? "CONTRACT" as const : null,
    /\b(temp(?:orary)?)\b/iu.test(text) ? "TEMPORARY" as const : null,
  ].filter((value): value is "FULL_TIME" | "PART_TIME" | "CONTRACT" | "TEMPORARY" => value !== null);
  if (employmentTypes.length) criteria.push({ ...makeBase("EMPLOYMENT_TYPE"), kind: "EMPLOYMENT_TYPE", employmentTypes: [...new Set(employmentTypes)] });

  const money = parseMoney(text);
  if (money.length) {
    const endpointMeaning = /\b(up to|maximum|max\.?\s)\b/iu.test(text) ? "UP_TO" as const
      : /\b(starting at|starts? at|from)\b/iu.test(text) ? "STARTING_AT" as const
        : money.length > 1 ? "RANGE" as const : "FIXED" as const;
    const first = money[0]?.cents ?? null;
    const second = money[1]?.cents ?? null;
    criteria.push({
      ...makeBase("COMPENSATION"),
      kind: "COMPENSATION",
      currency: money[0]?.currency ?? "USD",
      period: /\b(hour|hourly|\/hr|per hour)\b/iu.test(text) ? "HOUR" : "YEAR",
      lowerCents: endpointMeaning === "UP_TO" ? null : first,
      upperCents: endpointMeaning === "STARTING_AT" ? null : endpointMeaning === "RANGE" ? second : first,
      endpointMeaning,
      locationApplicability: locationApplicability(text),
      basis: /\b(ote|commission|variable)\b/iu.test(text) ? "VARIABLE_OTE" : /\bguaranteed total\b/iu.test(text) ? "GUARANTEED_TOTAL" : "BASE",
      workerClass: /\b(contractor|1099)\b/iu.test(text) ? "CONTRACTOR" : "EMPLOYEE",
      source: "EMPLOYER_LISTING",
      comparisonMethod: "PUBLISHED_TEXT_WITH_ENDPOINT_CURRENCY_AND_LOCATION",
    });
  }

  if (/\b(weekdays?|weekends?|evenings?|night shift|day shift|on[ -]?call|flexible schedule)\b/iu.test(text)) {
    criteria.push({
      ...makeBase("SCHEDULE"),
      kind: "SCHEDULE",
      days: [/\bweekdays?\b/iu.test(text) && !/\bno\s+weekdays?\b/iu.test(text) ? "WEEKDAYS" : null, /\bweekends?\b/iu.test(text) && !/\bno\s+weekends?\b/iu.test(text) ? "WEEKENDS" : null].filter((value): value is string => Boolean(value)),
      startTime: null,
      endTime: null,
      timeZone: null,
      shift: /\bnight shift\b/iu.test(text) ? "NIGHT" : /\bday shift\b/iu.test(text) ? "DAY" : null,
      weekend: /\bno weekends?\b/iu.test(text) ? false : /\bweekends?\b/iu.test(text) ? true : null,
      evening: /\bno evenings?\b/iu.test(text) ? false : /\b(evening|night shift)\b/iu.test(text) ? true : null,
      onCall: /\bno on[ -]?call\b/iu.test(text) ? false : /\bon[ -]?call\b/iu.test(text) ? true : null,
      flexible: /\bflexible schedule\b/iu.test(text) ? true : null,
    });
  }
  if (/\b(travel|physical labor|lift(?:ing)?|standing|cold call|phone work|sales)\b/iu.test(text)) {
    const demand = /\bno travel\b/iu.test(text) ? "NO_TRAVEL"
      : /\btravel\b/iu.test(text) ? "TRAVEL"
        : /\bcold call/iu.test(text) ? "COLD_CALLING"
          : /\bphone work\b/iu.test(text) ? "HEAVY_PHONE"
            : /\bsales\b/iu.test(text) ? "SALES" : "PHYSICAL_LABOR";
    const threshold = text.match(/\b(\d+(?:\.\d+)?)\s*(pounds?|lbs?|percent|%)\b/iu);
    criteria.push({ ...makeBase("TRAVEL_PHYSICAL"), kind: "TRAVEL_PHYSICAL", normalizedDemand: demand, threshold: threshold ? Number(threshold[1]) : null, unit: threshold ? threshold[2].toLocaleUpperCase("en-US") : null, accommodationNeutral: true });
  }
  if (/\b(benefits?|health insurance|medical insurance|paid time off|pto|retirement|401\s*\(?k\)?)\b/iu.test(text)) {
    criteria.push({ ...makeBase("BENEFIT"), kind: "BENEFIT", benefit: text, employerConfirmation: /\b(no|not offered|without)\b/iu.test(text) ? "UNKNOWN" : "CONFIRMED" });
  }
  for (const [id, label] of industryCatalog) {
    if (new RegExp(`\\b${label.replaceAll(" and ", "(?: and | & )").replaceAll(" ", "\\s+")}\\b`, "iu").test(text)) {
      criteria.push({ ...makeBase(`INDUSTRY_DOMAIN:${id}`), kind: "INDUSTRY_DOMAIN", domain: id, polarity: "ALLOW" });
    }
  }
  return criteria;
}

function criterionFor(snapshotId: string, locator: string, text: string, strengthOverride?: TypedCriterion["strength"], responsibilityContext = false): TypedCriterion | null {
  const strength = strengthOverride ?? strengthFor(text);
  const common = base(snapshotId, locator, text, strength, "EMPLOYER_REQUIREMENT");

  if (/\b(sponsor(?:ship)?|authorized to work|work authorization|visa)\b/iu.test(text)) {
    return { ...common, kind: "AUTHORIZATION_SPONSORSHIP", employerRule: text, customerStatus: "REQUIRES_TARGETED_CONFIRMATION", inferred: false };
  }

  const experience = text.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\+?\s*(?:years?|yrs?)\b\s*(?:of\s+)?(.+)?/iu);
  if (experience) return {
    ...common,
    kind: "EXPERIENCE",
    responsibilityOrDomain: experience[2] || text,
    minimumMonths: (/^\d+$/u.test(experience[1]) ? Number(experience[1]) : ({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 } as const)[experience[1].toLocaleLowerCase("en-US") as keyof { one: 1; two: 2; three: 3; four: 4; five: 5; six: 6; seven: 7; eight: 8; nine: 9; ten: 10 }]) * 12,
    fteExplicit: /\b(full[ -]?time|fte)\b/iu.test(text),
    permittedEquivalents: [],
    seniorityOrScope: null,
  };

  const education = text.match(/\b(high school|associate(?:'s)?|bachelor(?:'s)?|master(?:'s)?|doctorate|ph\.?d\.?)\b/iu);
  if (education) {
    const field = text.slice((education.index ?? 0) + education[0].length).match(/^(?:\s+degree)?\s+in\s+([\p{L}][\p{L}\s-]{0,119}?)(?:[.;]|$)/iu)?.[1]?.trim();
    return { ...common, kind: "EDUCATION", level: education[1], allowedFields: field ? [field] : [], completionStatus: "REQUIRED_BY_LISTING", equivalencyLanguage: /equivalent/iu.test(text) ? text : null };
  }

  const credential = text.match(/\b(?:[A-Z][A-Z0-9-]{1,15}\s+(?:certification|certificate|license)|(?:certification|certificate|license)\s+(?:in|as)\s+[^.;]{2,80})\b/u);
  if (credential) return { ...common, kind: "CERTIFICATION_LICENSE", credential: credential[0], status: "UNKNOWN", jurisdiction: null };

  const tool = text.match(/\b(?:proficien(?:t|cy)|experience|familiar(?:ity)?|skilled)\s+(?:in|with)\s+([^.;]{2,120})/iu);
  if (tool && !experience) return { ...common, kind: "TOOL_CAPABILITY", toolOrTaskCluster: tool[1].trim(), proficiency: /familiar/iu.test(text) ? "FAMILIARITY" : /experience/iu.test(text) ? "PRIOR_USE" : "CURRENT" };

  if (responsibilityContext || /\b(responsibilit(?:y|ies)|you will|duties include)\b/iu.test(text)) return { ...common, strength: strength === "INFORMATIONAL" ? "PREFERRED" : strength, kind: "RESPONSIBILITY", activity: text, centrality: "CENTRAL", complexity: null, autonomy: null, scope: null, frequency: null };
  return null;
}

// Tree identity distinguishes typed facts extracted from the same source text.
// The criterion's matching key and persisted semantic_key retain their meaning.
// Historical parser versions keep their original strict identity contract.
export function requirementNodeSemanticKey(criterion: TypedCriterion) {
  return hasTypedRequirementIdentity(criterion.version) ? `${criterion.kind}:${criterion.semanticKey}` : criterion.semanticKey;
}

export function hasTypedRequirementIdentity(version: string | null | undefined) {
  return version === "listing-requirements-v6" || version === "listing-requirements-v7";
}

function criterionNode(criterion: TypedCriterion): ParsedRequirementNode {
  return { nodeId: criterion.stableCriterionId, semanticKey: requirementNodeSemanticKey(criterion), kind: "CRITERION", criterion };
}

function alternativeNode(snapshotId: string, locator: string, text: string, strength: TypedCriterion["strength"]): { node: ParsedRequirementNode; criteria: TypedCriterion[] } | null {
  if (!/\bor\b/iu.test(text) || strength !== "REQUIRED") return null;
  const boundaries = [...text.matchAll(/\s+or\s+/giu)];
  for (const boundary of boundaries.reverse()) {
    const index = boundary.index;
    if (index == null) continue;
    const leftText = text.slice(0, index).replace(/^\s*(?:required|must|minimum|need to|shall)\s*:?\s*/iu, "").replace(/^either\s+/iu, "").trim();
    const rightText = text.slice(index + boundary[0].length).trim();
    if (!leftText || !rightText) continue;
    const left = criterionFor(snapshotId, `${locator}:alternative:1`, leftText, "REQUIRED");
    const right = criterionFor(snapshotId, `${locator}:alternative:2`, rightText, "REQUIRED");
    if (!left || !right || ambiguousRequirement(leftText, left) || ambiguousRequirement(rightText, right)) continue;
    const nodeId = stableUuid(`${snapshotId}|${locator}|ANY_OF|${semanticComparisonKey(text)}`);
    return {
      node: { nodeId, semanticKey: `any-of:${semanticComparisonKey(text)}`, kind: "ANY_OF", children: [criterionNode(left), criterionNode(right)] },
      criteria: [left, right],
    };
  }
  return null;
}

// These are source boundaries, not a paraphrase. Abbreviations and decimal
// points stay in their original statement; uncertain compounds require review.
function statements(text: string) {
  const result: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character !== ";" && character !== ".") continue;
    // This coherent positive/negative schedule pair has one existing typed
    // representation; splitting it would lose the positive half at consumers.
    if (character === ";" && /^no (?:weekdays?;\s*weekends?|weekends?;\s*weekdays?) only[.]?$/iu.test(text)) continue;
    if (character === ".") {
      if (index + 1 < text.length && !/\s/u.test(text[index + 1])) continue;
      const preceding = text.slice(start, index);
      if (/(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|approx|min|max|U\.S|U\.K|e\.g|i\.e|Ph\.D)|\b[A-Z])$/iu.test(preceding)) continue;
    }
    result.push(text.slice(start, index + 1).trim()); start = index + 1;
  }
  if (text.slice(start).trim()) result.push(text.slice(start).trim());
  return result.filter(Boolean);
}

function section(text: string): { strength: TypedCriterion["strength"]; empty: boolean } | null {
  const match = /^(required(?: qualifications| skills)?|minimum(?: qualifications| requirements)?|qualifications?|requirements?|preferred(?: qualifications| skills)?|nice to have|responsibilities|duties|benefits|compensation|salary|about (?:us|the role)|accepted formats|submission method)\s*:\s*(.*)$/iu.exec(text);
  if (!match) return null;
  const label = match[1].toLowerCase();
  return { strength: /^(required|minimum|qualification|requirement)/u.test(label) ? "REQUIRED"
    : /^(preferred|nice|responsibilit|duties)/u.test(label) ? "PREFERRED" : "INFORMATIONAL", empty: !match[2].trim() };
}

function isStandaloneDocumentInstruction(text: string) {
  // Only a complete document instruction. It remains in the saved source for
  // the separate owner submission-rule review and is never a qualification.
  return /^(?:(?:a|your)\s+)?(?:resume|résumé|cv|cover\s+letter)\s+(?:is\s+)?(?:required|optional)[.;]?$/iu.test(text);
}

const unsupportedQualification = /\b(clearance|background check|drug (?:test|screen)|speak|fluency|fluent|bilingual|citizenship|bespoke|assessment|matrix)\b/iu;
const requirementSignal = /\b(required|must|minimum|qualification|license|certification|experience|degree|clearance|ability to|capable of|essential function|successful candidate)\b/iu;

function ambiguousRequirement(text: string, criterion: TypedCriterion) {
  if (unsupportedQualification.test(text)) return true;
  if (/\b(?:resume|résumé|cv|cover\s+letter)\b.*\b(?:required|optional)\b/iu.test(text)) return true;
  const experiences = [...text.matchAll(/\b(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\+?\s*(?:years?|yrs?)\b/giu)];
  if (experiences.length > 1) return true;
  const kinds = [
    /\b(sponsor(?:ship)?|authorized to work|work authorization|visa)\b/iu.test(text),
    experiences.length > 0,
    /\b(high school|associate(?:'s)?|bachelor(?:'s)?|master(?:'s)?|doctorate|ph\.?d\.?)\b/iu.test(text),
    /\b(certification|certificate|license)\b/iu.test(text),
    /\b(?:proficien(?:t|cy)|familiar(?:ity)?|skilled)\s+(?:in|with)\s+/iu.test(text)
      || /\b(?:and|but|plus|while)\s+experience\s+(?:in|with)\s+/iu.test(text)
      || !experiences.length && /\bexperience\s+(?:in|with)\s+/iu.test(text),
    /\b(responsibilit(?:y|ies)|you will|duties include)\b/iu.test(text),
  ].filter(Boolean).length;
  if (kinds > 1 || /\b(?:and|but|plus|while)\s+(?:must|required|need to|shall|ability to|capable of|successful candidate)\b/iu.test(text)) return true;
  // A second requirement marker cannot be discharged by the first recognized
  // criterion (including punctuation that was unsafe to split).
  if ((text.match(/\b(?:required|must|minimum|need to|shall|ability to|capable of)\b/giu) || []).length > 1) return true;
  if (criterion.kind === "EXPERIENCE" && /\b(?:and|but|plus|while)\b/iu.test(criterion.responsibilityOrDomain)) return true;
  if (criterion.kind === "TOOL_CAPABILITY") {
    const match = /\b(?:proficien(?:t|cy)|experience|familiar(?:ity)?|skilled)\s+(?:in|with)\s+([^.;]{2,120})/iu.exec(text);
    // One tool cluster is not a conjunction of independently checked tools.
    if (!match || /\b(?:and|but|plus|while)\b|[,/&]/iu.test(match[1])
      || !/^[.;\s]*$/u.test(text.slice(match.index + match[0].length))) return true;
  }
  if (criterion.kind === "EDUCATION") {
    const plain = text.replace(/^(?:required|must|minimum|need to|shall)\s*:?\s*/iu, "").trim();
    if (!/^(?:(?:a|an)\s+)?(?:high school(?: diploma)?|associate(?:'s)?|bachelor(?:'s)?|master(?:'s)?|doctorate|ph\.?d\.?)(?:\s+degree)?(?:\s+in\s+[\p{L}][\p{L}\s-]{0,119})?(?:\s+(?:is\s+)?required)?[.;]?$/iu.test(plain)
      || criterion.allowedFields.some(field => /\b(?:and|but|plus|while|required|must)\b/iu.test(field))) return true;
  }
  return false;
}

function completeRequiredFact(text: string, facts: TypedCriterion[]) {
  if (!facts.length || unsupportedQualification.test(text)) return false;
  const plain = text.replace(/^(?:required|must|minimum|need to|shall)\s*:?\s*/iu, "").trim();
  // Narrow whole-statement forms only. A known word such as "remote" does not
  // account for unrelated mandatory language elsewhere in that statement.
  if (/^(?:ability to|must be able to|capable of)?\s*(?:lift(?:ing)?|stand(?:ing)?)\s+\d+(?:\.\d+)?\s*(?:pounds?|lbs?|hours?)(?:\s+(?:is\s+)?required)?[.;]?$/iu.test(plain)) return true;
  if (/^(?:no\s+)?travel(?:\s+(?:up to\s+)?\d+(?:\.\d+)?\s*(?:percent|%))?(?:\s+(?:is\s+)?required)?[.;]?$/iu.test(plain)) return true;
  const locations = stateOrDcOptions.flatMap(([code, name]) => [code, name]).join("|");
  return new RegExp(`^(?:(?:remote|hybrid|on[ -]?site|in[ -]?office|full[ -]?time|part[ -]?time|contract|temporary|seasonal|weekdays?|weekends?)\\s*(?:and\\s+)?)+(?:role|position|work|schedule)?(?:\\s+(?:in|based in|located in)\\s+(?:${locations}))?(?:\\s+(?:is\\s+)?required)?[.;]?$`, "iu").test(plain);
}

export function parseListingRequirements(input: { jobSnapshotId: string; listingText: string }): ListingParseResult {
  if (!input.jobSnapshotId || !input.listingText.trim()) throw new Error("job_snapshot_and_listing_required");
  const lines = input.listingText.split(/\r?\n/u).map((text, index) => ({ text: text.trim().replace(/^[-*•]\s*/u, ""), sourceText: text.trim(), locator: `line:${index + 1}` })).filter(({ text }) => text.length > 0);
  const criteria: TypedCriterion[] = [];
  const hardNodes: ParsedRequirementNode[] = [];
  const issues: ListingParserIssue[] = [];
  let inheritedStrength: TypedCriterion["strength"] = "INFORMATIONAL";
  let inheritedResponsibility = false;
  for (const line of lines) {
   const fragments = statements(line.text);
   let previousStrength: TypedCriterion["strength"] = inheritedStrength;
   for (const [index, text] of fragments.entries()) {
    const locator = `${line.locator}:statement:${index + 1}`;
    const heading = section(text);
    if (heading) {
      inheritedStrength = heading.empty ? heading.strength : "INFORMATIONAL";
      inheritedResponsibility = heading.empty && /^(?:responsibilities|duties)\s*:/iu.test(text);
    }
    if (heading?.empty || isStandaloneDocumentInstruction(text)) continue;
    const explicitStrength = strengthFor(text);
    const context = heading?.strength ?? (index > 0 && fragments[index - 1].endsWith(";") ? previousStrength : inheritedStrength);
    const strength = explicitStrength === "INFORMATIONAL" ? context : explicitStrength;
    previousStrength = strength;
    const addIssue = (code: ListingParserIssue["code"]) => { issues.push({ locator, code, text }); };
    // Negated requirements and incomplete alternatives need a human reading;
    // they must never be strengthened by section inheritance.
    if (/\b(?:not|never)\s+(?:required|mandatory)|\bno\s+(?:degree|experience|certification|license)\s+required|^(?:and|or)\b/iu.test(text)
      || /\b(?:\d+\.\d+|\d+\s*\/\s*\d+)\s*(?:years?|yrs?)\b/iu.test(text)
      || /\b(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:[-–—]|to)\s*(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:years?|yrs?)\b/iu.test(text)) {
      addIssue("AMBIGUOUS_HARD_REQUIREMENT"); continue;
    }
    const valid = (criterion: TypedCriterion) => {
      if (!typedCriterionSchema.safeParse(criterion).success) { addIssue("INVALID_TYPED_REQUIREMENT"); return false; }
      return true;
    };
    const facts = listingFactsFor(input.jobSnapshotId, locator, text, strength).filter(valid);
    for (const fact of facts) {
      if (!criteria.some((criterion) => criterion.stableCriterionId === fact.stableCriterionId)) criteria.push(fact);
      if (fact.strength === "REQUIRED" && !hardNodes.some((node) => node.nodeId === fact.stableCriterionId)) hardNodes.push(criterionNode(fact));
    }
    const alternative = alternativeNode(input.jobSnapshotId, locator, text, strength);
    if (alternative) {
      if (alternative.criteria.map(valid).every(Boolean)) { criteria.push(...alternative.criteria); hardNodes.push(alternative.node); }
      if (line.sourceText.length > 16_000) addIssue("INVALID_TYPED_REQUIREMENT");
      continue;
    }
    if (/\bor\b/iu.test(text) && strength === "REQUIRED") {
      addIssue("AMBIGUOUS_HARD_REQUIREMENT");
      continue;
    }
    const criterion = criterionFor(input.jobSnapshotId, locator, text, strength, inheritedResponsibility);
    if (criterion) {
      if (valid(criterion)) {
        criteria.push(criterion);
        if (criterion.strength === "REQUIRED") hardNodes.push(criterionNode(criterion));
      }
      if (ambiguousRequirement(text, criterion)) addIssue("AMBIGUOUS_HARD_REQUIREMENT");
    }
    else if ((strength === "REQUIRED" || requirementSignal.test(text)) && !completeRequiredFact(text, facts)) {
      addIssue("UNSUPPORTED_REQUIREMENT");
    }
    // The downstream qualification packet stores this exact original line and
    // bounds it at 16,000 JS characters. Never admit a line it cannot preserve.
    if (line.sourceText.length > 16_000 && (facts.length || criterion)) addIssue("INVALID_TYPED_REQUIREMENT");
   }
  }
  if (!hardNodes.length) {
    issues.push({ locator: "listing", code: "NO_REQUIREMENTS_FOUND", text: "No required criterion was deterministically extracted." });
  }
  const root = hardNodes.length ? {
    nodeId: stableUuid(`${input.jobSnapshotId}|hard-root|${hardNodes.map((node) => node.nodeId).join("|")}`),
    semanticKey: `hard-root:${input.jobSnapshotId}`,
    kind: "ALL_OF" as const,
    children: hardNodes,
  } : null;
  return {
    status: issues.length ? "NEEDS_HUMAN_REVIEW" : "COMPLETE",
    tree: root,
    criteria,
    issues,
    parserVersion: LISTING_PARSER_VERSION,
  };
}

export function requirementPersistenceRows(result: ListingParseResult, listingText: string) {
  if (!result.tree) return result.issues.map((issue, position) => ({
    id: stableUuid(`unresolved|${issue.locator}|${semanticComparisonKey(issue.text)}`),
    parent_id: null,
    position,
    node_kind: "CRITERION",
    criterion_type: null,
    stable_criterion_id: null,
    semantic_key: `unresolved:${semanticComparisonKey(issue.text)}`,
    requirement_strength: "UNCLEAR",
    source_locator: issue.locator,
    parser_certainty: 0,
    criterion_version: LISTING_PARSER_VERSION,
    typed_value: null,
    source_excerpt: issue.text,
    classification_method: LISTING_PARSER_VERSION,
    importance: null,
    human_correction_history: [],
  }));
  const lines = listingText.split(/\r?\n/u);
  const rows: Array<Record<string, unknown>> = [];
  const hardCriterionIds = new Set<string>();
  const visit = (node: ParsedRequirementNode, parentId: string | null, position: number) => {
    if (node.kind !== "CRITERION") {
      rows.push({ id: node.nodeId, parent_id: parentId, position, node_kind: node.kind, criterion_type: null, stable_criterion_id: null, semantic_key: node.semanticKey, requirement_strength: null, source_locator: null, parser_certainty: null, criterion_version: LISTING_PARSER_VERSION, typed_value: null, source_excerpt: null, classification_method: LISTING_PARSER_VERSION, human_correction_history: [] });
      node.children.forEach((child, childPosition) => visit(child, node.nodeId, childPosition));
      return;
    }
    const criterion = node.criterion;
    hardCriterionIds.add(criterion.stableCriterionId);
    const lineNumber = Number(criterion.sourceLocator.split(":")[1]);
    rows.push({ id: node.nodeId, parent_id: parentId, position, node_kind: "CRITERION", criterion_type: criterion.kind, stable_criterion_id: criterion.stableCriterionId, semantic_key: criterion.semanticKey, requirement_strength: criterion.strength, source_locator: criterion.sourceLocator, parser_certainty: criterion.parserCertainty, criterion_version: criterion.version, typed_value: criterion, source_excerpt: lines[lineNumber - 1]?.trim() || criterion.semanticKey, classification_method: LISTING_PARSER_VERSION, importance: criterion.strength === "REQUIRED" ? 3 : criterion.kind === "RESPONSIBILITY" ? 2 : 1, human_correction_history: [] });
  };
  visit(result.tree, null, 0);
  result.criteria.filter((criterion) => !hardCriterionIds.has(criterion.stableCriterionId)).forEach((criterion, position) => {
    const lineNumber = Number(criterion.sourceLocator.split(":")[1]);
    rows.push({ id: criterion.stableCriterionId, parent_id: null, position: position + 1, node_kind: "CRITERION", criterion_type: criterion.kind, stable_criterion_id: criterion.stableCriterionId, semantic_key: criterion.semanticKey, requirement_strength: criterion.strength, source_locator: criterion.sourceLocator, parser_certainty: criterion.parserCertainty, criterion_version: criterion.version, typed_value: criterion, source_excerpt: lines[lineNumber - 1]?.trim() || criterion.semanticKey, classification_method: LISTING_PARSER_VERSION, importance: criterion.kind === "RESPONSIBILITY" ? 2 : 1, human_correction_history: [] });
  });
  return rows;
}

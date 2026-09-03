import type {
  BenefitsStatus,
  EmploymentType,
  EquipmentResponsibility,
  ExperienceLevel,
  PayModel,
  PhoneIntensity,
  WorkMode,
  WorkerRelationship,
} from "./types";

const states: Readonly<Record<string, string>> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS",
  kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA",
  michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT",
  nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV",
  wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
};

const stateCodes = new Set(Object.values(states));

export function extractEligibleStates(text: string): string[] {
  const lower = text.toLowerCase();
  const found = new Set<string>();
  for (const [name, code] of Object.entries(states)) {
    if (new RegExp(`\\b${name.replace(" ", "\\s+")}\\b`, "i").test(lower)) found.add(code);
  }
  for (const match of text.toUpperCase().matchAll(/(?:^|[\s,(\/])([A-Z]{2})(?=$|[\s,).\/])/g)) {
    if (stateCodes.has(match[1])) found.add(match[1]);
  }
  return [...found].sort();
}

export function classifyWorkMode(args: {
  title: string;
  description: string;
  location: string;
  explicitStates?: readonly string[] | null;
  explicitCountries?: readonly string[] | null;
  explicitTimezone?: string | null;
}): { workMode: WorkMode; states: string[]; countries: string[]; timezone: string | null; remoteScope: string | null } {
  const text = `${args.title}\n${args.location}\n${args.description}`;
  const statesFound = new Set([...(args.explicitStates || []).map((state) => state.toUpperCase()), ...extractEligibleStates(`${args.location}\n${args.description}`)]);
  const countries = [...new Set((args.explicitCountries || []).map((country) => country.toUpperCase()))];
  const timezoneMatch = args.explicitTimezone || text.match(/\b(?:eastern|central|mountain|pacific|atlantic)\s+(?:time|timezone)|\b(?:EST|EDT|CST|CDT|MST|MDT|PST|PDT)\b/i)?.[0] || null;
  const remote = /\bremote\b|work\s+from\s+home|home[- ]based/i.test(text);
  const hybrid = /\bhybrid\b|(?:report|come|travel)\s+to\s+(?:the\s+)?office|in[- ]office\s+\d|onsite\s+\d|in[- ]person\s+training|required\s+training\s+(?:in|at)\s+/i.test(text);
  const onsite = /\bonsite\b|\bon-site\b|in[- ]person/i.test(text);
  const nationwide = /(?:anywhere|nationwide)\s+in\s+(?:the\s+)?(?:u\.?s\.?|united states)|(?:all|any)\s+(?:u\.?s\.?|united states)\s+states|remote\s+(?:within|across)\s+(?:the\s+)?(?:u\.?s\.?|united states)/i.test(text);
  const global = /remote\s+(?:anywhere|globally|worldwide)|work\s+from\s+anywhere/i.test(text);
  const stateLimited = /must\s+(?:live|reside|be located)|residents?\s+of|remote\s+in\s+[A-Z]|eligible\s+states?|available\s+in\s+(?:the\s+following\s+)?states?/i.test(text);
  const countryLimited = /must\s+(?:live|reside|be located)\s+in\s+(?:the\s+)?(?:u\.?s\.?|united states|canada|united kingdom)|remote\s+(?:within|in)\s+(?:the\s+)?(?:u\.?s\.?|united states|canada|united kingdom)/i.test(text);

  if (hybrid) return { workMode: "hybrid", states: [...statesFound], countries, timezone: timezoneMatch, remoteScope: restrictionSummary(text) };
  if (!remote && onsite) return { workMode: "onsite", states: [...statesFound], countries, timezone: timezoneMatch, remoteScope: restrictionSummary(text) };
  if (remote && global) return { workMode: "remote_global", states: [...statesFound], countries, timezone: timezoneMatch, remoteScope: restrictionSummary(text) };
  if (remote && timezoneMatch) return { workMode: "remote_us_timezone_limited", states: [...statesFound], countries: countries.length ? countries : ["US"], timezone: timezoneMatch, remoteScope: restrictionSummary(text) };
  if (remote && (stateLimited || (statesFound.size > 0 && !nationwide))) {
    return { workMode: "remote_us_state_limited", states: [...statesFound].sort(), countries: countries.length ? countries : ["US"], timezone: timezoneMatch, remoteScope: restrictionSummary(text) };
  }
  if (remote && nationwide) return { workMode: "remote_us_nationwide", states: [], countries: ["US"], timezone: timezoneMatch, remoteScope: restrictionSummary(text) };
  if (remote && countryLimited) return { workMode: "remote_country_limited", states: [...statesFound], countries: countries.length ? countries : ["US"], timezone: timezoneMatch, remoteScope: restrictionSummary(text) };
  if (remote) return { workMode: "unknown", states: [...statesFound], countries, timezone: timezoneMatch, remoteScope: [restrictionSummary(text), "Remote eligibility requires location verification."].filter(Boolean).join(" ") };
  if (onsite || args.location.trim()) return { workMode: "onsite", states: [...statesFound], countries, timezone: timezoneMatch, remoteScope: restrictionSummary(text) };
  return { workMode: "unknown", states: [], countries, timezone: timezoneMatch, remoteScope: null };
}

function restrictionSummary(text: string): string | null {
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).map((value) => value.trim()).filter(Boolean);
  const matched = sentences.filter((sentence) => /remote|hybrid|onsite|on-site|office|training|reside|located|timezone|home office|equipment|travel|language/i.test(sentence));
  return matched.slice(0, 6).join(" ").slice(0, 2000) || null;
}

export function classifyPhoneIntensity(title: string, description: string): { intensity: PhoneIntensity; highVolume: boolean } {
  const text = `${title}\n${description}`.toLowerCase();
  const highVolume = /\b(?:[89]\d|\d{3,})\+?\s+(?:calls|contacts)\s+(?:per|a)\s+day|high[- ]volume\s+(?:call|contact)|call\s+handling\s+metrics|talk\s+time|phone\s+queue|call\s+volume/i.test(text);
  const high = highVolume || /call\s+center|contact\s+center|inbound\s+calls?|outbound\s+calls?|customer\s+service\s+calls?|handle\s+calls?/i.test(text);
  if (high) return { intensity: "high", highVolume };
  const low = /email[- ](?:based|only)|chat[- ](?:based|only)|non[- ]phone|written\s+support|asynchronous\s+support|occasional\s+(?:phone|calls?)/i.test(text);
  const mixed = /phone|calls?|voice\s+support|telephone/i.test(text);
  if (low) return { intensity: "low", highVolume: false };
  if (mixed) return { intensity: "mixed", highVolume: false };
  return { intensity: "none_or_unknown", highVolume: false };
}

export function classifyFlags(title: string, description: string) {
  const text = `${title}\n${description}`;
  const salesFlag = /\bsales\b|inbound\s+sales|outbound\s+sales|business\s+development|account\s+executive|lead\s+generation|\bquota\b|upsell(?:ing)?|cross[- ]sell(?:ing)?|\bretention\b|\bclosing\b|\bprospecting\b|commission/i.test(text);
  const commissionFlag = /commission(?:-only|\s+only|ed)?|uncapped\s+earning/i.test(text);
  const marketingFlag = /\bmarketing\b|demand\s+generation|content\s+marketing|paid\s+media|brand\s+marketing|growth\s+marketing|marketing\s+communications/i.test(text);
  return { salesFlag, commissionFlag, marketingFlag };
}

export function classifyExperience(title: string, description: string): ExperienceLevel {
  const text = `${title}\n${description}`;
  if (/\b(?:senior|sr\.?|lead|principal|director|vice president|vp)\b/i.test(title)) return "senior";
  const years = [...text.matchAll(/(?:minimum\s+of\s+|at\s+least\s+)?(\d+)\+?\s+years?/gi)].map((match) => Number(match[1]));
  const required = years.length ? Math.max(...years) : null;
  if (required !== null && required >= 5) return "senior";
  if (required !== null && required >= 3) return "mid_level";
  if (required !== null && required >= 1) return "early_career";
  if (/entry[- ]level|no\s+(?:prior\s+)?experience|required\s+training\s+provided|new\s+graduate|recent\s+graduate/i.test(text)) return "entry_level";
  return "unknown";
}

export function classifyDegreeRequired(description: string): boolean | null {
  if (/bachelor(?:'s)?\s+(?:degree\s+)?(?:required|is required)|must\s+have\s+(?:a\s+)?bachelor|degree\s+required/i.test(description)) return true;
  if (/degree\s+(?:preferred|not required)|or\s+equivalent\s+experience|high\s+school\s+(?:diploma|ged)/i.test(description)) return false;
  return null;
}

export function classifyEmployment(value: string, sourceDefaults?: { relationship?: WorkerRelationship; employmentType?: EmploymentType }): { employmentType: EmploymentType; relationship: WorkerRelationship } {
  const lower = value.toLowerCase();
  if (/1099/.test(lower)) return { employmentType: "1099", relationship: "contractor" };
  if (/independent\s+contractor|freelance/.test(lower)) return { employmentType: "independent_contractor", relationship: "contractor" };
  if (/staffing|agency\s+assignment/.test(lower)) return { employmentType: "staffing_assignment", relationship: "staffing" };
  if (/temporary|\btemp\b/.test(lower)) return { employmentType: "temporary", relationship: sourceDefaults?.relationship || "staffing" };
  if (/seasonal/.test(lower)) return { employmentType: "seasonal", relationship: sourceDefaults?.relationship || "unknown" };
  if (/part[- ]time/.test(lower)) {
    return sourceDefaults?.relationship && sourceDefaults.relationship !== "w2"
      ? { employmentType: sourceDefaults.employmentType || "unknown", relationship: sourceDefaults.relationship }
      : { employmentType: "w2_part_time", relationship: "w2" };
  }
  if (/full[- ]time/.test(lower)) {
    return sourceDefaults?.relationship && sourceDefaults.relationship !== "w2"
      ? { employmentType: sourceDefaults.employmentType || "unknown", relationship: sourceDefaults.relationship }
      : { employmentType: "w2_full_time", relationship: "w2" };
  }
  return { employmentType: sourceDefaults?.employmentType || "unknown", relationship: sourceDefaults?.relationship || "unknown" };
}

export function normalizeBenefitsStatus(value: string | null | undefined, fallback: BenefitsStatus = "unknown"): BenefitsStatus {
  const lower = (value || "").toLowerCase();
  if (/not\s+provided|no\s+benefits/.test(lower)) return "not_provided";
  if (/varies|may\s+be\s+eligible/.test(lower)) return "varies";
  if (/provided|health\s+insurance|medical\s+benefits/.test(lower)) return "provided";
  return fallback;
}

export function normalizePayModel(value: string | null | undefined, text: string): PayModel {
  const lower = `${value || ""}\n${text}`.toLowerCase();
  if (/per[- ]minute|paid\s+by\s+the\s+minute/.test(lower)) return "per_minute";
  if (/commission/.test(lower)) return "commission";
  if (/contract\s+rate|per\s+project/.test(lower)) return "contract_rate";
  if (/\bannual|\bsalary|per\s+year/.test(lower)) return "salary";
  if (/hourly|per\s+hour|\/hr\b/.test(lower)) return "hourly";
  return "unknown";
}

export function classifyEquipmentResponsibility(text: string): EquipmentResponsibility {
  if (/company|employer[- ]provided\s+(?:computer|equipment)|equipment\s+(?:is\s+)?provided/i.test(text)) return "employer";
  if (/must\s+(?:have|provide)|own\s+(?:computer|equipment)|applicant[- ]provided/i.test(text)) return "applicant";
  if (/shared\s+equipment|some\s+equipment\s+provided/i.test(text)) return "shared";
  return "unknown";
}

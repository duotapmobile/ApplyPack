const aliasEntries = [
  ["Sitel Group", "Foundever"],
  ["Sitel", "Foundever"],
  ["SYKES", "Foundever"],
  ["Teleperformance", "TP"],
  ["Aetna", "CVS Health"],
  ["TurboTax", "Intuit"],
  ["Discover", "Capital One"],
] as const;

export const canonicalEmployerAliases = Object.fromEntries(aliasEntries) as Readonly<Record<string, string>>;

const canonicalIds: Readonly<Record<string, string>> = {
  Foundever: "foundever",
  TP: "tp",
  "CVS Health": "cvs-health",
  Intuit: "intuit",
  "Capital One": "capital-one",
};

export function normalizeEmployerToken(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

const aliasLookup = new Map(aliasEntries.map(([alias, canonical]) => [normalizeEmployerToken(alias), canonical]));

export function canonicalizeEmployer(name: string): {
  canonicalName: string;
  canonicalId: string;
  aliases: string[];
} {
  const trimmed = name.normalize("NFKC").trim().replace(/\s+/g, " ");
  const canonicalName = aliasLookup.get(normalizeEmployerToken(trimmed)) || trimmed;
  const aliases = aliasEntries
    .filter(([, target]) => target === canonicalName)
    .map(([alias]) => alias);
  return {
    canonicalName,
    canonicalId: canonicalIds[canonicalName] || slugifyEmployer(canonicalName),
    aliases,
  };
}

export function slugifyEmployer(name: string): string {
  return normalizeEmployerToken(name).replace(/\s+/g, "-") || "unknown-employer";
}

const liveopsPattern = /(?:^|[^a-z])(?:join\s*)?live\s*ops(?:[^a-z]|$)|liveops/i;

export function isLiveopsReference(...values: Array<string | null | undefined>): boolean {
  return values.some((value) => Boolean(value && liveopsPattern.test(value)));
}

const heldEmployerTokens = new Set([
  "dice",
  "demand com",
  "sunrun",
  "jerry",
  "centerfield",
  "datalot",
  "healthcare business services",
  "destination knot",
  "nogigiddy",
  "blue cross blue shield",
  "aaa",
]);

export function exclusionReason(args: {
  employerName?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  applicationUrl?: string | null;
}): string | null {
  if (isLiveopsReference(args.employerName, args.sourceName, args.sourceUrl, args.applicationUrl)) {
    return "hard_exclusion:liveops";
  }
  const employer = normalizeEmployerToken(args.employerName || "");
  if (heldEmployerTokens.has(employer)) return "source_held:" + employer.replace(/\s+/g, "_");
  return null;
}

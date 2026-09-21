import { canonicalSha256, semanticComparisonKey, type SearchBreadth } from "@/lib/domain/foundation";
import { isLiveopsReference } from "@/lib/jobs/canonicalize";
import type { SourceAuthorizationState } from "@/lib/jobs/types";

export const RETRIEVAL_POLICY_VERSION = "responsibility-retrieval-v1";
export const SOURCE_AUTHORIZATION_VERSION = "source-auth-v1";

export type ResponsibilityEvidence = {
  id: string;
  label: string;
  relation: "DIRECT" | "ADJACENT" | "TRANSFERABLE" | "UNSUPPORTED";
  verified: boolean;
  nearbyRoleFamilies?: readonly string[];
  relatedRoleFamilies?: readonly string[];
  broadRoleFamilies?: readonly string[];
};

export type RetrievalInput = {
  breadth: SearchBreadth;
  desiredResponsibilities: readonly string[];
  verifiedResponsibilities: readonly ResponsibilityEvidence[];
  capabilities: readonly string[];
  acceptedWorkModes: readonly string[];
  stateOrDc: string;
  acceptedEmploymentTypes: readonly string[];
  hardRestrictions: readonly string[];
  targetTitles?: readonly string[];
  industryInterests?: readonly string[];
  softAvoidances?: readonly string[];
  targetCompensationCents?: number | null;
};

export type RetrievalQueryFamily = {
  id: string;
  neutral: true;
  responsibilities: string[];
  roleFamilies: string[];
  expansionHints: string[];
  prioritizationHints: string[];
  hardFilters: string[];
  fingerprint: string;
  version: typeof RETRIEVAL_POLICY_VERSION;
};

function unique(values: readonly string[]) {
  return [...new Map(values.filter(Boolean).map((value) => [semanticComparisonKey(value), value.trim()])).values()]
    .sort((a, b) => semanticComparisonKey(a).localeCompare(semanticComparisonKey(b)));
}

export function buildResponsibilityFirstQueries(input: RetrievalInput): RetrievalQueryFamily[] {
  const supported = input.verifiedResponsibilities.filter((item) => item.verified && item.relation !== "UNSUPPORTED");
  const seeds = unique([...input.desiredResponsibilities, ...supported.map(({ label }) => label)]);
  if (!seeds.length) return [];
  const relations = input.breadth === "CLOSE_TO_PREVIOUS_WORK" ? new Set(["DIRECT"])
    : input.breadth === "ADJACENT_OPPORTUNITIES" ? new Set(["DIRECT", "ADJACENT"])
      : new Set(["DIRECT", "ADJACENT", "TRANSFERABLE"]);
  const roles = unique(supported.filter(({ relation }) => relations.has(relation)).flatMap((item) => input.breadth === "CLOSE_TO_PREVIOUS_WORK"
    ? item.nearbyRoleFamilies ?? [] : input.breadth === "ADJACENT_OPPORTUNITIES"
      ? [...(item.nearbyRoleFamilies ?? []), ...(item.relatedRoleFamilies ?? [])]
      : [...(item.nearbyRoleFamilies ?? []), ...(item.relatedRoleFamilies ?? []), ...(item.broadRoleFamilies ?? [])]));
  const expansionHints = unique([...(input.targetTitles ?? []), ...(input.industryInterests ?? []), ...(input.softAvoidances ?? []).map((v) => `avoid when alternatives tie: ${v}`)]);
  const prioritizationHints = unique([...input.capabilities, ...(input.targetCompensationCents == null ? [] : [`target compensation cents ${input.targetCompensationCents}`])]);
  const hardFilters = unique([...input.hardRestrictions, ...input.acceptedWorkModes.map((v) => `work mode ${v}`), `state ${input.stateOrDc}`, ...input.acceptedEmploymentTypes.map((v) => `employment type ${v}`)]);
  return seeds.map((responsibility) => {
    const stable = { responsibility, roles, hardFilters, breadth: input.breadth };
    return { id: canonicalSha256(stable).slice(0, 24), neutral: true, responsibilities: [responsibility], roleFamilies: roles, expansionHints, prioritizationHints, hardFilters, fingerprint: canonicalSha256(stable), version: RETRIEVAL_POLICY_VERSION };
  });
}

export function passesConfirmedHardRestrictions(input: { blockedIndustries: readonly string[]; hardAvoidedActivities: readonly string[]; candidateIndustry: string | null; candidateActivities: readonly string[] }) {
  const blockedIndustries = new Set(input.blockedIndustries.map(semanticComparisonKey));
  const avoided = new Set(input.hardAvoidedActivities.map(semanticComparisonKey));
  if (input.candidateIndustry && blockedIndustries.has(semanticComparisonKey(input.candidateIndustry))) return false;
  return !input.candidateActivities.some((activity) => avoided.has(semanticComparisonKey(activity)));
}

export function assertAuthorizedSource(input: { sourceId: string; sourceName?: string | null; url?: string | null; state: SourceAuthorizationState; evidenceId: string | null; path: "AUTOMATED" | "MANUAL" }) {
  if (isLiveopsReference(input.sourceId, input.sourceName, input.url) || input.state === "BLOCKED") throw new Error("blocked_source_liveops");
  if (!input.evidenceId) throw new Error("source_authorization_evidence_missing");
  if (input.path === "AUTOMATED" && input.state !== "AUTHORIZED_AUTOMATED") throw new Error("source_automation_not_authorized");
  if (input.path === "MANUAL" && !["AUTHORIZED_AUTOMATED", "AUTHORIZED_MANUAL_ONLY"].includes(input.state)) throw new Error("source_manual_research_not_authorized");
  return true;
}

export function listingEvidenceOnly<T>(captured: T): T {
  return captured;
}

export type ApplicationPathEvidence = {
  sourceId: string;
  url: string;
  hostType: "EMPLOYER_HOSTED" | "APPROVED_THIRD_PARTY";
  authorized: boolean;
  active: boolean;
  actionable: boolean;
};

export function chooseApplicationProvenance(input: {
  discoverySourceId: string;
  discoveryUrl: string;
  candidates: readonly ApplicationPathEvidence[];
}) {
  const usable = input.candidates.filter((candidate) => candidate.authorized && candidate.active && candidate.actionable);
  const chosen = usable.find((candidate) => candidate.hostType === "EMPLOYER_HOSTED") ?? usable.find((candidate) => candidate.hostType === "APPROVED_THIRD_PARTY");
  if (!chosen) throw new Error("actionable_application_path_missing");
  return {
    discoverySourceId: input.discoverySourceId,
    discoveryUrl: input.discoveryUrl,
    canonicalApplicationSourceId: chosen.sourceId,
    canonicalApplicationUrl: chosen.url,
    applicationHostType: chosen.hostType,
    thirdPartyDiscoveryRetained: input.discoverySourceId !== chosen.sourceId,
  };
}

import type { EvidenceBoundMaterialInput, EvidenceSentence } from "./generate";
import { credentialState } from "@/lib/matching/credential-state";

export type VerifiedClaimFact = { id: string; typed_value: unknown; capability_status?: string | null };
export type VerifiedJobExcerpt = { id: string; source_excerpt: string | null };

const normalize = (text: string) => text.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();
const safeNarratives = new Set([
  "Thank you for your consideration.",
  "I welcome the opportunity to discuss this position.",
].map(normalize));

export function isNonfactualNarrative(text: string) { return safeNarratives.has(normalize(text)); }

function textValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(textValues);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    // Verification confirms the record, including a negative answer. It does not
    // turn a skill name inside that answer into a positive candidate claim.
    if (credentialState(record) === "FAIL"
      || ["held", "hasExperience", "canDo", "supported", "completed", "earned", "obtained", "graduated", "certified", "licensed"].some((key) => record[key] === false)
      || ["status", "state", "capabilityStatus", "capability_status"].some((key) =>
        typeof record[key] === "string" && /^(?:unknown|unsure|not_done|not held|not_held|basic_exposure|incomplete|in progress|pending|planned)$/i.test(record[key] as string))) return [];
    return Object.entries(record).filter(([key]) => !/^(?:id|employmentFactId|type|kind|status|state|verification|source|capabilityStatus|capability_status)$/i.test(key))
      .flatMap(([, nested]) => textValues(nested));
  }
  return [];
}

function containsExactPhrase(text: string, evidence: string[]) {
  const claim = normalize(text);
  // Never remove context or negation by extracting a substring.
  return claim.length > 0 && evidence.some((item) => normalize(item) === claim);
}

/** Conservative extractive validation. Unproven paraphrases need verified fact
 * wording; an existing UUID or operator-authored narrative is not proof. */
export function validateMaterialClaims(
  input: EvidenceBoundMaterialInput,
  facts: VerifiedClaimFact[],
  jobEvidence: VerifiedJobExcerpt[],
) {
  const eligibleFacts = facts.filter((fact) => !fact.capability_status || fact.capability_status === "CAN_DO_NOW");
  const byFact = new Map(eligibleFacts.map((fact) => [fact.id, textValues(fact.typed_value)]));
  const byJob = new Map(jobEvidence.map((node) => [node.id, node.source_excerpt ? [node.source_excerpt] : []]));
  const supported = (text: string, ids: string[]) => {
    if (!ids.length || ids.some((id) => !byFact.has(id))
      || !containsExactPhrase(text, ids.flatMap((id) => byFact.get(id) || []))) {
      throw new Error("document_claim_not_supported_by_cited_facts");
    }
  };
  const sentence = (claim: EvidenceSentence, candidateOnly: boolean) => {
    if (claim.narrative) {
      if (candidateOnly || !isNonfactualNarrative(claim.text)) throw new Error("document_narrative_contains_unverified_claim");
      return;
    }
    if (claim.candidateFactIds?.length || candidateOnly) {
      supported(claim.text, claim.candidateFactIds || []);
      return;
    }
    const ids = claim.jobEvidenceIds || [];
    if (/\b(?:I|my|me|we|our)\b/i.test(claim.text) || !ids.length || ids.some((id) => !byJob.has(id))
      || !containsExactPhrase(claim.text, ids.flatMap((id) => byJob.get(id) || []))) {
      throw new Error("document_claim_not_supported_by_job_evidence");
    }
  };
  sentence(input.professionalSummary, true);
  input.coreSkills.forEach((claim) => sentence(claim, true));
  for (const experience of input.experiences) {
    const boundRecords = eligibleFacts.filter((fact) => {
      if (!experience.headerCandidateFactIds.includes(fact.id) || !fact.typed_value || typeof fact.typed_value !== "object") return false;
      const record = fact.typed_value as Record<string, unknown>;
      return ["historicalTitle", "employer", "dates", ...(experience.location ? ["location"] : [])].every((key) =>
        typeof record[key] === "string" && normalize(record[key] as string) === normalize(experience[key as keyof typeof experience] as string));
    });
    if (!boundRecords.length) throw new Error("document_employment_record_binding_required");
    const employmentIds = new Set(boundRecords.map((fact) => fact.id));
    const attributedFactIds = new Set(eligibleFacts.filter((fact) => employmentIds.has(fact.id)
      || (fact.typed_value && typeof fact.typed_value === "object"
        && employmentIds.has(String((fact.typed_value as Record<string, unknown>).employmentFactId))))
      .map((fact) => fact.id));
    const employmentSentence = (claim: EvidenceSentence) => {
      if (!claim.candidateFactIds?.length || claim.candidateFactIds.some((id) => !attributedFactIds.has(id))) {
        throw new Error("document_claim_employment_attribution_required");
      }
      sentence(claim, true);
    };
    if (experience.descriptor) employmentSentence(experience.descriptor);
    experience.bullets.forEach(employmentSentence);
  }
  for (const item of input.educationAndCertifications || []) {
    if (!item.candidateFactIds.some((id) => containsExactPhrase(item.degree, byFact.get(id) || [])
      && containsExactPhrase(item.detail, byFact.get(id) || []))) {
      throw new Error("document_education_record_binding_required");
    }
  }
  const breakDates = [input.careerBreak.start, input.careerBreak.end].filter((date): date is string => Boolean(date));
  if (breakDates.length && !input.careerBreak.candidateFactIds.some((id) =>
    breakDates.every((date) => containsExactPhrase(date, byFact.get(id) || [])))) {
    throw new Error("document_career_break_record_binding_required");
  }
  input.coverLetterParagraphs.forEach((claim) => sentence(claim, false));
}

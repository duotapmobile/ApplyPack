import { validateMaterialClaims, type VerifiedClaimFact, type VerifiedJobExcerpt } from "./claim-validation";
import { DOCUMENT_REQUIREMENTS } from "./requirements";
import type { EvidenceBoundMaterialInput, EvidenceSentence, RequirementMapping, VerifiedExperience } from "./generate";

type Review = { decision: unknown };
type Requirement = VerifiedJobExcerpt & { stable_criterion_id: string | null };
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const texts = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && !!item.trim()) : [];
const bound = (text: string, id: string): EvidenceSentence => ({ text, candidateFactIds: [id] });

/** Extractive preparation only: no generated achievements, inferred qualifications,
 * unverified paraphrases, or padding. The same claim guard runs again at rendering. */
export function prepareMaterialDraft(input: {
  facts: VerifiedClaimFact[];
  requirements: Requirement[];
  reviews: Review[];
  job: EvidenceBoundMaterialInput["job"];
  careerBreakChoice: EvidenceBoundMaterialInput["careerBreak"]["choice"];
}) {
  const facts = [...input.facts].sort((a, b) => a.id.localeCompare(b.id));
  const known = new Set(facts.map((fact) => fact.id));
  if (!input.requirements.length) throw new Error("Verified job requirements are needed before preparing a draft.");
  const mappings: RequirementMapping[] = input.requirements.map((node) => {
    const reviews = input.reviews.map((review) => record(review.decision)).filter((review) => review.stableCriterionId === node.stable_criterion_id);
    if (reviews.length > 1) throw new Error("Resolve duplicate current match reviews before drafting.");
    const review = reviews[0];
    const ids = texts(review?.candidateFactVersionIds);
    const supported = review?.disposition === "RESOLVED_PASS" && ids.length && ids.every((id) => known.has(id))
      && texts(review.sourceEvidenceNodeIds).includes(node.id);
    const classification = supported && review.evidenceRelation === "DIRECT" ? "DIRECT_EVIDENCE"
      : supported && review.evidenceRelation === "ADJACENT" && review.adjacentEquivalenceReviewId ? "TRANSFERABLE_EVIDENCE" : "UNKNOWN";
    return { jobEvidenceId: node.id, classification, candidateFactIds: classification === "UNKNOWN" ? [] : ids };
  });
  const matchedIds = new Set(mappings.flatMap((mapping) => mapping.candidateFactIds));
  if (!matchedIds.size) throw new Error("Current evidence-supported match reviews are needed before preparing a draft.");
  const experiences: VerifiedExperience[] = [];
  for (const fact of facts) {
    const value = record(fact.typed_value);
    if (!["historicalTitle", "employer", "dates"].every((key) => typeof value[key] === "string" && String(value[key]).trim())) continue;
    const evidence = facts.filter((candidate) => candidate.id === fact.id || record(candidate.typed_value).employmentFactId === fact.id);
    const bullets = evidence.flatMap((candidate) => {
      if (!matchedIds.has(candidate.id)) return [];
      const detail = record(candidate.typed_value);
      return [...texts(detail.bullets), ...(typeof detail.activity === "string" ? [detail.activity] : [])].map((text) => bound(text, candidate.id));
    }).slice(0, 12);
    if (!bullets.length) continue;
    experiences.push({ historicalTitle: String(value.historicalTitle), employer: String(value.employer), dates: String(value.dates),
      ...(typeof value.location === "string" ? { location: value.location } : {}), headerCandidateFactIds: [fact.id], bullets });
  }
  if (!experiences.length) throw new Error("Confirm a complete employment record and its job-relevant responsibilities before drafting.");
  const sourceParagraphs = facts.filter((fact) => matchedIds.has(fact.id)).flatMap((fact) =>
    texts(record(fact.typed_value).coverLetterEvidence).map((text) => bound(text, fact.id)));
  // Dedicated confirmed detail prevents repeating resume bullets as a letter.
  if (sourceParagraphs.length < 3) throw new Error("Confirm at least three job-relevant cover-letter evidence passages; unsupported wording will not be invented.");
  const selected = sourceParagraphs.slice(0, 12);
  const groups: EvidenceSentence[][] = [[], [], []];
  selected.forEach((claim, index) => groups[Math.min(2, Math.floor(index * 3 / selected.length))].push(claim));
  const coverLetterParagraphs: EvidenceSentence[] = groups.map((claims) => ({
    text: claims.map((claim) => claim.text).join(" "),
    candidateFactIds: [...new Set(claims.flatMap((claim) => claim.candidateFactIds || []))],
    segments: claims.map((claim) => ({ text: claim.text, candidateFactIds: claim.candidateFactIds! })),
  }));
  const words = coverLetterParagraphs.map((claim) => claim.text).join(" ").trim().split(/\s+/).length;
  if (words < DOCUMENT_REQUIREMENTS.coverLetter.supportedWordMinimum || words > DOCUMENT_REQUIREMENTS.coverLetter.supportedWordMaximum) {
    throw new Error("Confirmed cover-letter evidence must support 250–350 words without padding. Review the passages before drafting.");
  }
  const pointCount = new Set(selected.flatMap((claim) => claim.candidateFactIds || [])).size;
  if (pointCount < 2 || pointCount > 4) throw new Error("The letter needs two to four distinct confirmed evidence points.");
  if (!["KEEP_EXISTING_TIMELINE", "OMIT_ENTRY"].includes(input.careerBreakChoice)) {
    throw new Error("Prepare the customer's confirmed career-break dates and presentation manually before generation.");
  }
  const summary = facts.flatMap((fact) => typeof record(fact.typed_value).summary === "string" ? [bound(String(record(fact.typed_value).summary), fact.id)] : [])[0]
    || experiences[0].bullets[0];
  const draft = {
    professionalSummary: summary,
    coreSkills: facts.filter((fact) => matchedIds.has(fact.id)).flatMap((fact) => texts(record(fact.typed_value).skills).map((text) => bound(text, fact.id))).slice(0, 20),
    experiences: experiences.slice(0, 20), educationAndCertifications: [], coverLetterParagraphs,
    requirementMappings: mappings, verifiedHiringManager: null, careerBreakDates: null,
    mentionCareerBreakInCoverLetter: false, documentLanguage: "en-US" as const,
    humanApprovedTwoPageException: false, humanApprovedLongLetter: false,
  };
  validateMaterialClaims({ ...draft, contact: { displayName: "", email: "", phone: "", cityState: "", candidateFactIds: [] },
    job: input.job, finalVersionAt: new Date(0).toISOString(), careerBreak: { choice: input.careerBreakChoice, mentionInCoverLetter: false, candidateFactIds: [] },
    rules: { outputFormat: "DOCX", resumePageLimit: 1 } }, facts, input.requirements);
  return draft;
}

import { describe, expect, it } from "vitest";
import { prepareMaterialDraft } from "@/lib/documents/draft-preparation";
import { validateMaterialClaims, type VerifiedClaimFact } from "@/lib/documents/claim-validation";
import { generateEvidenceBoundMaterials, inspectDocxPackage } from "@/lib/documents/generate";
import { documentFixture } from "../fixtures/document";

function preparationFixture() {
  const original = documentFixture();
  const employmentId = original.experiences[0].headerCandidateFactIds[0];
  const detailId = "77000000-0000-4000-8000-000000000099";
  const facts: VerifiedClaimFact[] = [{ id: employmentId, typed_value: {
    historicalTitle: original.experiences[0].historicalTitle, employer: original.experiences[0].employer,
    dates: original.experiences[0].dates, location: original.experiences[0].location,
    summary: original.professionalSummary.text, bullets: original.experiences[0].bullets.map((bullet) => bullet.text),
    coverLetterEvidence: original.coverLetterParagraphs.slice(0, 2).map((paragraph) => paragraph.text),
  } }, { id: detailId, typed_value: { employmentFactId: employmentId,
    coverLetterEvidence: original.coverLetterParagraphs.slice(2).map((paragraph) => paragraph.text),
  } }];
  const requirements = original.job.jobEvidenceIds.map((id) => ({ id, stable_criterion_id: id, source_excerpt: "Verified job requirement." }));
  const reviews = requirements.map((node) => ({ decision: { stableCriterionId: node.stable_criterion_id,
    sourceEvidenceNodeIds: [node.id], candidateFactVersionIds: [employmentId, detailId], disposition: "RESOLVED_PASS", evidenceRelation: "DIRECT" } }));
  return { original, facts, requirements, reviews, job: original.job, careerBreakChoice: "OMIT_ENTRY" as const };
}

describe("verified material draft preparation", () => {
  it("prepares deterministic evidence, passes the canonical guard and generates both private DOCX artifacts", async () => {
    const input = preparationFixture();
    const draft = prepareMaterialDraft(input);
    expect(prepareMaterialDraft({ ...input, facts: [...input.facts].reverse() })).toEqual(draft);
    const canonical = { ...input.original, ...draft, careerBreak: { choice: "OMIT_ENTRY" as const, mentionInCoverLetter: false, candidateFactIds: [] } };
    validateMaterialClaims(canonical, input.facts, input.requirements);
    const generated = await generateEvidenceBoundMaterials(canonical);
    expect((await inspectDocxPackage(generated.resume.buffer, "RESUME")).extractedText).toContain(input.original.experiences[0].employer);
    expect(generated.resume.provenance.claims.length).toBeGreaterThan(0);
    expect(generated.coverLetter.provenance.claims.length).toBeGreaterThan(0);
  });
  it("does not pad a sparse customer record or pretend an unreviewed relationship is verified", () => {
    const input = preparationFixture();
    expect(() => prepareMaterialDraft({ ...input, reviews: [] })).toThrow("Current evidence-supported match reviews");
    const value = input.facts[0].typed_value as Record<string, unknown>;
    value.coverLetterEvidence = ["Maintained records.", "Updated records."];
    (input.facts[1].typed_value as Record<string, unknown>).coverLetterEvidence = ["Checked records."];
    expect(() => prepareMaterialDraft(input)).toThrow("250–350 words without padding");
  });
  it("rejects unbound additions and negation laundering inside compound paragraphs", () => {
    const input = preparationFixture();
    const draft = prepareMaterialDraft(input);
    const canonical = { ...input.original, ...draft, careerBreak: { choice: "OMIT_ENTRY" as const, mentionInCoverLetter: false, candidateFactIds: [] } };
    canonical.coverLetterParagraphs[0].text += " Generated $10 million.";
    expect(() => validateMaterialClaims(canonical, input.facts, input.requirements)).toThrow("document_composite_claim_binding_invalid");
    const segment = canonical.coverLetterParagraphs[0].segments![0];
    segment.text = "Excel";
    canonical.coverLetterParagraphs[0].text = canonical.coverLetterParagraphs[0].segments!.map((part) => part.text).join(" ");
    (input.facts[0].typed_value as Record<string, unknown>).skills = ["No Excel experience"];
    expect(() => validateMaterialClaims(canonical, input.facts, input.requirements)).toThrow("document_claim_not_supported_by_cited_facts");
  });
});

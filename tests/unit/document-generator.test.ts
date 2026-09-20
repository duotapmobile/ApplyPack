import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { generateEvidenceBoundMaterials } from "@/lib/documents/generate";
import { documentFixture } from "../fixtures/document";
import { validateMaterialClaims, type VerifiedClaimFact } from "@/lib/documents/claim-validation";

function truthfulFixture() {
  const input = documentFixture();
  input.coverLetterParagraphs = [{ text: "Thank you for your consideration.", narrative: true }];
  const facts: VerifiedClaimFact[] = [
    { id: input.professionalSummary.candidateFactIds![0], typed_value: {
      statements: [input.professionalSummary.text, input.coreSkills[0].text, input.experiences[0].bullets[0].text],
    } },
    { id: input.coreSkills[1].candidateFactIds![0], typed_value: {
      statements: [input.coreSkills[1].text, input.experiences[0].bullets[1].text],
    } },
    { id: input.experiences[0].headerCandidateFactIds[0], typed_value: {
      historicalTitle: input.experiences[0].historicalTitle, employer: input.experiences[0].employer,
      dates: input.experiences[0].dates, location: input.experiences[0].location,
      statements: input.experiences[0].bullets.map((bullet) => bullet.text),
    } },
  ];
  input.experiences[0].bullets.forEach((bullet) => { bullet.candidateFactIds = input.experiences[0].headerCandidateFactIds; });
  return { input, facts };
}

describe("canonical document generation", () => {
  it("preserves natural names and an unbolded signature", async () => {
    const input = documentFixture();
    input.contact.displayName = "MARISSA WRIGHT";
    const artifacts = await generateEvidenceBoundMaterials(input);
    const zip = await JSZip.loadAsync(artifacts.coverLetter.buffer);
    const xml = await zip.file("word/document.xml")!.async("string");
    const names = [...xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)].map((match) => match[0]).filter((p) => p.includes("Marissa Wright"));
    expect(names).toHaveLength(2);
    expect(names[1]).not.toMatch(/<w:b\b/);
    expect(xml).not.toContain("MARISSA WRIGHT");
  });
  it("rejects fabricated metrics even with an authentic fact ID", () => {
    const input = documentFixture();
    const id = input.professionalSummary.candidateFactIds![0];
    const facts: VerifiedClaimFact[] = [{ id, typed_value: { activity: "Coordinated customer records" } }];
    input.professionalSummary.text = "Managed 500 employees and generated $10 million.";
    expect(() => validateMaterialClaims(input, facts, [])).toThrow("document_claim_not_supported_by_cited_facts");
  });
  it("cannot use employer SQL requirements as candidate SQL evidence", () => {
    const input = documentFixture();
    input.professionalSummary = { text: "SQL", jobEvidenceIds: input.job.jobEvidenceIds };
    expect(() => validateMaterialClaims(input, [], [{ id: input.job.jobEvidenceIds[0], source_excerpt: "SQL required" }])).toThrow("document_claim_not_supported_by_cited_facts");
  });
  it("rejects narrative laundering before creating a document", async () => {
    const input = documentFixture();
    input.professionalSummary = { text: "Generated $10 million.", narrative: true };
    await expect(generateEvidenceBoundMaterials(input)).rejects.toThrow("document_narrative_contains_unverified_claim");
  });
  it("does not infer SQL from NoSQL", () => {
    const input = documentFixture();
    input.professionalSummary.text = "SQL";
    const facts = [{ id: input.professionalSummary.candidateFactIds![0], typed_value: "NoSQL" }];
    expect(() => validateMaterialClaims(input, facts, [])).toThrow("document_claim_not_supported_by_cited_facts");
  });
  it("accepts complete exact verified statements and a bound employment record", () => {
    const { input, facts } = truthfulFixture();
    expect(() => validateMaterialClaims(input, facts, [])).not.toThrow();
  });
  it.each([
    { skill: "SQL", held: false },
    { skill: "SQL", isActive: false },
    { skill: "SQL", status: "unknown" },
    { skill: "SQL", capabilityStatus: "NOT_DONE" },
    { skill: "SQL", hasExperience: false },
    "No SQL",
  ])("does not remove negative or unknown context from a verified fact: %j", (value) => {
    const { input, facts } = truthfulFixture();
    input.professionalSummary.text = "SQL";
    facts[0].typed_value = value;
    expect(() => validateMaterialClaims(input, facts, [])).toThrow("document_claim_not_supported_by_cited_facts");
  });
  it.each(["NOT_DONE", "UNSURE", "BASIC_EXPOSURE", "DONE_BEFORE_NEEDS_REFRESHER"])("does not upgrade capability %s to unqualified proficiency", (status) => {
    const { input, facts } = truthfulFixture();
    facts[0].capability_status = status;
    expect(() => validateMaterialClaims(input, facts, [])).toThrow("document_claim_not_supported_by_cited_facts");
  });
  it("does not combine another employer's title with a real employment record", () => {
    const { input, facts } = truthfulFixture();
    const extraId = "10000000-0000-4000-8000-000000000010";
    facts.push({ id: extraId, typed_value: { historicalTitle: "Director", employer: "Different Employer", dates: "2010 to 2015" } });
    input.experiences[0].historicalTitle = "Director";
    input.experiences[0].headerCandidateFactIds.push(extraId);
    expect(() => validateMaterialClaims(input, facts, [])).toThrow("document_employment_record_binding_required");
  });
  it("does not combine a degree with another education record's institution", () => {
    const { input, facts } = truthfulFixture();
    facts.push({ id: "degree-one", typed_value: { degree: "BA", detail: "University A" } },
      { id: "degree-two", typed_value: { degree: "Short course", detail: "University B" } });
    input.educationAndCertifications = [{ degree: "BA", detail: "University B", candidateFactIds: ["degree-one", "degree-two"] }];
    expect(() => validateMaterialClaims(input, facts, [])).toThrow("document_education_record_binding_required");
  });
  it("does not turn a verified unfinished degree record into an earned qualification", () => {
    const { input, facts } = truthfulFixture();
    facts.push({ id: "unfinished-degree", typed_value: { degree: "BA", detail: "University A", earned: false } });
    input.educationAndCertifications = [{ degree: "BA", detail: "University A", candidateFactIds: ["unfinished-degree"] }];
    expect(() => validateMaterialClaims(input, facts, [])).toThrow("document_education_record_binding_required");
  });
  it("does not move a truthful achievement from a different employer into this experience", () => {
    const { input, facts } = truthfulFixture();
    const text = "Launched a lending operations department.";
    facts.push({ id: "other-employment-achievement", typed_value: { statement: text, employmentFactId: "other-employment" } });
    input.experiences[0].bullets = [{ text, candidateFactIds: ["other-employment-achievement"] }];
    expect(() => validateMaterialClaims(input, facts, [])).toThrow("document_claim_employment_attribution_required");
  });
  it("accepts a separate verified achievement explicitly bound to the same employment record", () => {
    const { input, facts } = truthfulFixture();
    const text = "Coordinated document handoffs.";
    facts.push({ id: "attributed-achievement", typed_value: { statement: text, employmentFactId: input.experiences[0].headerCandidateFactIds[0] } });
    input.experiences[0].bullets = [{ text, candidateFactIds: ["attributed-achievement"] }];
    expect(() => validateMaterialClaims(input, facts, [])).not.toThrow();
  });
  it("never treats first-person wording from a job page as candidate experience", () => {
    const { input, facts } = truthfulFixture();
    const id = input.job.jobEvidenceIds[0];
    input.coverLetterParagraphs = [{ text: "I am a licensed nurse.", jobEvidenceIds: [id] }];
    expect(() => validateMaterialClaims(input, facts, [{ id, source_excerpt: "I am a licensed nurse." }]))
      .toThrow("document_claim_not_supported_by_job_evidence");
  });
  it("does not assemble a career-break interval from unrelated records", () => {
    const { input, facts } = truthfulFixture();
    facts.push({ id: "break-one", typed_value: { start: "2018", end: "2019" } },
      { id: "break-two", typed_value: { start: "2023", end: "2024" } });
    input.careerBreak = { choice: "CAREER_BREAK", start: "2018", end: "2024", mentionInCoverLetter: false, candidateFactIds: ["break-one", "break-two"] };
    expect(() => validateMaterialClaims(input, facts, [])).toThrow("document_career_break_record_binding_required");
  });
});

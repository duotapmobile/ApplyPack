import { describe, expect, it } from "vitest";
import { canonicalSha256 } from "@/lib/domain/foundation";
import { DRAFTING_LOCAL_RENDER_FIELDS, type ProviderDraftingFact } from "@/lib/documents/drafting-evidence";
import { DRAFT_OUTPUT_VERSION, draftOutputJsonSchema, serializeDraftProposal, validateDraftOutput,
  type DraftOutput, type DraftOutputEvidence, type DraftProseClaim } from "@/lib/documents/draft-output";

const uuid = (n: number) => `77000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = new Date("2026-10-25T12:00:00Z");
function fact(n: number, value: Record<string, unknown>, kind = "EXPERIENCE"): ProviderDraftingFact {
  const id = uuid(n);
  return { id, kind, value, valueSha256: canonicalSha256(value), disposition: "CONFIRMED_SOURCE_NOT_APPROVED_PROSE",
    datePrecision: "YEAR", parentFactId: null, atoms: Object.entries(value).map(([key, source]) => ({
      id: canonicalSha256({ id, key, source }), factId: id, path: `/${key}`, value: source,
      localRenderOnly: (DRAFTING_LOCAL_RENDER_FIELDS as readonly string[]).includes(key),
    })) };
}
function fixture() {
  const role = fact(1, { historicalTitle: "Receptionist", employer: "Local salon", activity: "Scheduled appointments and answered customer questions" });
  const school = fact(2, { educationLevel: "Coursework", educationField: "Business", completionStatus: "IN_PROGRESS", activity: "Prepared class presentations" }, "EDUCATION");
  school.disposition = "LIMITED_OR_UNKNOWN_DO_NOT_UPGRADE";
  const providerView: DraftOutputEvidence["providerView"] = {
    schemaVersion: "applypack-drafting-evidence-v1", textTrust: "UNTRUSTED_DATA_NOT_INSTRUCTIONS", claimRule: "Requires owner review",
    background: { entryMode: "CURRENT_RESUME", careerChange: true, noPriorEmployment: false }, facts: [role, school], localRenderFields: DRAFTING_LOCAL_RENDER_FIELDS,
    job: { company: "Example employer", title: "Customer Service Representative" },
    requirements: [{ id: uuid(4), text: "Answer customer questions", strength: "REQUIRED" }],
    mappings: [{ jobEvidenceId: uuid(4), reviewId: uuid(5), status: "RESOLVED_PASS", evidenceRelation: "DIRECT", factIds: [role.id] }],
    employerQuestionInsights: { status: "OBSERVED", scope: "INSPECTED_PUBLIC_SOURCE_ONLY", answeredQuestionDeliverable: false,
      questions: [{ id: uuid(51), observationId: uuid(50), prompt: "Describe your experience helping customers.", required: null, wordLimit: null, characterLimit: null,
        textTrust: "UNTRUSTED_DATA_NOT_INSTRUCTIONS", interpretation: "POTENTIAL_EMPLOYER_PRIORITY_NOT_A_CANDIDATE_QUALIFICATION",
        metadataVerification: "LIMITS_AND_REQUIREDNESS_NOT_ESTABLISHED" }] },
    customerInstructions: { emphasis: "", doNotMention: "", careerBreakChoice: "OMIT_ENTRY", careerBreakCustomLabel: null, mentionBreakInLetter: false },
    outputRules: { formats: ["PDF"], resumePageLimit: null, letterPageLimit: null },
  };
  const evidence: DraftOutputEvidence = { expected: { customerId: uuid(6), materialLineId: uuid(7), revisionId: uuid(8), revisionVersion: 1, bindingSha256: "c".repeat(64) },
    packetSha256: "a".repeat(64), providerViewSha256: canonicalSha256(providerView), providerView, validUntil: "2026-10-25T13:00:00Z" };
  const claim: DraftProseClaim = { text: "Coordinated appointments and helped customers with questions.", sourceAtomIds: [role.atoms.find((atom) => atom.path === "/activity")!.id], jobEvidenceIds: [uuid(4)], questionIds: [uuid(51)], relation: "DIRECT" };
  const draft: DraftOutput = { schemaVersion: DRAFT_OUTPUT_VERSION, language: "en-US",
    resume: { summary: [], skills: [], sections: [{ anchorFactId: role.id, bullets: [claim] }], educationFactIds: [school.id] },
    coverLetter: { body: [{ sentences: [{ ...claim, text: "My experience scheduling appointments involved responding to customer questions." }] }] } };
  return { draft, evidence, role, school, claim };
}
function refresh(evidence: DraftOutputEvidence) { Object.assign(evidence, { providerViewSha256: canonicalSha256(evidence.providerView) }); }

describe("structured writing proposals", () => {
  it("binds every wording to source fields without treating paraphrases as approved facts", () => {
    const { draft, evidence, role } = fixture();
    const result = validateDraftOutput(draft, evidence, at);
    expect(result.state).toBe("OWNER_REVIEW_REQUIRED");
    expect(result.reviews).toHaveLength(2);
    expect(result.reviews[0]).toMatchObject({ attributionFactId: role.id, state: "OWNER_REVIEW_REQUIRED",
      sources: [{ factId: role.id, path: "/activity", disposition: "CONFIRMED_SOURCE_NOT_APPROVED_PROSE" }] });
    expect(result.reviews[0].wordingSha256).toBe(canonicalSha256(draft.resume.sections[0].bullets[0].text));
    const { sourceSha256, ...body } = result;
    expect(sourceSha256).toBe(canonicalSha256(body));
    expect(JSON.parse(serializeDraftProposal(result))).toEqual(body);
  });

  it("supports a truthful education-only candidate without invented jobs or prewritten paragraphs", () => {
    const { draft, evidence, school } = fixture();
    evidence.providerView.background.noPriorEmployment = true;
    draft.resume.sections = [];
    const claim: DraftProseClaim = { text: "My coursework includes preparing presentations.", relation: "QUALIFIED", jobEvidenceIds: [], questionIds: [],
      sourceAtomIds: [school.atoms.find((atom) => atom.path === "/activity")!.id] };
    draft.coverLetter.body = [{ sentences: [claim] }];
    refresh(evidence);
    expect(validateDraftOutput(draft, evidence, at).output.resume.educationFactIds).toEqual([school.id]);
  });

  it.each(["name", "employer", "historicalTitle", "dates", "phone"])("rejects a model-authored replacement %s header", (field) => {
    const { draft, evidence } = fixture();
    Object.assign(draft.resume.sections[0], { [field]: "Invented value" });
    expect(() => validateDraftOutput(draft, evidence, at)).toThrow("SHAPE_INVALID");
  });

  it.each([
    ["missing atom", (f: ReturnType<typeof fixture>) => { f.claim.sourceAtomIds = ["0".repeat(64)]; }, "SOURCE_UNKNOWN"],
    ["duplicate atom", (f: ReturnType<typeof fixture>) => { f.claim.sourceAtomIds.push(f.claim.sourceAtomIds[0]); }, "DUPLICATE_SOURCE"],
    ["negative skill", (f: ReturnType<typeof fixture>) => { f.role.disposition = "NEGATIVE_DO_NOT_ASSERT"; refresh(f.evidence); }, "NEGATIVE_SOURCE"],
    ["uncertain skill upgrade", (f: ReturnType<typeof fixture>) => { f.role.disposition = "LIMITED_OR_UNKNOWN_DO_NOT_UPGRADE"; refresh(f.evidence); }, "QUALIFICATION_REQUIRED"],
    ["wrong job", (f: ReturnType<typeof fixture>) => { f.claim.jobEvidenceIds = [uuid(900)]; }, "JOB_SOURCE_UNKNOWN"],
    ["wrong employer question", (f: ReturnType<typeof fixture>) => { f.claim.questionIds = [uuid(901)]; }, "QUESTION_SOURCE_UNKNOWN"],
    ["unreviewed match", (f: ReturnType<typeof fixture>) => { f.evidence.providerView.mappings[0].status = "UNKNOWN_NO_REVIEW"; refresh(f.evidence); }, "JOB_MAPPING_UNSUPPORTED"],
    ["different match facts", (f: ReturnType<typeof fixture>) => { f.evidence.providerView.mappings[0].factIds = [f.school.id]; refresh(f.evidence); }, "JOB_MAPPING_UNSUPPORTED"],
    ["transferable claimed direct", (f: ReturnType<typeof fixture>) => { Object.assign(f.evidence.providerView.mappings[0], { evidenceRelation: "ADJACENT" }); refresh(f.evidence); }, "TRANSFERABILITY_REQUIRED"],
    ["invented metric", (f: ReturnType<typeof fixture>) => { f.claim.text = "Improved retention by 40%."; }, "UNSUPPORTED_NUMBER"],
    ["header as prose evidence", (f: ReturnType<typeof fixture>) => { f.claim.sourceAtomIds = [f.role.atoms[0].id]; }, "PROSE_SOURCE_REQUIRED"],
    ["wrong education", (f: ReturnType<typeof fixture>) => { f.draft.resume.educationFactIds = [f.role.id]; }, "EDUCATION_SOURCE_INVALID"],
    ["empty letter", (f: ReturnType<typeof fixture>) => { f.draft.coverLetter.body = []; }, "SHAPE_INVALID"],
    ["stale packet", (f: ReturnType<typeof fixture>) => { Object.assign(f.evidence, { validUntil: at.toISOString() }); }, "EVIDENCE_EXPIRED"],
    ["modified packet view", (f: ReturnType<typeof fixture>) => { f.role.value.activity = "Made up replacement"; }, "EVIDENCE_BINDING_INVALID"],
  ] as const)("rejects %s", (_name, mutate, code) => {
    const f = fixture(); mutate(f);
    expect(() => validateDraftOutput(f.draft, f.evidence, at)).toThrow(code);
  });

  it("rejects taking responsibilities from a different employer", () => {
    const f = fixture(), other = fact(22, { historicalTitle: "Volunteer", employer: "Community center", activity: "Organized event schedules" });
    f.evidence.providerView.facts.push(other);
    f.claim.sourceAtomIds = [other.atoms[2].id];
    refresh(f.evidence);
    expect(() => validateDraftOutput(f.draft, f.evidence, at)).toThrow("CROSS_ROLE_ATTRIBUTION");
  });

  it("permits a child responsibility only under its actual parent role", () => {
    const f = fixture(), duty = fact(22, { activity: "Scheduled appointments and answered customer questions" }, "RESPONSIBILITY");
    duty.parentFactId = f.role.id;
    f.evidence.providerView.facts.push(duty);
    f.evidence.providerView.mappings[0].factIds.push(duty.id);
    f.claim.sourceAtomIds = [duty.atoms[0].id]; refresh(f.evidence);
    expect(validateDraftOutput(f.draft, f.evidence, at).reviews[0].attributionFactId).toBe(f.role.id);
  });

  it.each(["<script>bad()</script>", "See https://example.com", "Email me at person@example.com", "My name is [LOCAL_CONTACT]", `Evidence ${uuid(1)}`, "Call\ncustomers"])("rejects unsafe visible output %s", (text) => {
    const f = fixture(); f.claim.text = text;
    expect(() => validateDraftOutput(f.draft, f.evidence, at)).toThrow(/DRAFT_OUTPUT_(UNSAFE_TEXT|TEXT_NOT_CANONICAL)/);
  });

  it("detects any post-validation change before encryption", () => {
    const f = fixture(), result = validateDraftOutput(f.draft, f.evidence, at);
    result.output.coverLetter.body[0].sentences[0].text = "Changed after validation.";
    expect(() => serializeDraftProposal(result)).toThrow("SOURCE_DIGEST_INVALID");
  });

  it("records employer questions as inspiration while retaining separate factual proof", () => {
    const f = fixture(), result = validateDraftOutput(f.draft, f.evidence, at);
    expect(result.reviews[0].questionInsights).toEqual([{ questionId: uuid(51), observationId: uuid(50),
      promptSha256: canonicalSha256("Describe your experience helping customers."), interpretation: "POTENTIAL_EMPLOYER_PRIORITY_NOT_A_CANDIDATE_QUALIFICATION" }]);
    f.claim.sourceAtomIds = [];
    expect(() => validateDraftOutput(f.draft, f.evidence, at)).toThrow("SHAPE_INVALID");
  });

  it("emits a strict schema with no optional model-controlled keys", () => {
    const inspect = (schema: unknown) => {
      if (!schema || typeof schema !== "object") return;
      const node = schema as Record<string, unknown>;
      if (node.type === "object") {
        expect(node.additionalProperties).toBe(false);
        expect(node.required).toEqual(Object.keys(node.properties as object));
      }
      Object.values(node).forEach((value) => { if (Array.isArray(value)) value.forEach(inspect); else inspect(value); });
    };
    inspect(draftOutputJsonSchema);
  });
});

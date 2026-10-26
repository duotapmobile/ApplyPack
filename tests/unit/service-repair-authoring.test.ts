import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { buildDraftOwnerEditModel, buildRecordedDraftOwnerEditModel } from "@/lib/documents/draft-owner-edit";
import { validateDraftOutput, validateRecordedDraftOutput } from "@/lib/documents/draft-output";
import { buildServiceRepairAuthoredSource } from "@/lib/documents/service-repair-authoring";
import { serializeDraftRenderSource } from "@/lib/documents/draft-render-source";
import { serializeDraftingEvidencePacket } from "@/lib/documents/drafting-evidence";
import { draftReferenceFixture } from "../fixtures/draft-reference";
import { draftDocumentFixture, draftFixtureNow } from "../fixtures/draft-document";
const id = (n: number) => `9a000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = new Date(draftFixtureNow.getTime() + 40 * 86400000);
function fixture(base = draftReferenceFixture(3)) {
  const source = base.build(), packet = base.input.packet;
  const output = structuredClone(buildRecordedDraftOwnerEditModel(source, packet).output);
  output.coverLetter.body[0].sentences[0].text = "I organized schedules for community events.";
  const request = { requestId: id(1), repairVersionId: id(2), originalFileVersionId: id(3), originalDraftVersionId: id(4),
    expectedSourceSha256: source.renderSourceSha256, artifactType: "COVER_LETTER" as "COVER_LETTER" | "RESUME", output };
  const input = { request, source, packet, reviewerId: id(5) };
  return { source, packet, request, input, build: () => buildServiceRepairAuthoredSource(input, now) };
}
describe("scoped historical repair authoring", () => {
  it("preserves the complete original resume, contact, references and evidence timestamps while correcting selected prose", () => {
    const f = fixture(), priorSource = serializeDraftRenderSource(f.source), priorPacket = serializeDraftingEvidencePacket(f.packet), result = f.build();
    expect(result.resume).toEqual(f.source.resume); expect(result.referenceSheet).toEqual(f.source.referenceSheet);
    expect(result.coverLetter.header).toEqual(f.source.coverLetter.header); expect(result.coverLetter.signature).toEqual(f.source.coverLetter.signature);
    expect(result.coverLetter.date).toBe(f.source.coverLetter.date); expect(result.validUntil).toBe(f.source.validUntil);
    expect(result.finalVersionAt).toBe(now.toISOString()); expect(result.ownerEdit).toMatchObject({ priorVersionId: id(4), priorSourceSha256: f.source.renderSourceSha256,
      reviewerId: id(5), changedPlacements: ["coverLetter.body.0.sentences.0"] });
    expect(result.coverLetter.body[0][0].origin).toBe("OWNER_EDIT"); expect(result.deliveryAuthorized).toBe(false);
    expect(result.ownerReviewClaims.filter(c => !c.placement.startsWith("coverLetter."))).toEqual(f.source.ownerReviewClaims.filter(c => !c.placement.startsWith("coverLetter.")));
    expect(serializeDraftRenderSource(f.source)).toBe(priorSource); expect(serializeDraftingEvidencePacket(f.packet)).toBe(priorPacket);
  });
  it("allows selected resume additions/removals without changing the original letter or local headers", () => {
    const f = fixture(); f.request.artifactType = "RESUME";
    f.request.output = buildRecordedDraftOwnerEditModel(f.source, f.packet).output;
    const claim = f.request.output.coverLetter.body[0].sentences[0];
    f.request.output.resume.summary.push({ ...claim, text: "Experienced in organizing community event schedules." });
    const result = f.build(); expect(result.coverLetter).toEqual(f.source.coverLetter); expect(result.referenceSheet).toEqual(f.source.referenceSheet);
    expect(result.resume.header).toEqual(f.source.resume.header); expect(result.resume.sections).toEqual(f.source.resume.sections);
    expect(result.resume.summary.at(-1)?.origin).toBe("OWNER_EDIT"); expect(result.ownerEdit?.changedPlacements).toContain("resume.summary.0");
  });
  it("keeps ordinary drafting freshness gates closed for the same historical packet", () => {
    const f = fixture(); expect(() => buildDraftOwnerEditModel(f.source, f.packet, now)).toThrow("EVIDENCE_EXPIRED");
    expect(() => validateDraftOutput(f.request.output, f.packet, now)).toThrow("EVIDENCE_EXPIRED");
    expect(validateRecordedDraftOutput(f.request.output, f.packet, now).state).toBe("OWNER_REVIEW_REQUIRED");
  });
  it.each([
    ["unselected resume", (f: ReturnType<typeof fixture>) => { f.request.output.resume.skills.push(f.request.output.coverLetter.body[0].sentences[0]); }],
    ["invented number", (f: ReturnType<typeof fixture>) => { f.request.output.coverLetter.body[0].sentences[0].text = "I managed 999 employees."; }],
    ["unbound fact", (f: ReturnType<typeof fixture>) => { f.request.output.coverLetter.body[0].sentences[0].sourceAtomIds = ["f".repeat(64)]; }],
    ["invented qualification", (f: ReturnType<typeof fixture>) => { f.request.output.coverLetter.body[0].sentences[0].jobEvidenceIds = [f.packet.providerView.requirements[0].id]; }],
    ["invented question", (f: ReturnType<typeof fixture>) => { f.request.output.coverLetter.body[0].sentences[0].questionIds = [id(99)]; }],
    ["private contact in prose", (f: ReturnType<typeof fixture>) => { f.request.output.coverLetter.body[0].sentences[0].text = "Contact example@example.invalid."; }],
    ["wrong source", (f: ReturnType<typeof fixture>) => { f.request.expectedSourceSha256 = "f".repeat(64); }],
    ["changed role", (f: ReturnType<typeof fixture>) => { f.request.artifactType = "RESUME"; f.request.output = buildRecordedDraftOwnerEditModel(f.source, f.packet).output; f.request.output.resume.sections[0].anchorFactId = id(99); }],
  ] as const)("rejects %s", (_, change) => { const f = fixture(); change(f); expect(f.build).toThrow(); });
  it("keeps incomplete education qualified and preserves no-prior-job labels", () => {
    const base = draftDocumentFixture("EDUCATION_CERTIFICATION", "IN_PROGRESS");
    const source = base.build(), packet = base.input.packet, output = buildRecordedDraftOwnerEditModel(source, packet).output;
    output.coverLetter.body[0].sentences[0].text = "I am studying community event scheduling.";
    const input = { source, packet, reviewerId: id(5), request: { requestId: id(1), repairVersionId: id(2), originalFileVersionId: id(3), originalDraftVersionId: id(4),
      expectedSourceSha256: source.renderSourceSha256, artifactType: "COVER_LETTER", output } };
    const result = buildServiceRepairAuthoredSource(input, now); expect(result.resume.education).toEqual(source.resume.education);
    output.coverLetter.body[0].sentences[0].relation = "DIRECT"; expect(() => buildServiceRepairAuthoredSource(input, now)).toThrow();
  });
  it("does not accept no-op, extra authority fields, unknown clocks or tampered original bytes", () => {
    const f = fixture(); f.request.output = buildRecordedDraftOwnerEditModel(f.source, f.packet).output; expect(f.build).toThrow("NO_CHANGES");
    expect(() => buildServiceRepairAuthoredSource({ ...f.input, request: { ...f.request, approved: true } }, now)).toThrow();
    expect(() => buildServiceRepairAuthoredSource(f.input, new Date(NaN))).toThrow("CLOCK_INVALID");
    const changed = structuredClone(f.source); changed.coverLetter.body[0][0].text = "Tampered";
    expect(() => buildServiceRepairAuthoredSource({ ...f.input, source: changed }, now)).toThrow();
  });
});

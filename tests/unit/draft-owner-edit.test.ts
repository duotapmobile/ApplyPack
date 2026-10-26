import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { buildDraftOwnerEditModel, buildOwnerEditedDraftSource, draftOwnerEditRequestSchema } from "@/lib/documents/draft-owner-edit";
import { serializeDraftRenderSource } from "@/lib/documents/draft-render-source";
import { readStoredDraftRenderSource } from "@/lib/documents/draft-render-source-storage";
import { draftDocumentFixture, draftFixtureNow } from "../fixtures/draft-document";
import { draftReferenceFixture } from "../fixtures/draft-reference";
vi.mock("server-only", () => ({}));
const id = (n: number) => `79000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture(base = draftDocumentFixture()) {
  const source = base.build(), packet = base.input.packet, model = buildDraftOwnerEditModel(source, packet, draftFixtureNow);
  const request = { jobId: id(1), expectedVersionId: id(2), expectedSourceSha256: source.renderSourceSha256, requestId: id(3), output: structuredClone(model.output) };
  request.output.coverLetter.body[0].sentences[0].text = "I organized schedules for community events.";
  const input = { source, packet, request, reviewerId: id(4), contact: base.input.contact, ...("references" in base ? { references: (base as ReturnType<typeof draftReferenceFixture>).references } : {}) };
  return { base, source, packet, model, request, input, build: () => buildOwnerEditedDraftSource(input, draftFixtureNow) };
}
describe("owner prose editing", () => {
  it("appends explicit owner provenance while preserving original proposal, immutable fields, and unchanged claims", () => {
    const f = fixture(), before = serializeDraftRenderSource(f.source), result = f.build();
    expect(result.ownerEdit).toMatchObject({ priorVersionId: id(2), priorSourceSha256: f.source.renderSourceSha256, reviewerId: id(4), requestId: id(3),
      originalProposalSourceSha256: f.source.proposalSourceSha256, changedPlacements: ["coverLetter.body.0.sentences.0"] });
    expect(result.proposalSourceSha256).toBe(f.source.proposalSourceSha256);
    expect(result.coverLetter.body[0][0]).toMatchObject({ origin: "OWNER_EDIT", state: "OWNER_REVIEW_REQUIRED", text: f.request.output.coverLetter.body[0].sentences[0].text });
    expect(result.resume.sections).toEqual(f.source.resume.sections);
    expect(result.coverLetter.header).toEqual(f.source.coverLetter.header);
    expect(result.coverLetter.body[0][0].claimId).not.toBe(f.source.coverLetter.body[0][0].claimId);
    expect(result.deliveryAuthorized).toBe(false); expect(serializeDraftRenderSource(f.source)).toBe(before);
    const body = serializeDraftRenderSource(result);
    expect(createHash("sha256").update(body).digest("hex")).toBe(result.renderSourceSha256);
    expect(readStoredDraftRenderSource({ body, value: JSON.parse(body) }, result.renderSourceSha256, f.packet, () => draftFixtureNow)).toEqual(result);
  });
  it("allows adding and removing bounded summary and skills with actual confirmed sources", () => {
    const f = fixture(), claim = f.request.output.coverLetter.body[0].sentences[0];
    f.request.output.resume.summary.push({ ...claim, text: "Experienced in organizing community event schedules." });
    f.request.output.resume.skills.push({ ...claim, text: "Community event scheduling" });
    const source = f.build(); expect(source.resume.skills[0].origin).toBe("OWNER_EDIT");
    const request = { ...f.request, expectedVersionId: id(5), expectedSourceSha256: source.renderSourceSha256, requestId: id(6), output: buildDraftOwnerEditModel(source, f.packet, draftFixtureNow).output };
    request.output.resume.skills = [];
    const next = buildOwnerEditedDraftSource({ ...f.input, source, request }, draftFixtureNow);
    expect(next.ownerEdit?.priorSourceSha256).toBe(source.renderSourceSha256); expect(next.ownerEdit?.changedPlacements).toContain("resume.skills.0");
    expect(next.proposalSourceSha256).toBe(f.source.proposalSourceSha256); expect(next.resume.summary[0].origin).toBe("OWNER_EDIT");
  });
  it.each(["VOLUNTEER", "PROJECT", "EDUCATION_CERTIFICATION", "CAREGIVING"] as const)("supports %s without inventing paid employment", (kind) => {
    const f = fixture(draftDocumentFixture(kind)), result = f.build();
    expect(result.resume.education).toEqual(f.source.resume.education); expect(result.resume.sections.map((section) => section.header)).toEqual(f.source.resume.sections.map((section) => section.header));
  });
  it.each(["YEAR", "MONTH", "UNKNOWN"] as const)("preserves %s date precision", (precision) => {
    const f = fixture(draftDocumentFixture("VOLUNTEER", "Completed", false, precision));
    expect(f.build().resume.sections[0].header).toEqual(f.source.resume.sections[0].header);
  });
  it("keeps references exact, local, and uneditable", () => {
    const base = draftReferenceFixture(3), f = fixture(base), source = f.build();
    expect(source.referenceSheet).toEqual(f.source.referenceSheet);
    expect(f.model.sources.some((item) => item.value.includes("Morgan Reference"))).toBe(false);
    expect(draftOwnerEditRequestSchema.safeParse({ ...f.request, referenceSheet: {} }).success).toBe(false);
  });
  it.each([
    ["forged atom", (f: ReturnType<typeof fixture>) => { f.request.output.coverLetter.body[0].sentences[0].sourceAtomIds = ["f".repeat(64)]; }],
    ["unsupported number", (f: ReturnType<typeof fixture>) => { f.request.output.coverLetter.body[0].sentences[0].text = "Managed 999 schedules."; }],
    ["forged role", (f: ReturnType<typeof fixture>) => { f.request.output.resume.sections[0].anchorFactId = id(99); }],
    ["added education", (f: ReturnType<typeof fixture>) => { f.request.output.resume.educationFactIds.push(id(99)); }],
    ["contact in prose", (f: ReturnType<typeof fixture>) => { f.request.output.coverLetter.body[0].sentences[0].text = "Contact person@example.test for details."; }],
    ["unbound employer qualification", (f: ReturnType<typeof fixture>) => { f.request.output.coverLetter.body[0].sentences[0].jobEvidenceIds = [f.packet.providerView.requirements[0].id]; }],
    ["unknown question", (f: ReturnType<typeof fixture>) => { f.request.output.coverLetter.body[0].sentences[0].questionIds = [id(99)]; }],
    ["stale source", (f: ReturnType<typeof fixture>) => { f.request.expectedSourceSha256 = "f".repeat(64); }],
  ] as const)("rejects %s", (_, change) => { const f = fixture(); change(f); expect(f.build).toThrow(); });
  it("rejects unchanged output rather than minting an unnecessary version", () => { const f = fixture(); f.request.output = f.model.output; expect(f.build).toThrow("NO_CHANGES"); });
  it("keeps unfinished education qualified", () => {
    const f = fixture(draftDocumentFixture("EDUCATION_CERTIFICATION", "IN_PROGRESS"));
    expect(f.build().resume.education[0].header.some((row) => row.text === "In progress")).toBe(true);
    f.request.output.coverLetter.body[0].sentences[0].relation = "DIRECT"; expect(f.build).toThrow("QUALIFICATION_REQUIRED");
  });
  it("rejects expired packet and wrong contact bytes", () => {
    const f = fixture(); expect(() => buildOwnerEditedDraftSource(f.input, new Date(f.packet.validUntil))).toThrow();
    expect(() => buildOwnerEditedDraftSource({ ...f.input, contact: { ...f.input.contact, plaintext: Buffer.from("{}") } }, draftFixtureNow)).toThrow();
  });
});

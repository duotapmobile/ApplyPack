import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { buildRecordedDraftOwnerEditModel } from "@/lib/documents/draft-owner-edit";
import { serviceRepairSaveSourceSchema } from "@/lib/documents/service-repair-authoring-server";
import { buildRepairAuthoringRequest, readRepairAuthoringJson, readRepairAuthoringReceipt, readRepairAuthoringView, repairAuthoringPostBody, type RepairAuthoringChoice } from "@/lib/materials/service-repair-authoring-client";
import { authoringId, repairAuthoringFixture, repairAuthoringReceipt } from "../fixtures/service-repair-authoring";
import { serviceRepairRenderFixture } from "../fixtures/service-repair-render";
const identity = (view = repairAuthoringFixture()) => ({ caseId: view.caseId, materialLineId: view.materialLineId, versionId: view.versionId });
function corrected() { const view = repairAuthoringFixture(), output = structuredClone(view.members[0].model!.output);
  output.coverLetter.body[0].sentences[0].text = "Answered routine customer questions.";
  return { view, choices: [{ repairMode: "SOURCE_CORRECTION", output }] satisfies RepairAuthoringChoice[] }; }
describe("repair authoring browser contract", () => {
  it("accepts the actual recorded owner model and produces the actual server request shape", () => {
    const fixture = serviceRepairRenderFixture("SOURCE_PRESERVING_RERENDER");
    const view = readRepairAuthoringView({ caseId: fixture.identity.caseId, materialLineId: fixture.identity.materialLineId, versionId: fixture.identity.versionId,
      acceptedScopeSha256: fixture.inspection.scope.acceptedScopeSha256, contextSha256: fixture.inspection.contextSha256, sourceSaved: false,
      members: [{ originalFileVersionId: fixture.original.fileVersionId, artifactType: fixture.original.artifactType,
        originalSourceSha256: fixture.original.sourceSha256, title: "Fictional confirmed evidence",
        model: buildRecordedDraftOwnerEditModel(fixture.prior, fixture.packet) }] }, fixture.identity);
    const request = buildRepairAuthoringRequest(view, [{ repairMode: "SOURCE_PRESERVING_RERENDER", output: null }], authoringId(8));
    expect(serviceRepairSaveSourceSchema.parse(request)).toEqual(request);
  });
  it("parses the finite model and preserves unselected resume, role anchors and education", () => {
    const { view, choices } = corrected(), original = structuredClone(view);
    expect(readRepairAuthoringView(view, identity(view))).toEqual(view);
    const request = buildRepairAuthoringRequest(view, choices, authoringId(8));
    expect(request.members[0].repairMode).toBe("SOURCE_CORRECTION");
    if (request.members[0].repairMode === "SOURCE_CORRECTION") expect(request.members[0].output.resume).toEqual(view.members[0].model!.output.resume);
    expect(view).toEqual(original); expect(request).not.toHaveProperty("reviewerId");
  });
  it("sends no output for exact-source rerenders including references", () => {
    const view = repairAuthoringFixture(); view.members.push({ ...view.members[0], originalFileVersionId: authoringId(9), artifactType: "REFERENCE_SHEET", model: null });
    const request = buildRepairAuthoringRequest(readRepairAuthoringView(view, identity()), view.members.map(() => ({ repairMode: "SOURCE_PRESERVING_RERENDER", output: null })), authoringId(8));
    expect(request.members.every(member => !Object.hasOwn(member, "output"))).toBe(true);
    expect(() => buildRepairAuthoringRequest(view, [{ repairMode: "", output: null }], authoringId(8))).toThrow();
  });
  it.each(["caseId", "materialLineId", "versionId"] as const)("rejects a different %s before displaying private evidence", key => {
    const view = repairAuthoringFixture(); expect(() => readRepairAuthoringView({ ...view, [key]: authoringId(99) }, identity())).toThrow();
  });
  it("rejects mixed, duplicate, unsupported and wrongly editable reference models", () => {
    const view = repairAuthoringFixture();
    for (const changed of [{ ...view, members: [...view.members, ...view.members] }, { ...view, approved: true },
      { ...view, members: [{ ...view.members[0], artifactType: "REFERENCE_SHEET" }] }, { ...view, members: [{ ...view.members[0], model: null }] }])
      expect(() => readRepairAuthoringView(changed, identity())).toThrow();
    const duplicate = structuredClone(view); duplicate.members[0].model!.sources.push(duplicate.members[0].model!.sources[0]);
    expect(() => readRepairAuthoringView(duplicate, identity())).toThrow();
  });
  it("rejects unselected edits, immutable anchors and new education", () => {
    for (const change of [(value: ReturnType<typeof corrected>) => { value.choices[0].output.resume.summary[0].text = "Changed resume"; },
      (value: ReturnType<typeof corrected>) => { value.choices[0].output.resume.sections[0].anchorFactId = authoringId(99); },
      (value: ReturnType<typeof corrected>) => { value.choices[0].output.resume.educationFactIds = []; }]) {
      const value = corrected(); change(value); expect(() => buildRepairAuthoringRequest(value.view, value.choices, authoringId(8))).toThrow();
    }
  });
  it.each([[], ["0".repeat(64)], ["1".repeat(64)], ["f".repeat(64)], ["c".repeat(64), "c".repeat(64)]].map(sources => ({ sources })))("rejects missing, foreign, negative, local-only or duplicate fact support $sources", ({ sources }) => {
    const { view, choices } = corrected(); choices[0].output.coverLetter.body[0].sentences[0].sourceAtomIds = sources;
    expect(() => buildRepairAuthoringRequest(view, choices, authoringId(8))).toThrow();
  });
  it("requires qualified wording for recorded limits and rejects role mixing", () => {
    const { view, choices } = corrected(), claim = choices[0].output.coverLetter.body[0].sentences[0]; claim.sourceAtomIds = ["e".repeat(64)];
    expect(() => buildRepairAuthoringRequest(view, choices, authoringId(8))).toThrow(); claim.relation = "QUALIFIED";
    expect(buildRepairAuthoringRequest(view, choices, authoringId(8)).members).toHaveLength(1);
    view.members[0].artifactType = "RESUME"; choices[0].output = structuredClone(view.members[0].model!.output);
    choices[0].output.resume.sections[0].bullets[0].text = "Answered questions."; view.members[0].model!.sources[0].factId = authoringId(77);
    expect(() => buildRepairAuthoringRequest(view, choices, authoringId(8))).toThrow();
  });
  it("rejects unchanged correction and already saved versions", () => {
    const { view, choices } = corrected(); choices[0].output = structuredClone(view.members[0].model!.output);
    expect(() => buildRepairAuthoringRequest(view, choices, authoringId(8))).toThrow();
    view.sourceSaved = true; expect(() => buildRepairAuthoringRequest(view, [{ repairMode: "SOURCE_PRESERVING_RERENDER", output: null }], authoringId(8))).toThrow();
  });
  it("caps complete encoded CHECK bytes at96KiB, reserving its extra byte over SAVE", () => {
    const { view, choices } = corrected(), request = buildRepairAuthoringRequest(view, choices, authoringId(8)), member = request.members[0];
    if (member.repairMode !== "SOURCE_CORRECTION") throw new Error("fixture");
    const entry = { ...member.output.coverLetter.body[0].sentences[0], text: "x" };
    member.output.resume.sections = Array.from({ length: 10 }, (_, index) => ({ anchorFactId: authoringId(100 + index), bullets: Array.from({ length: 10 }, () => structuredClone(entry)) }));
    let remaining = 96 * 1024 - new TextEncoder().encode(JSON.stringify({ action: "CHECK", request })).byteLength;
    for (const claim of member.output.resume.sections.flatMap(section => section.bullets)) {
      const added = Math.min(1199, remaining); claim.text += "x".repeat(added); remaining -= added;
    }
    expect(remaining).toBe(0); expect(serviceRepairSaveSourceSchema.safeParse(request).success).toBe(true);
    expect(new TextEncoder().encode(repairAuthoringPostBody("CHECK", request)).byteLength).toBe(96 * 1024);
    expect(new TextEncoder().encode(repairAuthoringPostBody("SAVE", request)).byteLength).toBe(96 * 1024 - 1);
    member.output.resume.sections.at(-1)!.bullets.at(-1)!.text += "é";
    expect(() => repairAuthoringPostBody("SAVE", request)).toThrow(/too long/);
    expect(() => repairAuthoringPostBody("CHECK", request)).toThrow(/too long/);
  });
  it("binds success and read-only retry receipts to the complete exact request and known source", () => {
    const { view, choices } = corrected(), request = buildRepairAuthoringRequest(view, choices, authoringId(8)), receipt = repairAuthoringReceipt(request);
    expect(readRepairAuthoringReceipt(receipt, request)).toEqual(receipt);
    for (const key of ["caseId", "materialLineId", "versionId", "requestId"] as const)
      expect(() => readRepairAuthoringReceipt({ ...receipt, [key]: authoringId(99) }, request)).toThrow();
    for (const change of [{ acceptedScopeSha256: "0".repeat(64) }, { contextSha256: "0".repeat(64) }, { renderingAuthorized: true }, { deliveryAuthorized: true }, { retryAllowed: true }])
      expect(() => readRepairAuthoringReceipt({ ...receipt, ...change }, request)).toThrow();
    expect(readRepairAuthoringReceipt(repairAuthoringReceipt(request, "NOT_SAVED"), request).retryAllowed).toBe(true);
    expect(() => readRepairAuthoringReceipt(receipt, request, "8".repeat(64))).toThrow();
  });
  it("bounds and strictly decodes response bytes", async () => {
    expect(await readRepairAuthoringJson(new Response('{"ready":true}'))).toEqual({ ready: true });
    await expect(readRepairAuthoringJson(new Response(new Uint8Array([0xff])))).rejects.toThrow();
    await expect(readRepairAuthoringJson(new Response(" ".repeat(6_000_001)))).rejects.toThrow(/too large/);
  });
  it("aborts a stalled response without waiting for a stalled cancel callback", async () => {
    const controller = new AbortController(), response = new Response(new ReadableStream({ cancel: () => new Promise(() => undefined) }));
    const pending = readRepairAuthoringJson(response, controller.signal); controller.abort();
    await expect(pending).rejects.toThrow(/interrupted/);
  });
});

import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { inspectDraftDocx, prepareDraftDocx } from "@/lib/documents/draft-docx";
import { draftPdfExpectation } from "@/lib/documents/draft-pdf-validation";
import { draftDocumentFixture, draftFixtureNow } from "../fixtures/draft-document";
import { draftReferenceFixture } from "../fixtures/draft-reference";
vi.mock("server-only", () => ({}));

describe("reviewed reference DOCX", () => {
  it.each([1, 2, 3] as const)("creates one exact sheet for%s selected records with bound links and permission provenance", async (count) => {
    const fixture = draftReferenceFixture(count), source = fixture.build(), result = await prepareDraftDocx({ source, packet: fixture.input.packet }, draftFixtureNow);
    const sheet = result.referenceSheet!;
    expect(sheet.provenance.artifact).toBe("REFERENCE_SHEET"); expect(sheet.inspection.passed).toBe(true);
    expect(sheet.inspection.sourceExpectation.expectedListItems).toBe(0);
    expect(sheet.filename).toBe("Casey_Example_References_Example_employer.docx");
    expect(sheet.ownerReviewClaims.filter((claim) => claim.origin === "LOCAL_REFERENCE")).toHaveLength(count * 7);
    expect(sheet.provenance.sourceBinding.referencePermissionIds).toEqual(fixture.references.map((input) => input.permissionId));
    expect(sheet.provenance.referenceBindings).toEqual(fixture.referenceBindings);
    expect(result.resume.provenance).not.toHaveProperty("referenceBindings"); expect(result.coverLetter.provenance).not.toHaveProperty("referenceBindings");
    expect(sheet.provenance.claims.filter((claim) => claim.kind === "REFERENCE_PERMISSION").map((claim) => claim.referenceBinding))
      .toEqual(sheet.ownerReviewClaims.filter((claim) => claim.origin === "LOCAL_REFERENCE").map((claim) => claim.referenceBinding));
    expect(sheet.provenance.claims.filter((claim) => claim.kind !== "REFERENCE_PERMISSION").every((claim) => !("referenceBinding" in claim))).toBe(true);
    const expectation = await draftPdfExpectation(sheet.buffer, "REFERENCE_SHEET", source.renderSourceSha256);
    expect(expectation.paragraphs.flatMap((row) => row.links)).toHaveLength(count + 2);
    expect(sheet.inspection.extractedText).not.toContain("Private internal"); expect(sheet.inspection.extractedText).not.toContain("Private capability");
    expect(sheet.expectedPageCount).toBe(1); expect(sheet.deliveryAuthorized).toBe(false);
  });
  it("uses the current employer reference filename instruction", async () => {
    const fixture = draftReferenceFixture(1, false, "Application References"), result = await prepareDraftDocx({ source: fixture.build(), packet: fixture.input.packet }, draftFixtureNow);
    expect(result.referenceSheet!.filename).toBe("Application_References.docx");
    expect(result.referenceSheet!.ownerReviewClaims.filter((claim) => claim.origin === "LOCAL_REFERENCE")).toHaveLength(6);
  });
  it("omits the third result entirely for the existing two-document selection", async () => {
    const fixture = draftDocumentFixture(), result = await prepareDraftDocx({ source: fixture.build(), packet: fixture.input.packet }, draftFixtureNow);
    expect(result).not.toHaveProperty("referenceSheet");
  });
  it.each(["swap-records", "swap-links", "invent-bullet"])("rejects%s in the real DOCX package", async (change) => {
    const fixture = draftReferenceFixture(2), source = fixture.build(), input = { source, packet: fixture.input.packet }, result = await prepareDraftDocx(input, draftFixtureNow);
    const zip = await JSZip.loadAsync(result.referenceSheet!.buffer), original = await zip.file("word/document.xml")!.async("string");
    let xml = original;
    if (change === "swap-records") xml = xml.replace("Morgan Reference 1", "REFERENCE_TEMP").replace("Morgan Reference 2", "Morgan Reference 1").replace("REFERENCE_TEMP", "Morgan Reference 2");
    if (change === "swap-links") {
      const links = [...xml.matchAll(/<w:hyperlink[^>]*r:id="([^"]+)"/gu)]; expect(links.length).toBe(4);
      xml = xml.replace(`r:id="${links[2][1]}"`, 'r:id="REFERENCE_TEMP"').replace(`r:id="${links[3][1]}"`, `r:id="${links[2][1]}"`).replace('r:id="REFERENCE_TEMP"', `r:id="${links[3][1]}"`);
    }
    if (change === "invent-bullet") xml = xml.replace("<w:pPr>", '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>');
    expect(xml).not.toBe(original); zip.file("word/document.xml", xml);
    const report = await inspectDraftDocx(await zip.generateAsync({ type: "nodebuffer" }), input, "REFERENCE_SHEET");
    expect(report.passed).toBe(false);
    if (change === "swap-links") expect(report.checks.exactContactLinks).toBe(false);
    if (change === "swap-records") expect(report.checks.exactParagraphText).toBe(false);
    if (change === "invent-bullet") expect(report.checks.nativeBullets).toBe(false);
  });
});

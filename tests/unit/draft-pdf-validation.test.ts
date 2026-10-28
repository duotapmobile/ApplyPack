import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { prepareDraftDocx } from "@/lib/documents/draft-docx";
import { assertDraftPdfExpectation, draftPdfExpectation, validateDraftPdfEvidence, type DraftPdfExpectation } from "@/lib/documents/draft-pdf-validation";
import { DOCUMENT_GENERATOR_VERSION } from "@/lib/documents/requirements";
import { draftDocumentFixture, draftFixtureNow } from "../fixtures/draft-document";
import { draftReferenceFixture } from "../fixtures/draft-reference";
vi.mock("server-only", () => ({}));
const escape = (value: string) => value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/"/gu, "&quot;");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export function reports(expectation: DraftPdfExpectation) {
  const body = expectation.paragraphs.map((row) => {
    const indent = row.kind === "BULLET" ? "        " : "  ";
    let text = row.text, contents = "";
    for (const link of row.links) {
      const at = text.indexOf(link.text); if (at > 0) contents += `${indent}  "${text.slice(0, at)}"\n`;
      contents += `${indent}  Link (inline)\n${indent}    "${link.text}"\n${indent}    Object 10 0\n`;
      text = text.slice(at + link.text.length);
    }
    if (text) contents += `${indent}  "${text}"\n`;
    const paragraph = `${indent}${row.kind === "H1" ? "H1" : "P"} (block):\n${contents}`;
    return row.kind === "BULLET" ? `  L (block):\n    LI (block)\n      Lbl (block)\n        "•"\n      LBody (block)\n${paragraph}` : paragraph;
  }).join("");
  const links = expectation.paragraphs.flatMap((row) => row.links).map((link) => `<text><a href="${escape(link.target)}">${escape(link.text)}</a></text>`).join("");
  return { structureText: `Document\n${body}`, linkXml: `<?xml version="1.0"?><!DOCTYPE pdf2xml SYSTEM "pdf2xml.dtd"><pdf2xml><page number="1">${links}</page></pdf2xml>`, pdf: Buffer.from("%PDF-fictional-unit-boundary"), pages: 1 as const };
}
async function fixture(education = false) {
  const fixture = draftDocumentFixture(education ? "EDUCATION_CERTIFICATION" : "VOLUNTEER", education ? "IN_PROGRESS" : "Completed");
  const source = fixture.build(), prepared = await prepareDraftDocx({ source, packet: fixture.input.packet }, draftFixtureNow);
  return { prepared, expectation: await draftPdfExpectation(prepared.resume.buffer, "RESUME", source.renderSourceSha256) };
}
describe("new draft PDF source-aware semantic and link validation", () => {
  it("binds each reference paragraph, exact zero-list scope and five contact links", async () => {
    const fixture = draftReferenceFixture(3), source = fixture.build(), prepared = await prepareDraftDocx({ source, packet: fixture.input.packet }, draftFixtureNow);
    const expectation = await draftPdfExpectation(prepared.referenceSheet!.buffer, "REFERENCE_SHEET", source.renderSourceSha256);
    expect(validateDraftPdfEvidence(expectation, reports(expectation))).toMatchObject({ artifact: "REFERENCE_SHEET", listItemCount: 0, linkCount: 5 });
    const changed = structuredClone(expectation), index = changed.paragraphs.findIndex((row) => row.text === "Morgan Reference 1");
    changed.paragraphs[index].text = "Morgan Reference 2";
    expect(() => validateDraftPdfEvidence(expectation, reports(changed))).toThrow();
    const evidence = reports(expectation);
    evidence.linkXml = evidence.linkXml.replace("mailto:reference1@example.test", "TEMP").replace("mailto:reference2@example.test", "mailto:reference1@example.test").replace("TEMP", "mailto:reference2@example.test");
    expect(() => validateDraftPdfEvidence(expectation, evidence)).toThrow();
    changed.paragraphs[index].kind = "BULLET";
    const { expectationSha256: _old, ...body } = changed; void _old; changed.expectationSha256 = hash(JSON.stringify(body));
    expect(() => assertDraftPdfExpectation(changed, prepared.referenceSheet!.buffer, "REFERENCE_SHEET")).toThrow();
  });
  it("derives exact semantic expectations from inspected DOCX and returns only hashes/counts", async () => {
    const { expectation } = await fixture();
    const receipt = validateDraftPdfEvidence(expectation, reports(expectation));
    expect(receipt.listItemCount).toBe(1); expect(receipt.paragraphCount).toBe(expectation.paragraphs.length);
    expect(JSON.stringify(receipt)).not.toContain("Casey"); expect(receipt).not.toHaveProperty("paragraphs");
  });
  it("permits zero lists only when the actual exact source contains zero lists", async () => {
    const { expectation } = await fixture(true), evidence = reports(expectation);
    expect(validateDraftPdfEvidence(expectation, evidence).listItemCount).toBe(0);
    evidence.structureText += '  L (block)\n    LI (block)\n      Lbl (block)\n        "•"\n      LBody (block)\n        P (block)\n          "Invented experience"\n';
    expect(() => validateDraftPdfEvidence(expectation, evidence)).toThrow(/source_validation/);
  });
  it("rejects paragraph swaps even though the same words remain in the PDF", async () => {
    const { expectation } = await fixture(); const changed = structuredClone(expectation);
    [changed.paragraphs[0], changed.paragraphs[1]] = [changed.paragraphs[1], changed.paragraphs[0]];
    expect(() => validateDraftPdfEvidence(expectation, reports(changed))).toThrow(/source_validation/);
  });
  it("rejects moving qualification text across a paragraph boundary", async () => {
    const { expectation } = await fixture(true), changed = structuredClone(expectation);
    const row = changed.paragraphs.findIndex((entry) => entry.text.includes("In progress"));
    expect(row).toBeGreaterThan(0);
    changed.paragraphs[row - 1].text += " | In progress";
    changed.paragraphs[row].text = changed.paragraphs[row].text.replace(/ \| In progress/u, "");
    expect(() => validateDraftPdfEvidence(expectation, reports(changed))).toThrow(/source_validation/);
  });
  it("rejects a correct label whose link opens a different target", async () => {
    const { expectation } = await fixture(), evidence = reports(expectation);
    evidence.linkXml = evidence.linkXml.replace("mailto:casey@example.test", "https://portfolio.example/");
    expect(() => validateDraftPdfEvidence(expectation, evidence)).toThrow(/source_validation/);
  });
  it("rejects email and portfolio link targets swapped while preserving all text and target sets", async () => {
    const fixture = draftDocumentFixture("VOLUNTEER", "Completed", false, "YEAR", "OMIT_ENTRY", "https://portfolio.example.test/casey");
    const source = fixture.build(), prepared = await prepareDraftDocx({ source, packet: fixture.input.packet }, draftFixtureNow);
    const expectation = await draftPdfExpectation(prepared.resume.buffer, "RESUME", source.renderSourceSha256), evidence = reports(expectation);
    expect(expectation.paragraphs.flatMap((row) => row.links)).toHaveLength(2);
    evidence.linkXml = evidence.linkXml.replace('href="mailto:casey@example.test"', 'href="PLACEHOLDER"')
      .replace('href="https://portfolio.example.test/casey"', 'href="mailto:casey@example.test"')
      .replace('href="PLACEHOLDER"', 'href="https://portfolio.example.test/casey"');
    expect(() => validateDraftPdfEvidence(expectation, evidence)).toThrow(/source_validation/);
  });
  it("rejects missing links, external entities, extra unsupported tags and oversized reports", async () => {
    const { expectation } = await fixture(), base = reports(expectation);
    for (const linkXml of [base.linkXml.replace(/<a[^>]*>(.*?)<\/a>/u, "$1"), base.linkXml.replace('<!DOCTYPE pdf2xml SYSTEM "pdf2xml.dtd">', '<!DOCTYPE pdf2xml [<!ENTITY x SYSTEM "https://example.test">]>'), " ".repeat(2_097_153)]) {
      expect(() => validateDraftPdfEvidence(expectation, { ...base, linkXml })).toThrow();
    }
    expect(() => validateDraftPdfEvidence(expectation, { ...base, structureText: `${base.structureText}  Figure (block)\n` })).toThrow();
  });
  it("rejects old/mismatched generator identities, artifact and input bytes before rendering", async () => {
    const { expectation, prepared } = await fixture();
    for (const change of [{ generatorVersion: DOCUMENT_GENERATOR_VERSION }, { artifact: "COVER_LETTER" }, { schemaVersion: "unknown" }]) {
      const bad = { ...expectation, ...change } as DraftPdfExpectation;
      const { expectationSha256: _digest, ...body } = bad; bad.expectationSha256 = hash(JSON.stringify(body));
      void _digest;
      expect(() => assertDraftPdfExpectation(bad, prepared.resume.buffer, "RESUME")).toThrow();
    }
    expect(() => assertDraftPdfExpectation(expectation, Buffer.from("changed-docx"), "RESUME")).toThrow();
  });
});

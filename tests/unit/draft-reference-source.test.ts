import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { draftDocumentFixture, draftFixtureNow } from "../fixtures/draft-document";
import { draftReferenceFixture } from "../fixtures/draft-reference";
import { serializeDraftRenderSource } from "@/lib/documents/draft-render-source";
import { readStoredDraftRenderSource } from "@/lib/documents/draft-render-source-storage";
import { readDraftReferenceSources, validateDraftReferenceSource } from "@/lib/documents/draft-reference-source";
vi.mock("server-only", () => ({}));
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
// Captured before the optional reference extension, against source published in
//42a953703e9650be03a00133bbcceb598e0e7cdf. These are fictional fixtures only.
const baseline = {
  VOLUNTEER: { sourceSha256: "827349538c95b24c355886e53e82b127d412575ecf88509dc52437d4c4626943", claimsJsonSha256: "ddabf67b7ac8ec0699f1b362714017bc5e933d5ad17c9509de054c911c81684d" },
  EDUCATION_CERTIFICATION: { sourceSha256: "269013fd9ba2f1137bc1cfa7e9f2a3d8c05dd563167880d765f8626c3ca219a1", claimsJsonSha256: "2fd238b0c140853a7050289e9c43eec9e101672f036c3761e83d1351c21b789c" },
  PROJECT: { sourceSha256: "7c97e6b915044b4edf0a614213f70a01d1aeeb383535b30c2306b54b14126b05", claimsJsonSha256: "62be435147d3193f6bebff389cd8588db3a0bee724dbbc211c127796f794b114" },
  CAREGIVING: { sourceSha256: "3bd9b7381ad552bdd16717c62c9005a4a9b3cd39d08dd5aa2730e145b5bea8e9", claimsJsonSha256: "44de926600795574242ad68adb900f960bfd270d2a4b39bc9784fa876956478d" },
};
describe("reference-free published source compatibility", () => {
  it.each(["VOLUNTEER", "EDUCATION_CERTIFICATION", "PROJECT", "CAREGIVING"] as const)("keeps exact published %s source and claim bytes", (kind) => {
    const source = draftDocumentFixture(kind).build();
    expect({ sourceSha256: hash(serializeDraftRenderSource(source)), claimsJsonSha256: hash(JSON.stringify(source.ownerReviewClaims)) }).toEqual(baseline[kind]);
  });
});

describe("exact private reference source", () => {
  it.each([1, 2, 3] as const)("preserves all %s selected references and only explicitly approved fields", (count) => {
    const fixture = draftReferenceFixture(count), source = fixture.build(), body = serializeDraftRenderSource(source);
    expect(source.referenceSheet?.records).toHaveLength(count);
    expect(source.referenceSheet?.records.every((row) => row.fields.length === 7)).toBe(true);
    expect(body).not.toContain("Private internal"); expect(body).not.toContain("Private capability");
    expect(JSON.stringify(fixture.input.packet.providerView)).not.toContain("Morgan");
    expect(() => validateDraftReferenceSource(source.referenceSheet, fixture.referenceBindings, fixture.references, draftFixtureNow)).not.toThrow();
    expect(readStoredDraftRenderSource({ body, value: JSON.parse(body) }, source.renderSourceSha256, fixture.input.packet, () => draftFixtureNow)).toEqual(source);
    expect(fixture.references.every((input) => input.plaintext.some((byte) => byte !== 0))).toBe(true);
  });
  it("does not infer context from private notes when approved context is absent", () => {
    const source = draftReferenceFixture(1, false).build();
    expect(source.referenceSheet!.records[0].fields).toHaveLength(6);
    expect(source.ownerReviewClaims.some((claim) => claim.referenceBinding?.field === "approvedContextLine")).toBe(false);
  });
  it("rejects duplicate payload/version aliases and more than three records without truncation", () => {
    const fixture = draftReferenceFixture(3);
    for (const field of ["recordId", "recordVersionId", "payloadId"] as const) {
      const bindings = structuredClone(fixture.referenceBindings); bindings[1][field] = bindings[0][field];
      expect(() => readDraftReferenceSources(bindings, fixture.references, draftFixtureNow)).toThrow("DRAFT_REFERENCE_SOURCE_INVALID");
    }
    expect(() => readDraftReferenceSources([...fixture.referenceBindings, fixture.referenceBindings[0]], [...fixture.references, fixture.references[0]], draftFixtureNow)).toThrow("DRAFT_REFERENCE_SOURCE_INVALID");
    expect(() => validateDraftReferenceSource(undefined, fixture.referenceBindings, fixture.references, draftFixtureNow)).toThrow();
  });
  it.each(["text", "field", "permission", "payload", "record", "missing", "duplicate"])("rejects saved %s substitution against freshly decrypted references", (change) => {
    const fixture = draftReferenceFixture(2), sheet = structuredClone(fixture.build().referenceSheet!);
    if (change === "text") { sheet.records[0].fields[0].text = "Forged reference"; sheet.records[0].fields[0].wordingSha256 = hash("Forged reference"); }
    if (change === "field") sheet.records[0].fields.reverse();
    if (change === "permission") sheet.records[0].fields[0].referencePermissionIds = [fixture.references[1].permissionId];
    if (change === "payload") sheet.records[0].payloadId = fixture.references[1].payloadId;
    if (change === "record") sheet.records[0].recordVersionId = fixture.references[1].recordVersionId;
    if (change === "missing") sheet.records.pop();
    if (change === "duplicate") sheet.records[1] = structuredClone(sheet.records[0]);
    expect(() => validateDraftReferenceSource(sheet, fixture.referenceBindings, fixture.references, draftFixtureNow)).toThrow();
  });
  it.each(["hash", "utf8", "schema", "missing", "identity", "future", "oversized"])("rejects %s payload and preserves caller bytes", (change) => {
    const fixture = draftReferenceFixture(), bindings = structuredClone(fixture.referenceBindings), inputs = fixture.references.map((input) => ({ ...input, plaintext: Buffer.from(input.plaintext) }));
    if (change === "hash") inputs[0].plaintext[5] ^= 1;
    if (change === "utf8") inputs[0].plaintext = Buffer.from([255]);
    if (change === "schema") inputs[0].plaintext = Buffer.from(JSON.stringify({ ...fixture.referencePayloads[0], schemaVersion: "unknown" }));
    if (change === "missing") inputs.pop();
    if (change === "identity") inputs[0].payloadId = fixture.r.contact.id;
    if (change === "future") bindings[0].permissionConfirmedAt = "2026-10-26T10:00:00.000Z";
    if (change === "oversized") inputs[0].plaintext = Buffer.alloc(32769, 65);
    if (["utf8", "schema", "oversized"].includes(change)) bindings[0].contentSha256 = createHash("sha256").update(inputs[0].plaintext).digest("hex");
    const before = inputs.map((input) => Buffer.from(input.plaintext));
    expect(() => readDraftReferenceSources(bindings, inputs, draftFixtureNow)).toThrow();
    inputs.forEach((input, index) => expect(input.plaintext).toEqual(before[index]));
  });
});

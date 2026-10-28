import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { matchesServiceErrorDecision, matchesServiceErrorReport } from "@/lib/materials/service-error-client";
import { serviceErrorReviewPayload, serviceErrorReportPayload, serviceErrorSha256, type ServiceErrorDecision } from "@/lib/materials/service-error-contract";
const id = (n: number) => `96000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const member = { artifactId: id(1), fileVersionId: id(2), releaseId: id(3) };
const report = { requestId: id(4), materialLineId: id(5), items: [{ ...member, field: "Name", documentText: "Wrong e\u0301雪 \"Name\"", expectedFact: "Confirmed e\u0301雪 \"Name\"" }] };
const decision: ServiceErrorDecision = { requestId: id(6), caseId: id(7), expectedDecisionId: null, classification: "CONFIRMED_SERVICE_ERROR", reasonCode: "CONFIRMED_SOURCE_MISMATCH",
  explanation: "The exact confirmed wording differs.\nNo new information.", evidence: [{ ...member, sourceSnapshotId: id(8), sourceFactIds: [id(9)], documentVersionIds: [] }], affected: [member], confirmedValuesReviewed: true, deliveredVersionReviewed: true, parserProvenanceReviewed: true };
beforeEach(() => vi.stubGlobal("crypto", webcrypto)); afterEach(() => vi.unstubAllGlobals());
describe("browser confirmation of exact encrypted service-error requests", () => {
  it("matches actual server canonical hashes including exact Unicode, quotes and newlines", async () => {
    expect(await matchesServiceErrorReport({ requestId: report.requestId, materialLineId: report.materialLineId, members: [member], reportSha256: serviceErrorSha256(serviceErrorReportPayload(report)) }, report)).toBe(true);
    expect(await matchesServiceErrorDecision({ ...decision, previousDecisionId: null, reviewSha256: serviceErrorSha256(serviceErrorReviewPayload(decision)) }, decision)).toBe(true);
  });
  it.each(["requestId", "caseId", "previousDecisionId", "classification", "reasonCode", "reviewSha256"])("rejects an altered %s", async (field) => {
    const receipt = { ...decision, previousDecisionId: null, reviewSha256: serviceErrorSha256(serviceErrorReviewPayload(decision)), [field]: "changed" };
    expect(await matchesServiceErrorDecision(receipt, decision)).toBe(false);
  });
  it("rejects same-ID reports with different private text and reordered or substituted delivered members", async () => {
    const receipt = { requestId: report.requestId, materialLineId: report.materialLineId, members: [member], reportSha256: serviceErrorSha256(serviceErrorReportPayload({ ...report, items: [{ ...report.items[0], expectedFact: "Different confirmed name" }] })) };
    expect(await matchesServiceErrorReport(receipt, report)).toBe(false);
    expect(await matchesServiceErrorReport({ ...receipt, members: [{ ...member, fileVersionId: id(20) }] }, report)).toBe(false);
  });
  it("fails closed on unavailable crypto or malformed receipts", async () => {
    vi.stubGlobal("crypto", {}); expect(await matchesServiceErrorDecision(null, decision)).toBe(false); expect(await matchesServiceErrorReport({}, report)).toBe(false);
  });
});

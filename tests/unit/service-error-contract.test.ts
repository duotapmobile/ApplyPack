import { describe, expect, it } from "vitest";
import { resolveServiceErrorContract, serviceErrorContractSchema, serviceErrorDecisionSchema, serviceErrorReportDeadline,
  serviceErrorReportPayload, serviceErrorReportSchema, serviceErrorSha256, SERVICE_ERROR_PRIVACY_VERSION,
  SERVICE_ERROR_TERMS_VERSION } from "@/lib/materials/service-error-contract";

const id = (value: number) => `96000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const contract = { materialLineId: id(1), customerId: id(2), purchaseId: id(3), sourceSnapshotId: id(4),
  legalReceiptId: id(5), intakeReviewId: id(6), intakeReviewSha256: "a".repeat(64), contractVersion: "service-error-only-v1",
  termsVersion: SERVICE_ERROR_TERMS_VERSION, termsContentSha256: "b".repeat(64), privacyVersion: SERVICE_ERROR_PRIVACY_VERSION,
  privacyContentSha256: "c".repeat(64), confirmedIntakeVersion: "applypack-confirmed-intake-v1", reportingTimeZone: "America/New_York",
  boundAt: "2026-10-25T12:00:00.000Z" };
const scope = { materialLineId: id(1), customerId: id(2), purchaseId: id(3), sourceSnapshotId: id(4),
  acceptedTermsVersion: SERVICE_ERROR_TERMS_VERSION, acceptedPrivacyVersion: SERVICE_ERROR_PRIVACY_VERSION, contract };
const member = { artifactId: id(7), fileVersionId: id(8), releaseId: id(9) };
const report = { requestId: id(10), materialLineId: id(1), items: [{ ...member, field: "Phone", documentText: "555-0102", expectedFact: "555-0101" }] };
const decision = { requestId: id(11), caseId: id(12), expectedDecisionId: null, classification: "CONFIRMED_SERVICE_ERROR", reasonCode: "CONFIRMED_SOURCE_MISMATCH",
  explanation: "The exact confirmed phone differs from the approved delivered phone.", evidence: [{ ...member, sourceSnapshotId: id(4), sourceFactIds: [id(13)], documentVersionIds: [] }],
  affected: [member], confirmedValuesReviewed: true, deliveredVersionReviewed: true, parserProvenanceReviewed: true };

describe("per-purchase prospective service-error contract", () => {
  it("resolves the exact immutable binding without changing a historical contract", () => {
    expect(resolveServiceErrorContract(scope).kind).toBe("SERVICE_ERROR_ONLY");
    expect(resolveServiceErrorContract({ ...scope, acceptedTermsVersion: "manual-launch-terms-2026-10-24-v3", acceptedPrivacyVersion: "privacy-2026-10-24-v3", contract: null }))
      .toEqual({ kind: "HISTORICAL", contract: null });
    expect(resolveServiceErrorContract(scope).contract).not.toBe(contract);
  });
  it.each(["materialLineId", "customerId", "purchaseId", "sourceSnapshotId"] as const)("rejects a binding for another %s", (field) => {
    expect(() => resolveServiceErrorContract({ ...scope, [field]: id(999) })).toThrow("CONTRACT_SCOPE_MISMATCH");
  });
  it("never falls back to historical rights for a missing or mixed v4 receipt", () => {
    expect(() => resolveServiceErrorContract({ ...scope, contract: null })).toThrow("CONTRACT_BINDING_MISSING");
    expect(() => resolveServiceErrorContract({ ...scope, acceptedTermsVersion: "old", contract: null })).toThrow("CONTRACT_BINDING_MISSING");
    expect(() => resolveServiceErrorContract({ ...scope, acceptedPrivacyVersion: "old" })).toThrow("CONTRACT_SCOPE_MISMATCH");
  });
  it("rejects content-free claims of confirmation with no exact digest or review identity", () => {
    expect(serviceErrorContractSchema.safeParse({ ...contract, intakeReviewSha256: "confirmed" }).success).toBe(false);
    expect(serviceErrorContractSchema.safeParse({ ...contract, intakeReviewId: null }).success).toBe(false);
    expect(serviceErrorContractSchema.safeParse({ ...contract, confirmedIntakeVersion: "checkbox-confirmed" }).success).toBe(false);
  });
});

describe("three calendar days in the contractual time zone", () => {
  it.each([
    ["2026-10-25T12:34:56.789Z", "2026-10-28T12:34:56.789Z", 72],
    ["2026-03-06T17:00:00Z", "2026-03-09T16:00:00.000Z", 71],
    ["2026-10-30T16:00:00Z", "2026-11-02T17:00:00.000Z", 73],
  ])("preserves local delivery time for %s", (delivery, deadline, hours) => {
    expect(serviceErrorReportDeadline(delivery)).toBe(deadline);
    expect((Date.parse(deadline) - Date.parse(delivery)) / 3_600_000).toBe(hours);
  });
  it("uses PostgreSQL-compatible standard-time resolution at the clock transition", () => {
    expect(serviceErrorReportDeadline("2026-03-05T07:30:00Z")).toBe("2026-03-08T07:30:00.000Z");
    expect(serviceErrorReportDeadline("2026-10-29T05:30:00Z")).toBe("2026-11-01T06:30:00.000Z");
  });
  it("handles local midnight, year boundaries and equivalent timezone offsets", () => {
    expect(serviceErrorReportDeadline("2026-12-30T05:00:00Z")).toBe("2027-01-02T05:00:00.000Z");
    expect(serviceErrorReportDeadline("2026-03-06T12:00:00-05:00")).toBe("2026-03-09T16:00:00.000Z");
  });
  it.each(["not a date", "2026-02-30T00:00:00Z", "2026-10-25T12:00:00"])("rejects invalid or timezone-free time %s", (value) => {
    expect(() => serviceErrorReportDeadline(value)).toThrow("DELIVERY_TIME_INVALID");
  });
});

describe("one grouped encrypted report and evidence-scoped decisions", () => {
  it("binds the exact private report bytes to one request and exact delivered versions", () => {
    const bytes = serviceErrorReportPayload(report), other = serviceErrorReportPayload({ ...report, items: [{ ...report.items[0], expectedFact: "555-0199" }] });
    expect(JSON.parse(bytes.toString())).toMatchObject({ schemaVersion: "applypack-service-error-report-v1", ...report });
    expect(serviceErrorSha256(bytes)).not.toBe(serviceErrorSha256(other)); bytes.fill(0); other.fill(0);
  });
  it("rejects duplicate, missing, unbounded or invented entitlement fields", () => {
    expect(serviceErrorReportSchema.safeParse({ ...report, items: [report.items[0], report.items[0]] }).success).toBe(false);
    expect(serviceErrorReportSchema.safeParse({ ...report, items: [] }).success).toBe(false);
    expect(serviceErrorReportSchema.safeParse({ ...report, autoRepair: true }).success).toBe(false);
    expect(serviceErrorReportSchema.safeParse({ ...report, items: [{ ...report.items[0], expectedFact: "x".repeat(1501) }] }).success).toBe(false);
  });
  it("requires reviewed evidence for each affected document", () => {
    expect(serviceErrorDecisionSchema.safeParse(decision).success).toBe(true);
    expect(serviceErrorDecisionSchema.safeParse({ ...decision, affected: [{ ...member, fileVersionId: id(99) }] }).success).toBe(false);
    expect(serviceErrorDecisionSchema.safeParse({ ...decision, affected: [] }).success).toBe(false);
    expect(serviceErrorDecisionSchema.safeParse({ ...decision, parserProvenanceReviewed: false }).success).toBe(false);
  });
  it.each([
    ["CUSTOMER_INPUT_CHANGE", "CUSTOMER_CONFIRMED_VALUE"], ["CUSTOMER_INPUT_CHANGE", "NEW_OR_OMITTED_INFORMATION"],
    ["EDITORIAL_REQUEST", "WORDING_OR_SELECTION_PREFERENCE"], ["EVIDENCE_INVESTIGATION", "CONFIRMATION_OR_PARSER_UNCLEAR"],
  ])("does not automatically authorize files for %s/%s", (classification, reasonCode) => {
    expect(serviceErrorDecisionSchema.safeParse({ ...decision, classification, reasonCode }).success).toBe(false);
    expect(serviceErrorDecisionSchema.safeParse({ ...decision, classification, reasonCode, affected: [] }).success).toBe(true);
  });
  it("rejects a reason that contradicts the owner classification", () => {
    expect(serviceErrorDecisionSchema.safeParse({ ...decision, reasonCode: "CUSTOMER_CONFIRMED_VALUE" }).success).toBe(false);
  });
});

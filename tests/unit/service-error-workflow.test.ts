import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { deterministicUuid } from "@/lib/commerce/server";
import { reportMaterialServiceError, recordMaterialServiceErrorDecision, type ServiceErrorWorkflowPort } from "@/lib/materials/service-error-workflow";
import { serviceErrorReportPayload, serviceErrorReviewPayload, serviceErrorSha256, SERVICE_ERROR_PRIVACY_VERSION, SERVICE_ERROR_TERMS_VERSION } from "@/lib/materials/service-error-contract";

const id = (n: number) => `96000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = new Date("2026-10-25T12:00:00Z"), signal = () => new AbortController().signal;
function fixture() {
  const customerId = id(1), materialLineId = id(2), reviewerId = id(3), caseId = id(4);
  const contract = { materialLineId, customerId, purchaseId: id(5), sourceSnapshotId: id(6), legalReceiptId: id(7), intakeReviewId: id(8),
    intakeReviewSha256: "a".repeat(64), contractVersion: "service-error-only-v1", termsVersion: SERVICE_ERROR_TERMS_VERSION,
    termsContentSha256: "b".repeat(64), privacyVersion: SERVICE_ERROR_PRIVACY_VERSION, privacyContentSha256: "c".repeat(64),
    confirmedIntakeVersion: "applypack-confirmed-intake-v1", reportingTimeZone: "America/New_York", boundAt: "2026-10-20T12:00:00Z" };
  const member = { artifactId: id(9), fileVersionId: id(10), releaseId: id(11) };
  const report = { requestId: id(12), materialLineId, items: [{ ...member, field: "Name", documentText: "Wrong name", expectedFact: "Confirmed name" }] };
  const reportBytes = serviceErrorReportPayload(report), reportSha256 = serviceErrorSha256(reportBytes); reportBytes.fill(0);
  const reportReceipt = { caseId, requestId: report.requestId, customerId, materialLineId,
    payloadId: deterministicUuid(`applypack:service-error-report-v1:${customerId}:${report.requestId}`), reportSha256,
    reportDeadline: "2026-10-27T12:00:00Z", reportedAt: now.toISOString(), state: "OPEN", latestDecisionId: null, members: [member] };
  const context = { scope: { materialLineId, customerId, purchaseId: contract.purchaseId, sourceSnapshotId: contract.sourceSnapshotId,
    acceptedTermsVersion: contract.termsVersion, acceptedPrivacyVersion: contract.privacyVersion }, contract,
    reportDeadline: reportReceipt.reportDeadline, files: [{ ...member, deliveredAt: "2026-10-24T12:00:00Z", checksumSha256: "d".repeat(64), artifactType: "RESUME", safeFilename: "Example_Resume.pdf" }] };
  const decision = { requestId: id(13), caseId, expectedDecisionId: null, classification: "CONFIRMED_SERVICE_ERROR" as const,
    reasonCode: "CONFIRMED_SOURCE_MISMATCH" as const, explanation: "The rendered name differs from the exact confirmed contact.",
    evidence: [{ ...member, sourceSnapshotId: contract.sourceSnapshotId, sourceFactIds: [id(14)], documentVersionIds: [] }], affected: [member],
    confirmedValuesReviewed: true as const, deliveredVersionReviewed: true as const, parserProvenanceReviewed: true as const };
  const decisionBytes = serviceErrorReviewPayload(decision), reviewSha256 = serviceErrorSha256(decisionBytes); decisionBytes.fill(0);
  const decisionReceipt = { decisionId: id(15), requestId: decision.requestId, caseId, customerId, materialLineId,
    payloadId: deterministicUuid(`applypack:service-error-review-v1:${reviewerId}:${decision.requestId}`), reviewSha256,
    previousDecisionId: null, reviewerId, classification: decision.classification, reasonCode: decision.reasonCode,
    evidence: decision.evidence, affected: decision.affected, decidedAt: now.toISOString() };
  let savedReport: unknown = null, savedDecision: unknown = null;
  const plaintext: Uint8Array[] = [];
  const port = { reportContext: vi.fn(async () => structuredClone(context)), readReport: vi.fn(async () => savedReport),
    openReport: vi.fn(async () => { savedReport = structuredClone(reportReceipt); return savedReport; }),
    inspect: vi.fn(async () => ({ report: structuredClone(reportReceipt), contract: structuredClone(contract), decisions: [] })),
    readDecision: vi.fn(async () => savedDecision), decide: vi.fn(async () => { savedDecision = structuredClone(decisionReceipt); return savedDecision; }),
    store: vi.fn(async (input, bytes: Uint8Array) => { plaintext.push(bytes); return { payloadId: input.payloadId, sha256: input.sha256 }; }),
  } satisfies ServiceErrorWorkflowPort;
  return { port, customerId, reviewerId, caseId, report, reportReceipt, context, contract, decision, decisionReceipt, plaintext,
    saveReport: (value: unknown = reportReceipt) => { savedReport = value; }, saveDecision: (value: unknown = decisionReceipt) => { savedDecision = value; },
    runReport: (s = signal()) => reportMaterialServiceError(port, customerId, report, { signal: s, now: () => now }),
    runDecision: (s = signal()) => recordMaterialServiceErrorDecision(port, reviewerId, decision, { signal: s }) };
}
afterEach(() => vi.useRealTimers());
describe("protected service-error reporting", () => {
  it("stores encrypted input before one mutation, then verifies durable identity without authorizing delivery", async () => {
    const f = fixture(), result = await f.runReport();
    expect(result.status).toBe("REPORTED"); expect(result.deliveryAuthorized).toBe(false);
    expect(f.port.store.mock.invocationCallOrder[0]).toBeLessThan(f.port.openReport.mock.invocationCallOrder[0]);
    expect(f.port.openReport).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ members: f.reportReceipt.members }), expect.any(AbortSignal));
    expect(f.plaintext[0].every((byte) => byte === 0)).toBe(true);
  });
  it("replays an exact request after the report window without new encryption or mutation", async () => {
    const f = fixture(); f.saveReport(); f.context.reportDeadline = "2020-01-01T00:00:00Z";
    expect((await f.runReport()).replayed).toBe(true); expect(f.port.store).not.toHaveBeenCalled(); expect(f.port.reportContext).not.toHaveBeenCalled();
  });
  it("reconciles a lost commit response once and does not repeat the mutation", async () => {
    const f = fixture(); f.port.openReport.mockImplementation(async () => { f.saveReport(); throw new Error("lost"); });
    expect((await f.runReport()).status).toBe("REPORTED"); expect(f.port.openReport).toHaveBeenCalledOnce(); expect(f.port.readReport).toHaveBeenCalledTimes(2);
  });
  it("keeps an uncertain persisted payload and reports unknown instead of fabricating success", async () => {
    const f = fixture(); f.port.openReport.mockImplementation(async () => { throw new Error("lost"); });
    await expect(f.runReport()).rejects.toThrow("REPORT_RESULT_UNKNOWN"); expect(f.port.openReport).toHaveBeenCalledOnce();
    expect(f.plaintext[0].every((byte) => byte === 0)).toBe(true);
  });
  it.each(["payloadId", "reportSha256", "materialLineId", "customerId"])("rejects a replay with changed %s", async (field) => {
    const f = fixture(); f.saveReport({ ...f.reportReceipt, [field]: field.includes("Sha") ? "e".repeat(64) : id(99) });
    await expect(f.runReport()).rejects.toThrow("REPORT_IDENTITY_CONFLICT"); expect(f.port.store).not.toHaveBeenCalled();
  });
  it.each(["window", "owner", "file", "historical"])("rejects invalid %s before storing private data", async (kind) => {
    const f = fixture();
    if (kind === "window") f.context.reportDeadline = "2026-10-25T11:59:59Z";
    if (kind === "owner") f.context.scope.customerId = id(99);
    if (kind === "file") f.context.files[0].fileVersionId = id(99);
    if (kind === "historical") { Object.assign(f.context, { contract: null }); Object.assign(f.context.scope, { acceptedTermsVersion: "v3", acceptedPrivacyVersion: "v3" }); }
    await expect(f.runReport()).rejects.toThrow(/^SERVICE_ERROR_/); expect(f.port.store).not.toHaveBeenCalled();
  });
  it("does not commit after cancellation during encryption and clears owned bytes", async () => {
    const f = fixture(), controller = new AbortController(); let release!: () => void;
    f.port.store.mockImplementation(async (input, bytes) => { f.plaintext.push(bytes); await new Promise<void>((resolve) => { release = resolve; }); return { payloadId: input.payloadId, sha256: input.sha256 }; });
    const pending = f.runReport(controller.signal); const rejected = expect(pending).rejects.toThrow("ABORTED");
    await vi.waitFor(() => expect(f.port.store).toHaveBeenCalledOnce()); controller.abort(); await rejected; release(); await Promise.resolve();
    expect(f.port.openReport).not.toHaveBeenCalled(); expect(f.plaintext[0].every((byte) => byte === 0)).toBe(true);
  });
});
describe("owner service-error decisions", () => {
  it("records scoped acceptance with explicit evidence but never repairs or delivers", async () => {
    const f = fixture(), result = await f.runDecision();
    expect(result.status).toBe("RECORDED"); expect(result.deliveryAuthorized).toBe(false); expect(f.port.decide).toHaveBeenCalledOnce();
    expect(f.plaintext[0].every((byte) => byte === 0)).toBe(true);
  });
  it("reconciles exact lost response and treats changed payload digest as a conflict", async () => {
    const f = fixture(); f.port.decide.mockImplementation(async () => { f.saveDecision(); throw new Error("lost"); });
    expect((await f.runDecision()).status).toBe("RECORDED"); expect(f.port.decide).toHaveBeenCalledOnce();
    f.saveDecision({ ...f.decisionReceipt, reviewSha256: "0".repeat(64) }); await expect(f.runDecision()).rejects.toThrow("DECISION_IDENTITY_CONFLICT");
  });
  it("rejects stale simultaneous triage and a report resolved elsewhere before encryption", async () => {
    const f = fixture(); Object.assign(f.reportReceipt, { latestDecisionId: id(99) });
    await expect(f.runDecision()).rejects.toThrow("CASE_CHANGED"); expect(f.port.store).not.toHaveBeenCalled();
  });
  it("cannot turn an unrelated historical remedy into prospective authorization", async () => {
    const f = fixture(); Object.assign(f.decision, { classification: "HISTORICAL_REMEDY", reasonCode: "HISTORICAL_CONTRACT" });
    await expect(f.runDecision()).rejects.toThrow("HISTORICAL_FLOW_REQUIRED"); expect(f.port.store).not.toHaveBeenCalled();
  });
});

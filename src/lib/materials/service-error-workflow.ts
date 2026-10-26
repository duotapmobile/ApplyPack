import "server-only";
import { z } from "zod";
import { deterministicUuid } from "@/lib/commerce/server";
import { ServiceErrorContractError, resolveServiceErrorContract, serviceErrorCanonicalJson, serviceErrorContractSchema,
  serviceErrorDecisionSchema, serviceErrorEvidenceSchema, serviceErrorMemberSchema, serviceErrorReportPayload,
  serviceErrorReportSchema, serviceErrorReviewPayload, serviceErrorSha256, SERVICE_ERROR_REPORT_PURPOSE, SERVICE_ERROR_REVIEW_PURPOSE } from "./service-error-contract";
import { boundedServiceErrorIo, type ServiceErrorPayloadInput } from "./service-error-payload";

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.iso.datetime({ offset: true });
export const serviceErrorReportReceiptSchema = z.object({
  caseId: uuid, requestId: uuid, customerId: uuid, materialLineId: uuid, payloadId: uuid, reportSha256: hash,
  reportDeadline: time, reportedAt: time, state: z.enum(["OPEN", "RESOLVED"]), latestDecisionId: uuid.nullable(),
  members: z.array(serviceErrorMemberSchema).min(1).max(3),
}).strict();
export type ServiceErrorReportReceipt = z.infer<typeof serviceErrorReportReceiptSchema>;
export const serviceErrorDecisionReceiptSchema = z.object({
  decisionId: uuid, requestId: uuid, caseId: uuid, customerId: uuid, materialLineId: uuid, payloadId: uuid, reviewSha256: hash,
  previousDecisionId: uuid.nullable(), reviewerId: uuid,
  classification: z.enum(["CONFIRMED_SERVICE_ERROR", "CUSTOMER_INPUT_CHANGE", "EDITORIAL_REQUEST", "HISTORICAL_REMEDY", "EVIDENCE_INVESTIGATION"]),
  reasonCode: z.string().min(1).max(80), evidence: z.array(serviceErrorEvidenceSchema).min(1).max(30),
  affected: z.array(serviceErrorMemberSchema).max(30), decidedAt: time,
}).strict();
const scopeSchema = z.object({ materialLineId: uuid, customerId: uuid, purchaseId: uuid, sourceSnapshotId: uuid,
  acceptedTermsVersion: z.string().min(1), acceptedPrivacyVersion: z.string().min(1) }).strict();
export const serviceErrorReportContextSchema = z.object({ scope: scopeSchema, contract: serviceErrorContractSchema.nullable(),
  existingReport: serviceErrorReportReceiptSchema.nullable().optional(),
  reportDeadline: time, files: z.array(serviceErrorMemberSchema.extend({ deliveredAt: time, checksumSha256: hash,
    artifactType: z.enum(["RESUME", "COVER_LETTER", "REFERENCE_SHEET"]), safeFilename: z.string().min(1).max(255) }).strict()).min(1).max(30) }).strict();
export const serviceErrorInspectionSchema = z.object({ report: serviceErrorReportReceiptSchema, contract: serviceErrorContractSchema,
  decisions: z.array(serviceErrorDecisionReceiptSchema).max(100) }).strict();

/** Exact prospective096 RPC surface. Implementations must use authenticated
 * server identity and abort-aware calls; all returned values are parsed below. */
export type ServiceErrorWorkflowPort = {
  reportContext(customerId: string, materialLineId: string, signal: AbortSignal): Promise<unknown>;
  readReport(customerId: string, requestId: string, signal: AbortSignal): Promise<unknown | null>;
  openReport(input: { customerId: string; requestId: string; materialLineId: string; payloadId: string; reportSha256: string;
    members: z.infer<typeof serviceErrorMemberSchema>[] }, signal: AbortSignal): Promise<unknown>;
  inspect(reviewerId: string, caseId: string, signal: AbortSignal): Promise<unknown>;
  readDecision(reviewerId: string, requestId: string, signal: AbortSignal): Promise<unknown | null>;
  decide(input: { reviewerId: string; caseId: string; requestId: string; previousDecisionId: string | null; payloadId: string; reviewSha256: string;
    classification: z.infer<typeof serviceErrorDecisionReceiptSchema>["classification"]; reasonCode: string;
    evidence: z.infer<typeof serviceErrorEvidenceSchema>[]; affected: z.infer<typeof serviceErrorMemberSchema>[] }, signal: AbortSignal): Promise<unknown>;
  store(input: ServiceErrorPayloadInput, bytes: Uint8Array, signal: AbortSignal): Promise<{ payloadId: string; sha256: string }>;
};
function ensure(value: unknown, code: string): asserts value { if (!value) throw new ServiceErrorContractError(code); }
function parse<T>(schema: z.ZodType<T>, value: unknown, code: string): T {
  const result = schema.safeParse(value); ensure(result.success, code); return result.data;
}
const same = (left: unknown, right: unknown) => serviceErrorCanonicalJson(left) === serviceErrorCanonicalJson(right);

/** Report receipt is not acceptance, repair authorization, revocation or delivery. */
export async function reportMaterialServiceError(port: ServiceErrorWorkflowPort, trustedCustomerId: string, raw: unknown,
  options: { signal: AbortSignal; now?: () => Date }) {
  const customerId = uuid.parse(trustedCustomerId), request = parse(serviceErrorReportSchema, raw, "REPORT_INVALID"), now = options.now ?? (() => new Date());
  const bytes = serviceErrorReportPayload(request), reportSha256 = serviceErrorSha256(bytes);
  const payloadId = deterministicUuid(`applypack:service-error-report-v1:${customerId}:${request.requestId}`);
  const members = request.items.map(({ artifactId, fileVersionId, releaseId }) => ({ artifactId, fileVersionId, releaseId }));
  const receipt = (value: unknown) => {
    const saved = parse(serviceErrorReportReceiptSchema, value, "REPORT_RESULT_UNKNOWN");
    ensure(saved.customerId === customerId && saved.materialLineId === request.materialLineId && saved.requestId === request.requestId
      && saved.payloadId === payloadId && saved.reportSha256 === reportSha256 && same(saved.members, members), "REPORT_IDENTITY_CONFLICT");
    return saved;
  };
  try {
    return await boundedServiceErrorIo(options.signal, async (signal) => {
      const previous = await port.readReport(customerId, request.requestId, signal);
      ensure(!signal.aborted, "ABORTED");
      if (previous !== null) return { status: "REPORTED" as const, receipt: receipt(previous), replayed: true, deliveryAuthorized: false as const };
      const context = parse(serviceErrorReportContextSchema, await port.reportContext(customerId, request.materialLineId, signal), "CONTEXT_INVALID");
      ensure(!signal.aborted, "ABORTED");
      ensure(context.scope.customerId === customerId && context.scope.materialLineId === request.materialLineId, "OWNERSHIP_MISMATCH");
      ensure(resolveServiceErrorContract({ ...context.scope, contract: context.contract }).kind === "SERVICE_ERROR_ONLY", "HISTORICAL_FLOW_REQUIRED");
      ensure(Number.isFinite(now().getTime()) && now().getTime() <= Date.parse(context.reportDeadline), "REPORT_WINDOW_CLOSED");
      ensure(members.every((member) => context.files.some((file) => file.artifactId === member.artifactId && file.fileVersionId === member.fileVersionId
        && file.releaseId === member.releaseId && Date.parse(file.deliveredAt) <= now().getTime())), "DELIVERY_MISMATCH");
      const stored = await port.store({ customerId, materialLineId: request.materialLineId, requestId: request.requestId,
        payloadId, purpose: SERVICE_ERROR_REPORT_PURPOSE, sha256: reportSha256 }, bytes, signal);
      ensure(!signal.aborted && stored.payloadId === payloadId && stored.sha256 === reportSha256, "PERSIST_RESULT_UNKNOWN");
      try { await port.openReport({ customerId, requestId: request.requestId, materialLineId: request.materialLineId, payloadId, reportSha256, members }, signal); }
      catch { /* Never repeat mutation or delete: reconcile the exact durable request. */ }
      ensure(!signal.aborted, "REPORT_RESULT_UNKNOWN");
      const recorded = await port.readReport(customerId, request.requestId, signal); ensure(!signal.aborted && recorded !== null, "REPORT_RESULT_UNKNOWN");
      return { status: "REPORTED" as const, receipt: receipt(recorded), replayed: false, deliveryAuthorized: false as const };
    });
  } finally { bytes.fill(0); }
}

/** An owner decision creates a review record only. Repair work and delivery are
 * separately authorized by the affected-member workflow, never by this result. */
export async function recordMaterialServiceErrorDecision(port: ServiceErrorWorkflowPort, trustedReviewerId: string, raw: unknown,
  options: { signal: AbortSignal }) {
  const reviewerId = uuid.parse(trustedReviewerId), request = parse(serviceErrorDecisionSchema, raw, "DECISION_INVALID");
  const bytes = serviceErrorReviewPayload(request), reviewSha256 = serviceErrorSha256(bytes);
  const payloadId = deterministicUuid(`applypack:service-error-review-v1:${reviewerId}:${request.requestId}`);
  const receipt = (value: unknown) => {
    const saved = parse(serviceErrorDecisionReceiptSchema, value, "DECISION_RESULT_UNKNOWN");
    ensure(saved.caseId === request.caseId && saved.requestId === request.requestId && saved.previousDecisionId === request.expectedDecisionId
      && saved.payloadId === payloadId && saved.reviewSha256 === reviewSha256 && saved.reviewerId === reviewerId
      && saved.classification === request.classification && saved.reasonCode === request.reasonCode
      && same(saved.evidence, request.evidence) && same(saved.affected, request.affected), "DECISION_IDENTITY_CONFLICT"); return saved;
  };
  try {
    return await boundedServiceErrorIo(options.signal, async (signal) => {
      const previous = await port.readDecision(reviewerId, request.requestId, signal);
      ensure(!signal.aborted, "ABORTED");
      if (previous !== null) return { status: "RECORDED" as const, receipt: receipt(previous), replayed: true, deliveryAuthorized: false as const };
      const current = parse(serviceErrorInspectionSchema, await port.inspect(reviewerId, request.caseId, signal), "CASE_UNAVAILABLE");
      ensure(!signal.aborted, "ABORTED");
      ensure(current.report.caseId === request.caseId && current.report.state === "OPEN"
        && current.report.latestDecisionId === request.expectedDecisionId, "CASE_CHANGED");
      ensure(current.report.customerId === current.contract.customerId && current.report.materialLineId === current.contract.materialLineId, "CONTRACT_SCOPE_MISMATCH");
      // Historical remedies are resolved under their recorded contract, never
      // manufactured by relabelling a prospective case.
      ensure(request.classification !== "HISTORICAL_REMEDY", "HISTORICAL_FLOW_REQUIRED");
      const stored = await port.store({ customerId: current.report.customerId, materialLineId: current.report.materialLineId,
        requestId: request.requestId, payloadId, purpose: SERVICE_ERROR_REVIEW_PURPOSE, sha256: reviewSha256 }, bytes, signal);
      ensure(!signal.aborted && stored.payloadId === payloadId && stored.sha256 === reviewSha256, "PERSIST_RESULT_UNKNOWN");
      try { await port.decide({ reviewerId, caseId: request.caseId, requestId: request.requestId, previousDecisionId: request.expectedDecisionId,
        payloadId, reviewSha256, classification: request.classification, reasonCode: request.reasonCode, evidence: request.evidence, affected: request.affected }, signal); }
      catch { /* The immutable decision may already exist; read it once. */ }
      ensure(!signal.aborted, "DECISION_RESULT_UNKNOWN");
      const recorded = await port.readDecision(reviewerId, request.requestId, signal); ensure(!signal.aborted && recorded !== null, "DECISION_RESULT_UNKNOWN");
      const saved = receipt(recorded); ensure(saved.customerId === current.report.customerId && saved.materialLineId === current.report.materialLineId, "DECISION_IDENTITY_CONFLICT");
      return { status: "RECORDED" as const, receipt: saved, replayed: false, deliveryAuthorized: false as const };
    });
  } finally { bytes.fill(0); }
}

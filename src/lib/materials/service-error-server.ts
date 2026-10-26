import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/database.types";
import { ServiceErrorContractError, resolveServiceErrorContract, serviceErrorCanonicalJson, serviceErrorDecisionSchema, serviceErrorReportPayload,
  serviceErrorReportSchema, serviceErrorReviewPayload, SERVICE_ERROR_REPORT_PURPOSE, SERVICE_ERROR_REVIEW_PURPOSE } from "./service-error-contract";
import { boundedServiceErrorIo, readServiceErrorPayload, storeServiceErrorPayload } from "./service-error-payload";
import { recordMaterialServiceErrorDecision, reportMaterialServiceError, serviceErrorInspectionSchema,
  serviceErrorReportContextSchema, serviceErrorReportReceiptSchema, type ServiceErrorWorkflowPort } from "./service-error-workflow";

type Admin = SupabaseClient<Database>;
type Result = { data: unknown; error: unknown };
type RpcQuery = { abortSignal(signal: AbortSignal): PromiseLike<Result> };
// Narrow source contract for the unpublished096 functions. Replace with the
// real generated Database surface when its CI artifact is available; this is
// not a generated-schema claim or an unbounded RPC escape hatch.
type RpcArgs = {
  ap_material_service_error_context: { p_customer_id: string; p_material_line_id: string };
  ap_read_material_service_error_report: { p_customer_id: string; p_request_id: string };
  ap_open_material_service_error_report: { p_customer_id: string; p_request_id: string; p_material_line_id: string;
    p_payload_id: string; p_report_sha256: string; p_members: { artifactId: string; fileVersionId: string; releaseId: string }[] };
  ap_inspect_material_service_error: { p_reviewer_id: string; p_case_id: string };
  ap_read_material_service_error_decision: { p_reviewer_id: string; p_request_id: string };
  ap_record_material_service_error_decision: { p_reviewer_id: string; p_case_id: string; p_request_id: string; p_previous_decision_id: string | null;
    p_payload_id: string; p_review_sha256: string; p_classification: string; p_reason_code: string;
    p_evidence: z.infer<typeof serviceErrorDecisionSchema>["evidence"]; p_affected: z.infer<typeof serviceErrorDecisionSchema>["affected"] };
};
type Rpc = <Name extends keyof RpcArgs>(name: Name, args: RpcArgs[Name]) => RpcQuery;
const uuid = z.uuid();
function ensure(value: unknown, code: string): asserts value { if (!value) throw new ServiceErrorContractError(code); }
function parse<T>(schema: z.ZodType<T>, value: unknown, code = "RECEIPT_INVALID"): T {
  const result = schema.safeParse(value); ensure(result.success, code); return result.data;
}
async function data(query: PromiseLike<Result>, signal: AbortSignal) {
  ensure(!signal.aborted, "ABORTED");
  let result: Result; try { result = await query; } catch { throw new ServiceErrorContractError("UNCONFIRMED"); }
  ensure(!signal.aborted, "ABORTED"); ensure(!result.error, "UNCONFIRMED"); return result.data;
}
function workflow(admin: Admin): ServiceErrorWorkflowPort {
  const rpc = admin.rpc.bind(admin) as unknown as Rpc;
  return {
    reportContext: (customerId, materialLineId, signal) => data(rpc("ap_material_service_error_context", { p_customer_id: customerId, p_material_line_id: materialLineId }).abortSignal(signal), signal),
    readReport: (customerId, requestId, signal) => data(rpc("ap_read_material_service_error_report", { p_customer_id: customerId, p_request_id: requestId }).abortSignal(signal), signal),
    openReport: (input, signal) => data(rpc("ap_open_material_service_error_report", { p_customer_id: input.customerId, p_request_id: input.requestId,
      p_material_line_id: input.materialLineId, p_payload_id: input.payloadId, p_report_sha256: input.reportSha256, p_members: input.members }).abortSignal(signal), signal),
    inspect: (reviewerId, caseId, signal) => data(rpc("ap_inspect_material_service_error", { p_reviewer_id: reviewerId, p_case_id: caseId }).abortSignal(signal), signal),
    readDecision: (reviewerId, requestId, signal) => data(rpc("ap_read_material_service_error_decision", { p_reviewer_id: reviewerId, p_request_id: requestId }).abortSignal(signal), signal),
    decide: (input, signal) => data(rpc("ap_record_material_service_error_decision", { p_reviewer_id: input.reviewerId, p_case_id: input.caseId,
      p_request_id: input.requestId, p_previous_decision_id: input.previousDecisionId, p_payload_id: input.payloadId, p_review_sha256: input.reviewSha256,
      p_classification: input.classification, p_reason_code: input.reasonCode, p_evidence: input.evidence, p_affected: input.affected }).abortSignal(signal), signal),
    store: (input, bytes, signal) => storeServiceErrorPayload(admin, input, bytes, { signal }),
  };
}

/** Trusted customer identity comes from server authentication, never the body.
 * Construction performs no I/O; an unbound historical line is not enrolled. */
export function createCustomerServiceErrors(admin: Admin, trustedCustomerId: string) {
  const customerId = parse(uuid, trustedCustomerId, "IDENTITY_INVALID"), port = workflow(admin);
  return {
    report: (raw: unknown, signal: AbortSignal) => reportMaterialServiceError(port, customerId, raw, { signal }),
    context: (rawLineId: string, signal: AbortSignal) => boundedServiceErrorIo(signal, async (child) => {
      const lineId = parse(uuid, rawLineId, "IDENTITY_INVALID");
      const result = parse(serviceErrorReportContextSchema, await port.reportContext(customerId, lineId, child));
      ensure(result.scope.customerId === customerId && result.scope.materialLineId === lineId, "OWNERSHIP_MISMATCH");
      ensure(resolveServiceErrorContract({ ...result.scope, contract: result.contract }).kind === "SERVICE_ERROR_ONLY", "HISTORICAL_FLOW_REQUIRED");
      ensure(!result.existingReport || result.existingReport.customerId === customerId && result.existingReport.materialLineId === lineId, "OWNERSHIP_MISMATCH"); return result;
    }),
    receipt: (rawRequestId: string, signal: AbortSignal) => boundedServiceErrorIo(signal, async (child) => {
      const requestId = parse(uuid, rawRequestId, "IDENTITY_INVALID"), value = await port.readReport(customerId, requestId, child);
      if (value === null) return null;
      const result = parse(serviceErrorReportReceiptSchema, value); ensure(result.customerId === customerId && result.requestId === requestId, "OWNERSHIP_MISMATCH"); return result;
    }),
  };
}

/** Internal owner adapter. HTTP/page callers must first require fresh admin MFA.
 * Every operation also confirms the current database reviewer role before any
 * private payload. Inspection is historical evidence, never render authority. */
export function createOwnerServiceErrors(admin: Admin, trustedReviewerId: string) {
  const reviewerId = parse(uuid, trustedReviewerId, "IDENTITY_INVALID"), port = workflow(admin);
  const authorized = async (signal: AbortSignal) => parse(z.literal(true),
    await data(admin.rpc("ap_require_material_reviewer", { p_reviewer_id: reviewerId }).abortSignal(signal), signal), "REVIEWER_UNCONFIRMED");
  const inspect = async (caseId: string, signal: AbortSignal) => {
    const value = parse(serviceErrorInspectionSchema, await port.inspect(reviewerId, caseId, signal));
    ensure(value.report.caseId === caseId && value.contract.customerId === value.report.customerId
      && value.contract.materialLineId === value.report.materialLineId, "CASE_IDENTITY_MISMATCH"); return value;
  };
  return {
    decide: (raw: unknown, signal: AbortSignal) => boundedServiceErrorIo(signal, async (child) => {
      await authorized(child); return recordMaterialServiceErrorDecision(port, reviewerId, raw, { signal: child });
    }),
    inspect: (rawCaseId: string, signal: AbortSignal) => boundedServiceErrorIo(signal, async (child) => {
      const caseId = parse(uuid, rawCaseId, "IDENTITY_INVALID"); await authorized(child);
      const current = await inspect(caseId, child), report = current.report;
      let bytes: Buffer | undefined;
      try {
        bytes = await readServiceErrorPayload(admin, { customerId: report.customerId, materialLineId: report.materialLineId,
          requestId: report.requestId, payloadId: report.payloadId, purpose: SERVICE_ERROR_REPORT_PURPOSE, sha256: report.reportSha256 }, { signal: child });
        const raw = parse(z.object({ ...serviceErrorReportSchema.shape, schemaVersion: z.literal("applypack-service-error-report-v1") }).strict(),
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), "REPORT_PAYLOAD_INVALID");
        const body = Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "schemaVersion")); const input = parse(serviceErrorReportSchema, body, "REPORT_PAYLOAD_INVALID");
        const canonical = serviceErrorReportPayload(input);
        try { ensure(canonical.equals(bytes), "REPORT_PAYLOAD_INVALID"); } finally { canonical.fill(0); }
        ensure(input.requestId === report.requestId && input.materialLineId === report.materialLineId
          && serviceErrorCanonicalJson(input.items.map(({ artifactId, fileVersionId, releaseId }) => ({ artifactId, fileVersionId, releaseId })))
            === serviceErrorCanonicalJson(report.members), "REPORT_PAYLOAD_INVALID");
        bytes.fill(0); bytes = undefined;
        const decisions = [];
        for (const receipt of current.decisions) {
          ensure(receipt.caseId === caseId && receipt.customerId === report.customerId && receipt.materialLineId === report.materialLineId, "DECISION_IDENTITY_MISMATCH");
          bytes = await readServiceErrorPayload(admin, { customerId: report.customerId, materialLineId: report.materialLineId,
            requestId: receipt.requestId, payloadId: receipt.payloadId, purpose: SERVICE_ERROR_REVIEW_PURPOSE, sha256: receipt.reviewSha256 }, { signal: child });
          const parsed = parse(z.object({ ...serviceErrorDecisionSchema.shape, schemaVersion: z.literal("applypack-service-error-review-v1") }).strict(),
            JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), "DECISION_PAYLOAD_INVALID");
          const decisionBody = Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== "schemaVersion")), decision = parse(serviceErrorDecisionSchema, decisionBody, "DECISION_PAYLOAD_INVALID");
          const canonicalReview = serviceErrorReviewPayload(decision);
          try { ensure(canonicalReview.equals(bytes), "DECISION_PAYLOAD_INVALID"); } finally { canonicalReview.fill(0); }
          ensure(decision.caseId === caseId && decision.requestId === receipt.requestId && decision.expectedDecisionId === receipt.previousDecisionId
            && decision.classification === receipt.classification && decision.reasonCode === receipt.reasonCode
            && serviceErrorCanonicalJson(decision.evidence) === serviceErrorCanonicalJson(receipt.evidence)
            && serviceErrorCanonicalJson(decision.affected) === serviceErrorCanonicalJson(receipt.affected), "DECISION_PAYLOAD_INVALID");
          decisions.push({ receipt, decision }); bytes.fill(0); bytes = undefined;
        }
        ensure(serviceErrorCanonicalJson(await inspect(caseId, child)) === serviceErrorCanonicalJson(current), "CASE_CHANGED");
        return { ...current, reportBody: input, decisionBodies: decisions, evidenceMode: "HISTORICAL_DELIVERY_REVIEW" as const, repairAuthorized: false as const };
      } catch (error) {
        if (error instanceof ServiceErrorContractError) throw error;
        throw new ServiceErrorContractError("INSPECTION_UNAVAILABLE");
      } finally { bytes?.fill(0); }
    }),
  };
}

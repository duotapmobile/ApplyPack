import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/database.types";
import { serviceRepairOpenRequestSchema, serviceRepairVersionSchema, validateServiceRepairInspection,
  type ServiceRepairOpenPort } from "./service-repair-workflow";

const uuid = z.uuid();
const inspectSchema = z.object({ caseId: uuid, materialLineId: uuid, reviewerId: uuid }).strict();
const readSchema = z.object({ requestId: uuid, reviewerId: uuid }).strict();
const openSchema = serviceRepairOpenRequestSchema.extend({ reviewerId: uuid }).strict();
type OpenArgs = Database["public"]["Functions"]["ap_open_service_repair"]["Args"];

export class ServiceRepairTransportError extends Error {
  constructor(readonly code: "INPUT_INVALID" | "ABORTED" | "UNCONFIRMED" | "RECEIPT_INVALID") {
    super(`SERVICE_REPAIR_TRANSPORT_${code}`); this.name = "ServiceRepairTransportError";
  }
}
function ensure(value: unknown, code: ServiceRepairTransportError["code"]): asserts value {
  if (!value) throw new ServiceRepairTransportError(code);
}
function parse<T>(schema: z.ZodType<T>, raw: unknown, code: ServiceRepairTransportError["code"] = "RECEIPT_INVALID"): T {
  const value = schema.safeParse(raw); ensure(value.success, code); return value.data;
}

/** Generated099 transport for trusted server services after their fresh MFA
 * check. Construction performs no I/O. Every request is attempted once, with
 * cancellation and a finite deadline. Opening a repair grants no render, review
 * or delivery authority; openServiceRepair reconciles an uncertain write using
 * the immutable request readback, never by repeating the mutation. */
export function createServiceRepairStore(admin: SupabaseClient<Database>): ServiceRepairOpenPort {
  async function bounded<T>(parent: AbortSignal, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    ensure(!parent.aborted, "ABORTED");
    const controller = new AbortController(), abort = () => controller.abort();
    parent.addEventListener("abort", abort, { once: true }); if (parent.aborted) abort();
    const timer = setTimeout(abort, 20_000); let stop: () => void = () => undefined;
    const interrupted = new Promise<never>((_, reject) => {
      stop = () => reject(new ServiceRepairTransportError("ABORTED"));
      controller.signal.addEventListener("abort", stop, { once: true }); if (controller.signal.aborted) stop();
    });
    try {
      ensure(!controller.signal.aborted, "ABORTED");
      const value = await Promise.race([operation(controller.signal), interrupted]);
      ensure(!controller.signal.aborted, "ABORTED"); return value;
    } catch (error) {
      if (error instanceof ServiceRepairTransportError) throw error;
      throw new ServiceRepairTransportError("UNCONFIRMED");
    } finally {
      clearTimeout(timer); parent.removeEventListener("abort", abort);
      controller.signal.removeEventListener("abort", stop); controller.abort();
    }
  }
  async function data(query: PromiseLike<{ data: unknown; error: unknown }>, signal: AbortSignal) {
    const result = await query; ensure(!signal.aborted, "ABORTED");
    ensure(!result.error, "UNCONFIRMED"); return result.data;
  }
  return {
    requireReviewer: (rawId, parent) => bounded(parent, async (signal) => {
      const p_reviewer_id = parse(uuid, rawId, "INPUT_INVALID");
      return parse(z.literal(true), await data(admin.rpc("ap_require_material_reviewer", { p_reviewer_id }).abortSignal(signal), signal));
    }),
    inspect: (caseId, materialLineId, reviewerId, parent) => bounded(parent, async (signal) => {
      const identity = parse(inspectSchema, { caseId, materialLineId, reviewerId }, "INPUT_INVALID");
      const args: Database["public"]["Functions"]["ap_inspect_service_repair"]["Args"] = {
        p_case_id: identity.caseId, p_material_line_id: identity.materialLineId, p_reviewer_id: identity.reviewerId,
      };
      const result = await data(admin.rpc("ap_inspect_service_repair", args).abortSignal(signal), signal);
      try { return validateServiceRepairInspection(result, { caseId: identity.caseId, materialLineId: identity.materialLineId }); }
      catch { throw new ServiceRepairTransportError("RECEIPT_INVALID"); }
    }),
    readVersion: (requestId, reviewerId, parent) => bounded(parent, async (signal) => {
      const identity = parse(readSchema, { requestId, reviewerId }, "INPUT_INVALID");
      const args: Database["public"]["Functions"]["ap_read_service_repair_version"]["Args"] = {
        p_request_id: identity.requestId, p_reviewer_id: identity.reviewerId,
      };
      const result = parse(serviceRepairVersionSchema.nullable(), await data(admin.rpc("ap_read_service_repair_version", args).abortSignal(signal), signal));
      ensure(result === null || result.request_id === identity.requestId, "RECEIPT_INVALID"); return result;
    }),
    open: (raw, parent) => bounded(parent, async (signal) => {
      const request = parse(openSchema, raw, "INPUT_INVALID");
      const args: OpenArgs = {
        p_case_id: request.caseId, p_material_line_id: request.materialLineId, p_request_id: request.requestId,
        // The actual SQL accepts NULL for the first version. The generated CLI
        // declaration omits parameter nullability; preserve SQL NULL on the wire.
        p_expected_version_id: request.expectedVersionId as OpenArgs["p_expected_version_id"],
        p_scope_sha256: request.acceptedScopeSha256, p_context_sha256: request.contextSha256, p_reviewer_id: request.reviewerId,
      };
      return parse(uuid, await data(admin.rpc("ap_open_service_repair", args).abortSignal(signal), signal));
    }),
  };
}

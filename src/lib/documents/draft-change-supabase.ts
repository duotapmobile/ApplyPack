import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/lib/database.types";
import { draftChangeRecordSchema, type DraftChangePort } from "./draft-change-port";

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const columns = "id,customer_id,material_line_id,job_id,parent_version_id,successor_version_id,encrypted_payload_id,request_sha256,payload_sha256,parent_source_sha256,parent_proposal_sha256,packet_sha256,context_sha256,reviewer_id,created_at";
const commitSchema = z.object({ p_job_id: uuid, p_expected_version_id: uuid, p_expected_source_sha256: hash,
  p_request_id: uuid, p_payload_id: uuid, p_request_sha256: hash, p_payload_sha256: hash,
  p_parent_proposal_sha256: hash, p_reviewer_id: uuid }).strict();
const reserveSchema = z.object({ p_job_id: uuid, p_lease_token: uuid, p_version_id: uuid, p_request_id: uuid, p_policy_id: uuid,
  p_input_token_cap: z.number().int().min(1).max(50_000), p_output_token_cap: z.number().int().min(16).max(16_000),
  p_change_request_id: uuid, p_change_payload_sha256: hash }).strict();
const reservationSchema = z.discriminatedUnion("dispatchAuthorized", [
  z.object({ requestId: uuid, dispatchAuthorized: z.literal(true), state: z.literal("DISPATCHED"),
    reservedMicrousd: z.number().int().positive(), provider: z.literal("openai"), model: z.string().min(1).max(120), policySha256: hash }).strict(),
  z.object({ requestId: uuid, dispatchAuthorized: z.literal(false),
    state: z.enum(["DISPATCHED", "RESULT_RECORDED", "RESULT_UNKNOWN", "NO_RESULT_CONFIRMED"]), reservedMicrousd: z.number().int().positive() }).strict(),
]);
export class DraftChangeTransportError extends Error {
  constructor(readonly code: "INPUT_INVALID" | "ABORTED" | "UNCONFIRMED" | "RECEIPT_INVALID") { super(`DRAFT_CHANGE_TRANSPORT_${code}`); }
}
function ensure(value: unknown, code: DraftChangeTransportError["code"]): asserts value { if (!value) throw new DraftChangeTransportError(code); }
function parse<T>(schema: z.ZodType<T>, raw: unknown, code: DraftChangeTransportError["code"] = "RECEIPT_INVALID"): T {
  const parsed = schema.safeParse(raw); ensure(parsed.success, code); return parsed.data;
}

/** Actual generated097 interface. Construction performs no I/O and grants no
 * provider permission. Call only from trusted server services after their MFA
 * or worker gates. Each transport is bounded and attempted once; uncertain
 * writes remain uncertain for immutable same-request reconciliation. */
export function createDraftChangePort(admin: SupabaseClient<Database>): DraftChangePort {
  async function bounded<T>(parent: AbortSignal, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    ensure(!parent.aborted, "ABORTED");
    const controller = new AbortController(), abort = () => controller.abort();
    parent.addEventListener("abort", abort, { once: true }); if (parent.aborted) abort();
    const timer = setTimeout(abort, 20_000); let stop: () => void = () => undefined;
    const interrupted = new Promise<never>((_, reject) => { stop = () => reject(new DraftChangeTransportError("ABORTED"));
      controller.signal.addEventListener("abort", stop, { once: true }); if (controller.signal.aborted) stop(); });
    try { ensure(!controller.signal.aborted, "ABORTED"); const value = await Promise.race([operation(controller.signal), interrupted]); ensure(!controller.signal.aborted, "ABORTED"); return value; }
    catch (error) { if (error instanceof DraftChangeTransportError) throw error; throw new DraftChangeTransportError("UNCONFIRMED"); }
    finally { clearTimeout(timer); parent.removeEventListener("abort", abort); controller.signal.removeEventListener("abort", stop); controller.abort(); }
  }
  async function data(query: PromiseLike<{ data: unknown; error: unknown }>, signal: AbortSignal) {
    const result = await query; ensure(!signal.aborted, "ABORTED"); ensure(!result.error, "UNCONFIRMED"); return result.data;
  }
  return {
    readRequest: (rawId, parent) => bounded(parent, async (signal) => {
      const id = parse(uuid, rawId, "INPUT_INVALID");
      const row = parse(draftChangeRecordSchema.nullable(), await data(admin.from("ap_material_draft_change_requests")
        .select(columns).eq("id", id).abortSignal(signal).maybeSingle(), signal));
      ensure(row === null || row.id === id, "RECEIPT_INVALID"); return row;
    }),
    readEvidence: (rawId, parent) => bounded(parent, async (signal) => {
      const p_version_id = parse(uuid, rawId, "INPUT_INVALID");
      return parse(draftChangeRecordSchema.nullable(), await data(admin.rpc("ap_material_draft_change_evidence", { p_version_id }).abortSignal(signal), signal));
    }),
    commit: (raw, parent) => bounded(parent, async (signal) => {
      const args: Database["public"]["Functions"]["ap_request_material_draft_changes"]["Args"] = parse(commitSchema, raw, "INPUT_INVALID");
      return parse(uuid, await data(admin.rpc("ap_request_material_draft_changes", args).abortSignal(signal), signal));
    }),
    reserve: (raw, parent) => bounded(parent, async (signal) => {
      const args: Database["public"]["Functions"]["ap_begin_material_draft_request_with_changes"]["Args"] = parse(reserveSchema, raw, "INPUT_INVALID");
      const receipt = parse(reservationSchema, await data(admin.rpc("ap_begin_material_draft_request_with_changes", args).abortSignal(signal), signal));
      ensure(receipt.requestId === args.p_request_id, "RECEIPT_INVALID"); return receipt;
    }),
  };
}

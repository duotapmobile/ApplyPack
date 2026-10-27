import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createDraftCapability, hashDraftSecret, type DraftCapability } from "@/lib/security/draft-capability";
import { clarificationSuccessorCapability } from "./clarification-capability";
import { clarificationAnswerReceiptSchema, clarificationQuestionsSchema, clarificationRequestSchema } from "./clarification-contract";

type Admin = SupabaseClient<Database>;
type RpcName = "ap_material_clarification_answer_context" | "ap_material_clarification_questions" | "ap_answer_material_clarification" | "ap_resume_material_clarification";
type Args<Name extends RpcName> = Database["public"]["Functions"][Name]["Args"];
type NullableAuth<Name extends RpcName> = Omit<Args<Name>, "p_customer_id" | "p_draft_id" | "p_secret_hash"> & {
  p_customer_id: string | null; p_draft_id: string | null; p_secret_hash: string | null;
};
export type ClarificationIdentity = { kind: "CUSTOMER"; customerId: string }
  | { kind: "ANONYMOUS"; capability: Pick<DraftCapability, "draftId" | "secret"> };
const contextSchema = z.object({ mode: z.enum(["CONFIRMED_INTAKE", "LEGACY"]), sourceDraftId: z.uuid(), successorDraftId: z.uuid().nullable() }).strict();
const storedCapabilitySchema = z.object({ id: z.uuid(), version: z.number().int().positive(), capability_secret_hash: z.string().regex(/^[a-f0-9]{64}$/), expires_at: z.iso.datetime({ offset: true }),
  state: z.literal("IN_PROGRESS"), retention_state: z.literal("ACTIVE") }).strict();

export class ClarificationError extends Error {
  constructor(readonly code: "UNAVAILABLE" | "NOT_CURRENT" | "OWNER_REVIEW_REQUIRED" | "EDIT_COMPLETE_REVIEW" | "SAVE_UNCERTAIN") { super(code); }
}
function fail(code: ClarificationError["code"]): never { throw new ClarificationError(code); }
function errorCode(error: unknown): string | null {
  return error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : null;
}
function mappedWriteError(error: unknown): never {
  switch (errorCode(error)) {
    case "clarification_paid_or_checkout_owner_exception": fail("OWNER_REVIEW_REQUIRED");
    case "clarification_answer_already_saved_edit_review": fail("EDIT_COMPLETE_REVIEW");
    case "question_owner_or_version_invalid": case "clarification_not_open": case "clarification_capability_conflict": fail("NOT_CURRENT");
    default: fail("SAVE_UNCERTAIN");
  }
}
function authArgs(identity: ClarificationIdentity) {
  if (identity.kind === "CUSTOMER") return { p_customer_id: z.uuid().parse(identity.customerId), p_draft_id: null, p_secret_hash: null };
  return { p_customer_id: null, p_draft_id: z.uuid().parse(identity.capability.draftId), p_secret_hash: hashDraftSecret(identity.capability.secret) };
}
async function readContext(admin: Admin, identity: ClarificationIdentity, questionId: string) {
  const args: NullableAuth<"ap_material_clarification_answer_context"> = { ...authArgs(identity), p_question_id: questionId };
  // CLI-generated function Args omit PostgreSQL parameter nullability. Only the
  // three SQL-authentication alternatives are widened, never names or other fields.
  const result = await admin.rpc("ap_material_clarification_answer_context", args as Args<"ap_material_clarification_answer_context">).abortSignal(AbortSignal.timeout(10_000));
  if (result.error) { if (errorCode(result.error) === "question_owner_or_version_invalid") fail("NOT_CURRENT"); fail("UNAVAILABLE"); }
  const parsed = contextSchema.safeParse(result.data);
  if (!parsed.success || parsed.data.sourceDraftId === parsed.data.successorDraftId) fail("UNAVAILABLE");
  return parsed.data;
}
export async function loadClarificationQuestions(admin: Admin, identity: ClarificationIdentity) {
  const args: NullableAuth<"ap_material_clarification_questions"> = authArgs(identity);
  const result = await admin.rpc("ap_material_clarification_questions", args as Args<"ap_material_clarification_questions">).abortSignal(AbortSignal.timeout(10_000));
  const parsed = clarificationQuestionsSchema.safeParse(result.data);
  if (result.error || !parsed.success) fail("UNAVAILABLE");
  return parsed.data;
}
export async function answerMaterialClarification(admin: Admin, identity: ClarificationIdentity, raw: unknown, now = Date.now()) {
  const input = clarificationRequestSchema.parse(raw);
  const context = await readContext(admin, identity, input.questionId);
  const capability = identity.kind === "ANONYMOUS"
    ? clarificationSuccessorCapability(identity.capability, { sourceDraftId: context.sourceDraftId, successorDraftId: context.successorDraftId })
    : createDraftCapability();
  if (context.successorDraftId) capability.draftId = context.successorDraftId;
  let result;
  if ("action" in input && (context.mode !== "CONFIRMED_INTAKE" || !context.successorDraftId)) fail("NOT_CURRENT");
  try {
    if ("action" in input) {
      // Resume validates the immutable initial receipt without replaying or
      // overwriting a clarification later edited during the complete review.
      const args: NullableAuth<"ap_resume_material_clarification"> = { ...authArgs(identity), p_question_id: input.questionId,
        p_successor_draft_id: capability.draftId, p_successor_secret_hash: capability.secretHash };
      result = await admin.rpc("ap_resume_material_clarification", args as Args<"ap_resume_material_clarification">).abortSignal(AbortSignal.timeout(10_000));
    } else {
      const args: NullableAuth<"ap_answer_material_clarification"> = { ...authArgs(identity), p_question_id: input.questionId,
        p_answer: input.answer, p_successor_draft_id: capability.draftId, p_successor_secret_hash: capability.secretHash };
      result = await admin.rpc("ap_answer_material_clarification", args as Args<"ap_answer_material_clarification">).abortSignal(AbortSignal.timeout(10_000));
    }
  }
  catch { fail("SAVE_UNCERTAIN"); }
  if (result.error) mappedWriteError(result.error);
  const parsed = clarificationAnswerReceiptSchema.safeParse(result.data);
  if (!parsed.success) fail("SAVE_UNCERTAIN");
  const receipt = parsed.data;
  if (receipt.state !== "FULL_REVIEW_REQUIRED") {
    if (context.mode !== "LEGACY" || receipt.state !== "LEGACY_EVIDENCE_RECORDED") fail("SAVE_UNCERTAIN");
    return { receipt, capability: null };
  }
  if (context.mode !== "CONFIRMED_INTAKE" || Date.parse(receipt.expiresAt) <= now || (context.successorDraftId && receipt.draftId !== context.successorDraftId)) fail("SAVE_UNCERTAIN");
  let after;
  try { after = await readContext(admin, identity, input.questionId); }
  catch { fail("SAVE_UNCERTAIN"); }
  if (after.sourceDraftId !== context.sourceDraftId || after.successorDraftId !== receipt.draftId || after.mode !== context.mode) fail("SAVE_UNCERTAIN");
  const saved = await admin.from("ap_anonymous_drafts").select("id,version,capability_secret_hash,expires_at,state,retention_state")
    .eq("id", receipt.draftId).eq("capability_secret_hash", capability.secretHash).abortSignal(AbortSignal.timeout(10_000)).maybeSingle();
  const stored = storedCapabilitySchema.safeParse(saved.data);
  if (saved.error || !stored.success || stored.data.id !== receipt.draftId || stored.data.capability_secret_hash !== capability.secretHash
    || stored.data.version !== receipt.version || Date.parse(stored.data.expires_at) !== Date.parse(receipt.expiresAt)) fail("SAVE_UNCERTAIN");
  return { receipt, capability: { ...capability, draftId: receipt.draftId } };
}

export function clarificationErrorResponse(error: unknown) {
  const code = error instanceof ClarificationError ? error.code : "UNAVAILABLE";
  if (code === "OWNER_REVIEW_REQUIRED") return { status: 409, body: { code, error: "This intake has an active checkout or paid service. Contact support; your order and deadline remain unchanged." } };
  if (code === "EDIT_COMPLETE_REVIEW") return { status: 409, body: { code, error: "An answer is already saved. Check saved questions and continue the complete intake review to edit it." } };
  if (code === "NOT_CURRENT") return { status: 409, body: { code, error: "This question or review is no longer available. Check saved questions or contact support." } };
  return { status: 503, body: { code, error: code === "SAVE_UNCERTAIN"
    ? "The save result is uncertain. Keep your answer and check saved questions before trying again."
    : "Clarification is temporarily unavailable. Your saved information has not been replaced." } };
}

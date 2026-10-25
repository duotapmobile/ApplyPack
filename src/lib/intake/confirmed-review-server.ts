import "server-only";
import { canonicalSha256 } from "@/lib/domain/foundation";
import { type createSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildConfirmedReview, confirmationReceiptSchema, type ConfirmationReceipt } from "./confirmed-review";
import { normalizedFourStepDraft, validateFourStep } from "./four-step";
import { fourStepPrivateState, parseStoredFourStepDraft } from "./four-step-server";

type Admin = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
type NewRpcName = "ap_intake_confirmation_source" | "ap_prepare_intake_confirmation" | "ap_read_intake_confirmation";
// Narrow forward-migration interface; replaced by the generated database declarations at integration.
export function confirmationRpc(admin: Admin, name: NewRpcName, args: Record<string, string | number>) {
  const client = admin as unknown as { rpc: (name: NewRpcName, args: Record<string, string | number>) => Promise<{ data: unknown; error: { message?: string } | null }> };
  return client.rpc(name, args);
}

export async function prepareConfirmedReview(admin: Admin, draftId: string, secretHash: string, expectedVersion: number) {
  const args = { p_draft_id: draftId, p_secret_hash: secretHash, p_expected_version: expectedVersion };
  const source = await confirmationRpc(admin, "ap_intake_confirmation_source", args);
  if (source.error || typeof source.data !== "string") throw new Error("INTAKE_REVIEW_STALE");
  const saved = await admin.rpc("ap_read_four_step_draft", { p_draft_id: draftId, p_secret_hash: secretHash });
  const row = Array.isArray(saved.data) ? saved.data[0] : null;
  if (saved.error || !row || row.version !== expectedVersion || row.state !== "IN_PROGRESS") throw new Error("INTAKE_REVIEW_STALE");
  const answers = normalizedFourStepDraft(parseStoredFourStepDraft(row.answers));
  const state = await fourStepPrivateState(admin, draftId);
  const resume = state.documents.find((document) => document.kind === "RESUME") ?? null;
  const errors = [0, 1, 2, 3].flatMap((step) => validateFourStep(step as 0 | 1 | 2 | 3, answers, { resume, facts: state.facts, presentedFactIds: new Set(state.presentedFactIds) }));
  if (answers.entryMode !== "GUIDED" && (!resume || !["READY", "REVIEW_READY"].includes(resume.processingState))) errors.push({ fieldId: "resume", message: "The resume must finish safe extraction before its facts can be confirmed." });
  if (errors.length) return { errors, sections: null, receipt: null };
  const sections = buildConfirmedReview(answers, state.documents, state.facts);
  const result = await confirmationRpc(admin, "ap_prepare_intake_confirmation", { ...args,
    p_source_sha256: source.data, p_review_sha256: canonicalSha256(sections), p_answers_sha256: canonicalSha256(answers) });
  const receipt = confirmationReceiptSchema.safeParse(result.data);
  if (result.error || !receipt.success) throw new Error("INTAKE_REVIEW_STALE");
  return { errors: [], sections, receipt: receipt.data };
}

export async function validateSubmittedConfirmation(admin: Admin, draftId: string, secretHash: string, expectedVersion: number, answers: unknown, receipt: ConfirmationReceipt) {
  if (receipt.draftVersion !== expectedVersion || receipt.answersSha256 !== canonicalSha256(answers)) return false;
  const saved = await confirmationRpc(admin, "ap_read_intake_confirmation", { p_draft_id: draftId, p_secret_hash: secretHash });
  const parsed = confirmationReceiptSchema.safeParse(saved.data);
  return !saved.error && parsed.success && canonicalSha256(parsed.data) === canonicalSha256(receipt);
}

export async function boundedIntakeJson(request: Request) {
  if (!request.body || request.signal.aborted) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  let stop: () => void = () => undefined;
  const interrupted = new Promise<never>((_, reject) => { stop = () => {
    void reader.cancel().catch(() => undefined);
    reject(new Error("INTAKE_BODY_INTERRUPTED"));
  }; });
  const timer = setTimeout(stop, 5_000);
  request.signal.addEventListener("abort", stop, { once: true });
  try {
    while (true) {
      const result = await Promise.race([reader.read(), interrupted]); if (result.done) break;
      size += result.value.byteLength;
      if (size > 96 * 1024) { void reader.cancel().catch(() => undefined); return null; }
      chunks.push(result.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch { return null; }
  finally { clearTimeout(timer); request.signal.removeEventListener("abort", stop); reader.releaseLock(); }
}

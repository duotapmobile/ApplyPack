import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { isSameOriginRequest } from "@/lib/security/origin";
import { submissionRuleConfirmationSchema } from "@/lib/documents/submission-rule-proposal";
import { createSubmissionRuleOwnerServer, SubmissionRuleReviewError } from "@/lib/documents/submission-rule-owner-server";
import { createSubmissionRulePort, SubmissionRuleSqlFailure } from "@/lib/documents/submission-rule-supabase";

const uuid = z.uuid();
const prepareSchema = z.object({ action: z.literal("PREPARE_SOURCE") }).strict();
type Context = { params: Promise<{ id: string }> };
function privateResponse(response: Response) {
  response.headers.set("cache-control", "private, no-store");
  response.headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  return response;
}
function response(body: unknown, status = 200) { return privateResponse(NextResponse.json(body, { status })); }
const unconfirmed = () => response({ code: "RESULT_UNCONFIRMED", error: "The result is unconfirmed. Keep the same pending review and check its saved confirmation before retrying." }, 409);
function query(request: Request, allowReceipt: boolean) {
  const url = new URL(request.url);
  if (url.search.length > 128) throw new Error("INVALID_QUERY");
  const entries = [...url.searchParams];
  if (!entries.length) return null;
  if (!allowReceipt || entries.length !== 1 || entries[0][0] !== "requestId") throw new Error("INVALID_QUERY");
  return uuid.parse(entries[0][1]);
}
async function readInput(request: Request) {
  if (!request.body || request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return null;
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > 128 * 1024)) return null;
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0, bytes: Buffer | undefined, interrupt: () => void = () => undefined;
  const stopped = new Promise<never>((_, reject) => { interrupt = () => { void reader.cancel().catch(() => undefined); reject(new Error("BODY_INTERRUPTED")); }; });
  const timer = setTimeout(interrupt, 5000);
  request.signal.addEventListener("abort", interrupt, { once: true });
  if (request.signal.aborted) interrupt();
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), stopped]);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 128 * 1024) { chunk.value.fill(0); void reader.cancel().catch(() => undefined); return null; }
      chunks.push(chunk.value);
    }
    bytes = Buffer.concat(chunks);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch { return null; }
  finally { clearTimeout(timer); request.signal.removeEventListener("abort", interrupt); chunks.forEach((chunk) => chunk.fill(0)); bytes?.fill(0); reader.releaseLock(); }
}

export async function GET(request: Request, route: Context) {
  if (request.headers.get("sec-fetch-site") === "cross-site" || request.headers.has("origin") && !isSameOriginRequest(request)) return response({ error: "This staff read was rejected." }, 403);
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return privateResponse(auth.response);
    const id = uuid.safeParse((await route.params).id);
    let requestId: string | null;
    try { requestId = query(request, true); } catch { return response({ error: "The review locator is invalid." }, 400); }
    if (!id.success) return response({ error: "The job locator is invalid." }, 400);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]);
    const server = createSubmissionRuleOwnerServer(createSubmissionRulePort(auth.admin, signal), auth.user.id);
    if (requestId) return response({ saved: await server.receipt(id.data, requestId) });
    const result = await server.review(id.data);
    return response(result.status === "READY" ? result.view : result);
  } catch { return response({ error: "This job's current review is unavailable. Verify your staff access and try again." }, 409); }
}

export async function POST(request: Request, route: Context) {
  if (!isSameOriginRequest(request)) return response({ error: "This staff action was rejected." }, 403);
  try {
    const auth = await requireAdmin();
    if (!auth.ok) return privateResponse(auth.response);
    const id = uuid.safeParse((await route.params).id);
    try { query(request, false); } catch { return response({ error: "This action does not accept query parameters." }, 400); }
    if (!id.success) return response({ error: "The job locator is invalid." }, 400);
    const raw = await readInput(request), prepare = prepareSchema.safeParse(raw);
    const input = submissionRuleConfirmationSchema.safeParse(raw);
    if (!prepare.success && (!input.success || input.data.jobSnapshotId !== id.data)) return response({ error: "Review the complete source and confirmation fields before saving." }, 400);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]);
    const server = createSubmissionRuleOwnerServer(createSubmissionRulePort(auth.admin, signal), auth.user.id);
    if (prepare.success) return response(await server.prepare(id.data));
    if (!input.success) return response({ error: "The confirmation is invalid." }, 400);
    try { return response({ saved: await server.confirm(input.data) }); }
    catch (error) {
      // Only the serialized SQL confirmation can prove a stale request rejected.
      // An earlier read, timeout or transport error cannot establish absence.
      if (error instanceof SubmissionRuleSqlFailure && error.operation === "CONFIRM" && error.sqlState === "P0001"
        && error.reason === "employer_rule_paid_binding_requires_explicit_change") return response({ code: "PAID_RULE_CHANGE_REQUIRED",
        error: "A checkout or paid Apply Pack already uses different instructions. Review the change in the existing Apply Pack document workflow before continuing. You can check this pending confirmation again here." }, 409);
      if (error instanceof SubmissionRuleSqlFailure && error.operation === "CONFIRM" && error.sqlState === "P0001"
        && ["employer_rule_review_basis_changed", "employer_rule_review_receipt_conflict"].includes(error.reason ?? "")) {
        try {
          const check = createSubmissionRuleOwnerServer(createSubmissionRulePort(auth.admin, AbortSignal.timeout(5000)), auth.user.id);
          const saved = await check.reconcile(input.data);
          if (saved) return response({ saved });
          if (error.reason === "employer_rule_review_basis_changed") return response({ code: "REVIEW_CHANGED", saved: null,
            error: "The source or instructions changed. Load and review the current evidence." }, 409);
        } catch { return unconfirmed(); }
        return response({ code: "RECEIPT_CONFLICT", error: "This request does not match its saved confirmation. Keep the original review for reconciliation." }, 409);
      }
      if (error instanceof SubmissionRuleReviewError && error.code === "RECEIPT_CONFLICT") return response({ code: "RECEIPT_CONFLICT", error: "This request does not match its saved confirmation. Keep the original review for reconciliation." }, 409);
      return unconfirmed();
    }
  } catch { return unconfirmed(); }
}

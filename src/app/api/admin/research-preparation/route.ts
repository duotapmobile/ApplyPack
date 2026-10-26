import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { isSameOriginRequest } from "@/lib/security/origin";
import { sourceVerificationSchema, promoteVerifiedSourceInventory } from "@/lib/jobs/verified-source-inventory";
import { loadPreparationReview } from "@/lib/matching/research-preparation-review";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Pragma: "no-cache", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
const respond = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("VERIFY_SOURCE"), preparationId: z.uuid(), verification: sourceVerificationSchema }).strict(),
  z.object({ action: z.literal("COMPLETE_COVERAGE"), preparationId: z.uuid(), snapshotId: z.uuid(),
    reviewed: z.literal(true), notes: z.string().trim().min(20).max(3000) }).strict(),
]);
async function readInput(request: Request): Promise<unknown> {
  if (!request.body || request.signal.aborted || request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return null;
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0, bytes: Buffer | undefined, interrupt = () => {};
  const stopped = new Promise<never>((_, reject) => { interrupt = () => {
    void reader.cancel().catch(() => undefined); reject(new Error("research_body_interrupted"));
  }; });
  const timer = setTimeout(interrupt, 5000);
  request.signal.addEventListener("abort", interrupt, { once: true });
  if (request.signal.aborted) interrupt();
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), stopped]); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 256_000) { chunk.value.fill(0); void reader.cancel().catch(() => undefined); return null; }
      chunks.push(chunk.value);
    }
    bytes = Buffer.concat(chunks); return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch { return null; }
  finally { clearTimeout(timer); request.signal.removeEventListener("abort", interrupt); chunks.forEach(chunk => chunk.fill(0)); bytes?.fill(0); reader.releaseLock(); }
}
function boundedClient(request: Request) {
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]);
  const admin = createSupabaseAdminClient({ signal }); if (!admin) throw new Error("research_unavailable");
  return { admin, signal };
}
export async function GET(request: Request) {
  const auth = await requireAdmin(); if (!auth.ok) return auth.response;
  const id = z.uuid().safeParse(new URL(request.url).searchParams.get("snapshotId"));
  if (!id.success) return respond({ error: "Choose a current intake." }, 400);
  try {
    const { admin, signal } = boundedClient(request), review = await loadPreparationReview(admin, id.data, signal);
    const role = await admin.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
    if (role.error || !["admin", "operator"].includes(role.data?.role ?? "")) throw new Error("reviewer_changed");
    signal.throwIfAborted(); return respond(review);
  }
  catch { return respond({ error: "Research preparation evidence is unavailable. Reload before reviewing." }, 409); }
}
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return respond({ error: "Request rejected." }, 403);
  const auth = await requireAdmin(); if (!auth.ok) return auth.response;
  const input = bodySchema.safeParse(await readInput(request));
  if (!input.success) return respond({ error: "Complete the exact source or coverage review." }, 400);
  try {
    const { admin, signal } = boundedClient(request);
    if (input.data.action === "VERIFY_SOURCE") {
      const result = await promoteVerifiedSourceInventory(admin, auth.user.id, input.data.verification, input.data.preparationId);
      signal.throwIfAborted();
      return respond(result, 201);
    }
    const review = await loadPreparationReview(admin, input.data.snapshotId, signal);
    if (!review.current || review.preparationId !== input.data.preparationId) throw new Error("stale");
    const result = await admin.rpc("ap_complete_prepared_research_review", {
      p_preparation_id: input.data.preparationId, p_actor_id: auth.user.id, p_notes: input.data.notes,
    });
    signal.throwIfAborted(); if (result.error || result.data !== true) throw new Error("unconfirmed");
    return respond({ state: "READY_FOR_FEASIBILITY", customerReleaseAuthorized: false });
  } catch { return respond({ error: "The exact current source, listing review and evaluation coverage could not be confirmed. Reload before retrying; no customer release was authorized." }, 409); }
}

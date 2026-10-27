import { NextResponse } from "next/server";
import { verifiedIntakeIdentity } from "@/lib/intake/verified-intake-server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSameOriginRequest } from "@/lib/security/origin";
import { clarificationRequestSchema } from "@/lib/intake/clarification-contract";
import { boundedIntakeJson } from "@/lib/intake/confirmed-review-server";
import { newIntakeRecoveryHold } from "@/lib/operations/protected-recovery-readiness";
import { answerMaterialClarification, clarificationErrorResponse, loadClarificationQuestions } from "@/lib/intake/clarification-server";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
async function context() {
  const identity = await verifiedIntakeIdentity();
  const admin = createSupabaseAdminClient();
  if (!identity || !admin) return null;
  return { customerId: identity.customerId, admin };
}
export async function GET() {
  try {
    const current = await context();
    if (!current) return NextResponse.json({ error: "Sign in to view questions." }, { status: 401, headers });
    return NextResponse.json({ questions: await loadClarificationQuestions(current.admin, { kind: "CUSTOMER", customerId: current.customerId }) }, { headers });
  } catch (error) { const mapped = clarificationErrorResponse(error); return NextResponse.json(mapped.body, { status: mapped.status, headers }); }
}
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Origin rejected." }, { status: 403, headers });
  if (Number(request.headers.get("content-length") || 0) > 24_000) return NextResponse.json({ error: "This answer is too large." }, { status: 413, headers });
  const input = clarificationRequestSchema.safeParse(await boundedIntakeJson(request));
  if (!input.success) return NextResponse.json({ error: "Confirm your factual answer or select the saved review." }, { status: 400, headers });
  if ("action" in input.data) return NextResponse.json({ error: "Choose the saved intake from Get Started to open its complete review." }, { status: 409, headers });
  try {
    const current = await context();
    if (!current) return NextResponse.json({ error: "Sign in to answer questions." }, { status: 401, headers });
    const hold = await newIntakeRecoveryHold(current.admin); if (hold) return hold;
    const result = await answerMaterialClarification(current.admin, { kind: "CUSTOMER", customerId: current.customerId }, input.data);
    // Account-level questions can concern another intake. Cookie selection is
    // performed only by the explicit, browser-fenced intake access flow.
    return NextResponse.json(result.receipt, { status: result.receipt.state === "FULL_REVIEW_REQUIRED" && result.receipt.replayed ? 200 : 201, headers });
  } catch (error) { const mapped = clarificationErrorResponse(error); return NextResponse.json(mapped.body, { status: mapped.status, headers }); }
}

import { NextResponse } from "next/server";
import { anonymousDraftContext } from "@/lib/drafts/anonymous-server";
import { isSameOriginRequest } from "@/lib/security/origin";
import { serializeDraftCapability } from "@/lib/security/draft-capability";
import { clarificationRequestSchema } from "@/lib/intake/clarification-contract";
import { boundedIntakeJson } from "@/lib/intake/confirmed-review-server";
import { newIntakeRecoveryHold } from "@/lib/operations/protected-recovery-readiness";
import { answerMaterialClarification, clarificationErrorResponse, loadClarificationQuestions } from "@/lib/intake/clarification-server";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
export async function GET() {
  try {
    const context = await anonymousDraftContext();
    if (!context) return NextResponse.json({ error: "Draft unavailable." }, { status: 404, headers });
    const questions = await loadClarificationQuestions(context.admin, { kind: "ANONYMOUS", capability: context.capability });
    return NextResponse.json({ questions }, { headers });
  } catch (error) { const mapped = clarificationErrorResponse(error); return NextResponse.json(mapped.body, { status: mapped.status, headers }); }
}
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Origin rejected." }, { status: 403, headers });
  if (Number(request.headers.get("content-length") || 0) > 24_000) return NextResponse.json({ error: "This answer is too large." }, { status: 413, headers });
  const input = clarificationRequestSchema.safeParse(await boundedIntakeJson(request));
  if (!input.success) return NextResponse.json({ error: "Confirm your factual answer or select the saved review." }, { status: 400, headers });
  try {
    const context = await anonymousDraftContext();
    if (!context) return NextResponse.json({ error: "Draft unavailable." }, { status: 404, headers });
    const hold = await newIntakeRecoveryHold(context.admin); if (hold) return hold;
    const result = await answerMaterialClarification(context.admin, { kind: "ANONYMOUS", capability: context.capability }, input.data);
    const response = NextResponse.json(result.receipt, { status: result.receipt.state === "FULL_REVIEW_REQUIRED" && result.receipt.replayed ? 200 : 201, headers });
    if (result.capability && result.receipt.state === "FULL_REVIEW_REQUIRED") {
      const remaining = Math.floor((Date.parse(result.receipt.expiresAt) - Date.now()) / 1_000);
      if (remaining < 1) throw new Error("clarification_expired");
      response.cookies.set(context.settings.name, serializeDraftCapability(result.capability), {
        ...context.settings, maxAge: Math.min(context.settings.maxAge, remaining), expires: new Date(result.receipt.expiresAt),
      });
    }
    return response;
  } catch (error) { const mapped = clarificationErrorResponse(error); return NextResponse.json(mapped.body, { status: mapped.status, headers }); }
}

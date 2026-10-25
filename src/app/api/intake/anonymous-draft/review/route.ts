import { NextResponse } from "next/server";
import { z } from "zod";
import { anonymousDraftContext } from "@/lib/drafts/anonymous-server";
import { boundedIntakeJson, prepareConfirmedReview } from "@/lib/intake/confirmed-review-server";
import { newIntakeRecoveryHold } from "@/lib/operations/protected-recovery-readiness";
import { isSameOriginRequest } from "@/lib/security/origin";

const inputSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();
const headers = { "Cache-Control": "private, no-store" };
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "This intake request was rejected." }, { status: 403, headers });
  const context = await anonymousDraftContext();
  if (!context) return NextResponse.json({ error: "The saved draft is unavailable." }, { status: 404, headers });
  const hold = await newIntakeRecoveryHold(context.admin); if (hold) return hold;
  const input = inputSchema.safeParse(await boundedIntakeJson(request));
  if (!input.success) return NextResponse.json({ error: "The review request is invalid." }, { status: 400, headers });
  try {
    const review = await prepareConfirmedReview(context.admin, context.capability.draftId, context.secretHash, input.data.expectedVersion);
    return NextResponse.json(review.errors.length ? { error: "Please answer these clarifications before reviewing your intake.", errors: review.errors } : review, { status: review.errors.length ? 400 : 200, headers });
  } catch {
    return NextResponse.json({ error: "Your saved answers or document facts changed. Reload and review the current information before confirming.", code: "INTAKE_REVIEW_STALE" }, { status: 409, headers });
  }
}

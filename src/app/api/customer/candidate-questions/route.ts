import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isSameOriginRequest } from "@/lib/security/origin";
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
async function context() {
  const client = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!client || !admin) return null;
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;
  return { customerId: data.user.id, rpc: admin.rpc.bind(admin) as unknown as (name: string,args: Record<string,unknown>) => Promise<{data: unknown;error: unknown}> };
}
export async function GET() {
  const c = await context();
  if (!c) return NextResponse.json({ error: "Sign in to view questions." }, { status: 401, headers });
  const result = await c.rpc("ap_customer_candidate_questions", { p_customer_id: c.customerId });
  if (result.error || !Array.isArray(result.data) || result.data.length>100) return NextResponse.json({ error: "Questions are unavailable. Contact support." }, { status: 503, headers });
  return NextResponse.json({ questions: result.data }, { headers });
}
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Origin rejected." }, { status: 403, headers });
  const c = await context();
  if (!c) return NextResponse.json({ error: "Sign in to answer questions." }, { status: 401, headers });
  const input = z.object({ questionId: z.uuid(), answer: z.string().trim().min(1).max(5000), confirmed: z.literal(true) }).strict().safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Confirm your factual answer." }, { status: 400, headers });
  const result = await c.rpc("ap_answer_customer_question", { p_customer_id: c.customerId, p_question_id: input.data.questionId, p_answer: input.data.answer });
  return NextResponse.json(result.error ? { error: "This question changed or was already answered. Refresh or contact support for a correction." }
    : { factId: result.data, state: "REVIEW_REQUIRED" }, { status: result.error ? 409 : 201, headers });
}

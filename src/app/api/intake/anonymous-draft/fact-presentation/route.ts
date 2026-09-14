import { NextResponse } from "next/server";
import { z } from "zod";
import { anonymousDraftContext, anonymousDraftError } from "@/lib/drafts/anonymous-server";
import { isSameOriginRequest } from "@/lib/security/origin";

const schema = z.object({ expectedVersion: z.number().int().positive(), factId: z.uuid(), controlId: z.string().trim().min(1).max(200) }).strict();

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "This review request was rejected." }, { status: 403 });
  const context = await anonymousDraftContext();
  if (!context) return NextResponse.json({ error: "The saved draft is unavailable." }, { status: 404 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "The review request is invalid." }, { status: 400 });
  const result = await context.admin.rpc("ap_record_fact_presentation", { p_draft_id: context.capability.draftId,
    p_secret_hash: context.secretHash, p_expected_version: parsed.data.expectedVersion, p_fact_id: parsed.data.factId, p_control_id: parsed.data.controlId });
  if (result.error) { const mapped = anonymousDraftError(result.error); return NextResponse.json(mapped.body, { status: mapped.status }); }
  return NextResponse.json({ presented: true }, { headers: { "cache-control": "no-store" } });
}

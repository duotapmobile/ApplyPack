import { NextResponse } from "next/server";
import { anonymousDraftContext } from "@/lib/drafts/anonymous-server";
import { isSameOriginRequest } from "@/lib/security/origin";
import { annotationDisplay, sourceAnnotationSchema } from "@/lib/intake/source-annotation";
const headers = { "Cache-Control": "private, no-store" };
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "Origin rejected" }, { status: 403, headers });
  const context = await anonymousDraftContext();
  if (!context) return NextResponse.json({ error: "Draft unavailable" }, { status: 404, headers });
  const input = sourceAnnotationSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Choose source lines and complete the factual fields." }, { status: 400, headers });
  const rpc = context.admin.rpc.bind(context.admin) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  const result = await rpc("ap_annotate_document_facts", { p_draft_id: context.capability.draftId, p_secret_hash: context.secretHash,
    p_source_fact_ids: input.data.sourceFactIds, p_annotation: input.data.annotation, p_display: annotationDisplay(input.data.annotation) });
  return NextResponse.json(result.error ? { error: "The source document changed or the draft is unavailable. Refresh before reviewing." }
    : { factId: result.data, state: "EXTRACTED_UNCONFIRMED" }, { status: result.error ? 409 : 201, headers });
}

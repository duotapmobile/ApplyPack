import { consumeRateLimit } from "@/lib/security/rate-limit";
import { NextResponse } from "next/server";
import { z } from "zod";
import { anonymousDraftContext, anonymousDraftError } from "@/lib/drafts/anonymous-server";
import { isSameOriginRequest } from "@/lib/security/origin";

const schema = z.object({ expectedVersion: z.number().int().positive(), kind: z.enum(["resume", "prior_cover_letter"]) }).strict();

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "This retry request was rejected." }, { status: 403 });
  const context = await anonymousDraftContext();
  if (!context) return NextResponse.json({ error: "The saved draft is unavailable." }, { status: 404 });
  const rate = await consumeRateLimit({ request, scope: "anonymous_document_extraction_retry", identity: context.capability.draftId, limit: 6, windowSeconds: 3600 });
  if (!rate.configured || !rate.allowed) return NextResponse.json({ error: "Document retry is temporarily unavailable." }, { status: rate.configured ? 429 : 503 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "The retry request is invalid." }, { status: 400 });
  const { data, error } = await context.admin.rpc("ap_retry_anonymous_document", { p_draft_id: context.capability.draftId,
    p_secret_hash: context.secretHash, p_expected_draft_version: parsed.data.expectedVersion,
    p_kind: parsed.data.kind === "resume" ? "RESUME" : "PRIOR_COVER_LETTER" });
  if (error || !Array.isArray(data) || !data[0]) { const mapped = anonymousDraftError(error); return NextResponse.json(mapped.body, { status: mapped.status }); }
  const current = await context.admin.from("ap_document_versions").select("id,storage_path,verified_mime_type")
    .eq("draft_id", context.capability.draftId).eq("kind", parsed.data.kind === "resume" ? "RESUME" : "PRIOR_COVER_LETTER").eq("is_current", true).maybeSingle();
  if (!current.data) return NextResponse.json({ error: "Document unavailable." }, { status: 404 });
  const queued = await context.admin.rpc("ap_retry_document_processing", { p_document_id: current.data.id, p_draft_id: context.capability.draftId });
  if (queued.error) return NextResponse.json({ error: "Document retry could not be queued." }, { status: 503 });
  return NextResponse.json({ retried: true, draftVersion: (data[0] as Record<string, unknown>).draft_version });
}

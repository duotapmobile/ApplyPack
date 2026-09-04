import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { anonymousDraftContext, anonymousDraftError } from "@/lib/drafts/anonymous-server";
import { createDraftCapability, draftCookieSettings, hashDraftSecret, serializeDraftCapability } from "@/lib/security/draft-capability";
import { isSameOriginRequest } from "@/lib/security/origin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

const updateSchema = z.object({
  expectedVersion: z.number().int().positive(),
  currentStep: z.number().int().min(0).max(6),
  answers: z.record(z.string(), z.unknown()),
});

function publicDraft(row: Record<string, unknown>) {
  return { id: row.id, version: row.version, state: row.state, currentStep: row.current_step, answers: row.answers, expiresAt: row.expires_at };
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "This draft request was rejected." }, { status: 403 });
  const settings = draftCookieSettings();
  const admin = createSupabaseAdminClient();
  if (!settings || !admin) return NextResponse.json({ error: "Anonymous draft retention is not configured." }, { status: 503 });
  const rate = await consumeRateLimit({ request, scope: "anonymous_draft_create", limit: 12, windowSeconds: 60 * 60 });
  if (!rate.configured || !rate.allowed) return NextResponse.json({ error: "A draft cannot be created right now." }, { status: rate.configured ? 429 : 503 });

  const capability = createDraftCapability();
  const expiresAt = new Date(Date.now() + settings.maxAge * 1000).toISOString();
  const { data, error } = await admin.rpc("ap_create_anonymous_draft", { p_draft_id: capability.draftId, p_secret_hash: capability.secretHash, p_expires_at: expiresAt });
  if (error || !Array.isArray(data) || !data[0]) return NextResponse.json({ error: "A draft cannot be created right now." }, { status: 502 });
  const store = await cookies();
  store.set(settings.name, serializeDraftCapability(capability), settings);
  return NextResponse.json({ draft: publicDraft(data[0] as Record<string, unknown>) }, { status: 201, headers: { "cache-control": "no-store" } });
}

export async function GET() {
  const context = await anonymousDraftContext();
  if (!context) return NextResponse.json({ draft: null }, { headers: { "cache-control": "no-store" } });
  const { data, error } = await context.admin.rpc("ap_read_anonymous_draft", { p_draft_id: context.capability.draftId, p_secret_hash: context.secretHash });
  if (error) return NextResponse.json(anonymousDraftError(error).body, { status: anonymousDraftError(error).status });
  const row = Array.isArray(data) ? data[0] : null;
  return NextResponse.json({ draft: row ? publicDraft(row as Record<string, unknown>) : null }, { headers: { "cache-control": "no-store" } });
}

export async function PUT(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "This draft request was rejected." }, { status: 403 });
  if (Number(request.headers.get("content-length") || 0) > 64 * 1024) return NextResponse.json({ error: "The intake draft is too large." }, { status: 413 });
  const context = await anonymousDraftContext();
  if (!context) return NextResponse.json({ error: "The saved draft is unavailable." }, { status: 404 });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || JSON.stringify(parsed.data.answers).length > 60_000) return NextResponse.json({ error: "The intake draft is invalid or too large." }, { status: 400 });
  const { data, error } = await context.admin.rpc("ap_save_anonymous_draft", {
    p_draft_id: context.capability.draftId,
    p_secret_hash: hashDraftSecret(context.capability.secret),
    p_expected_version: parsed.data.expectedVersion,
    p_current_step: parsed.data.currentStep,
    p_answers: parsed.data.answers,
  });
  if (error || !Array.isArray(data) || !data[0]) {
    const mapped = anonymousDraftError(error);
    return NextResponse.json(mapped.body, { status: mapped.status, headers: { "cache-control": "no-store" } });
  }
  return NextResponse.json({ draft: publicDraft(data[0] as Record<string, unknown>) }, { headers: { "cache-control": "no-store" } });
}

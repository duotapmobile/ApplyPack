import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOriginRequest } from "@/lib/security/origin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const updateSchema = z.object({
  currentStep: z.number().int().min(0).max(6),
  answers: z.record(z.string(), z.unknown()),
});

async function clients() {
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) return null;
  const { data } = await supabase.auth.getUser();
  return data.user ? { admin, user: data.user } : null;
}

function publicDraft(row: Record<string, unknown>) {
  const sanitize = (value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const document = value as Record<string, unknown>;
    return {
      name: String(document.name || ""),
      size: Number(document.size || 0),
      mimeType: String(document.mimeType || ""),
      scanStatus: String(document.scanStatus || "pending"),
    };
  };
  return {
    id: row.id,
    currentStep: row.current_step,
    answers: row.answers,
    resumeDocument: sanitize(row.resume_document),
    coverLetterDocument: sanitize(row.cover_letter_document),
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

export async function GET() {
  const auth = await clients();
  if (!auth) return NextResponse.json({ error: "Sign in to resume intake." }, { status: 401 });
  const { data, error } = await auth.admin.from("intake_drafts").select("*")
    .eq("customer_id", auth.user.id).maybeSingle();
  if (error) return NextResponse.json({ error: "Your saved intake could not be loaded." }, { status: 502 });
  return NextResponse.json({ draft: data ? publicDraft(data as Record<string, unknown>) : null }, {
    headers: { "cache-control": "no-store" },
  });
}

export async function PUT(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "This draft request was rejected." }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 64 * 1024) return NextResponse.json({ error: "The intake draft is too large." }, { status: 413 });
  const auth = await clients();
  if (!auth) return NextResponse.json({ error: "Sign in to save intake." }, { status: 401 });
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || JSON.stringify(parsed.data.answers).length > 60_000) {
    return NextResponse.json({ error: "The intake draft is invalid or too large." }, { status: 400 });
  }
  const now = new Date();
  const { data, error } = await auth.admin.from("intake_drafts").upsert({
    customer_id: auth.user.id,
    email: (auth.user.email || "").toLowerCase(),
    current_step: parsed.data.currentStep,
    answers: parsed.data.answers,
    updated_at: now.toISOString(),
    expires_at: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  }, { onConflict: "customer_id" }).select("*").single();
  if (error || !data) return NextResponse.json({ error: "Your intake progress could not be saved." }, { status: 502 });
  return NextResponse.json({ draft: publicDraft(data as Record<string, unknown>) });
}

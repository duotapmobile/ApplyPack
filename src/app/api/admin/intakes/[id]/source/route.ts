import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";

const kindSchema = z.enum(["resume", "cover_letter"]);

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const intakeId = (await context.params).id;
  const kind = kindSchema.safeParse(new URL(request.url).searchParams.get("kind"));
  if (!kind.success) return NextResponse.json({ error: "Choose a source document." }, { status: 400 });
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { data: intake } = await auth.admin.from("intakes")
    .select("resume_path,cover_letter_path,source_scan_status,source_deleted_at")
    .eq("id", intakeId)
    .maybeSingle();
  if (!intake || intake.source_deleted_at) return NextResponse.json({ error: "Source document not found." }, { status: 404 });
  if (intake.source_scan_status !== "clean") {
    return NextResponse.json({ error: "Source retrieval is locked until the configured document safety checks pass." }, { status: 423 });
  }
  const path = kind.data === "resume" ? intake.resume_path : intake.cover_letter_path;
  if (!path) return NextResponse.json({ error: "Source document not found." }, { status: 404 });
  const { data, error } = await auth.admin.storage.from("customer-source-documents").createSignedUrl(path, 60, { download: true });
  if (error || !data.signedUrl) return NextResponse.json({ error: "A secure source link could not be created." }, { status: 502 });
  await auth.admin.from("audit_logs").insert({
    actor_id: auth.user.id, action: "source_document_downloaded", entity_type: "intake", entity_id: intakeId, details: { kind: kind.data },
  });
  const response = NextResponse.redirect(data.signedUrl, { status: 303 });
  response.headers.set("Cache-Control", "no-store, private");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

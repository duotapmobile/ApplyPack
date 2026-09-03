import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";

const kinds = new Set(["resume", "cover_letter"]);

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const itemId = (await context.params).id;
  const kind = new URL(request.url).searchParams.get("kind") || "";
  if (!kinds.has(kind)) return NextResponse.json({ error: "Choose a valid draft document." }, { status: 400 });
  const { data: item } = await auth.admin.from("apply_pack_items")
    .select("draft_resume_path,draft_cover_letter_path")
    .eq("id", itemId).maybeSingle();
  const path = kind === "resume" ? item?.draft_resume_path : item?.draft_cover_letter_path;
  if (!path) return NextResponse.json({ error: "This draft is not ready." }, { status: 404 });
  const { data, error } = await auth.admin.storage.from("operator-drafts")
    .createSignedUrl(path, 60, { download: true });
  if (error || !data.signedUrl) return NextResponse.json({ error: "A secure draft link could not be created." }, { status: 502 });
  await auth.admin.from("audit_logs").insert({
    actor_id: auth.user.id,
    action: "apply_pack_draft_downloaded",
    entity_type: "apply_pack_item",
    entity_id: itemId,
    details: { kind },
  });
  const response = NextResponse.redirect(data.signedUrl, { status: 303 });
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

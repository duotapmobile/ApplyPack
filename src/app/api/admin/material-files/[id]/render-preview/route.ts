import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";

export async function GET(_: Request, route: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const fileVersionId = z.uuid().safeParse((await route.params).id);
  if (!fileVersionId.success) return NextResponse.json({ error: "Render preview not found." }, { status: 404 });
  const { data: quality } = await auth.admin.from("ap_artifact_quality_reviews")
    .select("render_preview_bucket,render_preview_path,render_preview_sha256,renderer_identity,arial_resolved")
    .eq("file_version_id", fileVersionId.data).maybeSingle();
  if (!quality || quality.render_preview_bucket !== "operator-render-previews" || !quality.arial_resolved) {
    return NextResponse.json({ error: "Render preview not found." }, { status: 404 });
  }
  const signed = await auth.admin.storage.from("operator-render-previews")
    .createSignedUrl(quality.render_preview_path, 5 * 60, { download: false });
  if (signed.error || !signed.data.signedUrl) {
    return NextResponse.json({ error: "Render preview is temporarily unavailable." }, { status: 503 });
  }
  const response = NextResponse.redirect(signed.data.signedUrl, 303);
  response.headers.set("Cache-Control", "no-store, private");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

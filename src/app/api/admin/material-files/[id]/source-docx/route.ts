import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth/require-admin";
import { isCurrentDocumentGeneratorVersion } from "@/lib/documents/requirements";

export async function GET(_: Request, route: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const fileVersionId = z.uuid().safeParse((await route.params).id);
  if (!fileVersionId.success) return NextResponse.json({ error: "Editable source not found." }, { status: 404 });
  const { data: source } = await auth.admin.from("ap_artifact_source_docx")
    .select("storage_bucket,storage_path,safe_filename,checksum_sha256")
    .eq("file_version_id", fileVersionId.data).maybeSingle();
  if (!source || source.storage_bucket !== "operator-drafts") {
    return NextResponse.json({ error: "Editable source not found." }, { status: 404 });
  }
  const { data: file } = await auth.admin.from("ap_generated_file_versions")
    .select("artifact_id,version,superseded_at,downloads_revoked_at").eq("id", fileVersionId.data).maybeSingle();
  const { data: artifact } = file ? await auth.admin.from("ap_generated_artifacts")
    .select("generator_version,current_file_version").eq("id", file.artifact_id).maybeSingle() : { data: null };
  if (!file || file.superseded_at || file.downloads_revoked_at
    || !artifact || artifact.current_file_version !== file.version
    || !isCurrentDocumentGeneratorVersion(artifact.generator_version)) {
    return NextResponse.json({ error: "This editable source is stale and must be regenerated." }, { status: 409 });
  }
  const audit = await auth.admin.from("audit_logs").insert({
    actor_id: auth.user.id,
    action: "material_source_docx_download_authorized",
    entity_type: "generated_file_version",
    entity_id: fileVersionId.data,
  });
  if (audit.error) {
    return NextResponse.json({ error: "Editable source access could not be audited." }, { status: 503 });
  }
  const signed = await auth.admin.storage.from("operator-drafts")
    .createSignedUrl(source.storage_path, 5 * 60, { download: source.safe_filename });
  if (signed.error || !signed.data.signedUrl) {
    return NextResponse.json({ error: "Editable source is temporarily unavailable." }, { status: 503 });
  }
  const response = NextResponse.redirect(signed.data.signedUrl, 303);
  response.headers.set("Cache-Control", "no-store, private");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

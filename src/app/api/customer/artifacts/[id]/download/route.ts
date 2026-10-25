import { NextResponse } from "next/server";
import { z } from "zod";
import { isSupportedDocumentGeneratorVersion } from "@/lib/documents/requirements";
import { MATERIAL_DOWNLOAD_SECONDS } from "@/lib/materials/contract";
import { PRIVATE_ACCESS_EXPIRED_MESSAGE, privateDownloadSeconds, retentionErrorMessage } from "@/lib/materials/retention-access";
import { signedDownloadWithinDeadline } from "@/lib/materials/signed-download";
import { verifiedAuthenticationAt, isFreshAuthentication } from "@/lib/materials/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const identifier = z.uuid();

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const artifactId = identifier.safeParse((await context.params).id);
  const fileVersionId = identifier.safeParse(new URL(request.url).searchParams.get("fileVersionId"));
  if (!artifactId.success || !fileVersionId.success) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) {
    return NextResponse.json({ error: "Private delivery is not configured." }, { status: 503 });
  }
  const [{ data: authData }, { data: sessionData }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.auth.getSession(),
  ]);
  if (!authData.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const token = sessionData.session?.access_token;
  const verified = token ? await supabase.auth.getClaims(token).catch(() => null) : null;
  const issuedAt = verified && !verified.error ? verifiedAuthenticationAt(verified.data?.claims, authData.user.id) : null;
  if (!isFreshAuthentication(issuedAt)) {
    return NextResponse.json({
      error: "Sign in again before requesting a new 15-minute download.",
      reauthenticationRequired: true,
    }, { status: 401 });
  }
  const { data: authorization, error: authorizationError } = await admin.rpc("ap_authorize_material_download", {
    p_customer_id: authData.user.id,
    p_artifact_id: artifactId.data,
    p_file_version_id: fileVersionId.data,
    p_reauthenticated_at: issuedAt,
  });
  const file = authorization && typeof authorization === "object" && !Array.isArray(authorization)
    ? authorization as Record<string, unknown> : null;
  if (authorizationError || !file?.bucket || !file.path || !file.filename) {
    const retentionError = retentionErrorMessage(authorizationError);
    if (retentionError) return NextResponse.json({ error: retentionError }, { status: 410, headers: { "Cache-Control": "no-store, private" } });
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }
  const { data: artifact } = await admin.from("ap_generated_artifacts")
    .select("generator_version").eq("id", artifactId.data).maybeSingle();
  if (typeof file.expiresAt !== "string") return NextResponse.json({ error: "Private access could not be verified." }, { status: 503 });
  const downloadSeconds = privateDownloadSeconds(file.expiresAt, MATERIAL_DOWNLOAD_SECONDS);
  if (downloadSeconds < 1) {
    return NextResponse.json({ error: PRIVATE_ACCESS_EXPIRED_MESSAGE }, { status: 410, headers: { "Cache-Control": "no-store, private" } });
  }
  if (!artifact || !isSupportedDocumentGeneratorVersion(artifact.generator_version)) {
    return NextResponse.json({
      error: "This file was created under an unsupported document standard and is unavailable.",
    }, { status: 409 });
  }
  const signed = await admin.storage.from(String(file.bucket)).createSignedUrl(
    String(file.path),
    downloadSeconds,
    { download: String(file.filename) },
  );
  if (signed.error || !signed.data.signedUrl || !signedDownloadWithinDeadline({
    signedUrl: signed.data.signedUrl, supabaseOrigin: process.env.NEXT_PUBLIC_SUPABASE_URL,
    bucket: String(file.bucket), path: String(file.path), expiresAt: file.expiresAt,
  })) {
    return NextResponse.json({ error: "A secure download could not be created." }, { status: 502 });
  }
  const response = NextResponse.redirect(signed.data.signedUrl, { status: 303 });
  response.headers.set("Cache-Control", "no-store, private");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

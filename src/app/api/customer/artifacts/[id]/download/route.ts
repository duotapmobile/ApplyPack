import { NextResponse } from "next/server";
import { z } from "zod";
import { MATERIAL_DOWNLOAD_SECONDS } from "@/lib/materials/contract";
import { authenticationIssuedAt, isFreshAuthentication } from "@/lib/materials/server";
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
  const issuedAt = authenticationIssuedAt(sessionData.session?.access_token);
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
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }
  const signed = await admin.storage.from(String(file.bucket)).createSignedUrl(
    String(file.path),
    MATERIAL_DOWNLOAD_SECONDS,
    { download: String(file.filename) },
  );
  if (signed.error || !signed.data.signedUrl) {
    return NextResponse.json({ error: "A secure download could not be created." }, { status: 502 });
  }
  const response = NextResponse.redirect(signed.data.signedUrl, { status: 303 });
  response.headers.set("Cache-Control", "no-store, private");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

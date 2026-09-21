import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOriginRequest } from "@/lib/security/origin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const grantSchema = z.object({
  deliveredReleaseId: z.uuid(),
  jobSnapshotId: z.uuid(),
  attestation: z.string().trim().min(1).max(500),
  permissionConfirmed: z.literal(true),
}).strict();
const revokeSchema = z.object({ permissionId: z.uuid() }).strict();

function noStoreJson(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store, private");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

async function authorized(request: Request, opaqueId: string) {
  if (!isSameOriginRequest(request) || !z.uuid().safeParse(opaqueId).success) {
    return { response: noStoreJson({ error: "Reference not found." }, 404) };
  }
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) return { response: noStoreJson({ error: "Protected references are not configured." }, 503) };
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { response: noStoreJson({ error: "Authentication required." }, 401) };
  const rate = await consumeRateLimit({
    request,
    scope: "chunk5_reference_permission",
    identity: data.user.id,
    limit: 30,
    windowSeconds: 60 * 60,
  });
  if (!rate.configured) return { response: noStoreJson({ error: "Secure reference controls are unavailable." }, 503) };
  if (!rate.allowed) return { response: noStoreJson({ error: "Too many permission changes. Try again later." }, 429) };
  const { data: record } = await admin.from("ap_reference_records")
    .select("id,current_version").eq("opaque_client_id", opaqueId).eq("customer_id", data.user.id)
    .is("removed_at", null).maybeSingle();
  if (!record) return { response: noStoreJson({ error: "Reference not found." }, 404) };
  const { data: version } = await admin.from("ap_reference_record_versions")
    .select("id").eq("reference_record_id", record.id).eq("version", record.current_version)
    .is("superseded_at", null).eq("permission_status", "CONFIRMED").maybeSingle();
  if (!version) return { response: noStoreJson({ error: "Confirm the reference’s current contact permission first." }, 409) };
  return { admin, user: data.user, version };
}

export async function POST(request: Request, route: { params: Promise<{ opaqueId: string }> }) {
  const context = await authorized(request, (await route.params).opaqueId);
  if ("response" in context) return context.response;
  const parsed = grantSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Choose one delivered job and confirm the exact permission statement." }, 400);
  const { data: job, error: jobError } = await context.admin.from("ap_job_snapshots")
    .select("id,content_sha256,company,exact_title").eq("id", parsed.data.jobSnapshotId).maybeSingle();
  if (jobError || !job) return noStoreJson({ error: "Delivered job not found." }, 404);
  const exactAttestation = `I confirm that this person gave me permission to share their contact information for my application to ${job.exact_title} at ${job.company}.`;
  if (parsed.data.attestation !== exactAttestation) {
    return noStoreJson({ error: "The exact job-specific permission statement must be confirmed without changes." }, 400);
  }
  const granted = await context.admin.rpc("ap_grant_reference_permission", {
    p_customer_id: context.user.id,
    p_reference_version_id: context.version.id,
    p_delivered_release_id: parsed.data.deliveredReleaseId,
    p_job_snapshot_id: job.id,
    p_job_snapshot_hash: job.content_sha256,
    p_employer_snapshot: job.company,
    p_exact_position_snapshot: job.exact_title,
    p_permission_text_version: "chunk5-exact-job-reference-v1",
  });
  if (granted.error || typeof granted.data !== "string") {
    return noStoreJson({ error: "Permission could not be bound to that delivered job." }, 409);
  }
  return noStoreJson({
    permissionId: granted.data,
    employer: job.company,
    exactPosition: job.exact_title,
    attested: true,
  }, 201);
}

export async function DELETE(request: Request, route: { params: Promise<{ opaqueId: string }> }) {
  const context = await authorized(request, (await route.params).opaqueId);
  if ("response" in context) return context.response;
  const parsed = revokeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Permission not found." }, 404);
  const { data: permission } = await context.admin.from("ap_reference_permissions")
    .select("id").eq("id", parsed.data.permissionId).eq("customer_id", context.user.id)
    .eq("reference_record_version_id", context.version.id).is("revoked_at", null).maybeSingle();
  if (!permission) return noStoreJson({ error: "Permission not found." }, 404);
  const revoked = await context.admin.rpc("ap_revoke_reference_permission", {
    p_customer_id: context.user.id,
    p_permission_id: permission.id,
    p_reason_code: "CUSTOMER_REVOKED",
  });
  if (revoked.error || !revoked.data) return noStoreJson({ error: "Permission not found." }, 404);
  return noStoreJson({ revoked: true });
}

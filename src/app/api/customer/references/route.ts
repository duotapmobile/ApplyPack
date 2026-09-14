import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  readReferencePayload,
  referencePayloadSchema,
  storeReferencePayload,
  type StoredReferenceEnvelope,
} from "@/lib/materials/references";
import { isSameOriginRequest } from "@/lib/security/origin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const createSchema = z.object({
  reference: referencePayloadSchema,
  permissionContactConfirmed: z.literal(true),
}).strict();

function noStoreJson(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store, private");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

async function authenticated() {
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) return null;
  const { data } = await supabase.auth.getUser();
  return data.user ? { user: data.user, admin } : null;
}

export async function GET() {
  const auth = await authenticated();
  if (!auth) return noStoreJson({ error: "Authentication required." }, 401);
  const { data: records, error: recordsError } = await auth.admin.from("ap_reference_records")
    .select("id,opaque_client_id,current_version,created_at")
    .eq("customer_id", auth.user.id).is("removed_at", null).order("created_at");
  if (recordsError) return noStoreJson({ error: "References could not be loaded." }, 502);
  if (!records?.length) return noStoreJson({ references: [] });
  const recordIds = records.map((record) => record.id);
  const { data: versions, error: versionsError } = await auth.admin.from("ap_reference_record_versions")
    .select("id,reference_record_id,version,encrypted_payload_id,permission_status,permission_last_confirmed_at")
    .in("reference_record_id", recordIds).is("superseded_at", null);
  if (versionsError || !versions) return noStoreJson({ error: "References could not be loaded." }, 502);
  const currentVersions = versions.filter((version) =>
    records.some((record) => record.id === version.reference_record_id && record.current_version === version.version));
  const payloadIds = currentVersions.map((version) => version.encrypted_payload_id);
  const versionIds = currentVersions.map((version) => version.id);
  const [{ data: payloads, error: payloadsError }, { data: permissions, error: permissionsError }] = await Promise.all([
    auth.admin.from("ap_sensitive_payloads")
      .select("id,ciphertext,encryption_algorithm,encrypted_data_key,nonce,authentication_tag,content_sha256,kms_key_identity,kms_key_version,encryption_context_hash")
      .eq("customer_id", auth.user.id).in("id", payloadIds),
    auth.admin.from("ap_reference_permissions")
      .select("id,reference_record_version_id,job_snapshot_id,employer_snapshot,exact_position_snapshot,attested_at,revoked_at,contact_version_changed_at")
      .eq("customer_id", auth.user.id).in("reference_record_version_id", versionIds),
  ]);
  if (payloadsError || permissionsError || !payloads || !permissions) {
    return noStoreJson({ error: "References could not be loaded." }, 502);
  }
  try {
    const result = [];
    for (const record of records) {
      const version = currentVersions.find((candidate) => candidate.reference_record_id === record.id);
      const envelope = payloads.find((candidate) => candidate.id === version?.encrypted_payload_id);
      if (!version || !envelope) throw new Error("reference_envelope_missing");
      const reference = await readReferencePayload({
        customerId: auth.user.id,
        payloadId: version.encrypted_payload_id,
        envelope: envelope as StoredReferenceEnvelope,
      });
      result.push({
        opaqueId: record.opaque_client_id,
        reference,
        permissionStatus: version.permission_status,
        permissionLastConfirmedAt: version.permission_last_confirmed_at,
        allowedApplications: permissions.filter((permission) =>
          permission.reference_record_version_id === version.id
          && !permission.revoked_at && !permission.contact_version_changed_at)
          .map((permission) => ({
            permissionId: permission.id,
            jobSnapshotId: permission.job_snapshot_id,
            employer: permission.employer_snapshot,
            exactPosition: permission.exact_position_snapshot,
            attestedAt: permission.attested_at,
          })),
      });
    }
    return noStoreJson({ references: result });
  } catch {
    return noStoreJson({ error: "Protected reference details are unavailable." }, 503);
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return noStoreJson({ error: "This request was rejected." }, 403);
  const auth = await authenticated();
  if (!auth) return noStoreJson({ error: "Authentication required." }, 401);
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Complete every reference field and confirm current permission." }, 400);
  const rate = await consumeRateLimit({
    request,
    scope: "chunk5_reference_write",
    identity: auth.user.id,
    limit: 20,
    windowSeconds: 60 * 60,
  });
  if (!rate.configured) return noStoreJson({ error: "Secure reference controls are unavailable." }, 503);
  if (!rate.allowed) return noStoreJson({ error: "Too many reference changes. Try again later." }, 429);
  const payloadId = randomUUID();
  try {
    const stored = await storeReferencePayload({
      admin: auth.admin,
      customerId: auth.user.id,
      payloadId,
      payload: parsed.data.reference,
    });
    const { data: recordId, error: createError } = await auth.admin.rpc("ap_create_reference_record", {
      p_customer_id: auth.user.id,
      p_encrypted_payload_id: payloadId,
      p_payload_schema_version: "chunk5-reference-record-v1",
      p_payload_sha256: stored.payloadSha256,
    });
    if (createError || typeof recordId !== "string") throw createError || new Error("reference_create_failed");
    const { data: record, error: recordError } = await auth.admin.from("ap_reference_records")
      .select("opaque_client_id,current_version").eq("id", recordId).eq("customer_id", auth.user.id).maybeSingle();
    const { data: version, error: versionError } = await auth.admin.from("ap_reference_record_versions")
      .select("id").eq("reference_record_id", recordId).eq("version", record?.current_version || 1).maybeSingle();
    if (recordError || versionError || !record || !version) throw recordError || versionError || new Error("reference_version_missing");
    const confirmed = await auth.admin.rpc("ap_confirm_reference_version", {
      p_customer_id: auth.user.id,
      p_reference_version_id: version.id,
    });
    if (confirmed.error || !confirmed.data) throw confirmed.error || new Error("reference_confirmation_failed");
    return noStoreJson({ opaqueId: record.opaque_client_id, permissionStatus: "CONFIRMED" }, 201);
  } catch {
    return noStoreJson({ error: "The protected reference could not be saved." }, 503);
  }
}

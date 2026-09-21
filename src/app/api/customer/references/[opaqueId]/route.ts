import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { referencePayloadSchema, storeReferencePayload } from "@/lib/materials/references";
import { isSameOriginRequest } from "@/lib/security/origin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const identifier = z.uuid();
const updateSchema = z.object({
  reference: referencePayloadSchema,
  permissionContactConfirmed: z.literal(true),
}).strict();

function noStoreJson(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store, private");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

async function contextFor(request: Request, opaqueId: string) {
  if (!isSameOriginRequest(request)) return { response: noStoreJson({ error: "This request was rejected." }, 403) };
  const parsedId = identifier.safeParse(opaqueId);
  if (!parsedId.success) return { response: noStoreJson({ error: "Reference not found." }, 404) };
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) return { response: noStoreJson({ error: "Protected references are not configured." }, 503) };
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { response: noStoreJson({ error: "Authentication required." }, 401) };
  const rate = await consumeRateLimit({
    request,
    scope: "chunk5_reference_write",
    identity: data.user.id,
    limit: 20,
    windowSeconds: 60 * 60,
  });
  if (!rate.configured) return { response: noStoreJson({ error: "Secure reference controls are unavailable." }, 503) };
  if (!rate.allowed) return { response: noStoreJson({ error: "Too many reference changes. Try again later." }, 429) };
  const { data: record, error } = await admin.from("ap_reference_records")
    .select("id,current_version").eq("opaque_client_id", parsedId.data)
    .eq("customer_id", data.user.id).is("removed_at", null).maybeSingle();
  if (error || !record) return { response: noStoreJson({ error: "Reference not found." }, 404) };
  return { admin, user: data.user, record };
}

export async function PATCH(request: Request, route: { params: Promise<{ opaqueId: string }> }) {
  const resolved = await contextFor(request, (await route.params).opaqueId);
  if ("response" in resolved) return resolved.response;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "Complete every reference field and confirm current permission." }, 400);
  const payloadId = randomUUID();
  try {
    const stored = await storeReferencePayload({
      admin: resolved.admin,
      customerId: resolved.user.id,
      payloadId,
      payload: parsed.data.reference,
    });
    const replaced = await resolved.admin.rpc("ap_replace_reference", {
      p_customer_id: resolved.user.id,
      p_reference_record_id: resolved.record.id,
      p_encrypted_payload_id: payloadId,
      p_payload_schema_version: "chunk5-reference-record-v1",
      p_payload_sha256: stored.payloadSha256,
    });
    if (replaced.error || typeof replaced.data !== "string") throw replaced.error || new Error("reference_replace_failed");
    const confirmed = await resolved.admin.rpc("ap_confirm_reference_version", {
      p_customer_id: resolved.user.id,
      p_reference_version_id: replaced.data,
    });
    if (confirmed.error || !confirmed.data) throw confirmed.error || new Error("reference_confirmation_failed");
    return noStoreJson({ updated: true, permissionStatus: "CONFIRMED" });
  } catch {
    return noStoreJson({ error: "The protected reference could not be updated." }, 503);
  }
}

export async function DELETE(request: Request, route: { params: Promise<{ opaqueId: string }> }) {
  const resolved = await contextFor(request, (await route.params).opaqueId);
  if ("response" in resolved) return resolved.response;
  const removed = await resolved.admin.rpc("ap_remove_reference", {
    p_customer_id: resolved.user.id,
    p_reference_record_id: resolved.record.id,
    p_reason_code: "CUSTOMER_REMOVED",
  });
  if (removed.error || !removed.data) return noStoreJson({ error: "Reference not found." }, 404);
  return noStoreJson({ removed: true });
}

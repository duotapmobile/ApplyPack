import { NextResponse } from "next/server";
import { z } from "zod";
import { deterministicUuid } from "@/lib/commerce/server";
import { canonicalSha256 } from "@/lib/domain/foundation";
import { isSameOriginRequest } from "@/lib/security/origin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const actionSchema = z.object({
  action: z.enum(["accept", "decline"]),
}).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "This request was rejected." }, { status: 403 });
  }
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid adjustment response." }, { status: 400 });

  const amendmentId = (await context.params).id;
  if (!z.string().uuid().safeParse(amendmentId).success) {
    return NextResponse.json({ error: "Adjustment not found." }, { status: 404 });
  }
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) return NextResponse.json({ error: "Account storage is not configured." }, { status: 503 });
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const rate = await consumeRateLimit({
    request,
    scope: "search_adjustment_decision",
    identity: authData.user.id,
    limit: 12,
    windowSeconds: 60 * 60,
  });
  if (!rate.allowed) return NextResponse.json({ error: "Too many responses. Try again later." }, { status: 429 });

  const { data: amendment, error: amendmentError } = await admin
    .from("ap_criteria_amendments")
    .select("id,search_service_id,parent_snapshot_id,state,proposed_snapshot_patch")
    .eq("id", amendmentId)
    .maybeSingle();
  if (amendmentError || !amendment) return NextResponse.json({ error: "Adjustment not found." }, { status: 404 });
  const { data: service } = await admin
    .from("ap_search_services")
    .select("customer_id")
    .eq("id", amendment.search_service_id)
    .maybeSingle();
  if (!service || service.customer_id !== authData.user.id) {
    return NextResponse.json({ error: "Adjustment not found." }, { status: 404 });
  }

  const stableKey = canonicalSha256({
    action: parsed.data.action,
    amendmentId,
    customerId: authData.user.id,
    version: "chunk4-adjustment-v1",
  });
  if (parsed.data.action === "decline") {
    const { data, error } = await admin.rpc("ap_decline_search_adjustment", {
      p_amendment_id: amendmentId,
      p_customer_id: authData.user.id,
      p_idempotency_key: `adjustment-decline:${stableKey}`,
      p_reason: "CUSTOMER_DECLINED",
    });
    if (error) return NextResponse.json({ error: "The refund response could not be recorded. Nothing was released." }, { status: 409 });
    return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
  }

  const { data: parent } = await admin
    .from("ap_intake_snapshots")
    .select("content_sha256,canonicalization_version,schema_version")
    .eq("id", amendment.parent_snapshot_id)
    .maybeSingle();
  if (!parent) return NextResponse.json({ error: "The bound criteria snapshot is unavailable." }, { status: 409 });
  const childSnapshotId = deterministicUuid(`adjustment-snapshot:${stableKey}`);
  const childContentSha256 = canonicalSha256({
    amendmentId,
    canonicalizationVersion: parent.canonicalization_version,
    parentContentSha256: parent.content_sha256,
    patch: amendment.proposed_snapshot_patch,
    schemaVersion: parent.schema_version,
    version: "chunk4-adjustment-v1",
  });
  const { data, error } = await admin.rpc("ap_accept_search_adjustment", {
    p_amendment_id: amendmentId,
    p_customer_id: authData.user.id,
    p_child_snapshot_id: childSnapshotId,
    p_child_content_sha256: childContentSha256,
    p_acceptance_idempotency_key: `adjustment-accept:${stableKey}`,
    p_capacity_request_key: `adjustment-capacity:${stableKey}`,
    p_outbox_id: deterministicUuid(`adjustment-outbox:${stableKey}`),
  });
  if (error) {
    return NextResponse.json({ error: "The revised search could not be started. No release was committed." }, { status: 409 });
  }
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}

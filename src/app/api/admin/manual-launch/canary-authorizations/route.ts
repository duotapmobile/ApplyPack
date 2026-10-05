import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { safeReleaseSha } from "@/lib/operations/summary";
import { isSameOriginRequest } from "@/lib/security/origin";

const schema = z.object({
  productKind: z.enum(["SEARCH", "MATERIALS"]),
  expectedCustomerId: z.uuid(),
  searchDraftId: z.uuid().nullable().optional(),
  evidenceReference: z.string().trim().min(12).max(500),
  expiresAt: z.iso.datetime(),
}).strict().superRefine((value, context) => {
  if ((value.productKind === "SEARCH") !== Boolean(value.searchDraftId)) {
    context.addIssue({
      code: "custom",
      message: "A search canary requires its exact intake draft; a materials canary must not include one.",
    });
  }
});

const headers = { "cache-control": "no-store, private" };

const revocationSchema = z.object({
  authorizationId: z.uuid(),
  evidenceReference: z.string().trim().min(12).max(500),
}).strict();

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "The canary authorization request was rejected." }, { status: 403, headers });
  }
  const access = await requireAdmin();
  if (!access.ok) return access.response;
  if (access.role !== "admin") {
    return NextResponse.json({ error: "An administrator must authorize the canary checkout." }, { status: 403, headers });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "An exact customer, product, expiry, and evidence reference are required." }, { status: 400, headers });
  }
  const releaseSha = safeReleaseSha();
  if (!/^[a-f0-9]{40}$/.test(releaseSha)) {
    return NextResponse.json({ error: "The exact deployed release SHA is unavailable." }, { status: 503, headers });
  }
  const result = await access.admin.rpc("ap_authorize_manual_launch_canary_checkout", {
    p_release_sha: releaseSha,
    p_product_kind: parsed.data.productKind,
    p_expected_customer_id: parsed.data.expectedCustomerId,
    p_search_draft_id: parsed.data.searchDraftId || null,
    p_actor_id: access.user.id,
    p_evidence_reference: parsed.data.evidenceReference,
    p_expires_at: parsed.data.expiresAt,
  });
  if (result.error || !result.data) {
    return NextResponse.json({ error: "The exact customer is not eligible for a canary checkout." }, { status: 409, headers });
  }
  return NextResponse.json({
    ok: true,
    authorizationId: result.data,
    productKind: parsed.data.productKind,
    releaseSha,
    expiresAt: parsed.data.expiresAt,
  }, { status: 201, headers });
}

export async function PATCH(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "The canary revocation request was rejected." }, { status: 403, headers });
  }
  const access = await requireAdmin();
  if (!access.ok) return access.response;
  if (access.role !== "admin") {
    return NextResponse.json({ error: "An administrator must revoke the canary checkout." }, { status: 403, headers });
  }
  const parsed = revocationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "The exact authorization and revocation evidence are required." }, { status: 400, headers });
  }
  const releaseSha = safeReleaseSha();
  if (!/^[a-f0-9]{40}$/.test(releaseSha)) {
    return NextResponse.json({ error: "The exact deployed release SHA is unavailable." }, { status: 503, headers });
  }
  const result = await access.admin.rpc("ap_revoke_manual_launch_canary_checkout", {
    p_authorization_id: parsed.data.authorizationId,
    p_release_sha: releaseSha,
    p_actor_id: access.user.id,
    p_evidence_reference: parsed.data.evidenceReference,
  });
  if (result.error || result.data !== true) {
    return NextResponse.json({ error: "The canary authorization could not be revoked." }, { status: 409, headers });
  }
  return NextResponse.json({ ok: true, authorizationId: parsed.data.authorizationId, releaseSha }, { headers });
}

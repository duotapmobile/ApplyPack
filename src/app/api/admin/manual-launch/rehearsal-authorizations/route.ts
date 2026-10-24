import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { selectedJobResourceSha256 } from "@/lib/commerce/checkout-authorization";
import { reconcileCheckoutInitiations } from "@/lib/commerce/checkout-initiation";
import { isSameOriginRequest } from "@/lib/security/origin";
import { checkoutConfiguration } from "@/lib/stripe/mode";

const headers = { "cache-control": "no-store, private" };
const schema = z.object({
  productKind: z.enum(["SEARCH", "MATERIALS"]),
  customerId: z.uuid(),
  resourceId: z.uuid(),
  selectedJobIds: z.array(z.uuid()).min(1).max(2).optional(),
  expiresAt: z.iso.datetime(),
  evidenceReference: z.string().trim().min(12).max(500),
}).strict().superRefine((value, context) => {
  if ((value.productKind === "MATERIALS") !== Boolean(value.selectedJobIds)
    || (value.selectedJobIds && new Set(value.selectedJobIds).size !== value.selectedJobIds.length)) {
    context.addIssue({ code: "custom", message: "Materials require the exact distinct selected jobs." });
  }
});
const revocationSchema = z.object({
  authorizationId: z.uuid(), evidenceReference: z.string().trim().min(12).max(500),
}).strict();

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "The rehearsal request was rejected." }, { status: 403, headers });
  const access = await requireAdmin();
  if (!access.ok) return access.response;
  if (access.role !== "admin") return NextResponse.json({ error: "Administrator authorization is required." }, { status: 403, headers });
  const configuration = checkoutConfiguration();
  if (!["LOCKED_STAGING", "STAGING_REHEARSAL"].includes(configuration.state)) {
    return NextResponse.json({ error: "Rehearsal authorization requires the approved staging identity and test credentials." }, { status: 503, headers });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  const expiresAt = parsed.success ? Date.parse(parsed.data.expiresAt) : NaN;
  if (!parsed.success || expiresAt <= Date.now() || expiresAt > Date.now() + 30 * 60_000) {
    return NextResponse.json({ error: "An exact customer, product, resource, and expiry within 30 minutes are required." }, { status: 400, headers });
  }
  const input = parsed.data;
  const releaseSha = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.APP_RELEASE_SHA!;
  const result = await access.admin.rpc("ap_authorize_staging_rehearsal_checkout", {
    p_release_sha: releaseSha, p_product_kind: input.productKind, p_customer_id: input.customerId,
    p_resource_id: input.resourceId,
    p_resource_sha256: input.selectedJobIds ? selectedJobResourceSha256(input.selectedJobIds) : null,
    p_actor_id: access.user.id, p_evidence_reference: input.evidenceReference, p_expires_at: input.expiresAt,
  });
  if (result.error || !result.data) return NextResponse.json({ error: "The exact rehearsal could not be authorized." }, { status: 409, headers });
  return NextResponse.json({ authorizationId: result.data, releaseSha, expiresAt: input.expiresAt }, { status: 201, headers });
}

export async function PATCH(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "The rehearsal revocation was rejected." }, { status: 403, headers });
  const access = await requireAdmin();
  if (!access.ok) return access.response;
  if (access.role !== "admin") return NextResponse.json({ error: "Administrator authorization is required." }, { status: 403, headers });
  const parsed = revocationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "An authorization and evidence reference are required." }, { status: 400, headers });
  const result = await access.admin.rpc("ap_revoke_staging_rehearsal_checkout", {
    p_authorization_id: parsed.data.authorizationId, p_actor_id: access.user.id,
    p_evidence_reference: parsed.data.evidenceReference,
  });
  if (result.error || !result.data) return NextResponse.json({ error: "Rehearsal revocation could not be recorded." }, { status: 409, headers });
  const reconciliation = await reconcileCheckoutInitiations(access.admin, 10, parsed.data.authorizationId)
    .catch(() => ({ processed: 0, unresolved: 1 }));
  return NextResponse.json({ ok: true, reconciliationPending: reconciliation.unresolved > 0 }, { headers });
}

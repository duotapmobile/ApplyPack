import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { safeReleaseSha } from "@/lib/operations/summary";
import { isSameOriginRequest } from "@/lib/security/origin";

const schema = z.object({
  paymentAttemptId: z.uuid(),
  expectedCustomerId: z.uuid(),
  productKind: z.enum(["SEARCH", "MATERIALS"]),
  evidenceReference: z.string().trim().min(12).max(500),
}).strict();

const headers = { "cache-control": "no-store, private" };

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "The canary designation request was rejected." }, { status: 403, headers });
  }
  const access = await requireAdmin();
  if (!access.ok) return access.response;
  if (access.role !== "admin") {
    return NextResponse.json({ error: "An administrator must authorize the canary payment." }, { status: 403, headers });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "A pre-charge payment, expected customer, product, and evidence reference are required." }, { status: 400, headers });
  }
  const releaseSha = safeReleaseSha();
  if (!/^[a-f0-9]{40}$/.test(releaseSha)) {
    return NextResponse.json({ error: "The exact deployed release SHA is unavailable." }, { status: 503, headers });
  }
  const result = await access.admin.rpc("ap_designate_manual_launch_canary_payment", {
    p_payment_attempt_id: parsed.data.paymentAttemptId,
    p_expected_customer_id: parsed.data.expectedCustomerId,
    p_product_kind: parsed.data.productKind,
    p_release_sha: releaseSha,
    p_actor_id: access.user.id,
    p_evidence_reference: parsed.data.evidenceReference,
  });
  if (result.error || !result.data) {
    return NextResponse.json({ error: "This unpaid payment cannot be designated as the release canary." }, { status: 409, headers });
  }
  return NextResponse.json({
    ok: true,
    designationId: result.data,
    productKind: parsed.data.productKind,
    releaseSha,
  }, { status: 201, headers });
}

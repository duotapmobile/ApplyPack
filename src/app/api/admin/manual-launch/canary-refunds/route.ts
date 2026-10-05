import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { safeReleaseSha } from "@/lib/operations/summary";
import { isSameOriginRequest } from "@/lib/security/origin";

const schema = z.object({
  paymentAttemptId: z.uuid(),
  evidenceReference: z.string().trim().min(12).max(500),
}).strict();

const headers = { "cache-control": "no-store, private" };

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "The canary refund request was rejected." }, { status: 403, headers });
  }
  const access = await requireAdmin();
  if (!access.ok) return access.response;
  if (access.role !== "admin") {
    return NextResponse.json({ error: "An administrator must authorize the canary refund." }, { status: 403, headers });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "A delivered payment and canary evidence reference are required." }, { status: 400, headers });
  }
  const releaseSha = safeReleaseSha();
  if (!/^[a-f0-9]{40}$/.test(releaseSha)) {
    return NextResponse.json({ error: "The exact deployed release SHA is unavailable." }, { status: 503, headers });
  }
  const result = await access.admin.rpc("ap_queue_manual_launch_canary_refund", {
    p_payment_attempt_id: parsed.data.paymentAttemptId,
    p_actor_id: access.user.id,
    p_evidence_reference: parsed.data.evidenceReference,
    p_release_sha: releaseSha,
  });
  if (result.error || !result.data) {
    return NextResponse.json({ error: "This payment is not eligible for the manual-launch canary refund." }, { status: 409, headers });
  }
  const durable = await access.admin.from("ap_refund_operations")
    .select("state").eq("id", result.data).maybeSingle();
  if (durable.error || !durable.data) {
    return NextResponse.json({ error: "The canary refund state could not be reconciled." }, { status: 503, headers });
  }
  return NextResponse.json({ ok: true, refundOperationId: result.data, state: durable.data.state }, {
    status: durable.data.state === "PENDING" ? 202 : 200,
    headers,
  });
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { safeReleaseSha } from "@/lib/operations/summary";
import { isSameOriginRequest } from "@/lib/security/origin";
import { createStripeOperationalClient } from "@/lib/stripe/server";

const schema = z.object({
  designationId: z.uuid(),
  evidenceReference: z.string().trim().min(12).max(500),
}).strict();

const headers = { "cache-control": "no-store, private" };

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "The canary retry request was rejected." }, { status: 403, headers });
  }
  const access = await requireAdmin();
  if (!access.ok) return access.response;
  if (access.role !== "admin") {
    return NextResponse.json({ error: "An administrator must authorize a canary retry." }, { status: 403, headers });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "The exact failed designation and retry evidence are required." }, { status: 400, headers });
  }
  const releaseSha = safeReleaseSha();
  if (!/^[a-f0-9]{40}$/.test(releaseSha)) {
    return NextResponse.json({ error: "The exact deployed release SHA is unavailable." }, { status: 503, headers });
  }
  const designationResult = await access.admin.from("ap_manual_launch_canary_designations")
    .select("payment_attempt_id,product_kind,superseded_at")
    .eq("id", parsed.data.designationId)
    .eq("release_sha", releaseSha)
    .maybeSingle();
  const designation = designationResult.data;
  if (designationResult.error || !designation || designation.superseded_at) {
    return NextResponse.json({ error: "The active failed canary designation is unavailable." }, { status: 409, headers });
  }
  const paymentResult = await access.admin.from("ap_payment_attempts")
    .select("checkout_attempt_id,provider_checkout_session_id")
    .eq("id", designation.payment_attempt_id)
    .maybeSingle();
  if (paymentResult.error || !paymentResult.data) {
    return NextResponse.json({ error: "The failed canary payment record is unavailable." }, { status: 409, headers });
  }
  let providerSessionId = paymentResult.data.provider_checkout_session_id;
  if (designation.product_kind === "SEARCH") {
    if (!paymentResult.data.checkout_attempt_id) {
      return NextResponse.json({ error: "The failed search checkout record is unavailable." }, { status: 409, headers });
    }
    const checkoutResult = await access.admin.from("ap_checkout_attempts")
      .select("provider_checkout_session_id")
      .eq("id", paymentResult.data.checkout_attempt_id)
      .maybeSingle();
    if (checkoutResult.error || !checkoutResult.data) {
      return NextResponse.json({ error: "The failed search checkout record is unavailable." }, { status: 409, headers });
    }
    providerSessionId = checkoutResult.data.provider_checkout_session_id;
  } else {
    const checkoutResult = await access.admin.from("ap_material_checkout_intents")
      .select("provider_checkout_session_id")
      .eq("payment_attempt_id", designation.payment_attempt_id)
      .maybeSingle();
    if (checkoutResult.error || !checkoutResult.data) {
      return NextResponse.json({ error: "The failed materials checkout record is unavailable." }, { status: 409, headers });
    }
    providerSessionId = checkoutResult.data.provider_checkout_session_id;
  }

  if (providerSessionId) {
    const stripe = createStripeOperationalClient();
    if (!stripe) {
      return NextResponse.json({ error: "Stripe reconciliation is unavailable; the canary remains locked." }, { status: 503, headers });
    }
    try {
      let session = await stripe.checkout.sessions.retrieve(providerSessionId);
      if (session.status === "open") {
        session = await stripe.checkout.sessions.expire(session.id);
      }
      if (session.status !== "expired" || session.payment_status !== "unpaid") {
        return NextResponse.json({
          error: "The Stripe Checkout Session is not proven expired and uncharged; the canary remains locked.",
        }, { status: 409, headers });
      }
      const reconciled = await access.admin.rpc("ap_reconcile_manual_launch_canary_provider_terminal", {
        p_designation_id: parsed.data.designationId,
        p_release_sha: releaseSha,
        p_actor_id: access.user.id,
        p_provider_session_id: session.id,
        p_provider_session_status: session.status,
        p_provider_payment_status: session.payment_status,
        p_evidence_reference: parsed.data.evidenceReference,
      });
      if (reconciled.error || reconciled.data !== true) {
        return NextResponse.json({ error: "Stripe is terminal, but local reconciliation did not complete." }, { status: 409, headers });
      }
    } catch {
      return NextResponse.json({
        error: "Stripe terminal status could not be verified; the canary remains locked.",
      }, { status: 502, headers });
    }
  }
  const result = await access.admin.rpc("ap_supersede_manual_launch_canary_designation", {
    p_designation_id: parsed.data.designationId,
    p_release_sha: releaseSha,
    p_actor_id: access.user.id,
    p_evidence_reference: parsed.data.evidenceReference,
  });
  if (result.error || result.data !== true) {
    return NextResponse.json({ error: "Only a reconciled, terminal, uncharged canary attempt can be retried." }, { status: 409, headers });
  }
  return NextResponse.json({ ok: true, designationId: parsed.data.designationId, releaseSha }, { headers });
}

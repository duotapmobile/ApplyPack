import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { reconcileCheckoutInitiations } from "@/lib/commerce/checkout-initiation";
import { isSameOriginRequest } from "@/lib/security/origin";
import { checkoutConfiguration } from "@/lib/stripe/mode";

const schema = z.object({
  mode: z.enum(["LOCKED", "PUBLIC", "CANARY", "REHEARSAL"]),
  evidenceReference: z.string().trim().min(12).max(500),
}).strict();
const headers = { "cache-control": "no-store, private" };

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "The mode change was rejected." }, { status: 403, headers });
  const access = await requireAdmin();
  if (!access.ok) return access.response;
  if (access.role !== "admin") return NextResponse.json({ error: "Administrator authorization is required." }, { status: 403, headers });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "An exact mode and evidence reference are required." }, { status: 400, headers });
  const configuration = checkoutConfiguration();
  if (parsed.data.mode === "CANARY" && configuration.state !== "STAGING_CANARY") {
    return NextResponse.json({ error: "Canary checkout is restricted to the configured sandbox." }, { status: 409, headers });
  }
  const expected = configuration.acceptingOrders ? "PUBLIC" : configuration.restrictedMode;
  if (parsed.data.mode !== "LOCKED" && (!configuration.validState || parsed.data.mode !== expected)) {
    return NextResponse.json({ error: "The deployed environment must agree with the requested checkout mode." }, { status: 409, headers });
  }
  const result = await access.admin.rpc("ap_set_checkout_mode", {
    p_mode: parsed.data.mode,
    p_release_sha: process.env.RAILWAY_GIT_COMMIT_SHA || process.env.APP_RELEASE_SHA || null,
    p_actor_id: access.user.id, p_evidence_reference: parsed.data.evidenceReference,
  });
  if (result.error || result.data === null) return NextResponse.json({ error: "The mode transition remains blocked. Lock and reconcile outstanding attempts first." }, { status: 409, headers });
  const reconciliation = parsed.data.mode === "LOCKED"
    ? await reconcileCheckoutInitiations(access.admin).catch(() => ({ processed: 0, unresolved: 1 })) : null;
  return NextResponse.json({ mode: parsed.data.mode, generation: result.data, reconciliation }, { headers });
}

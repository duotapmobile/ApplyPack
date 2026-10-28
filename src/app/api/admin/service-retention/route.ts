import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { adminRetentionStatusSchema, retentionHoldRequestSchema } from "@/lib/materials/retention-admin";
import { isSameOriginRequest } from "@/lib/security/origin";

const headers = { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" };
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

export async function GET() {
  const access = await requireAdmin();
  if (!access.ok) return access.response;
  const result = await access.admin.rpc("ap_admin_service_retention_status", { p_limit: 100 });
  const parsed = adminRetentionStatusSchema.safeParse(result.data);
  if (result.error || !parsed.success) return response({ error: "Retention status could not be verified. No cleanup action is available." }, 503);
  return response(parsed.data);
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return response({ error: "The hold change was rejected." }, 403);
  const access = await requireAdmin();
  if (!access.ok) return access.response;
  if (access.role !== "admin") return response({ error: "Administrator authorization is required to change a retention hold." }, 403);
  const parsed = retentionHoldRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return response({ error: "Select an order and reason, and confirm that you reviewed its current obligations." }, 400);
  const result = await access.admin.rpc("ap_set_service_retention_hold", {
    p_order_id: parsed.data.orderId, p_actor_id: access.user.id, p_reason_code: parsed.data.reasonCode,
    p_hold_id: parsed.data.holdId, p_release: parsed.data.release,
  });
  if (result.error || typeof result.data !== "string") return response({ error: "The hold change could not be confirmed. Refresh the status before retrying; completed cleanup cannot be reversed." }, 409);
  return response({ ok: true, holdId: result.data });
}

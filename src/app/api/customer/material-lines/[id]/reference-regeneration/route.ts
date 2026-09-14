import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isSameOriginRequest } from "@/lib/security/origin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({
  priorArtifactId: z.uuid(),
  permissionIds: z.array(z.uuid()).min(1).max(3),
  idempotencyKey: z.uuid(),
}).strict().superRefine((value, context) => {
  if (new Set(value.permissionIds).size !== value.permissionIds.length) {
    context.addIssue({ code: "custom", message: "Duplicate permissions are not allowed." });
  }
});

function response(body: unknown, status = 200) {
  const result = NextResponse.json(body, { status });
  result.headers.set("Cache-Control", "no-store, private");
  result.headers.set("Referrer-Policy", "no-referrer");
  return result;
}

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return response({ error: "This request was rejected." }, 403);
  const lineId = z.uuid().safeParse((await route.params).id);
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!lineId.success || !input.success) return response({ error: "Choose one to three current exact-job reference permissions." }, 400);
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) return response({ error: "Reference regeneration is not configured." }, 503);
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return response({ error: "Authentication required." }, 401);
  const rate = await consumeRateLimit({
    request,
    scope: "chunk5_reference_regeneration",
    identity: authData.user.id,
    limit: 10,
    windowSeconds: 60 * 60,
  });
  if (!rate.configured) return response({ error: "Secure regeneration controls are unavailable." }, 503);
  if (!rate.allowed) return response({ error: "Too many regeneration attempts. Try again later." }, 429);
  const { data: line } = await admin.from("ap_material_lines")
    .select("id,purchase_id,fulfillment").eq("id", lineId.data).maybeSingle();
  const { data: purchase } = line ? await admin.from("ap_material_purchases")
    .select("customer_id").eq("id", line.purchase_id).maybeSingle() : { data: null };
  if (!line || purchase?.customer_id !== authData.user.id) return response({ error: "Materials line not found." }, 404);
  const requestKey = `${authData.user.id}:${line.id}:${input.data.priorArtifactId}:${input.data.idempotencyKey}`;
  const regeneration = await admin.rpc("ap_request_reference_regeneration", {
    p_customer_id: authData.user.id,
    p_material_line_id: line.id,
    p_prior_artifact_id: input.data.priorArtifactId,
    p_permission_ids: input.data.permissionIds,
    p_request_key: requestKey,
    p_outbox_id: randomUUID(),
  });
  if (regeneration.error) {
    return response({ error: "A replacement reference sheet could not start. Confirm permissions and current capacity, then try again." }, 409);
  }
  return response({ regeneration: regeneration.data }, 202);
}

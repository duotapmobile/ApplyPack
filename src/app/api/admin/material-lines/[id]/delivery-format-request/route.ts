import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth/require-admin";
import { isSameOriginRequest } from "@/lib/security/origin";

const schema = z.object({
  deliveryFormat: z.literal("DOCX"),
  requestReference: z.string().trim().min(6).max(200)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/, "Use a non-sensitive support or intake reference."),
}).strict();

function response(body: unknown, status = 200) {
  const result = NextResponse.json(body, { status });
  result.headers.set("Cache-Control", "no-store, private");
  result.headers.set("Referrer-Policy", "no-referrer");
  return result;
}

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return response({ error: "This format request was rejected." }, 403);
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const materialLineId = z.uuid().safeParse((await route.params).id);
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!materialLineId.success || !input.success) {
    return response({ error: "A valid material line and non-sensitive request reference are required." }, 400);
  }
  const requestReferenceSha256 = createHash("sha256")
    .update(input.data.requestReference, "utf8").digest("hex");
  const result = await auth.admin.rpc("ap_record_applicant_document_format_request", {
    p_request_id: randomUUID(),
    p_material_line_id: materialLineId.data,
    p_actor_id: auth.user.id,
    p_delivery_format: input.data.deliveryFormat,
    p_request_reference_sha256: requestReferenceSha256,
  });
  if (result.error) return response({ error: "The applicant format request could not be recorded." }, 409);
  return response({ request: result.data }, 201);
}

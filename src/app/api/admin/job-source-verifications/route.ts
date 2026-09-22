import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { isSameOriginRequest } from "@/lib/security/origin";
import { independentSourceVerificationSchema, verifyIndependentSourceInventory } from "@/lib/jobs/verified-source-inventory";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const respond = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "cache-control": "no-store, private" } });
  if (!isSameOriginRequest(request)) return respond({ error: "Source verification request rejected." }, 403);
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const input = independentSourceVerificationSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return respond({ error: "Complete the direct source verification evidence." }, 400);
  try { return respond(await verifyIndependentSourceInventory(auth.admin, auth.user.id, input.data), 201); }
  catch { return respond({ error: "Source verification requires current matching evidence." }, 409); }
}

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { isSameOriginRequest } from "@/lib/security/origin";
import { manualSourceObservationSchema, recordManualSourceInventory } from "@/lib/jobs/manual-source-inventory";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const respond = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "cache-control": "no-store, private" } });
  if (!isSameOriginRequest(request)) return respond({ error: "Manual source request rejected." }, 403);
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const input = manualSourceObservationSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return respond({ error: "Complete the official listing capture, identity checks, and review reason." }, 400);
  try { return respond(await recordManualSourceInventory(auth.admin, auth.user.id, input.data), 201); }
  catch { return respond({ error: "Manual verification requires current permission and matching official evidence." }, 409); }
}

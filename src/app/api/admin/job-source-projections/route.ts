import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { isSameOriginRequest } from "@/lib/security/origin";
import { promoteVerifiedSourceInventory, sourceVerificationSchema } from "@/lib/jobs/verified-source-inventory";

const privateHeaders = { "Cache-Control": "private, no-store", "Pragma": "no-cache" };
const respond = (body: unknown, status: number) => NextResponse.json(body, { status, headers: privateHeaders });

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return respond({ error: "Request origin rejected." }, 403);
  const auth = await requireAdmin();
  if (!auth.ok) {
    for (const [key, value] of Object.entries(privateHeaders)) auth.response.headers.set(key, value);
    return auth.response;
  }
  const input = sourceVerificationSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return respond({ error: "Current direct official listing evidence and complete operator verification are required." }, 400);
  try { return respond(await promoteVerifiedSourceInventory(auth.admin, auth.user.id, input.data), 201); }
  catch { return respond({ error: "The observation, source authority, parsed requirements, or direct verification needs review. No customer release was authorized." }, 409); }
}

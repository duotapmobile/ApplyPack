import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { isSameOriginRequest } from "@/lib/security/origin";

export const dynamic = "force-dynamic";
const schema = z.object({ runId: z.string().uuid() }).strict();

export async function POST(request: Request) {
  const respond = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "cache-control": "no-store, private" } });
  if (!isSameOriginRequest(request)) return respond({ error: "Source reconciliation request rejected." }, 403);
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return respond({ error: "Choose a complete verified source run." }, 400);
  const rpc = auth.admin.rpc.bind(auth.admin) as unknown as (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  const result = await rpc("ap_reconcile_verified_source_run", { p_run_id: input.data.runId, p_actor_id: auth.user.id });
  return result.error ? respond({ error: "A current complete directly verified source snapshot is required." }, 409)
    : respond(result.data, 200);
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { isSameOriginRequest } from "@/lib/security/origin";

const schema = z.object({
  unitsPer24h: z.number().int(),
  enabled: z.boolean(),
  reason: z.string().trim().min(12).max(500),
}).strict();

const resources = {
  job_search: { resource: "SEARCH", unitsPer24h: 1 },
  apply_pack: { resource: "MATERIALS", unitsPer24h: 2 },
} as const;

export async function POST(request: Request, context: { params: Promise<{ kind: string }> }) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "This capacity request was rejected." }, { status: 403 });
  const kind = (await context.params).kind;
  if (!Object.prototype.hasOwnProperty.call(resources, kind)) {
    return NextResponse.json({ error: "Unknown capacity type." }, { status: 404 });
  }
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  if (auth.role !== "admin") return NextResponse.json({ error: "An administrator must change launch capacity." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  const target = resources[kind as keyof typeof resources];
  if (!parsed.success || parsed.data.unitsPer24h !== target.unitsPer24h) {
    return NextResponse.json({ error: "Manual-launch capacity is fixed at one search and two Apply Packs per rolling 24 hours." }, { status: 400 });
  }
  const { error } = await auth.admin.rpc("ap_set_manual_launch_capacity_state", {
    p_resource: target.resource,
    p_enabled: parsed.data.enabled,
    p_actor_id: auth.user.id,
    p_reason: parsed.data.reason,
  });
  if (error) return NextResponse.json({ error: "Capacity could not be updated." }, { status: 502 });
  return NextResponse.json({ ok: true });
}

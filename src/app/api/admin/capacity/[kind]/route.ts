import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";

const schema = z.object({ unitsPer24h: z.number().int().min(1).max(100), enabled: z.boolean() });

export async function POST(request: Request, context: { params: Promise<{ kind: string }> }) {
  const kind = (await context.params).kind;
  if (!["job_search", "apply_pack"].includes(kind)) return NextResponse.json({ error: "Unknown capacity type." }, { status: 404 });
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Capacity must be between 1 and 100 units." }, { status: 400 });
  const { error } = await auth.admin.from("capacity_limits").update({
    units_per_24h: parsed.data.unitsPer24h,
    enabled: parsed.data.enabled,
    updated_at: new Date().toISOString(),
  }).eq("kind", kind);
  if (error) return NextResponse.json({ error: "Capacity could not be updated." }, { status: 502 });
  await auth.admin.from("audit_logs").insert({
    actor_id: auth.user.id,
    action: "capacity_updated",
    entity_type: "capacity_limit",
    entity_id: kind,
    details: parsed.data,
  });
  return NextResponse.json({ ok: true });
}

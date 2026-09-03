import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(_request: Request, context: { params: Promise<{ kind: string }> }) {
  const kind = (await context.params).kind;
  if (kind !== "job_search" && kind !== "apply_pack") {
    return NextResponse.json({ error: "Unknown capacity type." }, { status: 404 });
  }
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) return NextResponse.json({ error: "Capacity is unavailable." }, { status: 503 });
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: "Sign in to check capacity." }, { status: 401 });
  const { data, error } = await admin.rpc("available_capacity", { p_kind: kind });
  if (error) return NextResponse.json({ error: "Capacity is unavailable." }, { status: 503 });
  return NextResponse.json({
    kind,
    availableUnits: Math.max(0, Math.min(Number(data || 0), kind === "apply_pack" ? 10 : 1)),
    measuredAt: new Date().toISOString(),
    provisional: true,
  });
}

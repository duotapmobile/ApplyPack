import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const schema = z.object({ decision: z.enum(["selected", "not_for_me", "undecided"]) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const id = (await context.params).id;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid decision." }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) return NextResponse.json({ error: "Account storage is not configured." }, { status: 503 });
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const { data: match } = await admin.from("job_matches").select("id,orders!job_matches_search_order_id_fkey(customer_id,status)").eq("id", id).maybeSingle();
  const related = Array.isArray(match?.orders) ? match?.orders[0] : match?.orders;
  if (!match || !related || related.customer_id !== authData.user.id || related.status !== "delivered") {
    return NextResponse.json({ error: "Match not found." }, { status: 404 });
  }
  const { error } = await admin.from("job_matches").update({ customer_decision: parsed.data.decision }).eq("id", id);
  if (error) return NextResponse.json({ error: "The decision could not be saved." }, { status: 502 });
  await admin.from("audit_logs").insert({ actor_id: authData.user.id, action: "job_match_decision", entity_type: "job_match", entity_id: id, details: { decision: parsed.data.decision } });
  return NextResponse.json({ ok: true });
}

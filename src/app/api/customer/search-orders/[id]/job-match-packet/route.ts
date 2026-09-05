import { NextResponse } from "next/server";
import { PdfcnJobMatchPacketRenderer } from "@/lib/documents/job-match-packet/renderer";
import { JobMatchPacketError, JobMatchPacketService } from "@/lib/documents/job-match-packet/service";
import { SupabaseJobMatchPacketRepository, SupabasePacketAuditSink } from "@/lib/documents/job-match-packet/supabase-repository";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const [supabase, admin] = await Promise.all([createSupabaseServerClient(), Promise.resolve(createSupabaseAdminClient())]);
  if (!supabase || !admin) return NextResponse.json({ error: "Private document storage is not configured." }, { status: 503 });
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const orderId = (await context.params).id;
  const service = new JobMatchPacketService(
    new SupabaseJobMatchPacketRepository(admin),
    new PdfcnJobMatchPacketRenderer(),
    new SupabasePacketAuditSink(admin),
    null,
  );
  try {
    const url = await service.customerDownload({ id: authData.user.id, role: "customer" }, orderId);
    const response = NextResponse.redirect(url, { status: 303 });
    response.headers.set("Cache-Control", "no-store, private");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) {
    if (error instanceof JobMatchPacketError) return NextResponse.json({ error: error.code }, { status: error.status });
    return NextResponse.json({ error: "Packet download is unavailable." }, { status: 502 });
  }
}

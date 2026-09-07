import { NextResponse } from "next/server";
import { anonymousDraftContext, anonymousDraftError } from "@/lib/drafts/anonymous-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const context = await anonymousDraftContext();
  if (!context) {
    return NextResponse.json({ error: "The saved intake is unavailable." }, {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  }
  const { data, error } = await context.admin.rpc("ap_read_current_feasibility", {
    p_draft_id: context.capability.draftId,
    p_secret_hash: context.secretHash,
  });
  if (error) {
    const mapped = anonymousDraftError(error);
    return NextResponse.json(mapped.body, { status: mapped.status, headers: { "cache-control": "no-store" } });
  }
  return NextResponse.json({ feasibility: data }, { headers: { "cache-control": "no-store" } });
}

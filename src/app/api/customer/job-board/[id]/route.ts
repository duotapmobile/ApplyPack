import { NextResponse } from "next/server";
import { requireBoardAccess } from "@/lib/job-board/access";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireBoardAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status, headers });
  const { id } = await context.params;
  const { data, error } = await access.admin.from("ap_board_admissions")
    .select("warning_codes,capability_connection_codes,job:jobs(id,company,title,description,location_text,salary_text,posted_at,last_verified_at,source_name,source_job_url,listing_status)")
    .eq("customer_id", access.customerId).eq("profile_snapshot_id", access.profileId).eq("job_id", id).eq("decision", "ADMITTED").maybeSingle();
  if (error) return NextResponse.json({ error: "Listing is temporarily unavailable." }, { status: 503, headers });
  if (!data) return NextResponse.json({ error: "Listing is not available for the current profile." }, { status: 404, headers });
  return NextResponse.json(data, { headers });
}

const headers = { "cache-control": "private, no-store, max-age=0", vary: "cookie, authorization" };

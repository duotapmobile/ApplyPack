import { NextResponse } from "next/server";
import { requireBoardAccess } from "@/lib/job-board/access";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireBoardAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status, headers });
  const { id } = await context.params;
  const { data } = await access.admin.from("ap_board_admissions")
    .select("job:jobs(official_application_url,source_job_url,is_active,listing_status,last_verified_at)")
    .eq("customer_id", access.customerId).eq("profile_snapshot_id", access.profileId).eq("job_id", id).eq("decision", "ADMITTED").maybeSingle();
  const job = Array.isArray(data?.job) ? data.job[0] : data?.job;
  const link = job?.official_application_url || job?.source_job_url;
  if (!job || !job.is_active || job.listing_status !== "open" || !link || !isSafeExternalLink(link)) return NextResponse.json({ error: "The application link is expired or unavailable." }, { status: 410, headers });
  return NextResponse.json({ url: link, lastVerifiedAt: job.last_verified_at }, { headers });
}

const headers = { "cache-control": "private, no-store, max-age=0", vary: "cookie, authorization" };

function isSafeExternalLink(value: string) {
  try { return new URL(value).protocol === "https:"; } catch { return false; }
}

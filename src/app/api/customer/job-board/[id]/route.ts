import { NextResponse } from "next/server";
import { requireBoardAccess } from "@/lib/job-board/access";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireBoardAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status, headers });
  const { id } = await context.params;
  const { data, error } = await access.admin.from("ap_board_admissions")
    .select("warning_codes,capability_connection_codes,job:jobs!inner(id,company,title,description,location_text,salary_text,posted_at,last_verified_at,source_name,source_job_url,listing_status,source:job_sources!inner(id))")
    .eq("customer_id", access.customerId).eq("profile_snapshot_id", access.profileId).eq("job_id", id)
    .eq("admission_version", access.admissionVersion).is("superseded_at", null).eq("decision", "ADMITTED")
    .eq("job.is_active", true).eq("job.listing_status", "open")
    .or(`closing_at.is.null,closing_at.gt.${new Date().toISOString()}`, { referencedTable: "job" })
    .eq("job.application_path_status", "verified_actionable")
    .in("job.source_freshness_status", ["fresh", "aging"])
    .gte("job.last_successfully_verified_at", new Date(Date.now() - 72 * 60 * 60 * 1_000).toISOString())
    .lte("job.last_successfully_verified_at", new Date().toISOString())
    .eq("job.source.is_active", true)
    .eq("job.source.paid_display_permission_status", "documented_paid_display_authorized")
    .not("job.source.permission_evidence_url", "is", null).maybeSingle();
  if (error) return NextResponse.json({ error: "Listing is temporarily unavailable." }, { status: 503, headers });
  if (!data) return NextResponse.json({ error: "Listing is not available for the current profile." }, { status: 404, headers });
  return NextResponse.json(data, { headers });
}

const headers = { "cache-control": "private, no-store, max-age=0", vary: "cookie, authorization" };

import { NextResponse } from "next/server";
import { requireBoardAccess } from "@/lib/job-board/access";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await requireBoardAccess();
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status, headers: privateHeaders });
  const url = new URL(request.url);
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get("pageSize") || "25", 10) || 25));
  const sort = url.searchParams.get("sort") === "salary_high" ? "salary_high" : "newest";
  let query = access.admin.from("ap_board_admissions")
    .select("id,warning_codes,evaluated_at,job:jobs!inner(id,company,title,location_text,salary_text,salary_min,salary_max,posted_at,last_verified_at,source_name,source:job_sources!inner(id))", { count: "exact" })
    .eq("customer_id", access.customerId).eq("profile_snapshot_id", access.profileId)
    .eq("admission_version", access.admissionVersion).is("superseded_at", null).eq("decision", "ADMITTED")
    .eq("job.is_active", true).eq("job.listing_status", "open")
    .or(`closing_at.is.null,closing_at.gt.${new Date().toISOString()}`, { referencedTable: "job" })
    .eq("job.application_path_status", "verified_actionable")
    .in("job.source_freshness_status", ["fresh", "aging"])
    .gte("job.last_successfully_verified_at", new Date(Date.now() - 72 * 60 * 60 * 1_000).toISOString())
    .lte("job.last_successfully_verified_at", new Date().toISOString())
    .eq("job.source.is_active", true)
    .eq("job.source.paid_display_permission_status", "documented_paid_display_authorized")
    .not("job.source.permission_evidence_url", "is", null);
  query = sort === "salary_high"
    ? query.order("salary_min", { referencedTable: "jobs", ascending: false, nullsFirst: false }).order("id", { ascending: true })
    : query.order("freshness_sort_at", { referencedTable: "jobs", ascending: false, nullsFirst: false }).order("id", { ascending: true });
  const start = (page - 1) * pageSize;
  const { data, error, count } = await query.range(start, start + pageSize - 1);
  if (error) return NextResponse.json({ error: "Listings are temporarily unavailable." }, { status: 503, headers: privateHeaders });
  return NextResponse.json({ jobs: data, page, pageSize, total: count || 0,
    pageCount: Math.ceil((count || 0) / pageSize), hasPreviousPage: page > 1,
    hasNextPage: start + pageSize < (count || 0), sort }, { headers: privateHeaders });
}

const privateHeaders = { "cache-control": "private, no-store, max-age=0", vary: "cookie, authorization" };

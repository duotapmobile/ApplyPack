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
    .select("id,warning_codes,evaluated_at,job:jobs(id,company,title,location_text,salary_text,salary_min,salary_max,posted_at,last_verified_at,source_name)", { count: "exact" })
    .eq("customer_id", access.customerId).eq("profile_snapshot_id", access.profileId).eq("decision", "ADMITTED");
  query = sort === "salary_high"
    ? query.order("salary_min", { referencedTable: "jobs", ascending: false, nullsFirst: false }).order("id", { ascending: true })
    : query.order("posted_at", { referencedTable: "jobs", ascending: false, nullsFirst: false }).order("id", { ascending: true });
  const start = (page - 1) * pageSize;
  const { data, error, count } = await query.range(start, start + pageSize - 1);
  if (error) return NextResponse.json({ error: "Listings are temporarily unavailable." }, { status: 503, headers: privateHeaders });
  return NextResponse.json({ jobs: data, page, pageSize, total: count || 0, sort }, { headers: privateHeaders });
}

const privateHeaders = { "cache-control": "private, no-store, max-age=0", vary: "cookie, authorization" };

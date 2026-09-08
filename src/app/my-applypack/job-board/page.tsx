import type { Metadata } from "next";
import Link from "next/link";
import { ApplyLinkButton, BillingPortalButton } from "@/components/job-board/checkout-button";
import { hasBoardAccess, type BoardSubscriptionState } from "@/lib/job-board/entitlements";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "My Job Board", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function MyJobBoardPage({ searchParams }: { searchParams: Promise<{ sort?: string; page?: string }> }) {
  const requested = await searchParams;
  const sort = requested.sort === "salary_high" ? "salary_high" : "newest";
  const page = Math.max(1, Number.parseInt(requested.page || "1", 10) || 1);
  const supabase = await createSupabaseServerClient();
  if (!supabase) return <BoardState title="Job board setup is incomplete" message="Private account and billing configuration is required." />;
  const { data } = await supabase.auth.getUser();
  if (!data.user) return <BoardState title="Sign in to view your job board" message="Actual listings and application links require authenticated paid access." actionHref="/sign-in" actionLabel="Sign in" />;
  const { data: subscription } = await supabase.from("ap_board_subscriptions")
    .select("state,access_ends_at,cancel_at_period_end").eq("customer_id", data.user.id)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const access = subscription && hasBoardAccess({ state: subscription.state as BoardSubscriptionState, accessEndsAt: subscription.access_ends_at });
  if (!access) return <BoardState title={subscription?.state === "PENDING" ? "Payment verification is pending" : "A subscription is required"} message={subscription?.state === "PENDING" ? "A checkout return never grants access. This page opens only after a signed payment event confirms the paid period." : "Choose a plan before actual listings or application links are available."} actionHref="/job-board" actionLabel="View plans" />;

  const admin = createSupabaseAdminClient();
  const { data: profile } = admin ? await admin.from("ap_intake_snapshots").select("id,version").eq("customer_id", data.user.id).order("version", { ascending: false }).limit(1).maybeSingle() : { data: null };
  let query = admin && profile ? admin.from("ap_board_admissions")
    .select("id,warning_codes,job:jobs(id,company,title,location_text,salary_text,last_verified_at,source_name)")
    .eq("customer_id", data.user.id).eq("profile_snapshot_id", profile.id).eq("decision", "ADMITTED")
    : null;
  if (query) query = sort === "salary_high"
    ? query.order("salary_min", { referencedTable: "jobs", ascending: false, nullsFirst: false }).order("id").range((page - 1) * 25, page * 25 - 1)
    : query.order("posted_at", { referencedTable: "jobs", ascending: false, nullsFirst: false }).order("id").range((page - 1) * 25, page * 25 - 1);
  const result = query ? await query : { data: [], error: null };
  const rows = result.data || [];
  return <main id="main-content" className="board-page"><div className="page-frame"><section className="board-hero"><p className="eyebrow eyebrow--light">MY JOB BOARD</p><h1>Filtered around your confirmed profile.</h1><p>Newest first. Admission is an inclusion check, not comparative ranking.</p></section>
    <section className="board-account"><div><h2>Access active</h2><p>{subscription.cancel_at_period_end ? "Access ends" : "Next charge or access-end date"}: {new Date(subscription.access_ends_at).toLocaleDateString("en-US", { timeZone: "America/New_York" })}.</p></div><BillingPortalButton /></section>
    <section><div className="portal-section__heading"><div><p className="eyebrow">CURRENT LISTINGS</p><h2>Available jobs</h2></div><Link href="/get-started">Edit profile</Link></div>
      <nav aria-label="Sort jobs" className="board-sort"><span>Sort by factual field:</span> <Link aria-current={sort === "newest" ? "page" : undefined} href="?sort=newest">Newest first</Link> <Link aria-current={sort === "salary_high" ? "page" : undefined} href="?sort=salary_high">Highest disclosed minimum salary</Link></nav>
      {result.error || !admin ? <div className="empty-state"><h3>Listings are temporarily unavailable.</h3><p>Your paid access is unchanged.</p></div> : !profile ? <div className="empty-state"><h3>Complete your profile.</h3><p>ApplyPack will not infer missing qualifications.</p><Link href="/get-started">Complete onboarding</Link></div> : rows.length === 0 ? <div className="empty-state"><h3>No admitted jobs right now.</h3><p>We will not invent results or silently relax your preferences.</p></div> : <div className="board-job-list">{rows.map((row) => {
        const job = Array.isArray(row.job) ? row.job[0] : row.job;
        if (!job) return null;
        const warnings = Array.isArray(row.warning_codes) ? row.warning_codes.map(String) : [];
        return <article className="board-card" key={row.id}><p className="eyebrow">{job.source_name || "Attributed source"}</p><h3>{job.title}</h3><p>{job.company}{job.location_text ? ` · ${job.location_text}` : ""}</p><p>{job.salary_text || "Salary not disclosed"}</p>{warnings.length ? <p className="match-warning">Unknown listing information: {warnings.join(", ")}.</p> : null}<p>Freshness checked {job.last_verified_at ? new Date(job.last_verified_at).toLocaleDateString("en-US", { timeZone: "UTC" }) : "date unavailable"}.</p><ApplyLinkButton jobId={job.id} /><p>$8 human-reviewed résumé and cover-letter ordering will open here after fulfillment integration passes its release gate.</p></article>;
      })}</div>}{rows.length === 25 ? <nav aria-label="Job pages" className="board-pagination">{page > 1 ? <Link href={`?sort=${sort}&page=${page - 1}`}>Previous</Link> : null}<Link href={`?sort=${sort}&page=${page + 1}`}>Next</Link></nav> : page > 1 ? <nav aria-label="Job pages" className="board-pagination"><Link href={`?sort=${sort}&page=${page - 1}`}>Previous</Link></nav> : null}
    </section></div></main>;
}

function BoardState({ title, message, actionHref, actionLabel }: { title: string; message: string; actionHref?: string; actionLabel?: string }) {
  return <main id="main-content" className="auth-page"><section className="auth-card"><p className="eyebrow">PRIVATE JOB BOARD</p><h1>{title}</h1><p>{message}</p>{actionHref && actionLabel ? <Link className="button-link button-link--primary" href={actionHref}>{actionLabel}</Link> : null}</section></main>;
}

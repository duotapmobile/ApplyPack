import type { Metadata } from "next";
import Link from "next/link";
import { ApplyLinkButton } from "@/components/job-board/checkout-button";
import { BoardMaterialCheckout } from "@/components/job-board/board-material-checkout";
import { requireBoardAccess } from "@/lib/job-board/access";

export const metadata: Metadata = { title: "Job details", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function BoardJobDetails({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireBoardAccess();
  if (!access.ok) return <State title="Job details are unavailable" message={access.error} />;
  const result = await access.admin.from("ap_board_admissions")
    .select("id,warning_codes,capability_connection_codes,job:jobs(id,company,title,description,location_text,salary_text,posted_at,last_verified_at,source_name,source_job_url,listing_status)")
    .eq("customer_id", access.customerId).eq("profile_snapshot_id", access.profileId).eq("job_id", id)
    .eq("admission_version", access.admissionVersion).is("superseded_at", null).eq("decision", "ADMITTED").maybeSingle();
  const job = Array.isArray(result.data?.job) ? result.data.job[0] : result.data?.job;
  if (result.error || !result.data || !job) return <State title="This job is no longer available" message="It may have expired, changed, or no longer pass your current profile filters." />;
  const snapshot = await access.admin.from("ap_job_snapshots").select("id")
    .eq("legacy_job_id", id).order("retrieved_at", { ascending: false }).limit(1).maybeSingle();
  const rule = snapshot.data ? await access.admin.from("ap_employer_submission_rules").select("id")
    .eq("job_snapshot_id", snapshot.data.id).eq("is_current", true).is("superseded_at", null).limit(1).maybeSingle() : { data: null };
  const materialReady = Boolean(snapshot.data && rule.data);
  const warnings = Array.isArray(result.data.warning_codes) ? result.data.warning_codes.map(String) : [];
  const connections = Array.isArray(result.data.capability_connection_codes) ? result.data.capability_connection_codes.map(String) : [];
  return <main id="main-content" className="board-page"><div className="page-frame">
    <p><Link href="/my-applypack/job-board">← Back to job board</Link></p>
    <section className="board-hero"><p className="eyebrow eyebrow--light">{job.source_name || "Attributed source"}</p><h1>{job.title}</h1><p>{job.company}{job.location_text ? ` · ${job.location_text}` : ""}</p></section>
    <section className="board-card"><h2>Job details</h2><p>{job.salary_text || "Salary not disclosed"}</p>
      <p>Posted {job.posted_at ? new Date(job.posted_at).toLocaleDateString("en-US", { timeZone: "UTC" }) : "date unavailable"}. Last verified {job.last_verified_at ? new Date(job.last_verified_at).toLocaleString("en-US", { timeZone: "America/New_York" }) : "time unavailable"}.</p>
      {warnings.length ? <p className="match-warning">Important unknown information: {warnings.join(", ")}. Verify it with the employer before applying.</p> : null}
      <p>{job.description || "The source did not provide a usable description."}</p>
      <p>Profile evidence connected to this listing: {connections.length ? connections.join(", ") : "unavailable"}. These are inclusion reasons, not a score or rank.</p>
      <ApplyLinkButton jobId={job.id} />
    </section>
    <section className="board-card"><h2>Tailored résumé + cover letter</h2>
      {materialReady ? <BoardMaterialCheckout jobId={job.id} initialEmail={access.customerEmail} />
        : <p>This job is visible on your board, but its current application instructions still need human review before the $8 package can be purchased.</p>}
    </section>
  </div></main>;
}

function State({ title, message }: { title: string; message: string }) {
  return <main id="main-content" className="auth-page"><section className="auth-card"><h1>{title}</h1><p>{message}</p><Link href="/my-applypack/job-board">Return to job board</Link></section></main>;
}

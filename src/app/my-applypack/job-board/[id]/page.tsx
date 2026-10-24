import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireLegacyBoardArchiveAccess } from "@/lib/job-board/access";

export const metadata: Metadata = { title: "Archived job details", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function LegacyBoardJobDetails({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireLegacyBoardArchiveAccess();
  if (!access.ok) notFound();
  const result = await access.admin.from("ap_legacy_board_archive_entries")
    .select("id,company,title,description,location_text,salary_text,posted_at,last_verified_at,source_name,warning_codes,capability_connection_codes,archived_at")
    .eq("customer_id", access.customerId).eq("id", id).maybeSingle();
  if (result.error || !result.data) notFound();
  const job = result.data;
  const warnings = Array.isArray(job.warning_codes) ? job.warning_codes.map(String) : [];
  const connections = Array.isArray(job.capability_connection_codes) ? job.capability_connection_codes.map(String) : [];

  return <main id="main-content" className="board-page"><div className="page-frame">
    <p><Link href="/my-applypack/job-board">← Back to legacy archive</Link></p>
    <section className="board-hero"><p className="eyebrow eyebrow--light">{job.source_name || "Historical attributed source"}</p><h1>{job.title}</h1><p>{job.company}{job.location_text ? ` · ${job.location_text}` : ""}</p></section>
    <section className="board-card"><h2>Frozen historical details</h2>
      <p>{job.salary_text || "Salary was not disclosed"}</p>
      <p>Posted {job.posted_at ? new Date(job.posted_at).toLocaleDateString("en-US", { timeZone: "UTC" }) : "date unavailable"}. Last verified {job.last_verified_at ? new Date(job.last_verified_at).toLocaleString("en-US", { timeZone: "America/New_York" }) : "time unavailable"}. Archived {new Date(job.archived_at).toLocaleDateString("en-US", { timeZone: "UTC" })}.</p>
      {warnings.length ? <p className="match-warning">Historical unknown information: {warnings.join(", ")}.</p> : null}
      <p>{job.description || "The historical source did not provide a usable description."}</p>
      <p>Historical profile evidence connected to this listing: {connections.length ? connections.join(", ") : "unavailable"}. These were inclusion reasons, not a score or rank.</p>
      <p>This record is read-only. ApplyPack does not resolve or expose an application link from this archive.</p>
    </section>
  </div></main>;
}

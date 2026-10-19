import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BillingPortalButton } from "@/components/job-board/checkout-button";
import { requireLegacyBoardArchiveAccess } from "@/lib/job-board/access";

export const metadata: Metadata = { title: "Legacy job archive", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function LegacyJobBoardArchivePage() {
  const access = await requireLegacyBoardArchiveAccess();
  if (!access.ok) notFound();

  const result = await access.admin.from("ap_legacy_board_archive_entries")
    .select("id,company,title,location_text,salary_text,source_name,last_verified_at,archived_at")
    .eq("customer_id", access.customerId)
    .order("archived_at", { ascending: false })
    .order("id", { ascending: true });
  if (result.error) notFound();
  const rows = result.data || [];

  return <main id="main-content" className="board-page"><div className="page-frame">
    <section className="board-hero">
      <p className="eyebrow eyebrow--light">LEGACY PAID ARCHIVE</p>
      <h1>Your frozen historical listings.</h1>
      <p>This read-only archive preserves listings that were admitted under your historical paid board period. It is not a current job board, ranking, or application service.</p>
    </section>
    <section className="board-account"><div>
      <h2>Historical access</h2>
      <p>Provider-confirmed access ends {new Date(access.accessEndsAt).toLocaleDateString("en-US", { timeZone: "America/New_York" })}. No new subscriptions or renewals are offered.</p>
    </div><BillingPortalButton /></section>
    <section><div className="portal-section__heading"><div>
      <p className="eyebrow">FROZEN RECORDS</p><h2>Archived listings</h2>
    </div><Link href="/my-applypack">Return to My ApplyPack</Link></div>
      {rows.length === 0 ? <div className="empty-state"><h3>No archived listings were preserved.</h3><p>No current listings will be created or recomputed.</p></div>
        : <div className="board-job-list">{rows.map((row) => <article className="board-card" key={row.id}>
          <p className="eyebrow">{row.source_name || "Historical attributed source"}</p>
          <h3>{row.title}</h3>
          <p>{row.company}{row.location_text ? ` · ${row.location_text}` : ""}</p>
          <p>{row.salary_text || "Salary was not disclosed"}</p>
          <p>Last verified {row.last_verified_at ? new Date(row.last_verified_at).toLocaleDateString("en-US", { timeZone: "UTC" }) : "date unavailable"}. Archived {new Date(row.archived_at).toLocaleDateString("en-US", { timeZone: "UTC" })}.</p>
          <p><Link className="button-link" href={`/my-applypack/job-board/${row.id}`}>View archived details</Link></p>
        </article>)}</div>}
    </section>
  </div></main>;
}

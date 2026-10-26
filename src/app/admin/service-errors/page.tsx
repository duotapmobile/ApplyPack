import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { ServiceErrorReview } from "@/components/admin/service-error-review";
import styles from "@/components/admin/draft-owner-workspace.module.css";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Reported document errors | ApplyPack", robots: { index: false, follow: false, noarchive: true } };
const cursorSchema = z.object({ at: z.iso.datetime({ offset: true }), id: z.uuid() }).strict();
export default async function ServiceErrorsPage({ searchParams }: { searchParams: Promise<{ case?: string; cursor?: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return <main id="main-content" className="auth-page"><section className="auth-card"><h1>Verify administrator access</h1><p>Fresh administrator MFA is required before private reports are loaded.</p><Link href="/admin">Return to administrator verification</Link></section></main>;
  const params = await searchParams, selected = z.uuid().safeParse(params.case); let cursor: z.infer<typeof cursorSchema> | null = null;
  try { if (params.cursor) { if (params.cursor.length > 250) throw new Error("Invalid cursor"); cursor = cursorSchema.parse(JSON.parse(Buffer.from(params.cursor, "base64url").toString("utf8"))); } }
  catch { return <main id="main-content" className="admin-page"><h1>Reported document errors</h1><p>The report page reference is invalid.</p><Link href="/admin/service-errors">Start with recent reports</Link></main>; }
  let query = auth.admin.from("ap_material_support_cases").select("id,opened_at").eq("case_kind", "SERVICE_ERROR_REPORT").eq("state", "OPEN");
  if (cursor) query = query.or(`opened_at.lt.${cursor.at},and(opened_at.eq.${cursor.at},id.lt.${cursor.id})`);
  const result = await query.order("opened_at", { ascending: false }).order("id", { ascending: false }).limit(31).abortSignal(AbortSignal.timeout(20_000));
  const parsed = z.array(z.object({ id: z.uuid(), opened_at: z.iso.datetime({ offset: true }) }).strict()).max(31).safeParse(result.data);
  const rows = !result.error && parsed.success ? parsed.data.slice(0, 30) : null, last = rows?.at(-1);
  const next = parsed.success && parsed.data.length > 30 && last ? Buffer.from(JSON.stringify({ at: last.opened_at, id: last.id })).toString("base64url") : null;
  return <main id="main-content" className="admin-page"><header><p className="eyebrow">OPERATIONS</p><h1>Reported document errors</h1><p>Compare the original confirmed information and delivered files before deciding whether ApplyPack owes a factual repair.</p><Link href="/admin">Back to operations</Link></header>
    <div className={styles.workspace}><nav className={styles.queue} aria-label="Open document reports"><h2>Open reports</h2>{rows === null ? <p>The report queue is unavailable.</p> : rows.length === 0 ? <p>No open reports on this page.</p> : <ul>{rows.map((row) => <li key={row.id}><Link href={`/admin/service-errors?case=${row.id}`} aria-current={selected.success && selected.data === row.id ? "page" : undefined}>Report from {new Date(row.opened_at).toLocaleString("en-US", { timeZone: "America/New_York" })} Eastern</Link></li>)}</ul>}{next && <Link href={`/admin/service-errors?cursor=${next}`}>Older open reports</Link>}</nav>
      {selected.success ? <ServiceErrorReview key={selected.data} caseId={selected.data} /> : <section><h2>Select a report</h2><p>Opening a report does not revoke files, approve a repair, or send a delivery.</p></section>}</div></main>;
}

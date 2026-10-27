import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { SubmissionRuleReview } from "@/components/admin/submission-rule-review";
import { loadSubmissionRuleQueue, submissionRuleQueueCursor } from "@/lib/documents/submission-rule-supabase";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Employer instructions | ApplyPack", robots: { index: false, follow: false, noarchive: true } };
const paramsSchema = z.object({ job: z.uuid().optional(), cursor: z.string().max(256).optional() }).strict();
export default async function SubmissionRulesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return <main id="main-content" className="auth-page"><section className="auth-card"><h1>Verify administrator access</h1><p>Fresh administrator MFA is required before employer instructions can be reviewed.</p><Link href="/admin">Return to administrator verification</Link></section></main>;
  const params = paramsSchema.safeParse(await searchParams);
  let validCursor = params.success;
  if (params.success) { try { submissionRuleQueueCursor(params.data.cursor); } catch { validCursor = false; } }
  if (!params.success || !validCursor) return <main id="main-content" className="admin-page"><h1>Review locator unavailable</h1><p>Use a current job or page link from the employer-instruction queue.</p><Link href="/admin/submission-rules">Open the queue</Link></main>;
  const queue = await loadSubmissionRuleQueue(auth.admin, params.data.cursor, AbortSignal.timeout(45_000));
  return <main id="main-content" className="admin-page"><div className="page-frame">
    <header><p className="eyebrow">OPERATIONS</p><h1>Review employer instructions</h1><p>Prepare and confirm instructions from the saved permitted source. This does not draft, approve or send documents.</p><Link href="/admin">Back to operations</Link></header>
    <section aria-labelledby="submission-rule-queue"><h2 id="submission-rule-queue">Recent verified job sources</h2>
      <p>Checkout separately checks delivered-job eligibility, current listing evidence and capacity. Confirming instructions does not renew the listing verification time.</p>
      {queue.unavailable ? <p role="alert">The queue is unavailable. Refresh after verifying your staff access.</p> : queue.jobs.length ? <ul>{queue.jobs.map((job) => <li key={job.id}>
        <Link href={`/admin/submission-rules?job=${job.id}${params.data.cursor ? `&cursor=${encodeURIComponent(params.data.cursor)}` : ""}`}>{job.title} — {job.company}</Link>
        <p>Listing verified <time dateTime={job.verifiedAt}>{new Date(job.verifiedAt).toLocaleString("en-US", { timeZone: "America/New_York" })} ET</time>.</p>
      </li>)}</ul> : <p>No current sources are available on this page.</p>}
      {queue.nextCursor && <Link href={`/admin/submission-rules?cursor=${encodeURIComponent(queue.nextCursor)}`}>Next page of source snapshots</Link>}
    </section>
    {params.data.job && <SubmissionRuleReview jobSnapshotId={params.data.job} />}
  </div></main>;
}

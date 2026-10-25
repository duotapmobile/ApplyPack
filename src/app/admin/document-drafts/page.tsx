import type { Metadata } from "next";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createDraftOwnerView } from "@/lib/documents/draft-owner-view";
import { DraftOwnerWorkspace } from "@/components/admin/draft-owner-workspace";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Document review | ApplyPack", robots: { index: false, follow: false, noarchive: true } };

export default async function DocumentDraftsPage({ searchParams }: { searchParams: Promise<{ job?: string | string[]; cursor?: string | string[] }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return <main id="main-content" className="auth-page"><section className="auth-card"><h1>Verify administrator access</h1><p>Fresh administrator MFA is required before private document drafts can be loaded.</p><Link href="/admin">Return to administrator verification</Link></section></main>;
  const params = await searchParams, admin: SupabaseClient<Database> = auth.admin;
  const view = createDraftOwnerView(admin, auth.user.id), signal = AbortSignal.timeout(50_000);
  const cursor = typeof params.cursor === "string" ? params.cursor : params.cursor ? "invalid" : null;
  const queue = await view.list(cursor, signal);
  const selected = typeof params.job === "string" ? params.job : params.job ? "invalid" : null;
  const detail = selected ? await view.detail(selected, signal) : null;
  return <main id="main-content" className="admin-page"><header><p className="eyebrow">OPERATIONS</p><h1>Review document drafts</h1><p>Review the saved wording and confirmed sources. Approve the finished pair, then send it in a separate step.</p><Link href="/admin">Back to operations</Link></header><DraftOwnerWorkspace queue={queue} detail={detail} loadedAt={new Date().toISOString()} /></main>;
}

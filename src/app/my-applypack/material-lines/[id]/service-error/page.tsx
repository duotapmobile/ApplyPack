import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ServiceErrorReportForm } from "@/components/portal/service-error-report";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Report a document error | ApplyPack", robots: { index: false, follow: false, noarchive: true } };
export default async function ServiceErrorPage({ params }: { params: Promise<{ id: string }> }) {
  const parsed = z.uuid().safeParse((await params).id), auth = await createSupabaseServerClient(), user = auth ? await auth.auth.getUser() : null;
  if (!parsed.success || user?.error || !user?.data.user) return <main id="main-content" className="auth-page"><section className="auth-card"><h1>Sign in to your ApplyPack</h1><p>Verify your email before viewing private delivery support.</p><Link href="/my-applypack">Return to My ApplyPack</Link></section></main>;
  return <main id="main-content" className="portal-page"><h1>Document support</h1><ServiceErrorReportForm key={parsed.data} materialLineId={parsed.data} /><Link href="/my-applypack">Back to My ApplyPack</Link></main>;
}

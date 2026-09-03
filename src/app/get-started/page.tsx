import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { IntakeWizard } from "./wizard-v2";

export const metadata: Metadata = {
  title: { absolute: "Get Started With ApplyPack | Find 10 Matched Jobs" },
  description: "Tell ApplyPack what fits your life, what you want to leave behind, and what experience you bring. Start your 10-job search for $20.",
  robots: { index: false, follow: false },
};

export default async function GetStartedPage() {
  if (process.env.NODE_ENV !== "production" && process.env.APP_E2E_FIXTURE_MODE === "true") {
    return <IntakeWizard authenticatedEmail="e2e-customer@example.invalid" />;
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) return <main id="main-content" className="auth-page"><section className="auth-card"><p className="eyebrow">SECURE INTAKE</p><h1>Account service is not connected.</h1><p>ApplyPack cannot accept an intake or payment until private authentication and storage are ready. Please try again later or email help@applypack.work.</p></section></main>;
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) redirect("/sign-in?next=/get-started");
  return <IntakeWizard authenticatedEmail={data.user.email} />;
}

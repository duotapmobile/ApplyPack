import type { Metadata } from "next";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { IntakeWizard } from "./wizard-v2";
import { PublicIntakeEntry } from "./public-intake-entry";

export const metadata: Metadata = { title: { absolute: "Get Started With ApplyPack | Find 10 Researched Job Matches" }, description: "Tell ApplyPack what fits your life and what experience you bring. Start your 10-job search for $20.", robots: { index: false, follow: false } };

export default async function GetStartedPage() {
  if (process.env.NODE_ENV !== "production" && process.env.APP_E2E_FIXTURE_MODE === "true") return <IntakeWizard authenticatedEmail="e2e-customer@example.invalid" />;
  const supabase = await createSupabaseServerClient();
  const { data } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
  return data.user ? <IntakeWizard authenticatedEmail={data.user.email || ""} /> : <PublicIntakeEntry />;
}

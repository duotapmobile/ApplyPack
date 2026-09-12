import type { Metadata } from "next";
import "./chunk2.css";
import { IntakeWizard } from "./wizard-v3";

export const metadata: Metadata = {
  title: { absolute: "Get Started With ApplyPack | Find 10 Researched Job Matches" },
  description: "Tell ApplyPack what fits your life and what experience you bring. Start your 10-job search for $20.",
  robots: { index: false, follow: false },
};

export default function GetStartedPage() {
  return <IntakeWizard fixtureMode={process.env.NODE_ENV !== "production" && process.env.APP_E2E_FIXTURE_MODE === "true"} />;
}

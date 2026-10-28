import { VerifiedIntakeEntry } from "@/components/intake/verified-intake-entry";
import type { Metadata } from "next";
import "./chunk2.css";
import { IntakeWizard } from "./wizard-v3";

export const metadata: Metadata = {
  title: { absolute: "Get Started With ApplyPack | Find 10 Researched Job Matches" },
  description: "Tell ApplyPack what fits your life and what experience you bring. Request exactly 10 current, human-reviewed job matches for $18.99.",
  robots: { index: false, follow: false },
};

export default function GetStartedPage() {
  return process.env.NODE_ENV !== "production" && process.env.APP_E2E_FIXTURE_MODE === "true"
    ? <IntakeWizard fixtureMode /> : <VerifiedIntakeEntry />;
}

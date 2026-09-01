import type { Metadata } from "next";
import { IntakeWizard } from "./wizard-v2";

export const metadata: Metadata = {
  title: "Get Started With ApplyPack",
  description: "Tell ApplyPack what fits your life and start your 10-job search for $20.",
  alternates: { canonical: "/get-started" },
};

export default function GetStartedPage() {
  return <IntakeWizard />;
}

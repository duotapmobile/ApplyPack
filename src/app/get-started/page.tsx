import type { Metadata } from "next";
import { IntakeWizard } from "./wizard-v2";

export const metadata: Metadata = {
  title: "Get Started With ApplyPack",
  description: "Tell ApplyPack what fits your life and start your 10-job search for $20.",
  alternates: { canonical: "/get-started" },
  openGraph: {
    title: "Get Started With ApplyPack",
    description: "Tell ApplyPack what fits your life and start your 10-job search for $20.",
    type: "website",
    url: "/get-started",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Get Started With ApplyPack",
    description: "Tell ApplyPack what fits your life and start your 10-job search for $20.",
    images: ["/opengraph-image"],
  },
};

export default function GetStartedPage() {
  return <IntakeWizard />;
}

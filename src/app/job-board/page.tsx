import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = {
  title: "Not Available",
  robots: { index: false, follow: false },
};

export default function JobBoardPricingPage() {
  notFound();
}

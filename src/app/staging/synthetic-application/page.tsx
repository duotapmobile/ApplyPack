import { notFound } from "next/navigation";
import Link from "next/link";

export const metadata = { title: "Synthetic application test | ApplyPack", robots: { index: false, follow: false } };

export default async function SyntheticApplicationPage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  if (process.env.APP_STAGING_SYNTHETIC_JOBS !== "true" || process.env.APP_PAYMENT_MODE === "live") notFound();
  const { job } = await searchParams;
  return <main id="main-content" className="brief-page">
    <section className="inner-hero">
      <div className="page-frame inner-hero__grid">
        <div><p className="eyebrow">STAGING VERIFICATION ONLY</p><h1>This is a fictional application destination</h1></div>
        <div className="inner-hero__intro">
          <p>No employer, vacancy, or application exists here. This page proves that the board can preserve a safe, active HTTPS application link without sending synthetic test traffic to a real employer.</p>
          <p>Fixture: <strong>{job || "unspecified"}</strong>.</p>
          <Link className="button-link button-link--primary" href="/my-applypack/job-board"><span>Return to the test board</span></Link>
        </div>
      </div>
    </section>
  </main>;
}

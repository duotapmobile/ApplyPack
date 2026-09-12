import type { Metadata } from "next";
import Link from "next/link";
import { BoardCheckoutButton } from "@/components/job-board/checkout-button";
import { boardPlanDisclosure, boardPlans, type BoardPlanId } from "@/lib/job-board/plans";

export const metadata: Metadata = {
  title: "Filtered Job Board",
  description: "Subscription access to current jobs filtered by your confirmed ApplyPack profile and sorted by factual fields, never personalized rank.",
  alternates: { canonical: "/job-board" },
};

export default function JobBoardPricingPage() {
  return <main id="main-content" className="board-page"><div className="page-frame">
    <section className="board-hero"><p className="eyebrow eyebrow--light">FILTERED JOB BOARD</p><h1>Your filters. Every admitted job. No secret ranking.</h1><p>Browse current opportunities connected to facts in your shared ApplyPack profile. The default is newest first, and you control factual sorting.</p></section>
    <section aria-labelledby="board-pricing"><p className="eyebrow">SUBSCRIPTION ACCESS</p><h2 id="board-pricing">Choose your renewal period</h2><p>No free trial. Each plan auto-renews until canceled. Cancel future renewal any time; normal access continues through the paid period.</p>
      <div className="board-plan-grid">{(Object.entries(boardPlans) as Array<[BoardPlanId, (typeof boardPlans)[BoardPlanId]]>).map(([id, plan]) => <article className="board-card" key={id}><h3>{plan.label}</h3><p className="board-price">${(plan.amountCents / 100).toFixed(2)}</p><p>{boardPlanDisclosure(id)}</p><BoardCheckoutButton planId={id} /></article>)}</div>
    </section>
    <section className="board-explainer"><h2>What access includes</h2><ul><li>All currently available jobs admitted by your confirmed filters and capability evidence.</li><li>Neutral newest-first browsing, disclosed-salary sorting, stable pagination, source attribution, and direct application links.</li><li>Clear warnings where important listing information is unknown.</li></ul><h2>What it does not include</h2><p>No fit scores, percentage matches, “recommended” ordering, tiers, automatic Top 10, or claim that every listing was individually reviewed.</p><p>Need human comparison? The existing <Link href="/get-started">$20 Top 10 service</Link> remains available without a subscription. Tailored résumé and cover-letter materials are $8 per selected job. ApplyPack never submits applications.</p></section>
  </div></main>;
}

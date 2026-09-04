import { Check, ChevronDown } from "lucide-react";
import Link from "next/link";

import { ExperienceConnector, FaqAccordion, JobMatchExample, PricingCards, ProcessSteps, TailoringExample } from "@/components/marketing/brief-interactions";
import { ButtonLink } from "@/components/ui/button-link";

export default function Home() {
  return (
    <main id="main-content" className="brief-home">
      <section className="brief-hero" aria-labelledby="home-title">
        <div className="page-frame brief-hero-grid">
          <div className="brief-hero-copy">
            <p className="eyebrow">JOB SEARCH HELP FOR WOMEN MOVING FORWARD</p>
            <h1 id="home-title">Finding the right job shouldn&apos;t become your full-time job.</h1>
            <p className="brief-hero-lede">You may be qualified for more roles than you realize. ApplyPack finds 10 current jobs that fit both what you can do and what your life requires, for $20, delivered within 24 hours.</p>
            <div className="button-row brief-hero-actions"><ButtonLink href="/get-started">Find My 10 Jobs</ButtonLink><a className="brief-text-link" href="#how-it-works">See How It Works <ChevronDown aria-hidden="true" /></a></div>
            <div className="brief-offer-strip" aria-label="Offer summary"><span><strong>10</strong> jobs</span><span><strong>$20</strong> one time</span><span><strong>24</strong> hours</span></div>
            <p className="brief-reassurance">One search. No subscription. You choose where to apply.</p>
            <p className="brief-second-product">Found a job you want? Add a <strong>tailored resume and cover letter for $8.</strong></p>
          </div>
          <div className="brief-fit-visual" aria-label="ApplyPack considers three inputs to find ten jobs worth reviewing"><div className="brief-fit-inputs"><span>What you can do</span><span>What your life requires</span><span>What you want to avoid</span></div><div className="brief-fit-path" aria-hidden="true"><i /><i /><i /></div><strong>10 jobs worth reviewing</strong></div>
        </div>
      </section>

      <section className="brief-section brief-section-life" aria-labelledby="real-match-title">
        <div className="page-frame brief-split"><div className="brief-heading-block"><p className="eyebrow">MORE THAN A SKILL MATCH</p><h2 id="real-match-title">A job can fit your abilities and still be wrong for your life.</h2><p>You may be able to do the work, but the pay, schedule, location, travel, or benefits may not work. ApplyPack looks at the whole fit before a job reaches you.</p><p className="brief-emphasis">The right opportunity has to match both what you can do and how you need to work.</p></div><JobMatchExample /></div>
      </section>

      <section className="brief-section brief-section-connector" aria-labelledby="experience-title">
        <div className="page-frame"><div className="brief-heading-block brief-heading-wide"><p className="eyebrow">THE TITLE MAY BE HIDING THE MATCH</p><h2 id="experience-title">You may not be unqualified. You may be searching under the wrong job titles.</h2><p>Most job searches begin with a title you already know. That can hide roles that use the same skills under completely different names. We look at the work behind your experience, then find where it may fit next.</p></div><ExperienceConnector /></div>
      </section>

      <section className="brief-section brief-section-workload" aria-labelledby="workload-title">
        <div className="page-frame"><div className="brief-heading-block brief-heading-wide"><p className="eyebrow">WE DO THE TIME-CONSUMING PART</p><h2 id="workload-title">You should not have to spend every spare hour figuring out where you fit.</h2><p>We search current listings, compare responsibilities, research employers, check your requirements, and explain why each opportunity is worth reviewing.</p></div><div className="brief-workload"><h3>Hours of searching become 10 focused choices.</h3><article className="brief-receive"><h4>What you receive</h4><ul><li>10 current job opportunities</li><li>Direct application links</li><li>Why each job may fit</li><li>Pay, location, schedule, and remote details when listed</li><li>Important requirements and possible gaps</li><li>The date each listing was checked</li></ul></article><details className="brief-handle"><summary>See what we handle</summary><div><h4>What the search normally takes</h4><ul><li>Guessing which titles to search</li><li>Opening listing after listing</li><li>Checking pay, schedule, location, and benefits</li><li>Researching unfamiliar companies</li><li>Comparing requirements with your experience</li><li>Ruling out jobs that break a dealbreaker</li></ul></div></details><p className="brief-workload-close">ApplyPack does the research. You decide what is worth pursuing.</p></div></div>
      </section>

      <section className="brief-section brief-section-process" id="how-it-works" aria-labelledby="process-title">
        <div className="page-frame"><div className="brief-heading-block brief-heading-wide"><p className="eyebrow">FROM SEARCHING TO READY TO APPLY</p><h2 id="process-title">Four clear steps. You stay in control of every decision.</h2></div><ProcessSteps /><TailoringExample /></div>
      </section>

      <section className="brief-section brief-section-pricing" aria-labelledby="pricing-title">
        <div className="page-frame"><div className="brief-heading-block brief-heading-wide"><p className="eyebrow">AFFORDABLE BY DESIGN</p><h2 id="pricing-title">Pay for the help you need, only when you need it.</h2><p>Returning to work or changing direction can already come with financial pressure. ApplyPack starts with a focused $20 search, then lets you add application materials only for the jobs you choose.</p></div><PricingCards /><div className="brief-price-examples" aria-label="Price examples"><span>Search only: <strong>$20</strong></span><span>Search plus one: <strong>$28 total</strong></span><span>Search plus three: <strong>$44 total</strong></span><span>Search plus all 10: <strong>$100 total</strong></span></div><ul className="brief-reassurance-row"><li><Check aria-hidden="true" />No subscription</li><li><Check aria-hidden="true" />No expensive coaching package</li><li><Check aria-hidden="true" />No automatic applications</li><li><Check aria-hidden="true" />No obligation to buy all 10 document sets</li></ul></div>
      </section>

      <section className="brief-section brief-section-close" aria-labelledby="founder-title">
        <div className="page-frame"><div className="brief-founder-trust"><article className="brief-founder"><p className="eyebrow">WHY I BUILT APPLYPACK</p><h2 id="founder-title">I knew I could do more. I did not have unlimited time to prove it one listing at a time.</h2><p>I loved teaching and never expected my career to move outside education. Later, after time focused on my family and running a small business, I needed work that fit the life I had now. I knew what I could not return to, but I did not know what job titles to search.</p><p>The more descriptions I read, the more I realized my experience was broader than my resume made it look. Planning, documentation, training, problem solving, purchasing, inventory, and operations appeared under titles I had never considered. I was capable of more than my original search showed me, but uncovering those connections took hours.</p><p className="brief-founder-lock">I built ApplyPack for women going through transitions like mine, women who are capable, determined, and ready to move forward, but need work that fits the reality of their lives. ApplyPack makes the connections we may not see on our own, making the path back to work feel possible, even when life is already full.</p></article><aside className="brief-trust" aria-labelledby="trust-title"><h3 id="trust-title">Honest help, without promises no one can make.</h3><ul><li>A person reviews every delivery</li><li>Your experience stays truthful</li><li>You decide where to apply</li><li>Employers control hiring decisions</li></ul><p>ApplyPack can make the search clearer and the application stronger. It cannot guarantee an interview, offer, salary, or hiring decision.</p></aside></div><div className="brief-faq-block"><div><p className="eyebrow">FREQUENTLY ASKED QUESTIONS</p><h2>Clear answers before you begin.</h2></div><FaqAccordion /><Link className="brief-text-link" href="/faq">Read All FAQs</Link></div><div className="brief-final-cta"><div><h2>You may be closer to the right opportunity than your current search makes it seem.</h2><p>Let ApplyPack find the connection and give you back the hours it takes to uncover it.</p><p className="brief-supporting">10 researched matches. $20. Delivered within 24 hours.</p></div><ButtonLink href="/get-started" variant="light">Find My 10 Jobs</ButtonLink></div></div>
      </section>
    </main>
  );
}

import type { Metadata } from "next";

import { ButtonLink } from "@/components/ui/button-link";

const description =
  "The personal story behind Apply Pack: a more affordable, flexible way to connect real experience with work that fits real life.";

export const metadata: Metadata = {
  title: { absolute: "Why I Built Apply Pack | Apply Pack" },
  description,
  alternates: { canonical: "/why-apply-pack" },
  openGraph: {
    title: "Why I Built Apply Pack | Apply Pack",
    description,
    type: "article",
    url: "/why-apply-pack",
    images: ["/opengraph-image.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Why I Built Apply Pack | Apply Pack",
    description,
    images: ["/opengraph-image.png"],
  },
};

export default function WhyApplyPackPage() {
  return (
    <main id="main-content" className="founder-story">
      <section className="founder-story__hero">
        <div className="page-frame founder-story__hero-grid">
          <div className="founder-story__hero-copy">
            <p className="eyebrow">THE STORY BEHIND APPLY PACK</p>
            <h1>Why I Built Apply Pack</h1>
            <p className="founder-story__lead">
              Apply Pack began during one of the most difficult transitions of my life.
            </p>
          </div>

          <aside className="founder-story__truth-card" aria-label="The need that started Apply Pack">
            <p>I did not need another endless list of jobs.</p>
            <strong>I needed realistic opportunities worth my time.</strong>
          </aside>
        </div>
      </section>

      <section className="founder-story__opening">
        <div className="page-frame founder-story__opening-grid">
          <article className="founder-story__opening-card founder-story__opening-card--wide">
            <h2>Returning to the Workforce</h2>
            <p>
              After years as a stay-at-home mom, I was separated, going through a divorce, and facing the reality that I needed to return to the workforce. With my children in my care about 90 percent of the time, including every school night, I needed work that could support my family while allowing me to remain the primary parent to two children with special needs.
            </p>
          </article>
          <article className="founder-story__opening-card founder-story__opening-card--compact">
            <h2>Remote Work Was a Necessity</h2>
            <p>
              Remote work was not simply a preference. I needed the flexibility to manage IEP meetings, medical appointments, school responsibilities, and the unexpected situations that required me to be there.
            </p>
          </article>
        </div>
      </section>

      <section className="founder-story__shared-problem">
        <div className="page-frame">
          <article className="founder-story__shared-card">
            <h2>This Wasn&apos;t Just a “Me” Problem</h2>
            <div>
              <p>
                I realized other women had to be facing the same problem. Like me, they needed meaningful help finding work, but they might not have hundreds or thousands of dollars to spend on a career coach or résumé package.
              </p>
              <p>Out of personal necessity, I built Apply Pack, the affordable, flexible service I also needed.</p>
            </div>
          </article>
        </div>
      </section>

      <section className="founder-story__chapters" aria-label="How Apply Pack began">
        <div className="page-frame founder-story__chapter-list">
          <article className="founder-story__chapter founder-story__chapter--lavender">
            <h2>My Résumé Missed My Story</h2>
            <p>When I started looking for work, I undersold myself.</p>
            <p>
              On paper, my years as a stay-at-home mom looked like a gap. But that gap did not tell the whole story. During those years, I ran a mobile spray-tanning business and sold products on Amazon. I learned about logistics, inventory, buying behavior, advertising, scheduling, customer service, and the constant decision-making required to operate a small business.
            </p>
            <p>
              When I considered those skills alongside everything I had learned as a teacher, I realized my experience was far more valuable and versatile than my résumé made it appear.
            </p>
          </article>

          <article className="founder-story__chapter founder-story__chapter--mint">
            <h2>Titles Hid the Match</h2>
            <p>
              When I was looking on job boards like Indeed, I would see an unfamiliar job title and assume I was not qualified before reading the full description. But when I took the time to look beyond the title and examine the actual responsibilities, I often discovered that I had already performed similar tasks, just in a more unconventional setting.
            </p>
            <p>My skills were there, but their connection to those intimidating job titles was not initially obvious.</p>
          </article>

          <article className="founder-story__chapter founder-story__chapter--gold">
            <h2>I Needed More Than a Search</h2>
            <p>
              Looking for a job felt like a full-time job. I did not need another job board giving me hundreds of listings to sort through. I also did not need expensive career coaching, another subscription, or a package that made me pay for services I might not use.
            </p>
            <p>
              I needed something that could examine my complete experience, search beyond the titles I already knew, read the actual job descriptions, research the companies, and apply my requirements for salary, benefits, travel, location, and flexibility.
            </p>
            <p><strong>I needed realistic opportunities worth my time, not another endless list of jobs.</strong></p>
          </article>
        </div>
      </section>

      <section className="founder-story__close">
        <div className="page-frame founder-story__close-box">
          <div>
            <h2>A Solution for Us</h2>
            <p>
              I built Apply Pack for women going through transitions like mine. These women are capable, determined, and ready to move forward, but need work that fits the reality of their lives. Apply Pack makes the connections we may not see on our own, making the path back to work feel possible, even when life is already full.
            </p>
          </div>
          <ButtonLink className="founder-story__cta" href="/get-started" variant="light">
            Find My 10 Jobs
          </ButtonLink>
        </div>
      </section>
    </main>
  );
}

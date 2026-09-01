import {
  ArrowDown,
  Check,
  Clock3,
  FileCheck2,
  Search,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";

import { DocumentVisual } from "@/components/marketing/document-visual";
import { ButtonLink } from "@/components/ui/button-link";

export default function Home() {
  return (
    <main id="main-content">
      <section className="hero-section">
        <div className="page-frame hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">24-HOUR JOB SEARCH + APPLICATION HELP</p>
            <h1>Finding a job should not become your full-time job.</h1>
            <p className="hero-lede">
              Get 10 jobs matched around your experience, priorities, and
              dealbreakers within 24 hours.
            </p>
            <p className="hero-secondary">
              See one you want? Get a resume and cover letter tailored
              specifically for that job within the next 24 hours.
            </p>
            <div className="hero-price-row">
              <span><strong>$20</strong> for 10 matched jobs</span>
              <span><strong>$8</strong> per selected Apply Pack</span>
            </div>
            <div className="button-row">
              <ButtonLink href="/get-started">Get My 10 Jobs in 24 Hours</ButtonLink>
              <ButtonLink href="/how-it-works" variant="secondary">
                See How It Works
              </ButtonLink>
            </div>
            <p className="trust-line">
              No subscription. No mass applying. No fake experience.
            </p>
          </div>
          <DocumentVisual />
        </div>
      </section>

      <section className="trust-strip" aria-label="ApplyPack service highlights">
        <div className="page-frame trust-strip-inner">
          <span><Clock3 aria-hidden="true" /> 24-hour turnaround</span>
          <span><Search aria-hidden="true" /> 10 focused matches</span>
          <span><FileCheck2 aria-hidden="true" /> Job-specific documents</span>
          <span><ShieldCheck aria-hidden="true" /> Human-reviewed and truthful</span>
        </div>
      </section>

      <section className="section-shell">
        <div className="page-frame">
          <div className="section-heading section-heading--split">
            <div>
              <p className="eyebrow">A SMALLER, BETTER PLACE TO START</p>
              <h2>You do not have to know the job title yet.</h2>
            </div>
            <p>
              Know what fits your life? Know what you are done doing? That is
              enough to start.
            </p>
          </div>
          <div className="bento-grid">
            <article className="bento-card bento-card--lead bento-card--lavender">
              <p className="card-kicker">KEEP</p>
              <h3>What needs to fit your life now?</h3>
              <div className="selection-list">
                {["Remote", "$80K+", "Benefits", "Flexible schedule"].map((item) => (
                  <span key={item}><Check aria-hidden="true" /> {item}</span>
                ))}
              </div>
              <div className="match-result">
                10 jobs matched around your priorities
              </div>
            </article>
            <article className="bento-card bento-card--compact bento-card--rose">
              <p className="card-kicker">LEAVE BEHIND</p>
              <h3>The work you never want again.</h3>
              <div className="selection-list selection-list--negative">
                {["Sales", "Marketing", "Cold calling", "Heavy phone work"].map((item) => (
                  <span key={item}><X aria-hidden="true" /> {item}</span>
                ))}
              </div>
            </article>
            <article className="bento-card bento-card--small bento-card--mint">
              <p className="card-kicker">SEARCHING</p>
              <h3>We do the scrolling.</h3>
              <p>Current opportunities, direct links, and clear details.</p>
            </article>
            <article className="bento-card bento-card--small bento-card--gold">
              <p className="card-kicker">CONNECTING</p>
              <h3>We find the honest overlap.</h3>
              <p>Your old title is not the limit of what you can do next.</p>
            </article>
            <article className="bento-card bento-card--wide bento-card--sky">
              <div>
                <p className="card-kicker">WRITING</p>
                <h3>One application, built around one real job.</h3>
                <p>We change the emphasis, not the truth.</p>
              </div>
              <div className="mini-document">
                <span>Resume</span>
                <strong>Relevant experience first</strong>
                <i /><i /><i />
              </div>
            </article>
          </div>
        </div>
      </section>

      <section className="section-shell section-shell--flush">
        <div className="page-frame">
          <div className="dark-showcase">
            <div className="showcase-intro">
              <p className="eyebrow eyebrow--light">
                SAME EXPERIENCE. A CLEARER CONNECTION.
              </p>
              <h2>Your next job does not have to look like your last one.</h2>
              <p>
                ApplyPack looks past the title and compares the work underneath it.
              </p>
            </div>
            <div className="showcase-zone">
              <div className="showcase-copy">
                <span className="showcase-number">01</span>
                <h3>Searching</h3>
                <p>
                  Thousands of noisy results become 10 opportunities selected
                  around the criteria you approved.
                </p>
              </div>
              <div className="result-stack" aria-hidden="true">
                <span>Sponsored</span><span>Wrong state</span>
                <span>Sales</span><span>Expired</span>
                <strong>10 jobs worth your time</strong>
              </div>
            </div>
            <div className="showcase-zone showcase-zone--reverse">
              <div className="showcase-copy">
                <span className="showcase-number">02</span>
                <h3>Connecting</h3>
                <p>
                  Teaching can contain training, documentation, planning,
                  communication, and progress tracking.
                </p>
              </div>
              <div
                className="connection-map"
                aria-label="Possible connections from teaching experience"
              >
                <span>Teacher</span>
                <ArrowDown aria-hidden="true" />
                <strong>Training + Documentation + Planning</strong>
                <ArrowDown aria-hidden="true" />
                <span>Possible direction: Client Onboarding</span>
              </div>
            </div>
            <div className="showcase-zone">
              <div className="showcase-copy">
                <span className="showcase-number">03</span>
                <h3>Writing</h3>
                <p>
                  Your real experience is reorganized and explained for the
                  selected employer. Important gaps stay visible.
                </p>
              </div>
              <div className="writing-preview">
                <p>BEFORE</p>
                <span>Developed and implemented lesson plans.</span>
                <p>AFTER</p>
                <strong>
                  Created clear instructional materials, tracked progress, and
                  adjusted support when barriers arose.
                </strong>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section-shell process-section">
        <div className="page-frame">
          <div className="section-heading section-heading--center">
            <p className="eyebrow">FROM I NEED A JOB TO READY TO APPLY</p>
            <h2>Your search in 24 hours. Your application in the next 24.</h2>
          </div>
          <ol className="process-list">
            {[
              ["1", "Tell us what stays and what goes.", "Complete your preferences and approve the exact search."],
              ["2", "Get 10 matched jobs.", "Each result explains why it may fit and what to know."],
              ["3", "Choose the ones you actually want.", "Select one, several, all 10, or none."],
              ["4", "Get job-specific documents.", "Receive a tailored resume and cover letter for $8 per selected job."],
            ].map(([number, title, text]) => (
              <li key={number}>
                <span className="process-number">{number}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ol>
          <div className="center-action">
            <ButtonLink href="/get-started">Start My 24-Hour Search</ButtonLink>
          </div>
        </div>
      </section>

      <section className="section-shell section-shell--tinted">
        <div className="page-frame pricing-grid">
          <div className="pricing-copy">
            <p className="eyebrow">PAY FOR THE HELP YOU ACTUALLY USE</p>
            <h2>Start with the search. Choose where to spend more.</h2>
            <p>
              You should not have to pay for 10 applications before seeing the jobs.
            </p>
          </div>
          <article className="price-card price-card--primary">
            <span>JOB MATCH SEARCH</span>
            <strong>$20</strong>
            <p>10 current opportunities selected around your approved criteria.</p>
            <ul>
              <li><Check aria-hidden="true" /> Direct job links</li>
              <li><Check aria-hidden="true" /> Fit and gap explanations</li>
              <li><Check aria-hidden="true" /> Delivered within 24 hours</li>
            </ul>
          </article>
          <article className="price-card">
            <span>APPLY PACK</span>
            <strong>$8 <small>per selected job</small></strong>
            <p>One resume and one cover letter tailored to the job you choose.</p>
            <ul>
              <li><Check aria-hidden="true" /> Editable Word documents</li>
              <li><Check aria-hidden="true" /> Human review</li>
              <li><Check aria-hidden="true" /> One factual-correction round</li>
            </ul>
          </article>
        </div>
      </section>

      <section className="section-shell">
        <div className="page-frame outcome-grid">
          <div>
            <p className="eyebrow">BUILT AROUND WHAT IS TRUE</p>
            <h2>
              No one can promise you the job. ApplyPack can make sure you are
              ready to apply.
            </h2>
          </div>
          <article>
            <h3>What ApplyPack handles</h3>
            {[
              "Jobs selected around approved criteria",
              "Honest reasons they may fit",
              "Job-specific resumes and cover letters",
              "Human review before delivery",
            ].map((item) => <p key={item}><Check aria-hidden="true" /> {item}</p>)}
          </article>
          <article>
            <h3>What employers decide</h3>
            {[
              "Who reviews an application",
              "Who receives an interview",
              "Who receives an offer",
              "What compensation is offered",
            ].map((item) => <p key={item}><Sparkles aria-hidden="true" /> {item}</p>)}
          </article>
        </div>
      </section>

      <section className="section-shell faq-preview">
        <div className="page-frame faq-grid">
          <div>
            <p className="eyebrow">QUESTIONS BEFORE YOU START?</p>
            <h2>The details should feel clear before you pay.</h2>
            <ButtonLink href="/faq" variant="secondary">
              Read All Frequently Asked Questions
            </ButtonLink>
          </div>
          <div className="accordion-list">
            {[
              ["What if I do not know what job I want?", "That is normal. Start with what fits your life and what you do not want to do again."],
              ["Do I need an existing resume?", "Yes. It may be old or written for another career. It gives ApplyPack a factual starting point."],
              ["Does ApplyPack guarantee an interview?", "No. ApplyPack prepares the search and application. Employers make every hiring decision."],
              ["Does ApplyPack use AI?", "Technology may help with research and drafting. A person reviews every match and application document."],
            ].map(([question, answer]) => (
              <details key={question}>
                <summary>{question}</summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="final-cta-wrap">
        <div className="page-frame">
          <div className="final-cta">
            <p className="eyebrow eyebrow--light">YOU ALREADY HAVE ENOUGH TO START</p>
            <h2>Tell us what fits your life and what you are done doing.</h2>
            <p>10 matched jobs. $20. Delivered within 24 hours.</p>
            <ButtonLink href="/get-started" variant="light">
              Get My 10 Jobs in 24 Hours
            </ButtonLink>
          </div>
        </div>
      </section>
    </main>
  );
}

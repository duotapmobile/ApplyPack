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
            <h1>Finding a job shouldn&apos;t become your full-time job.</h1>
            <p className="hero-lede">
              Get 10 jobs matched around your experience, priorities, and
              dealbreakers within 24 hours.
            </p>
            <p className="hero-secondary"><strong>See one you want?</strong></p>
            <p className="hero-secondary">
              Get a resume and cover letter tailored specifically for that job
              within the next 24 hours.
            </p>
            <div className="hero-price-row">
              <span>10 matched jobs: <strong>$20</strong></span>
              <span>Tailored resume + cover letter: <strong>$8 per selected job</strong></span>
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

      <section className="section-shell process-section">
        <div className="page-frame">
          <div className="section-heading section-heading--center">
            <p className="eyebrow">NO WAITING WEEKS TO GET STARTED.</p>
            <h2>Within 24 hours: 10 jobs matched around you.</h2>
            <p>
              Choose one. Within the next 24 hours, your tailored resume and
              cover letter are ready.
            </p>
          </div>
          <ol className="process-list timeline-list">
            {[
              ["1", "Today", "Complete your preferences and pay $20"],
              ["2", "Within 24 hours", "Receive 10 matched jobs"],
              ["3", "Select a job", "Choose an Apply Pack for $8"],
              ["4", "Within the next 24 hours", "Receive your tailored resume and cover letter"],
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

      <section className="section-shell section-shell--flush">
        <div className="page-frame">
          <div className="dark-showcase compact-showcase">
            <div className="showcase-intro">
              <p className="eyebrow eyebrow--light">
                YOUR NEXT JOB DOESN&apos;T HAVE TO LOOK LIKE YOUR LAST ONE.
              </p>
              <h2>Different job. Same valuable skills. ApplyPack makes the connection.</h2>
              <ButtonLink href="/experience-connections" variant="light">
                See the Connections
              </ButtonLink>
            </div>
            <div className="showcase-zone">
              <div className="showcase-copy">
                <span className="showcase-number">PAST ROLE</span>
                <h3>Teacher</h3>
                <p><strong>Not again:</strong> Teaching</p>
              </div>
              <div
                className="connection-map"
                aria-label="Possible new directions from teaching experience"
              >
                <span>Training · Planning · Documentation · Data · Communication · Leadership</span>
                <ArrowDown aria-hidden="true" />
                <strong>Possible new directions</strong>
                <span>Client Onboarding · Training Coordination · Operations · Project Coordination</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section-shell">
        <div className="page-frame">
          <div className="section-heading section-heading--split">
            <div>
              <p className="eyebrow">YOU DON&apos;T HAVE TO KNOW THE JOB TITLE YET.</p>
              <h2>
                Know what fits your life? Know what you&apos;re done doing?
                That&apos;s enough to start.
              </h2>
            </div>
            <p>ApplyPack searches for what fits between the two.</p>
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
          <div className="center-action">
            <ButtonLink href="/job-search-help" variant="secondary">
              See How Job Matching Works
            </ButtonLink>
          </div>
        </div>
      </section>

      <section className="section-shell section-shell--tinted">
        <div className="page-frame">
          <div className="section-heading section-heading--center">
            <p className="eyebrow">YOU MAY BE QUALIFIED FOR MORE THAN YOU THINK.</p>
            <h2>You bring the skills. ApplyPack finds where they fit.</h2>
          </div>
          <div className="overlap-grid">
            {[
              {
                title: "Ran a small cake business",
                skills: "Orders · Customers · Inventory · Purchasing · Deadlines",
                directions: "Operations · Order Management · Customer Support · Inventory Coordination",
              },
              {
                title: "Worked as a teacher",
                skills: "Training · Documentation · Progress Tracking · Planning · Communication",
                directions: "Client Onboarding · Training Coordination · Project Coordination · Operations",
              },
              {
                title: "Worked as a retail supervisor",
                skills: "Scheduling · Team Training · Customer Escalations · Inventory · Performance Tracking",
                directions: "Customer Success · Operations · Team Support · Account Support",
              },
            ].map((example) => (
              <article className="overlap-card" key={example.title}>
                <h3>{example.title}</h3>
                <p>{example.skills}</p>
                <strong>Possible overlap:</strong>
                <p>{example.directions}</p>
              </article>
            ))}
          </div>
          <div className="center-action">
            <ButtonLink href="/experience-connections">See More Examples</ButtonLink>
          </div>
        </div>
      </section>

      <section className="section-shell section-shell--flush">
        <div className="page-frame">
          <div className="dark-showcase compact-showcase">
            <div className="showcase-intro">
              <p className="eyebrow eyebrow--light">
                YOU HAVE BETTER THINGS TO DO THAN SCROLL THROUGH JOBS ALL DAY.
              </p>
              <h2>ApplyPack does the searching. You do the choosing.</h2>
              <ButtonLink href="/pricing" variant="light">
                See What You Get for $20
              </ButtonLink>
            </div>
            <div className="showcase-zone">
              <div className="showcase-copy">
                <span className="showcase-number">ILLUSTRATIVE EXAMPLE</span>
                <h3>2,847 results</h3>
              </div>
              <div
                className="result-stack"
                aria-label="Example of noisy job results narrowing to ten matches"
              >
                {[
                  "Sponsored",
                  "Wrong state",
                  "Sales",
                  "Reposted",
                  "Expired",
                  "Marketing",
                  "Commission only",
                  "Wrong schedule",
                ].map((item) => <span key={item}>{item}</span>)}
                <strong>10 jobs worth your time</strong>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section-shell process-section">
        <div className="page-frame">
          <div className="section-heading section-heading--center">
            <p className="eyebrow">
              YOUR RESUME MAY MEET SOFTWARE BEFORE IT MEETS A PERSON.
            </p>
            <h2>ApplyPack prepares it to make sense to both.</h2>
          </div>
          <ol className="process-list process-list--three">
            {[
              ["1", "You submit your application"],
              ["2", "Hiring software may sort and organize it"],
              ["3", "A recruiter or hiring manager reviews it"],
            ].map(([number, text]) => (
              <li key={number}>
                <span className="process-number">{number}</span>
                <h3>{text}</h3>
              </li>
            ))}
          </ol>
          <div className="center-action">
            <ButtonLink href="/resume-screening" variant="secondary">
              See What Happens Before a Human Reads It
            </ButtonLink>
          </div>
        </div>
      </section>

      <section className="section-shell section-shell--tinted">
        <div className="page-frame">
          <div className="section-heading section-heading--center">
            <p className="eyebrow">NOT JUST ANOTHER AI RESUME.</p>
            <h2>A quick AI rewrite changes words.</h2>
            <p>
              ApplyPack decides what belongs, why it matters, and whether it is
              true.
            </p>
          </div>
          <div className="comparison-grid">
            <article className="comparison-card">
              <p className="card-kicker">QUICK AI REWRITE</p>
              <p>Old resume</p>
              <ArrowDown aria-hidden="true" />
              <p>Rewrite</p>
              <ArrowDown aria-hidden="true" />
              <strong>Generic application</strong>
            </article>
            <article className="comparison-card comparison-card--brand">
              <p className="card-kicker">APPLYPACK</p>
              <p>
                Your experience + Your priorities + The actual job + What the
                employer needs
              </p>
              <ArrowDown aria-hidden="true" />
              <strong>Application built for that job</strong>
            </article>
          </div>
          <p className="centered-trust-copy">
            No fake experience. No invented numbers. No buzzword soup.
          </p>
          <div className="center-action">
            <ButtonLink href="/not-just-ai">See What We Do Differently</ButtonLink>
          </div>
        </div>
      </section>

      <section className="section-shell section-shell--flush">
        <div className="page-frame">
          <div className="dark-showcase compact-showcase">
            <div className="showcase-intro">
              <p className="eyebrow eyebrow--light">
                SAME EXPERIENCE. BETTER CONNECTION.
              </p>
              <h2>See the job we found, why it fit, what changed, and why.</h2>
              <ButtonLink href="/before-and-after" variant="light">
                See the Before and After
              </ButtonLink>
            </div>
            <div className="showcase-zone">
              <div className="writing-preview">
                <p>BEFORE</p>
                <span>
                  Developed and implemented lesson plans for third-grade students.
                </span>
                <p>AFTER</p>
                <strong>
                  Created clear instructional materials, guided students and
                  families through new processes, tracked progress, and adjusted
                  support when questions or barriers arose.
                </strong>
              </div>
              <div className="callout-list" aria-label="What changed">
                {[
                  "More relevant detail",
                  "Still completely true",
                  "Written for the new role",
                ].map((item) => (
                  <span key={item}><Check aria-hidden="true" /> {item}</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section-shell process-section">
        <div className="page-frame">
          <div className="section-heading section-heading--center">
            <p className="eyebrow">FROM &quot;I NEED A JOB&quot; TO READY TO APPLY.</p>
            <h2>Four clear steps.</h2>
          </div>
          <ol className="process-list">
            {[
              ["1", "Tell us what stays and what goes."],
              ["2", "Get 10 matched jobs within 24 hours."],
              ["3", "Choose the ones you actually want."],
              ["4", "Get a tailored resume and cover letter within 24 hours."],
            ].map(([number, title]) => (
              <li key={number}>
                <span className="process-number">{number}</span>
                <h3>{title}</h3>
              </li>
            ))}
          </ol>
          <div className="center-action">
            <ButtonLink href="/get-started">Start My 24-Hour Search</ButtonLink>
          </div>
        </div>
      </section>

      <section className="section-shell section-shell--tinted">
        <div className="page-frame">
          <div className="section-heading section-heading--center">
            <p className="eyebrow">PAY FOR THE HELP YOU ACTUALLY USE.</p>
          </div>
          <div className="pricing-cards">
            <article className="price-card price-card--primary">
              <span>JOB MATCH SEARCH</span>
              <strong>$20</strong>
              <p>
                10 current job opportunities selected around your experience,
                priorities, and dealbreakers.
              </p>
              <b>DELIVERED WITHIN 24 HOURS</b>
              <ul>
                {[
                  "Direct job links",
                  "Why each job may fit",
                  "Salary, location, and remote details when listed",
                  "Important requirements",
                  "Possible concerns or gaps",
                  "The date each opportunity was checked",
                ].map((item) => <li key={item}><Check aria-hidden="true" /> {item}</li>)}
              </ul>
              <ButtonLink href="/get-started">Get My 10 Jobs in 24 Hours</ButtonLink>
            </article>
            <article className="price-card">
              <span>APPLY PACK</span>
              <strong>$8 <small>per selected job</small></strong>
              <p>
                A resume and cover letter tailored specifically for the job you
                choose.
              </p>
              <b>DELIVERED WITHIN 24 HOURS</b>
              <ul>
                {[
                  "Job-specific resume",
                  "Job-specific cover letter",
                  "Editable Word documents",
                  "Human review before delivery",
                  "One round of factual corrections",
                ].map((item) => <li key={item}><Check aria-hidden="true" /> {item}</li>)}
              </ul>
              <ButtonLink href="/before-and-after" variant="secondary">
                See the Before and After
              </ButtonLink>
            </article>
          </div>
          <p className="pricing-close">
            Your search in 24 hours. Your application in the next 24. No
            subscription. No obligation to purchase an Apply Pack for every job.
          </p>
        </div>
      </section>

      <section className="section-shell">
        <div className="page-frame outcome-grid">
          <div>
            <p className="eyebrow">NO ONE CAN PROMISE YOU THE JOB.</p>
            <h2>ApplyPack can make sure you&apos;re ready to apply.</h2>
          </div>
          <article>
            <h3>What ApplyPack handles</h3>
            {[
              "Jobs selected around your approved criteria",
              "Honest explanations of why they may fit",
              "A resume tailored to the selected role",
              "A cover letter written for the employer",
              "Human review before delivery",
            ].map((item) => <p key={item}><Check aria-hidden="true" /> {item}</p>)}
          </article>
          <article>
            <h3>What employers decide</h3>
            {[
              "Who reviews your application",
              "Who receives an interview",
              "Who receives an offer",
              "What compensation is ultimately offered",
              "How long the job stays open",
            ].map((item) => <p key={item}><Sparkles aria-hidden="true" /> {item}</p>)}
          </article>
          <p className="outcome-close">
            ApplyPack does not guarantee interviews, offers, or employment. We
            handle the search, the connection, and the application. The employer
            makes the hiring decision.
          </p>
        </div>
      </section>

      <section className="section-shell trust-authority-section">
        <div className="page-frame">
          <div className="section-heading section-heading--center">
            <p className="eyebrow">BUILT AROUND WHAT IS TRUE.</p>
            <h2>
              Just a clearer connection between what you have done and what the
              employer needs.
            </h2>
          </div>
          <div className="truth-grid">
            {[
              "No made-up experience.",
              "No fake numbers.",
              "No applications sent without your approval.",
              "No promise that a resume can guarantee an interview.",
            ].map((item) => (
              <p key={item}><ShieldCheck aria-hidden="true" /> {item}</p>
            ))}
          </div>
          <div className="trust-badges" aria-label="ApplyPack trust principles">
            {["Truthful", "Job-specific", "Human-reviewed", "You stay in control"].map((item) => (
              <span key={item}>{item}</span>
            ))}
          </div>
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
          <ul className="faq-question-list">
            {[
              "What if I do not know what kind of job I want?",
              "What if I have been out of the workforce?",
              "What if I do not want to return to my old field?",
              "Do I need an existing resume?",
              "Does ApplyPack guarantee an interview?",
              "How does ApplyPack use AI?",
            ].map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="final-cta-wrap">
        <div className="page-frame">
          <div className="final-cta">
            <p className="eyebrow eyebrow--light">YOU ALREADY HAVE ENOUGH TO START.</p>
            <h2>Tell us what fits your life and what you&apos;re done doing.</h2>
            <p>ApplyPack will take it from there.</p>
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

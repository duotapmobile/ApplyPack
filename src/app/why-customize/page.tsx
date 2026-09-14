import type { Metadata } from "next";
import { ArrowDown, ArrowRight, Check, FileSearch, Link2, SearchCheck } from "lucide-react";
import Link from "next/link";

import { ButtonLink } from "@/components/ui/button-link";
import { siteConfig } from "@/config/site";

import { ResumeComparison } from "./resume-comparison";
import styles from "./why-customize.module.css";

const title = "ATS-Friendly Résumé Customization | ApplyPack";
const description =
  "Learn how hiring software may screen applications and how ApplyPack uses research-informed, job-specific résumé and cover-letter customization without inventing experience.";

export const metadata: Metadata = {
  title: { absolute: title },
  description,
  alternates: { canonical: "/why-customize" },
  openGraph: {
    title,
    description,
    type: "website",
    url: "/why-customize",
    images: [{ url: "/opengraph-image.png", width: 1200, height: 630, alt: "ApplyPack job-specific résumé and cover-letter customization" }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/opengraph-image.png"],
  },
};

const questions = [
  {
    question: "How do I get past résumé bots?",
    answer:
      "There is no universal trick or guaranteed pass. Use a readable résumé, answer application questions accurately, and connect the job's relevant language to qualifications you genuinely have. ApplyPack helps make that truthful connection clear, but customization cannot replace a missing required qualification.",
  },
  {
    question: "What is an applicant tracking system, or ATS?",
    answer:
      "An applicant tracking system is software employers use to collect and manage applications. Depending on the product and the employer's configuration, it may parse résumé text, organize candidates, support searches and filters, or apply rules based on application answers.",
  },
  {
    question: "Can hiring software reject my résumé before a person reads it?",
    answer:
      "Some systems can apply employer-configured screening rules before ordinary human review. For example, a required license or work-location answer may trigger an automatic rejection. That is different from claiming every ATS silently grades every résumé, which is not true.",
  },
  {
    question: "How does customizing my résumé help?",
    answer:
      "Customization makes the relevant evidence easier to find. It can bring matching experience forward, use clear structure, and explain responsibilities in language that fits the job while preserving your real titles, dates, tools, and results.",
  },
  {
    question: "Should I use keywords from the job description?",
    answer:
      "Use the employer's terminology when it accurately describes your experience. Do not copy terms you cannot support, hide keywords, or repeat phrases for density. ApplyPack ties job-specific wording to evidence you can defend.",
  },
  {
    question: "What research informs ApplyPack's approach?",
    answer:
      "ApplyPack reviews official hiring-system documentation, published research relevant to applicant presentation and self-promotion, and document-quality standards. We use that review to shape cautious practices. We have not run an experiment proving higher interview rates or tested these example documents inside every employer's ATS.",
  },
  {
    question: "Does a cover letter help with automated screening?",
    answer:
      "It depends on the employer and system, so we do not claim a cover letter improves ATS ranking. We use the letter for human context: it can explain a career change, return to work, or transferable background without repeating the résumé or inventing qualifications.",
  },
  {
    question: "Can ApplyPack help me find jobs as well as customize my résumé?",
    answer:
      "Yes. You can explore the filtered job board or purchase a standalone, human-reviewed Top 10. A tailored résumé and cover letter can then be purchased for an eligible board job or a job from your delivered Top 10.",
  },
];

function ChoiceLinks({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`${styles.choiceLinks} ${compact ? styles.choiceLinksCompact : ""}`}>
      <article>
        <p className={styles.choiceKicker}>Start with opportunities</p>
        <h3>Find Jobs That Fit</h3>
        <p>Explore opportunities connected to your experience and preferences.</p>
        <ButtonLink href="/job-board">Find Jobs That Fit</ButtonLink>
      </article>
      <article>
        <p className={styles.choiceKicker}>Already have an eligible job?</p>
        <h3>Customize My Résumé</h3>
        <p>Get a résumé and cover letter tailored to the job.</p>
        <ButtonLink href="/my-applypack" variant="secondary">Customize My Résumé</ButtonLink>
      </article>
    </div>
  );
}

export default function WhyCustomizePage() {
  const pageUrl = `${siteConfig.url}/why-customize`;
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${pageUrl}#webpage`,
        url: pageUrl,
        name: title,
        description,
        isPartOf: { "@type": "WebSite", name: siteConfig.name, url: siteConfig.url },
      },
      {
        "@type": "Service",
        "@id": `${pageUrl}#service`,
        name: "ApplyPack job-specific résumé and cover-letter customization",
        serviceType: "Application document preparation",
        provider: { "@type": "Organization", name: siteConfig.legalEntity, url: siteConfig.url },
        areaServed: "US",
        description: "Truthful résumé and cover-letter customization for an eligible job from a customer's active board or delivered Top 10.",
      },
    ],
  };

  return (
    <main className={styles.page} id="main-content">
      <script
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, "\u003c") }}
        type="application/ld+json"
      />

      <section aria-labelledby="why-customize-title" className={styles.hero}>
        <div className={`page-frame ${styles.heroGrid}`}>
          <div className={styles.heroCopy}>
            <p className="eyebrow">Research-backed résumé customization</p>
            <h1 id="why-customize-title">Beat the bot. Reach the human.</h1>
            <p className={styles.heroLead}>
              Not with tricks. With a résumé built from research, customized for the job, and grounded in experience you actually have.
            </p>
            <div className={styles.heroActions}>
              <ButtonLink href="/my-applypack">Build My Custom Application</ButtonLink>
              <a className="button-link button-link--secondary" href="#comparison">
                <span>See What Changes</span>
                <ArrowDown aria-hidden="true" size={18} />
              </a>
            </div>
            <p className={styles.heroBoundary}>
              Already have an eligible board or Top 10 job? Sign in to choose it. ApplyPack does not promise ATS acceptance, human review, an interview, or employment.
            </p>
          </div>

          <div aria-label="How ApplyPack connects a job requirement to real candidate evidence" className={styles.heroVisual}>
            <div>
              <span>Job requirement</span>
              <strong>Guide people through a new process</strong>
            </div>
            <ArrowRight aria-hidden="true" />
            <div>
              <span>Verified experience</span>
              <strong>Created materials and guided families</strong>
            </div>
            <p><Check aria-hidden="true" /> Clearer connection, same facts</p>
          </div>
        </div>
        <div className={`page-frame ${styles.heroChoices}`}>
          <ChoiceLinks compact />
        </div>
      </section>

      <section aria-labelledby="connected-title" className={styles.connectedSection}>
        <div className="page-frame">
          <div className={styles.sectionHeading}>
            <p className="eyebrow">One application, three connected ideas</p>
            <h2 id="connected-title">Clear enough for systems. Specific enough for people.</h2>
          </div>
          <div className={styles.connectedGrid}>
            <article>
              <span aria-hidden="true">01</span>
              <FileSearch aria-hidden="true" />
              <h3>First, the screening.</h3>
              <p>Hiring software can organize, search, and filter applications before a recruiter reviews them. Your résumé needs to present your qualifications clearly, not leave the connection to guesswork.</p>
            </article>
            <article>
              <span aria-hidden="true">02</span>
              <SearchCheck aria-hidden="true" />
              <h3>Then, the research.</h3>
              <p>We reviewed research and hiring-system guidance on résumé formatting, relevant terminology, and clear writing. Those findings inform how we prepare your application.</p>
            </article>
            <article>
              <span aria-hidden="true">03</span>
              <Link2 aria-hidden="true" />
              <h3>Applied to your application.</h3>
              <p>We compare the job&apos;s requirements with your actual experience, bring the strongest connections forward, and create a matching cover letter that explains your fit.</p>
            </article>
          </div>
          <p className={styles.connectedBoundary}>Systems and employer configurations vary. Clear customization can present evidence better, but it cannot create a missing required qualification or control a hiring decision.</p>
        </div>
      </section>

      <section aria-labelledby="comparison-title" className={styles.comparisonSection} id="comparison">
        <div className="page-frame">
          <div className={styles.sectionHeading}>
            <p className="eyebrow">Interactive résumé excerpt</p>
            <h2 id="comparison-title">Same experience. A clearer connection.</h2>
            <p>See how job-specific customization changes what your résumé emphasizes, without changing the facts.</p>
            <p className={styles.illustrativeLabel}>Illustrative fictional example, not an ATS result.</p>
          </div>
          <ResumeComparison />
          <div className={styles.changeNotes}>
            <article>
              <span>01</span>
              <h3>Relevant experience brought forward</h3>
              <p>The revised summary leads with Sarah&apos;s process guidance, instructional materials, and progress tracking instead of leaving them inside classroom language.</p>
            </article>
            <article>
              <span>02</span>
              <h3>Job terminology connected to real evidence</h3>
              <p>“New processes,” “documentation,” and “follow-up” reflect both the target requirement and work shown in the original facts.</p>
            </article>
            <article>
              <span>03</span>
              <h3>Clear structure and specific wording</h3>
              <p>The single-column excerpt uses conventional headings and says what Sarah created, tracked, and coordinated. It also keeps her software-onboarding gap visible.</p>
            </article>
          </div>
        </div>
      </section>

      <section aria-labelledby="research-title" className={styles.researchSection}>
        <div className={`page-frame ${styles.researchPanel}`}>
          <div className={styles.researchIntro}>
            <p className="eyebrow eyebrow--light">Research made practical</p>
            <h2 id="research-title">We did the research. Here is how it helps you.</h2>
            <p>Our review informs careful defaults. It is not an experiment proving employer outcomes, and our document extraction checks are not tests inside a real employer&apos;s ATS.</p>
          </div>
          <div className={styles.researchRows}>
            <article>
              <span>Research</span>
              <h3>Readable formatting</h3>
              <p>We use a straightforward layout and familiar headings to reduce avoidable reading-order and text-extraction problems.</p>
            </article>
            <article>
              <span>Research</span>
              <h3>Job-specific wording</h3>
              <p>We connect the employer&apos;s terminology to experience you actually have, helping make relevant qualifications easier to identify.</p>
            </article>
            <article>
              <span>Research</span>
              <h3>Evidence and context</h3>
              <p>Your résumé shows relevant work. Your cover letter explains why that background fits this opportunity.</p>
            </article>
          </div>

          <details className={styles.sources} id="sources">
            <summary>See our sources and standards</summary>
            <div>
              <p><strong>What we reviewed:</strong> official product documentation and ApplyPack&apos;s governed document standards. These sources describe available system behavior and cautious document practices. They do not establish a universal ATS score or guarantee an outcome.</p>
              <ul>
                <li>
                  <a href="https://doc.workday.com/admin-guide/en-us/human-capital-management/recruiting/candidates/set-up-prospects-and-candidates/hdc1552497830785.html">Workday, “Concept: Resume Parsing”</a>
                  <span>Supports the narrow point that parsing can populate fields and that results vary with format and word order.</span>
                </li>
                <li>
                  <a href="https://developer.workday.com/documentation/GUID-f07adb7f-630e-42a2-9de9-a39652e34ec5-enHYPHENus/ResumeRESTAPI">Workday, “Resume REST API”</a>
                  <span>Supports the distinction between machine extraction of résumé entities and a hiring decision.</span>
                </li>
                <li>
                  <a href="https://docs.oracle.com/en/cloud/saas/talent-management/faush/advanced-job-application-filters.html">Oracle, “Advanced Job Application Filters”</a>
                  <span>Supports that recruiters can filter applications using structured criteria such as questions, skills, employers, positions, and education.</span>
                </li>
                <li>
                  <a href="https://support.greenhouse.io/hc/en-us/articles/360000653472-Auto-reject">Greenhouse, “Auto-reject”</a>
                  <span>Supports that an employer can configure certain application-question responses to trigger automatic rejection.</span>
                </li>
                <li>
                  <a href="https://doi.org/10.1093/qje/qjac003">Exley and Kessler, “The Gender Gap in Self-Promotion”</a>
                  <span>Supports our decision to use recognition-based evidence confirmation alongside free-text self-description. Its specific study settings do not establish a universal effect or an ATS outcome.</span>
                </li>
                <li>
                  <a href="https://doi.org/10.1038/s41562-022-01485-6">Kristal, Nicks, Gloor, and Hauser, “Reducing discrimination against job seekers with and without employment gaps”</a>
                  <span>Supports cautious testing of chronology and presentation alternatives for employment gaps. It does not create a universal U.S. résumé-format rule.</span>
                </li>
                <li>
                  <strong>ApplyPack document-generation standard</strong>
                  <span>Our governed standard requires single-column Arial documents, selectable text, conventional headings, verified factual provenance, and human content and visual approval before release.</span>
                </li>
                <li>
                  <strong>ApplyPack local document-extraction audit, September 7, 2026</strong>
                  <span>Seven controlled DOCX/PDF pairs had matching normalized text and searchable PDF pages in local XML, Mammoth, and pdfplumber checks. This was not a live employer ATS test or a current external-parser comparison.</span>
                </li>
              </ul>
              <p><strong>Scope:</strong> We reviewed these materials. We did not run the vendors&apos; systems, test every employer configuration, or measure interview improvement. Product capabilities and employer settings can change.</p>
            </div>
          </details>
        </div>
      </section>

      <section aria-labelledby="letter-title" className={styles.letterSection}>
        <div className={`page-frame ${styles.letterGrid}`}>
          <div>
            <p className="eyebrow">The human context</p>
            <h2 id="letter-title">The résumé shows the evidence. The letter explains the fit.</h2>
          </div>
          <div>
            <p>Changing careers? Returning to work? Your experience may need more context than a résumé bullet can provide. Your customized cover letter connects your background to the opportunity without repeating your résumé or inventing qualifications.</p>
            <p className={styles.letterBoundary}>A cover letter can add context for a person. We do not claim it universally changes automated screening or ranking.</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="questions-title" className={styles.questionsSection}>
        <div className={`page-frame ${styles.questionsGrid}`}>
          <div className={styles.questionsIntro}>
            <p className="eyebrow">Straight answers</p>
            <h2 id="questions-title">Questions about résumé bots and customization</h2>
            <p>Hiring systems differ. These answers separate what software can do from what employers and candidates decide.</p>
          </div>
          <div className={styles.questionsList}>
            {questions.map(({ question, answer }) => (
              <details key={question}>
                <summary>{question}<span aria-hidden="true">+</span></summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </div>
        <div className={`page-frame ${styles.afterQuestions}`}>
          <ChoiceLinks />
        </div>
      </section>

      <section aria-labelledby="final-title" className={styles.finalSection}>
        <div className={`page-frame ${styles.finalPanel}`}>
          <div>
            <p className="eyebrow eyebrow--light">Truth first</p>
            <h2 id="final-title">Give your experience a clearer introduction.</h2>
            <p>A résumé tailored to the role. A cover letter that explains the connection. Both grounded in what you have actually done.</p>
            <p className={styles.trustLine}>No hidden keywords. No invented experience. No promises of an interview.</p>
          </div>
          <div>
            <ButtonLink href="/my-applypack" variant="light">Build My Custom Application</ButtonLink>
            <Link href="/how-it-works">See how the full ApplyPack service works</Link>
          </div>
        </div>
      </section>
    </main>
  );
}

"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";

type TabItem = { label: string; content: React.ReactNode };

function Tabs({ label, items, className = "" }: { label: string; items: TabItem[]; className?: string }) {
  const id = useId();
  const [selected, setSelected] = useState(0);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function move(from: number, direction: number) {
    const next = (from + direction + items.length) % items.length;
    setSelected(next);
    refs.current[next]?.focus();
  }

  return (
    <div className={`brief-tabs ${className}`}>
      <div className="brief-tablist" role="tablist" aria-label={label}>
        {items.map((item, index) => (
          <button
            aria-controls={`${id}-panel-${index}`}
            aria-selected={selected === index}
            id={`${id}-tab-${index}`}
            key={item.label}
            onClick={() => setSelected(index)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); move(index, 1); }
              if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); move(index, -1); }
              if (event.key === "Home") { event.preventDefault(); setSelected(0); refs.current[0]?.focus(); }
              if (event.key === "End") { event.preventDefault(); setSelected(items.length - 1); refs.current[items.length - 1]?.focus(); }
            }}
            ref={(element) => { refs.current[index] = element; }}
            role="tab"
            tabIndex={selected === index ? 0 : -1}
            type="button"
          >
            <span className="brief-selected-mark" aria-hidden="true">{selected === index ? "✓" : ""}</span>{item.label}
          </button>
        ))}
      </div>
      {items.map((item, index) => (
        <div
          aria-labelledby={`${id}-tab-${index}`}
          className="brief-tabpanel"
          hidden={selected !== index}
          id={`${id}-panel-${index}`}
          key={item.label}
          role="tabpanel"
          tabIndex={0}
        >
          <p className="brief-panel-label">{item.label}</p>
          {item.content}
        </div>
      ))}
      <noscript>
        <div className="brief-noscript">
          {items.map((item) => <div key={item.label}><h3>{item.label}</h3>{item.content}</div>)}
        </div>
      </noscript>
    </div>
  );
}

export function JobMatchExample() {
  return (
    <article className="brief-demo-card brief-job-demo" aria-labelledby="job-demo-title">
      <p className="brief-demo-kicker">WHY THIS JOB MADE THE LIST</p>
      <h3 id="job-demo-title">Client Onboarding Coordinator</h3>
      <p className="brief-illustrative">Illustrative role</p>
      <Tabs
        label="Reasons this illustrative job made the list"
        items={[
          { label: "Experience fit", content: <><p>Your background shows experience explaining complex information, guiding people through unfamiliar processes, tracking progress, and adjusting support when questions or barriers arise.</p><ul className="brief-chip-list"><li>Process guidance</li><li>Progress tracking</li><li>Clear communication</li></ul></> },
          { label: "Life fit", content: <ul className="brief-check-list"><li>Remote in the United States</li><li>Full-time schedule</li><li>Health benefits listed</li><li>Limited travel</li><li>Salary meets the selected minimum</li></ul> },
          { label: "What to know", content: <p>The employer prefers direct client-onboarding experience. Your transferable experience creates a credible connection, but the preference should still be considered before you apply.</p> },
        ]}
      />
      <p className="brief-caption">Illustrative example. Every delivered match is checked against the actual listing and the customer&apos;s approved criteria.</p>
    </article>
  );
}

const experienceExamples = [
  {
    label: "Teaching",
    did: ["Planned and delivered structured programs", "Tracked progress and maintained records", "Explained unfamiliar information clearly", "Adjusted support when something was not working"],
    shows: ["Program coordination", "Documentation", "Training and onboarding", "Stakeholder communication", "Problem solving"],
    connects: ["Client Onboarding Coordinator", "Training Coordinator", "Project Coordinator", "Operations Coordinator"],
  },
  {
    label: "Small business",
    did: ["Managed orders, inventory, suppliers, and deadlines", "Tracked costs and performance", "Resolved customer and fulfillment problems", "Improved repeatable processes"],
    shows: ["Operations management", "Purchasing and supplier coordination", "Inventory control", "Process improvement", "Performance tracking"],
    connects: ["Operations Specialist", "Purchasing Coordinator", "Inventory Coordinator", "Vendor Operations Associate"],
  },
  {
    label: "Administrative work",
    did: ["Organized records and schedules", "Coordinated communication and follow-up", "Maintained accurate information", "Kept recurring processes moving"],
    shows: ["Workflow coordination", "Documentation", "Scheduling", "Data accuracy", "Cross-functional support"],
    connects: ["Operations Coordinator", "Project Assistant", "HR Operations Coordinator", "Administrative Operations Specialist"],
  },
  {
    label: "Caregiving or time outside traditional work",
    did: ["Coordinated appointments, schedules, records, and changing priorities", "Researched options and managed follow-up", "Responded when plans changed unexpectedly", "Balanced several responsibilities with limited time"],
    shows: ["Scheduling and coordination", "Record management", "Research and follow-through", "Prioritization", "Adaptability"],
    connects: ["Scheduling Coordinator", "Administrative Support", "Service Coordinator", "Operations Support"],
  },
];

export function ExperienceConnector() {
  const [selected, setSelected] = useState(0);
  const item = experienceExamples[selected];
  return (
    <div className="brief-connector" aria-labelledby="connector-title">
      <h3 className="sr-only" id="connector-title">Experience connector</h3>
      <div className="brief-role-selector" aria-label="Choose an experience example">
        {experienceExamples.map((example, index) => (
          <button aria-pressed={selected === index} key={example.label} onClick={() => setSelected(index)} type="button"><span className="brief-selected-mark" aria-hidden="true">{selected === index ? "✓" : ""}</span>{example.label}</button>
        ))}
      </div>
      <p className="sr-only" aria-live="polite">Showing {item.label}</p>
      <div className="brief-connector-panels">
        <article><span>1</span><h3>What you did</h3><ul>{item.did.map((text) => <li key={text}>{text}</li>)}</ul></article>
        <article><span>2</span><h3>What it {selected === 3 ? "may " : ""}demonstrate</h3><ul>{item.shows.map((text) => <li key={text}>{text}</li>)}</ul></article>
        <article><span>3</span><h3>Where it may connect</h3><ul>{item.connects.map((text) => <li key={text}>{text}</li>)}</ul></article>
      </div>
      <p className="brief-boundary">These are possible directions, not automatic qualifications. ApplyPack verifies every connection against the customer&apos;s actual experience and the job&apos;s requirements.</p>
      <noscript><p className="brief-caption">JavaScript is not required to use ApplyPack. The complete examples are available during intake and in each researched delivery.</p></noscript>
    </div>
  );
}

export function TailoringExample() {
  const original = "Developed and implemented lesson plans. Communicated with families. Maintained student records.";
  const tailored = "Created clear instructional materials, guided students and families through unfamiliar processes, tracked progress, and adjusted support when questions or barriers arose.";
  const reasons = <ul className="brief-check-list"><li>Brings process guidance and progress tracking forward</li><li>Uses language relevant to an onboarding role</li><li>Keeps the underlying experience accurate</li><li>Does not claim CRM use, customer-account ownership, or qualifications not shown in the source material</li></ul>;
  return (
    <div className="brief-tailoring" aria-labelledby="tailoring-title">
      <div className="brief-heading-block"><h3 id="tailoring-title">The facts stay the same. What matters most changes with the job.</h3><p>Tailoring is not inventing experience. It is choosing the most relevant truth and making the connection clear.</p></div>
      <div className="brief-tailoring-desktop"><article><h4>Original</h4><p className="brief-document-copy">{original}</p></article><article><h4>Tailored for client onboarding</h4><p className="brief-document-copy"><span className="brief-change-label">Changed:</span> <mark>{tailored}</mark></p></article><details><summary>Why it changed</summary>{reasons}</details></div>
      <div className="brief-tailoring-mobile"><Tabs label="Original and tailored resume example" items={[{ label: "Original", content: <p className="brief-document-copy">{original}</p> }, { label: "Tailored for client onboarding", content: <p className="brief-document-copy"><span className="brief-change-label">Changed:</span> <mark>{tailored}</mark></p> }, { label: "Why it changed", content: reasons }]} /></div>
      <p className="brief-supporting">The cover letter makes the same honest connection in a more personal way, using the selected employer and role.</p>
    </div>
  );
}

const homepageFaqs = [
  ["What if I do not know what kind of job I want?", "You do not need a job title to begin. Tell us what kind of work fits your life, what you want to avoid, and what experience you bring. We use that information to identify credible directions."],
  ["What if my resume is old or incomplete?", "Upload the best version you have. The intake lets you confirm experience, responsibilities, tools, training, and other information that may be missing or outdated."],
  ["When does the 24-hour period begin?", "The 24-clock-hour period begins after your intake and payment are complete and current capacity is confirmed."],
  ["Does ApplyPack apply to jobs for me?", "No. ApplyPack researches opportunities and prepares application materials. You choose where to apply and submit each application yourself."],
];

export function FaqAccordion({ items = homepageFaqs }: { items?: string[][] }) {
  return (
    <div className="brief-faq">
      {items.map(([question, answer]) => (
        <details key={question}>
          <summary>{question}<span aria-hidden="true">+</span></summary>
          <p>{answer}</p>
        </details>
      ))}
    </div>
  );
}

export function ProcessSteps() {
  const steps = [
    ["Tell us what fits.", "Upload your current resume and choose your priorities, preferences, and dealbreakers."],
    ["Receive 10 matched jobs.", "We research current openings and deliver 10 focused opportunities within 24 hours."],
    ["Choose what you want to pursue.", "Review why each job may fit and what you should know before applying."],
    ["Get application materials for the jobs you choose.", "Add a tailored resume and cover letter for $8 per selected job."],
  ];
  const [selected, setSelected] = useState(0);
  return <div className="brief-process-wrap"><ol className="brief-process">{steps.map(([title], index) => <li key={title}><button type="button" aria-pressed={selected === index} aria-controls="process-step-detail" onClick={() => setSelected(index)}><span>{index + 1}</span><span className="brief-selected-mark" aria-hidden="true">{selected === index ? "✓" : ""}</span><h3>{title}</h3></button></li>)}</ol><p id="process-step-detail" className="brief-process-detail" aria-live="polite"><strong>Step {selected + 1}:</strong> {steps[selected][1]}</p><noscript><ol>{steps.map(([title, body]) => <li key={title}><strong>{title}</strong> {body}</li>)}</ol></noscript></div>;
}

export function PricingCards() {
  return (
    <div className="brief-pricing-grid">
      <article className="brief-price-card brief-price-card-primary"><p className="brief-demo-kicker">10 RESEARCHED JOB MATCHES</p><strong>$20 <small>one time</small></strong><p>Ten current opportunities selected for your experience, priorities, and dealbreakers, with direct links and a clear explanation of each match.</p><b>Delivered within 24 hours after your intake and payment are complete.</b><Link className="button-link button-link--primary" href="/get-started">Find My 10 Jobs</Link></article>
      <article className="brief-price-card"><p className="brief-demo-kicker">TAILORED RESUME + COVER LETTER</p><strong>$8 <small>per job</small></strong><p>A job-specific resume and cover letter based on your verified experience and the role you select.</p><b>Delivered within 24 hours after your selection and payment are complete.</b><p className="brief-control">Choose one job, several jobs, all 10, or none. The decision stays with you.</p></article>
    </div>
  );
}

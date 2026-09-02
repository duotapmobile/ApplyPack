import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { siteConfig } from "../../src/config/site";
import { publicPages } from "../../src/content/public-pages";

const approvedPages = {
  "how-it-works": {
    title: "From \"I need a job\" to ready to apply.",
    seoTitle: "24-Hour Job Search and Application Help | ApplyPack",
  },
  "job-search-help": {
    title: "You do not have to know the job title yet.",
    seoTitle: "Job Search Help Without Knowing the Job Title | ApplyPack",
  },
  "experience-connections": {
    title: "Your experience may fit more jobs than you think. ApplyPack makes the connection.",
    seoTitle: "What Jobs Fit My Experience? | ApplyPack",
  },
  "before-and-after": {
    title: "See what changes when the job comes first.",
    seoTitle: "Resume Before and After for a Career Change | ApplyPack",
  },
  "resume-screening": {
    title: "Before a person really looks at your resume, software may already be sorting it.",
    seoTitle: "How Resume Screening Software Reads Applications | ApplyPack",
  },
  "not-just-ai": {
    title: "Not just another AI resume.",
    seoTitle: "Human-Reviewed Resume and Cover Letter Service | ApplyPack",
  },
  pricing: {
    title: "Pay for the help you actually use.",
    seoTitle: "ApplyPack Pricing | 10 Job Matches in 24 Hours for $20",
  },
  faq: {
    title: "Questions before you start?",
    seoTitle: "Job Search and Resume Help FAQ | ApplyPack",
  },
  about: {
    title: "I built ApplyPack because I needed it.",
    seoTitle: "About ApplyPack | A More Human Job Search Service",
  },
  contact: {
    title: "How can we help?",
    seoTitle: "Contact ApplyPack | Job Search and Resume Help",
  },
  accessibility: {
    title: "Accessibility at ApplyPack",
    seoTitle: "Accessibility Statement | ApplyPack",
  },
} as const;

describe("approved site copy and navigation", () => {
  it("keeps the approved desktop navigation in order", () => {
    expect(siteConfig.navigation).toEqual([
      { href: "/how-it-works", label: "How It Works" },
      { href: "/experience-connections", label: "See the Connections" },
      { href: "/before-and-after", label: "Before and After" },
      { href: "/pricing", label: "Pricing" },
      { href: "/faq", label: "FAQ" },
    ]);
  });

  it("keeps every locked public headline and SEO title", () => {
    for (const [slug, approved] of Object.entries(approvedPages)) {
      expect(publicPages[slug]?.title, slug).toBe(approved.title);
      expect(publicPages[slug]?.seoTitle, slug).toBe(approved.seoTitle);
    }
  });

  it("keeps the approved homepage promise and pricing language", () => {
    const home = readFileSync("src/app/page.tsx", "utf8");
    const approvedHomepageCopy = [
      "Finding a job shouldn&apos;t become your full-time job.",
      "NO WAITING WEEKS TO GET STARTED.",
      "YOUR NEXT JOB DOESN&apos;T HAVE TO LOOK LIKE YOUR LAST ONE.",
      "YOU DON&apos;T HAVE TO KNOW THE JOB TITLE YET.",
      "YOU MAY BE QUALIFIED FOR MORE THAN YOU THINK.",
      "YOU HAVE BETTER THINGS TO DO THAN SCROLL THROUGH JOBS ALL DAY.",
      "YOUR RESUME MAY MEET SOFTWARE BEFORE IT MEETS A PERSON.",
      "NOT JUST ANOTHER AI RESUME.",
      "SAME EXPERIENCE. BETTER CONNECTION.",
      "FROM &quot;I NEED A JOB&quot; TO READY TO APPLY.",
      "PAY FOR THE HELP YOU ACTUALLY USE.",
      "NO ONE CAN PROMISE YOU THE JOB.",
      "BUILT AROUND WHAT IS TRUE.",
      "QUESTIONS BEFORE YOU START?",
      "YOU ALREADY HAVE ENOUGH TO START.",
      "10 matched jobs:",
      "Tailored resume + cover letter:",
      "ApplyPack will take it from there.",
    ];

    for (const copy of approvedHomepageCopy) {
      expect(home, copy).toContain(copy);
    }
  });
});

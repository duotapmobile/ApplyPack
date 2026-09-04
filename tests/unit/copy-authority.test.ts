import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { siteConfig } from "../../src/config/site";
import { publicPages } from "../../src/content/public-pages";

const requiredPages = {
  "how-it-works": "From unsure where to start to ready to apply.",
  "experience-connections": "Your experience may fit more jobs than your title suggests.",
  "before-and-after": "See how the same experience changes for a different job.",
  pricing: "Start with the search. Add application help only when you want it.",
  faq: "Get clear answers before you pay.",
  about: "I built the job-search help I needed when I was trying to find my own way forward.",
} as const;

describe("controlling public copy and navigation", () => {
  it("keeps the corrected desktop navigation in order", () => {
    expect(siteConfig.navigation).toEqual([
      { href: "/why-apply-pack", label: "Why Apply Pack?" },
      { href: "/how-it-works", label: "How It Works" },
      { href: "/experience-connections", label: "How Matching Works" },
      { href: "/before-and-after", label: "Before and After" },
      { href: "/pricing", label: "Pricing" },
      { href: "/faq", label: "FAQ" },
    ]);
  });

  it("keeps every corrected public headline", () => {
    for (const [slug, title] of Object.entries(requiredPages)) {
      expect(publicPages[slug]?.title, slug).toBe(title);
      expect(publicPages[slug]?.seoTitle, slug).toBeTruthy();
    }
  });

  it("keeps the approved seven-section homepage offer and boundaries", () => {
    const home = readFileSync("src/app/page.tsx", "utf8");
    expect(home.match(/<section\b/g)).toHaveLength(7);
    for (const copy of [
      "Finding the right job shouldn&apos;t become your full-time job.",
      "Find My 10 Jobs",
      "One search. No subscription. You choose where to apply.",
      "A job can fit your abilities and still be wrong for your life.",
      "You may not be unqualified. You may be searching under the wrong job titles.",
      "Hours of searching become 10 focused choices.",
      "Four clear steps. You stay in control of every decision.",
      "Pay for the help you need, only when you need it.",
      "Honest help, without promises no one can make.",
    ]) expect(home, copy).toContain(copy);
    expect(home.match(/<ButtonLink href="\/get-started"/g)?.length).toBeLessThanOrEqual(4);
  });

  it("removes banned public phrases and long dashes", () => {
    const sources = [
      "src/app/page.tsx",
      "src/content/public-pages.ts",
      "src/components/marketing/content-page.tsx",
      "src/components/marketing/brief-interactions.tsx",
      "src/components/layout/site-header.tsx",
      "src/components/layout/site-footer.tsx",
      "src/app/get-started/public-intake-entry.tsx",
    ].map((path) => readFileSync(path, "utf8")).join("\n");
    for (const phrase of ["matched around", "Take the next useful step", "$8 Apply Pack", "approved non-negotiable", "Start My 24-Hour Search", "Get My 10 Jobs in 24 Hours", "We search between the two"]) {
      expect(sources.toLowerCase()).not.toContain(phrase.toLowerCase());
    }
    expect(sources).not.toMatch(/[—–]|&mdash;|&ndash;/);
  });
});

export type ContentSection = { title: string; body?: string[]; bullets?: string[]; note?: string };
export type PublicPage = { slug: string; eyebrow: string; title: string; seoTitle: string; description: string; intro: string[]; sections: ContentSection[]; ctaLabel?: string; ctaHref?: string };

const start = { ctaLabel: "Find My 10 Jobs", ctaHref: "/get-started" };

export const publicPages: Record<string, PublicPage> = {
  "how-it-works": {
    slug: "how-it-works", eyebrow: "OUR PROCESS", title: "From unsure where to start to ready to apply.",
    seoTitle: "How ApplyPack Works | Job Search and Application Help", description: "Four clear steps from intake to 10 researched job matches and optional tailored application materials.",
    intro: ["You do not need the perfect job title or a perfectly updated resume. Tell us what fits your life now, and we will use your experience to find credible directions."],
    sections: [], ...start,
  },
  "job-search-help": {
    slug: "job-search-help", eyebrow: "JOB SEARCH HELP", title: "Start with what your life needs from work.",
    seoTitle: "Job Search Help Without Knowing the Job Title | ApplyPack", description: "ApplyPack searches around your experience, priorities, preferences, and dealbreakers.",
    intro: ["You can begin with the work setting, pay, schedule, benefits, and responsibilities that fit, even if you do not know the right title yet."],
    sections: [
      { title: "Tell us what fits", bullets: ["Remote, hybrid, or on-site work", "Salary and benefits", "Schedule and travel", "Employment type"] },
      { title: "Name each dealbreaker", body: ["Strict exclusions keep roles that cannot work for your life out of the delivered list."] },
      { title: "Keep unknowns visible", body: ["A useful job may still appear when a preferred detail is not listed. We label that detail clearly, such as Health benefits not confirmed."] },
    ], ...start,
  },
  "experience-connections": {
    slug: "experience-connections", eyebrow: "HOW MATCHING WORKS", title: "Your experience may fit more jobs than your title suggests.",
    seoTitle: "How Job Matching Works | ApplyPack", description: "See how ApplyPack compares actual experience with job requirements, priorities, and dealbreakers.",
    intro: ["ApplyPack compares what you have actually done with what each job requires, then checks whether the opportunity also fits your priorities and dealbreakers."],
    sections: [], ...start,
  },
  "before-and-after": {
    slug: "before-and-after", eyebrow: "BEFORE AND AFTER", title: "See how the same experience changes for a different job.",
    seoTitle: "Resume Before and After for a Career Change | ApplyPack", description: "See how ApplyPack changes emphasis, order, and language without changing the facts.",
    intro: ["We keep the facts and change the emphasis, order, and language to match the role you selected."],
    sections: [], ...start,
  },
  "resume-screening": {
    slug: "resume-screening", eyebrow: "RESUME SCREENING", title: "Make your experience clear to software and people.",
    seoTitle: "How Resume Screening Software Reads Applications | ApplyPack", description: "ApplyPack prepares clean, truthful, job-specific application materials.",
    intro: ["A clear structure and relevant language help an employer understand the honest connection between your experience and the role."],
    sections: [
      { title: "What we do", bullets: ["Use a readable structure", "Bring relevant experience forward", "Use accurate job language", "Keep dates and credentials truthful"] },
      { title: "What we do not do", bullets: ["Hide keywords", "Invent qualifications", "Promise a ranking", "Guarantee an interview"] },
      { title: "Human review", body: ["A person reviews every resume and cover letter before delivery. You review it again before submitting."] },
    ], ...start,
  },
  "not-just-ai": {
    slug: "not-just-ai", eyebrow: "HUMAN REVIEW", title: "Technology can assist. People remain accountable.",
    seoTitle: "Human-Reviewed Resume and Cover Letter Service | ApplyPack", description: "Every ApplyPack delivery requires human review and remains grounded in customer facts.",
    intro: ["Tools may support research, comparison, and drafting. They do not make the final customer-facing decision."],
    sections: [
      { title: "Research needs judgment", body: ["A role can use similar skills while failing the customer's pay, location, schedule, or travel needs."] },
      { title: "Writing needs restraint", body: ["We make the relevant truth clear without inventing titles, metrics, credentials, or experience."] },
      { title: "Every delivery is reviewed", bullets: ["Criteria checked", "Links checked", "Claims checked", "Clarity checked"] },
    ], ...start,
  },
  pricing: {
    slug: "pricing", eyebrow: "AFFORDABLE BY DESIGN", title: "Start with the search. Add application help only when you want it.",
    seoTitle: "ApplyPack Pricing | 10 Job Matches for $20", description: "Get 10 researched job matches for $20, then add a tailored resume and cover letter for $8 per selected job.",
    intro: ["Get 10 researched job matches for $20. Then choose whether you want a tailored resume and cover letter for any of them."],
    sections: [], ...start,
  },
  faq: {
    slug: "faq", eyebrow: "FREQUENTLY ASKED QUESTIONS", title: "Get clear answers before you pay.",
    seoTitle: "Job Search and Resume Help FAQ | ApplyPack", description: "Answers about getting started, job matching, pricing, timing, application materials, privacy, and account access.",
    intro: [], sections: [], ctaLabel: "Contact ApplyPack", ctaHref: "/contact",
  },
  about: {
    slug: "about", eyebrow: "WHY APPLYPACK EXISTS", title: "I built the job-search help I needed when I was trying to find my own way forward.",
    seoTitle: "About ApplyPack | Founder Story", description: "Why ApplyPack was built for capable women navigating a return to work or a major transition.",
    intro: [], sections: [], ...start,
  },
  contact: {
    slug: "contact", eyebrow: "CONTACT APPLYPACK", title: "How can we help?", seoTitle: "Contact ApplyPack | Job Search and Resume Help",
    description: "Contact ApplyPack about job matching, application materials, an order, privacy, or accessibility.",
    intro: ["We normally respond within two business days. Do not email resumes, payment details, or other sensitive documents."],
    sections: [{ title: "General help, privacy, and accessibility", body: ["help@applypack.work"] }, { title: "Orders and billing", body: ["orders@applypack.work"] }],
    ctaLabel: "Email Help", ctaHref: "mailto:help@applypack.work",
  },
  accessibility: {
    slug: "accessibility", eyebrow: "ACCESSIBILITY AT APPLYPACK", title: "Accessibility at ApplyPack", seoTitle: "Accessibility Statement | ApplyPack",
    description: "ApplyPack's accessibility target and support contact.", intro: ["DuoTap LLC d/b/a ApplyPack is committed to a website and service usable by as many people as possible."],
    sections: [
      { title: "Our target", body: ["We aim to conform to WCAG 2.2 Level AA."], bullets: ["Keyboard access", "Visible focus", "Clear structure and labels", "Sufficient contrast", "Reflow and reduced motion", "Manual and automated testing"] },
      { title: "Need help or another format?", body: ["Email help@applypack.work with the page or service step, what happened, the accommodation or alternative you need, and how you prefer us to respond."] },
      { title: "Ongoing work", body: ["Accessibility is reviewed during design, development, content changes, and major releases. Automated checks support, but do not replace, keyboard, reflow, screen-reader, and human review."] },
    ], ctaLabel: "Email Accessibility Help", ctaHref: "mailto:help@applypack.work",
  },
  privacy: {
    slug: "privacy", eyebrow: "PRIVACY POLICY", title: "Your information is for providing your service.", seoTitle: "Privacy Policy | ApplyPack",
    description: "How ApplyPack, operated by DuoTap LLC d/b/a ApplyPack, handles information.", intro: ["Effective September 2, 2026."],
    sections: [
      { title: "Information and use", body: ["We collect contact details, approved search criteria and preferences, documents you upload, order and delivery records, support messages, and limited operational security logs. We use them to authenticate you, perform and deliver the service, take payment, provide support, prevent abuse, and meet legal or accounting obligations."] },
      { title: "AI assistance and human review", body: ["AI-assisted tools may support research, comparison, and drafting. A person reviews every customer-facing delivery, and factual claims remain grounded in information you provide."] },
      { title: "Uploads and document safety", body: ["After account access is established, uploads use private storage with randomized storage keys and restricted access. Supported files are checked for allowed type, size, file structure, and prohibited active content."] },
      { title: "Providers", body: ["Supabase supports authentication, database, and private file storage. Railway hosts the application. Stripe processes payments. Configured email providers deliver authentication, order, and support messages."] },
      { title: "Sharing and analytics", body: ["We do not sell resumes or personal information. We share information only as needed to provide or secure the service, comply with law, resolve a transaction, or follow your direction."] },
      { title: "Retention and security", body: ["Saved intake drafts expire after seven days. Source documents are scheduled for deletion according to the posted retention period. Access is restricted by account and role, and signed links are time-limited. No system can promise absolute security."] },
      { title: "Your choices", body: ["Email help@applypack.work for access, correction, or deletion requests. Some records may be retained for transactions, disputes, security, or law."] },
    ], ctaLabel: "Contact Privacy", ctaHref: "mailto:help@applypack.work",
  },
  terms: {
    slug: "terms", eyebrow: "TERMS OF SERVICE", title: "The service boundary, in plain language.", seoTitle: "Terms of Service | ApplyPack",
    description: "Terms for ApplyPack's job-search and application-preparation services.", intro: ["Effective September 2, 2026. ApplyPack is operated by DuoTap LLC d/b/a ApplyPack."],
    sections: [
      { title: "Service and eligibility", body: ["ApplyPack serves customers 18 or older. It researches public opportunities and prepares materials. It does not contact employers or submit applications for customers."] },
      { title: "10 Researched Job Matches", body: ["The $20 one-time fee pays for exactly 10 researched opportunities. The 24-clock-hour period begins only after a complete intake, verified payment, and confirmed capacity."] },
      { title: "Tailored Resume + Cover Letter", body: ["Each $8 unit covers one truthful, tailored resume and one truthful, tailored cover letter for one selected job. Every delivery requires human review."] },
      { title: "Your review and responsibility", body: ["Provide accurate facts and documents you have the right to use, review each delivery, answer employer questions, and submit applications yourself."] },
      { title: "Corrections and listing changes", body: ["One factual-correction round is included for each document set when requested within three calendar days. Jobs may close or change after they are checked."] },
      { title: "No outcome guarantee", body: ["ApplyPack does not guarantee ATS ranking, employer review, interviews, offers, salary, employment, or continued listing availability. Employers control hiring decisions and job availability."] },
    ], ctaLabel: "Contact Help", ctaHref: "mailto:help@applypack.work",
  },
};

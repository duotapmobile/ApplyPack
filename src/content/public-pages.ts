export type ContentSection = { title: string; body?: string[]; bullets?: string[]; note?: string };
export type PublicPage = {
  slug: string; eyebrow: string; title: string; description: string;
  intro: string[]; sections: ContentSection[]; ctaLabel?: string; ctaHref?: string;
};

const start = { ctaLabel: "Start My Search", ctaHref: "/get-started" };

export const publicPages: Record<string, PublicPage> = {
  "how-it-works": {
    slug: "how-it-works", eyebrow: "FROM I NEED A JOB TO READY TO APPLY",
    title: "From I need a job to ready to apply.",
    description: "Tell ApplyPack what fits your life. Receive 10 matched jobs within 24 hours, then add tailored application materials for the jobs you choose.",
    intro: ["ApplyPack handles the work between needing something different and having an application ready to submit.", "You do not need the perfect job title or resume. You only need to give us somewhere honest to start."],
    sections: [
      { title: "1. Tell us what stays and what goes.", body: ["Your pay, location, schedule, priorities, and dealbreakers shape the search."] },
      { title: "2. We look past your old title.", body: ["We review work, side businesses, volunteering, caregiving periods, education, and other relevant experience to understand the skills underneath the titles."] },
      { title: "3. We find 10 current opportunities.", body: ["We search around the exact criteria you approve. We do not give you another endless results page."] },
      { title: "4. We explain every match.", bullets: ["Company and job title", "Direct application link", "Location and salary when listed", "Why it may fit", "Requirements, visible gaps, and date checked"] },
      { title: "5. You choose.", body: ["Select one, several, all 10, or none. You do not buy application materials for jobs you do not want."] },
      { title: "6. We build around the job.", body: ["For $8 per selected job, ApplyPack creates a truthful, tailored resume and cover letter."] },
      { title: "7. You review and apply.", body: ["You receive editable documents within 24 hours, review every detail, and submit the application yourself."] },
      { title: "What ApplyPack is not", bullets: ["A staffing agency or employer", "A job board or auto-apply bot", "A guarantee of an interview", "A service that invents qualifications"] },
    ], ...start,
  },
  "job-search-help": {
    slug: "job-search-help", eyebrow: "A SEARCH BUILT AROUND YOUR REAL LIFE",
    title: "You do not have to know the job title yet.",
    description: "ApplyPack searches around your pay, schedule, location, priorities, and dealbreakers.",
    intro: ["Maybe you know you want remote work, $80K+, benefits, and no sales. That is enough to begin."],
    sections: [
      { title: "Tell us what stays.", bullets: ["Remote work", "Minimum salary", "Benefits or flexibility", "Limited travel", "A location or time zone"] },
      { title: "Tell us what goes.", bullets: ["Sales or marketing", "Cold calling", "Heavy phone work", "Travel, nights, or weekends"] },
      { title: "We search between the two.", body: ["Your past can still matter without sending you back into the same kind of job."] },
      { title: "No padding the list.", body: ["If the criteria produce fewer than 10 reasonable opportunities, we tell you and ask before changing a preference."] },
      { title: "A match is not a guarantee.", body: ["Employers decide whom to interview. You decide whether a job is right for you."] },
    ], ...start,
  },
  "experience-connections": {
    slug: "experience-connections", eyebrow: "SAME EXPERIENCE. MORE POSSIBLE DIRECTIONS.",
    title: "Your experience may fit more jobs than you think.",
    description: "See how real skills from work, caregiving periods, and side businesses may connect to new jobs.",
    intro: ["A title is a label. The work underneath it is often much broader."],
    sections: [
      { title: "Small business", body: ["Ordering, pricing, customer communication, deadlines, costs, and problem solving may connect to operations or order management."] },
      { title: "Teaching", body: ["Training, documentation, planning, progress tracking, and facilitation may connect to onboarding or program coordination."] },
      { title: "Retail supervision", body: ["Scheduling, inventory, coaching, escalations, and reporting may connect to operations support."] },
      { title: "Administrative work", body: ["Records, follow-up, vendor communication, and document preparation may connect to project coordination."] },
      { title: "Time outside traditional work", body: ["Life periods can explain a timeline, but ApplyPack never relabels unpaid responsibilities as employment."] },
      { title: "The trust boundary", body: ["We surface genuine overlap, keep important gaps visible, and never invent titles, dates, credentials, or outcomes."] },
    ], ...start,
  },
  "before-and-after": {
    slug: "before-and-after", eyebrow: "THE DIFFERENCE IS RELEVANCE",
    title: "Same facts. Clearer connection.",
    description: "See how ApplyPack reorganizes truthful experience around one real role.",
    intro: ["These examples are illustrative. Your documents use your own facts and the job you select."],
    sections: [
      { title: "Before: generic", body: ["Developed lesson plans. Communicated with families. Maintained student records."] },
      { title: "After: client onboarding", body: ["Created clear instructional materials, guided people through unfamiliar processes, tracked progress, and adjusted support when barriers arose."] },
      { title: "What changed", bullets: ["Relevant work moved forward", "Language became clearer", "Original facts stayed intact", "Missing requirements remained visible"] },
      { title: "The cover letter changes too.", body: ["It explains why this employer, why this role, and where your real experience may transfer."] },
    ], ...start,
  },
  "resume-screening": {
    slug: "resume-screening", eyebrow: "CLEAR FOR PEOPLE AND SCREENING SOFTWARE",
    title: "A strong resume should be easy to understand.",
    description: "Readable, truthful, job-specific resumes for people and common hiring systems.",
    intro: ["The safest strategy is a clean document that uses relevant language accurately."],
    sections: [
      { title: "What we do", bullets: ["Readable structure", "Relevant experience first", "Accurate job language", "Truthful dates and credentials", "Editable Word delivery"] },
      { title: "What we do not do", bullets: ["Stuff keywords", "Hide text", "Invent qualifications", "Claim a guaranteed score", "Promise an interview"] },
      { title: "Human review matters.", body: ["A person reviews every document before delivery. You review it again before submitting."] },
    ], ...start,
  },
  "not-just-ai": {
    slug: "not-just-ai", eyebrow: "TECHNOLOGY CAN HELP. A PERSON IS ACCOUNTABLE.",
    title: "ApplyPack is not a prompt and a download button.",
    description: "Technology may assist research and drafting, but a person reviews every delivery.",
    intro: ["AI-assisted tools may support research, comparison, and drafting. They do not make the final decision about what reaches you."],
    sections: [
      { title: "Research needs judgment.", body: ["Keywords can match while salary, schedule, or location does not."] },
      { title: "Connections need restraint.", body: ["Similar language is not permission to invent a qualification."] },
      { title: "Writing needs context.", body: ["Documents must match the selected job and remain consistent with your source material."] },
      { title: "Every delivery is reviewed.", bullets: ["Criteria checked", "Links checked", "Claims checked against customer facts", "Clarity and consistency reviewed"] },
    ], ...start,
  },
  pricing: {
    slug: "pricing", eyebrow: "PAY FOR THE HELP YOU ACTUALLY USE",
    title: "Start with the search. Choose where to spend more.",
    description: "10 matched opportunities for $20. A tailored resume and cover letter for $8 per selected job.",
    intro: ["No subscription. No recurring charge. No auto-apply service."],
    sections: [
      { title: "$20 Job Match Search", bullets: ["10 current opportunities", "Direct links", "Fit and gap explanations", "Delivered within 24 hours of completed intake and payment"] },
      { title: "$8 Apply Pack, per job", bullets: ["One tailored resume", "One tailored cover letter", "Editable Word documents", "Human review", "One factual-correction round"] },
      { title: "Two selected jobs", body: ["$20 search + $16 application materials = $36 total."] },
      { title: "All 10 selected jobs", body: ["$20 search + $80 application materials = $100 total."] },
      { title: "The search stands alone.", body: ["Choose one, all 10, or none. A material conflict with an approved non-negotiable is eligible for replacement review."] },
    ], ctaLabel: "Get My 10 Jobs in 24 Hours", ctaHref: "/get-started",
  },
  faq: {
    slug: "faq", eyebrow: "CLEAR BEFORE YOU PAY", title: "Questions before you start?",
    description: "Answers about matches, documents, turnaround, corrections, privacy, and ApplyPack's limits.",
    intro: ["If your question is not here, contact us before purchasing."],
    sections: [
      { title: "What if I do not know what job I want?", body: ["Start with what fits your life and what you do not want to do again."] },
      { title: "Do I need a resume?", body: ["Yes. It can be old or written for another career. It provides the factual starting point."] },
      { title: "When does 24 hours begin?", body: ["After completed, approved intake and payment. For Apply Packs, after selection confirmation and payment."] },
      { title: "Does that include weekends?", body: ["Yes. When the queue is full, purchases pause."] },
      { title: "Must I buy all 10 Apply Packs?", body: ["No. Choose one, several, all 10, or none."] },
      { title: "What if a job conflicts with my criteria?", body: ["A material conflict with an approved non-negotiable is reviewed and replaced at no charge."] },
      { title: "Does ApplyPack submit applications?", body: ["No. You review and submit each application yourself."] },
      { title: "Is an interview guaranteed?", body: ["No. Employers make every hiring decision."] },
      { title: "Does ApplyPack use AI?", body: ["AI-assisted tools may help, and a person reviews every delivery."] },
      { title: "Is my information private?", body: ["It is used to provide the service and is not sold."] },
      { title: "Are you a recruiter?", body: ["No. ApplyPack works for the job seeker."] },
    ], ctaLabel: "Ask Another Question", ctaHref: "/contact",
  },
  about: {
    slug: "about", eyebrow: "A MORE HUMAN PLACE TO START", title: "I built ApplyPack because I needed it.",
    description: "ApplyPack was created for people with real experience who need help finding where it fits next.",
    intro: ["I had years of experience and time outside the traditional workforce. I knew what I did not want, but not which titles to search."],
    sections: [
      { title: "So I built a process.", body: ["I learned to search beyond titles, compare the work inside a posting, connect transferable experience, and tailor applications without making anything up."] },
      { title: "Marissa Wright", bullets: ["Founder of ApplyPack", "Former teacher", "Private-label e-commerce operations", "Career changer"] },
      { title: "We work for the applicant.", body: ["ApplyPack is not a recruiter or staffing agency."] },
    ], ...start,
  },
  contact: {
    slug: "contact", eyebrow: "CONTACT APPLYPACK", title: "How can we help?",
    description: "Contact ApplyPack about the service, an order, billing, privacy, or accessibility.",
    intro: ["We normally respond within two business days. Do not email resumes, payment details, or other sensitive documents."],
    sections: [
      { title: "General help and orders", body: ["support@applypack.work"] },
      { title: "Privacy", body: ["privacy@applypack.work"] },
      { title: "Website accessibility", body: ["accessibility@applypack.work"] },
    ], ctaLabel: "Email Support", ctaHref: "mailto:support@applypack.work",
  },
  accessibility: {
    slug: "accessibility", eyebrow: "ACCESSIBILITY AT APPLYPACK", title: "A service designed for more people to use.",
    description: "ApplyPack's accessibility target and support contact.",
    intro: ["ApplyPack is committed to a website and service usable by as many people as possible."],
    sections: [
      { title: "Our target", body: ["We aim to conform to WCAG 2.2 Level AA."], bullets: ["Keyboard access", "Visible focus", "Clear structure and labels", "Sufficient contrast", "Reflow and reduced motion", "Manual and automated testing"] },
      { title: "Need help?", body: ["Email accessibility@applypack.work with the page, what happened, and how you prefer us to respond."] },
      { title: "Ongoing work", body: ["Accessibility is reviewed during design, development, content changes, and major releases."], note: "Last reviewed September 1, 2026." },
    ], ctaLabel: "Email Accessibility Support", ctaHref: "mailto:accessibility@applypack.work",
  },
  privacy: {
    slug: "privacy", eyebrow: "PRIVACY POLICY", title: "Your information is for providing your service.",
    description: "How ApplyPack, operated by DuoTap LLC, handles information.",
    intro: ["Effective September 1, 2026. Provider-specific details will be confirmed before live purchasing is enabled."],
    sections: [
      { title: "Information and use", body: ["We collect contact details, search preferences, uploads, order records, messages, and security logs to provide, support, secure, and administer the service."] },
      { title: "Uploads and providers", body: ["Authorized workers and contracted hosting, storage, email, payment, and AI-assisted providers may process relevant information. Human review occurs before delivery."] },
      { title: "Payments and email", body: ["Stripe processes cards; ApplyPack does not store full card numbers. Transactional email providers deliver service messages."] },
      { title: "Sharing", body: ["We do not sell resumes or personal information. We share only as needed for the service, security, law, or customer direction."] },
      { title: "Retention and security", body: ["Access is restricted by account and role. Enforced retention periods will be documented before launch. No system can promise absolute security."] },
      { title: "Your choices", body: ["Email privacy@applypack.work for access, correction, or deletion requests. Some records may be retained for transactions, disputes, security, or law."] },
      { title: "Children and changes", body: ["ApplyPack is not directed to children under 18. Changes will be posted with a new effective date."] },
    ], ctaLabel: "Contact Privacy", ctaHref: "mailto:privacy@applypack.work",
  },
  terms: {
    slug: "terms", eyebrow: "TERMS OF SERVICE", title: "The service boundary, in plain language.",
    description: "Terms for ApplyPack's job-search and application-preparation services.",
    intro: ["Effective September 1, 2026. ApplyPack is operated by DuoTap LLC."],
    sections: [
      { title: "Service and eligibility", body: ["ApplyPack serves customers 18 or older and is not a recruiter, employer, staffing agency, or law firm."] },
      { title: "$20 search", body: ["10 current opportunities selected around approved criteria within 24 hours after completed intake and payment, subject to displayed capacity."] },
      { title: "$8 Apply Pack", body: ["One tailored resume and cover letter per selected job within 24 hours after confirmation and payment, subject to capacity."] },
      { title: "Customer responsibility", body: ["Provide accurate facts, review every delivery, answer employer questions, and submit applications yourself."] },
      { title: "Corrections and replacement review", body: ["One factual-correction round requested within three calendar days is included. Material conflicts with confirmed non-negotiables are reviewed for replacement."] },
      { title: "Payments and cancellation", body: ["Prices appear before payment. Work begins promptly, so cancellation may not be possible after fulfillment starts. Duplicate charges and failures are reviewed through support."] },
      { title: "No hiring guarantee", body: ["ApplyPack does not guarantee screening, interviews, offers, pay, or listing availability."] },
      { title: "Liability and changes", body: ["To the extent allowed by law, liability is limited to the amount paid for the service giving rise to the claim. Updates will show a new effective date."] },
    ], ctaLabel: "Contact Support", ctaHref: "mailto:support@applypack.work",
  },
};

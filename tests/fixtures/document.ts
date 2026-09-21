import type { EvidenceBoundMaterialInput } from "@/lib/documents/generate";

const FACT_CONTACT = "10000000-0000-4000-8000-000000000001";
const FACT_ONE = "10000000-0000-4000-8000-000000000002";
const FACT_TWO = "10000000-0000-4000-8000-000000000003";
const FACT_HEADER = "10000000-0000-4000-8000-000000000004";
const JOB_EVIDENCE = "20000000-0000-4000-8000-000000000001";
const REFERENCE_PERMISSION = "30000000-0000-4000-8000-000000000001";

function realisticCoverLetter(jobTitle: string, employer: string) {
  return [
    {
      text: `The ${jobTitle} role at ${employer} calls for careful records, responsive communication, and dependable follow-through. In my administrative work, I coordinated customer files, reviewed documents for accuracy, and kept colleagues informed when priorities changed. That combination of practical organization and clear service is the verified experience I would bring to this opportunity. I am especially prepared for work where details must remain understandable as an item moves between customers and coworkers.`,
      candidateFactIds: [FACT_ONE],
      jobEvidenceIds: [JOB_EVIDENCE],
    },
    {
      text: "One recurring responsibility involved checking incoming information before it moved to the next person. I compared details, corrected routine discrepancies, and documented the current status so others could act with confidence. When a question required additional review, I explained what was known, identified what was still needed, and followed the item through resolution. This approach reduced ambiguity at handoff points and gave the next person a practical record of the action already completed.",
      candidateFactIds: [FACT_TWO],
      jobEvidenceIds: [JOB_EVIDENCE],
    },
    {
      text: "I also supported customers and coworkers during schedule changes and competing requests. I organized the work by urgency, maintained accurate notes, and provided concise updates rather than allowing requests to disappear between handoffs. Those habits helped me contribute steady support while respecting established procedures and the limits of my role. I learned to ask focused questions, confirm the requested outcome, and close the loop when the work was finished.",
      candidateFactIds: [FACT_ONE, FACT_TWO],
      jobEvidenceIds: [JOB_EVIDENCE],
    },
    {
      text: `I would welcome the opportunity to discuss how this documented background could support the ${jobTitle} team at ${employer}. I value work that depends on accuracy, respectful communication, and consistent completion. Thank you for considering the experience described here and for the opportunity to explain how I approach service and coordination.`,
      candidateFactIds: [FACT_TWO],
      jobEvidenceIds: [JOB_EVIDENCE],
    },
  ];
}

export function documentFixture(): EvidenceBoundMaterialInput {
  const input: EvidenceBoundMaterialInput = {
    contact: {
      displayName: "Jamie Rivera",
      email: "jamie@example.invalid",
      phone: "555-010-2026",
      cityState: "Richmond, VA",
      linkedInOrPortfolio: "https://example.invalid/jamie",
      candidateFactIds: [FACT_CONTACT],
    },
    job: {
      exactTitle: "Operations Coordinator",
      employer: "Example Services",
      location: "Richmond, VA",
      postingContentSha256: "a".repeat(64),
      jobEvidenceIds: [JOB_EVIDENCE],
    },
    requirementMappings: [{
      jobEvidenceId: JOB_EVIDENCE,
      classification: "DIRECT_EVIDENCE",
      candidateFactIds: [FACT_ONE],
    }],
    professionalSummary: {
      text: "Operations professional who coordinates accurate records and clear customer communication.",
      candidateFactIds: [FACT_ONE],
      jobEvidenceIds: [JOB_EVIDENCE],
    },
    coreSkills: [
      { text: "Document coordination", candidateFactIds: [FACT_ONE], priority: 1, essential: true },
      { text: "Customer communication", candidateFactIds: [FACT_TWO], priority: 2 },
    ],
    experiences: [{
      historicalTitle: "Administrative Specialist",
      employer: "Community Example",
      dates: "2021 to 2026",
      location: "Richmond, VA",
      headerCandidateFactIds: [FACT_HEADER],
      bullets: [
        { text: "Coordinated customer records and reviewed documents for accuracy.", candidateFactIds: [FACT_ONE], priority: 1, essential: true },
        { text: "Communicated status updates and resolved routine workflow questions.", candidateFactIds: [FACT_TWO], priority: 2 },
      ],
    }],
    coverLetterParagraphs: [],
    verifiedHiringManager: null,
    finalVersionAt: "2026-09-07T14:00:00.000Z",
    careerBreak: { choice: "KEEP_EXISTING_TIMELINE", mentionInCoverLetter: false, candidateFactIds: [] },
    rules: { outputFormat: "DOCX", resumePageLimit: 1 },
    references: [{
      permissionId: REFERENCE_PERMISSION,
      name: "Synthetic Reference",
      titleAndOrganization: "Program Lead, Example Organization",
      relationship: "Former project lead",
      email: "reference@example.invalid",
      phone: "555-010-3030",
      approvedContext: "Observed document coordination and customer communication.",
    }],
  };
  input.coverLetterParagraphs = realisticCoverLetter(input.job.exactTitle, input.job.employer);
  return input;
}

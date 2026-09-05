export const governedChunk3Personas = [
  { id: "direct-match", scenario: "direct_match", pii: false },
  { id: "career-changer", scenario: "career_changer", pii: false },
  { id: "no-degree-qualified-experience", scenario: "no_degree_with_qualifying_experience", pii: false },
  { id: "degree-no-experience", scenario: "degree_with_no_experience", pii: false },
  { id: "career-break", scenario: "career_break", pii: false },
  { id: "nontraditional-work", scenario: "nontraditional_work", pii: false },
  { id: "high-salary-floor", scenario: "high_salary_floor", pii: false },
  { id: "unpublished-salary", scenario: "unpublished_salary", pii: false },
  { id: "unfamiliar-fintech-title", scenario: "unfamiliar_fintech_title", pii: false },
  { id: "remote-state-restriction", scenario: "remote_state_restriction", pii: false },
  { id: "hard-tool-gap", scenario: "hard_tool_gap", pii: false },
  { id: "employer-unknown", scenario: "employer_unknown", pii: false },
  { id: "listing-injection", scenario: "listing_injection", pii: false },
] as const;

export const CHUNK3_PERSONA_FIXTURE_VERSION = "synthetic-personas-v1";

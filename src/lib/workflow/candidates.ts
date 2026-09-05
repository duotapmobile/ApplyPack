export function candidatePayload(candidate: Record<string, unknown>, job: Record<string, unknown>): Record<string, unknown> {
  const sourceUrl = stringValue(job.official_application_url || job.source_job_url || job.source_url);
  const candidateId = stringValue(candidate.id, "candidate-record");
  const concerns = stringArray(candidate.concerns);
  return {
    company: stringValue(job.employer_display_name || job.company, "Unknown employer"),
    title: stringValue(job.raw_title || job.title, "Unknown role"),
    sourceId: stringValue(job.source_id, "manual-reviewed"),
    sourceName: stringValue(job.source_name, "Reviewed source"),
    sourceUrl,
    officialApplicationUrl: nullableString(job.official_application_url) || undefined,
    externalJobId: nullableString(job.external_job_id) || undefined,
    description: stringValue(job.description),
    department: stringValue(job.department),
    location: stringValue(job.location_text),
    employmentType: stringValue(job.employment_type),
    remoteScope: stringValue(job.remote_scope),
    eligibleStates: stringArray(job.eligible_states),
    eligibleCountries: stringArray(job.eligible_countries),
    timezoneRequirement: stringValue(job.timezone_requirement),
    scheduleType: stringValue(job.schedule_type),
    salaryMin: nullableNumber(job.salary_min),
    salaryMax: nullableNumber(job.salary_max),
    salaryCurrency: stringValue(job.salary_currency),
    payPeriod: stringValue(job.pay_period),
    payModel: stringValue(job.pay_model),
    applicantCost: nullableNumber(job.applicant_cost),
    benefitsStatus: stringValue(job.benefits_status),
    languageRequirements: stringArray(job.language_requirements),
    postedAt: nullableString(job.posted_at),
    closingAt: nullableString(job.closing_at),
    checkedAt: stringValue(job.last_verified_at || job.checked_at, new Date(0).toISOString()),
    salary: stringValue(job.salary_text, "Not listed"),
    fitSummary: stringValue(candidate.fit_summary, "Operator review is required before this job can be delivered."),
    matchingExperience: [],
    primaryOutcome: "",
    coreResponsibilities: [],
    requirements: stringArray(candidate.requirements),
    hiddenJobFunctions: [],
    concerns,
    matchCategory: "TRANSFERABLE",
    packetStrongConnections: [{
      kind: "TRANSFERABLE",
      statement: stringValue(candidate.fit_summary, "Operator review is required before this connection can be approved."),
      evidenceIds: [`candidate-fact:${candidateId}`, "job-field:description"],
    }],
    packetThingsToConsider: concerns.map((statement) => ({ kind: "GAP", statement, evidenceIds: ["job-field:description"] })),
    packetUnknownWarnings: [
      ...(stringValue(job.benefits_status, "unknown") === "unknown" ? [{ field: "Health benefits", status: "NOT_CONFIRMED", evidenceIds: ["job-field:benefits_status"] }] : []),
      ...(!stringValue(job.salary_text) ? [{ field: "Compensation", status: "NOT_STATED", evidenceIds: ["job-field:salary_text"] }] : []),
    ],
    criteriaChecks: {
      dutiesAligned: false,
      experienceConfirmed: false,
      levelAcceptable: false,
      scheduleAcceptable: false,
      locationAcceptable: false,
      compensationAcceptable: false,
      nonNegotiablesSatisfied: false,
    },
  };
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

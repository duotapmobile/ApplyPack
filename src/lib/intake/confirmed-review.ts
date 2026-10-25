import { z } from "zod";
import { activityCatalog, breadthChoices, capabilityChoices, experienceKindLabels, formatCompensation, industryCatalog, normalizedFourStepDraft, type ExperienceAddition, type FactSuggestion, type FourStepDraft, type IntakeDocument } from "./four-step";

export const CONFIRMED_REVIEW_VERSION = "applypack-confirmed-intake-v1" as const;
export const confirmationReceiptSchema = z.object({
  id: z.uuid(), contractVersion: z.literal(CONFIRMED_REVIEW_VERSION), draftVersion: z.number().int().positive(),
  reviewSha256: z.string().regex(/^[a-f0-9]{64}$/), sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  answersSha256: z.string().regex(/^[a-f0-9]{64}$/),
  preparedAt: z.iso.datetime({ offset: true }), entryMode: z.enum(["CURRENT_RESUME", "OUTDATED_RESUME", "GUIDED"]),
}).strict();
export type ConfirmationReceipt = z.infer<typeof confirmationReceiptSchema>;
export type ReviewSection = { title: string; lines: string[]; step: 0 | 1 | 2 | 3; controlId: string };

const labels: Record<string, string> = Object.fromEntries([...activityCatalog, ...industryCatalog.map(([key, label]) => [key, label]), ...breadthChoices, ...capabilityChoices, ...Object.entries(experienceKindLabels)]);
export function readableLabel(value: string) { return labels[value] || value.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase()); }
const list = (values: readonly string[]) => values.map(readableLabel).join(", ") || "None selected";
export function readableFact(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not supplied";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? value.map(readableFact).join("; ") : "None supplied";
  if (typeof value === "object") return Object.entries(value).map(([key, item]) => `${readableLabel(key)}: ${readableFact(item)}`).join("; ");
  return String(value);
}

export function experienceDate(value: string, precision: ExperienceAddition["datePrecision"]) {
  if (!value || precision === "UNKNOWN") return "Not known";
  return precision === "YEAR" ? value.slice(0, 4) : precision === "MONTH" ? value.slice(0, 7) : value;
}

/** Suggestions are questions about the stated past role. Nothing is selected or inferred as a fact. */
export function contextualDutySuggestions(experience: Pick<ExperienceAddition, "kind" | "roleOrRelationship" | "responsibilities">): string[] {
  if (["CAREGIVING", "OTHER_RELEVANT_LIFE_CONTEXT", "EDUCATION_CERTIFICATION"].includes(experience.kind)) return [];
  const context = `${experience.roleOrRelationship} ${experience.responsibilities.join(" ")}`.toLowerCase();
  const groups: [RegExp, string[]][] = [
    [/cashier|retail|store|sales associate/, ["Helped customers find products", "Handled payments", "Restocked or counted items", "Helped train a new team member"]],
    [/reception|office|administrat|secretar|assistant|coordinat/, ["Answered calls and messages", "Scheduled appointments or meetings", "Organized records", "Prepared routine documents"]],
    [/warehouse|stock|inventory|shipping|logistics|delivery/, ["Checked incoming items", "Picked or packed orders", "Tracked stock", "Followed safety procedures"]],
    [/restaurant|server|barista|food|cook|hospitality/, ["Took customer orders", "Handled payments", "Prepared food or drinks", "Kept work areas clean", "Coordinated work during busy periods"]],
    [/supervis|manager|team lead|foreman/, ["Assigned daily work", "Helped train team members", "Checked completed work", "Coordinated schedules", "Resolved day-to-day problems"]],
    [/customer|support|help desk/, ["Answered customer questions", "Recorded and followed up on requests", "Explained next steps", "Resolved problems within my authority"]],
    [/teacher|tutor|instructor|training/, ["Explained a topic or task", "Prepared learning activities", "Helped people practice", "Tracked progress"]],
  ];
  return [...new Set(groups.filter(([pattern]) => pattern.test(context)).flatMap(([, duties]) => duties))].slice(0, 12);
}

export function buildConfirmedReview(draft: FourStepDraft, documents: readonly IntakeDocument[], facts: readonly FactSuggestion[]): ReviewSection[] {
  const a = normalizedFourStepDraft(draft);
  const sections: ReviewSection[] = [
    { title: "Contact and documents", step: 0, controlId: "full-name", lines: [
      `Name: ${a.fullName}`, `Email: ${a.email}`, `Phone: ${a.phone || "Not supplied"}`, `Starting point: ${readableLabel(a.entryMode)}`,
      ...documents.map((doc) => `${doc.kind === "RESUME" ? "Resume" : "Previous cover letter"}: ${doc.name} (version ${doc.version}, ${readableLabel(doc.processingState)})`),
      `Previous cover letter use: ${readableLabel(a.priorCoverLetterUse)}`, `Career change: ${a.careerChange ? "Yes" : "No"}`, `No previous paid job: ${a.noPriorEmployment ? "Yes" : "No"}`,
    ] },
    { title: "Search direction", step: 1, controlId: "desired-activities", lines: [
      `Work I want: ${list(a.desiredActivities)}`, `Work to avoid: ${list(a.avoidedActivities)}`, `Help choosing a direction: ${a.guidanceRequested ? "Yes" : "No"}`,
      `Titles: ${list(a.targetTitles)}`, `Limit to these titles: ${a.titleRestrictionConfirmed ? "Yes" : "No"}`, `Breadth: ${readableLabel(a.searchBreadth)}`,
      `Industries of interest: ${list(a.industryInterests)}`, `Industries to exclude: ${list(a.blockedIndustries)}`,
    ] },
    { title: "Document facts and corrections", step: 2, controlId: "experience-additions", lines: facts.length ? facts.map((fact) => {
      const decision = a.factReviews[fact.id] || (fact.verification === "CUSTOMER_CONFIRMED" ? "CONFIRM" : "SKIP");
      const correction = a.factCorrections[fact.id];
      return `${fact.displayLabel}: ${fact.displayValue}. ${decision === "CONFIRM" ? "Confirmed" : decision === "CORRECT" ? correction?.category === "FIELD_EDITS" ? `Corrected values to use: ${readableFact({ ...fact.editableValues, ...correction.fields })}` : `Apply this correction to the information above: ${readableFact(correction)}` : "Excluded from confirmed facts"}. Source: ${fact.sourceLocator}`;
    }) : ["No document facts. The structured background below is the source."] },
  ];
  for (const [index, item] of a.experienceAdditions.entries()) sections.push({ title: `Experience ${index + 1}: ${item.roleOrRelationship || readableLabel(item.kind)}`, step: 2, controlId: "experience-additions", lines: [
    `Type: ${readableLabel(item.kind)}`, `Organization or project: ${item.organizationOrProject || "Not supplied"}`, `Role or relationship: ${item.roleOrRelationship || "Not supplied"}`,
    `Dates: ${experienceDate(item.startsOn, item.datePrecision)} to ${item.current ? "Current" : experienceDate(item.endsOn, item.datePrecision)} (${readableLabel(item.datePrecision)})`,
    `Tasks actually done: ${item.responsibilities.join("; ") || "Not supplied"}`, `Tools actually used: ${item.tools.join(", ") || "Not supplied"}`,
    `Scope: ${item.scope || "Not supplied"}`, `Outcome: ${item.outcome || "Not supplied"}`, `Intensity: ${item.intensityPercent === null ? "Not supplied" : `${item.intensityPercent}%`}`,
    `Education: ${[item.educationLevel, item.educationField, item.completionStatus].filter(Boolean).join("; ") || "Not supplied"}`, `Credentials: ${list(item.certifications)}`, `Coursework: ${list(item.relevantCoursework)}`, `Optional context: ${item.optionalDetail || "Not supplied"}`,
  ] });
  return [...sections,
    { title: "Task capabilities", step: 2, controlId: "experience-additions", lines: Object.entries(a.capabilities).map(([key, value]) => `${readableLabel(key)}: ${readableLabel(value)}`).concat(Object.keys(a.capabilities).length ? [] : ["None supplied"]) },
    { title: "Work modes and location", step: 3, controlId: "work-modes", lines: [`Accepted work modes: ${list(a.workModes)}`, `Preferred: ${a.preferredWorkMode ? readableLabel(a.preferredWorkMode) : "No preference"}`, `State: ${a.stateOrDc}`, ...(a.zipCode ? [`Commute origin: ${a.zipCode}; maximum ${a.commuteDistanceMiles} miles`] : [])] },
    { title: "Employment type and schedule", step: 3, controlId: "employment-types", lines: [`Types: ${list(a.employmentTypes)}`, `Preferred: ${a.preferredEmploymentType ? readableLabel(a.preferredEmploymentType) : "No preference"}`, `Schedule: ${list(a.schedules)}`] },
    { title: "Benefits and work conditions", step: 3, controlId: "benefits-preferences", lines: [`Benefits: ${readableFact(a.benefits)}`, `Conditions: ${readableFact(a.workConditionPreferences) || "None supplied"}`] },
    { title: "Compensation", step: 3, controlId: "compensation", lines: [`Target: ${formatCompensation(a.salaryTargetCents, a.salaryPeriod)}`, `Minimum: ${formatCompensation(a.salaryHardMinimumCents, a.salaryPeriod)}`, `Pay meaning: ${a.salaryBasis || "Not supplied"}`, `Minimum flexible: ${a.salaryMinimumFlexible ? "Yes" : "No"}`, `Unpublished pay: ${readableLabel(a.salaryUnpublishedPolicy)}`, `Overlapping range: ${readableLabel(a.salaryOverlapPolicy)}`, `Noncomparable pay: ${readableLabel(a.salaryNoncomparablePolicy)}`, `Variable pay: ${readableLabel(a.salaryVariablePayPolicy)}`] },
    { title: "Exclusions and unknown details", step: 3, controlId: "leave-out", lines: [`Exclude: ${list(a.dealbreakers)}`, `Other exclusions: ${a.customDealbreaker || "None supplied"}`, ...Object.entries(a.employerUnknownPolicies).map(([key, value]) => `${readableLabel(key)}: ${readableLabel(value)}`)] },
  ];
}

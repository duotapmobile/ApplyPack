import { describe, expect, it } from "vitest";
import { typedCriterionSchema } from "@/lib/domain/foundation";
import { parseListingRequirements, requirementPersistenceRows } from "@/lib/matching/listing-parser";
import { reconstructPersistedRequirementTree, type PersistedRequirementRow } from "@/lib/matching/evidence-derived";
import { validateRequirementTree } from "@/lib/matching/requirements";

const jobSnapshotId = "b7100000-0000-4000-8000-000000000001";
const parse = (listingText: string) => parseListingRequirements({ jobSnapshotId, listingText });
// Exact original failed connected fixture: do not shorten its public wording.
const connected = "Fictional résumé fixture — not an actual employer opening. Remote full-time role in Virginia. Required: proficient with Excel. Responsibilities: coordinate service recovery. Salary: $60000 per year. Resume required. Cover letter optional. Accepted formats: DOCX and PDF. Submission method: HTTPS upload.";

describe("prospective v7 statement parsing", () => {
  it("preserves the unchanged303-character capture and all useful statements without instruction strength contamination", () => {
    expect(connected.length).toBe(303);
    const result = parse(connected);
    expect(result.status).toBe("COMPLETE"); expect(result.parserVersion).toBe("listing-requirements-v7");
    expect(result.criteria.map(item => [item.kind, item.strength])).toEqual([
      ["WORK_MODE", "INFORMATIONAL"], ["GEOGRAPHY", "INFORMATIONAL"], ["EMPLOYMENT_TYPE", "INFORMATIONAL"],
      ["TOOL_CAPABILITY", "REQUIRED"], ["RESPONSIBILITY", "PREFERRED"], ["COMPENSATION", "INFORMATIONAL"],
    ]);
    expect(result.criteria.every(item => typedCriterionSchema.safeParse(item).success)).toBe(true);
    expect(result.criteria.find(item => item.kind === "TOOL_CAPABILITY")?.sourceLocator).toBe("line:1:statement:3");
    expect(result.criteria.find(item => item.kind === "RESPONSIBILITY")?.semanticKey).toBe("responsibilities: coordinate service recovery.");
    const rows = requirementPersistenceRows(result, connected) as PersistedRequirementRow[];
    expect(rows.filter(row => row.node_kind === "CRITERION").every(row => row.source_excerpt === connected)).toBe(true);
    expect(validateRequirementTree(result.tree)).toEqual(reconstructPersistedRequirementTree(rows));
    expect(parse(connected)).toEqual(result);
  });

  it.each([
    "Required: proficient with Excel. Must speak Spanish.",
    "Required: proficient with Excel and must speak Spanish.",
    "Required: proficient with Excel and security clearance.",
    "Required: proficient with Excel and 3 years of operations experience.",
    "Required: proficient with Excel and PowerPoint.",
    "Required: proficient with Excel and bilingual.",
    "Required: 3 years of customer support and 5 years of operations experience.",
    "Required: 3 years of operations experience and pass an audition.",
    "Required: 3 years of customer operations experience or proficient with Excel and must speak Spanish.",
    "Remote role required; must satisfy the bespoke matrix.",
    "Remote role required with security clearance.",
    "Resume required and 5 years of operations experience.",
    "Resume and 3 years of experience required.",
    "Required: bachelor's degree in physics and must speak Spanish or 5 years of operations experience.",
  ])("holds an unsupported or compound requirement without a successful fact hiding it: %s", (text) => {
    const result = parse(text);
    expect(result.status).toBe("NEEDS_HUMAN_REVIEW"); expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.some(issue => issue.code !== "NO_REQUIREMENTS_FOUND")).toBe(true);
  });

  it("keeps independently represented fact conjunctions and supported degree/experience alternatives", () => {
    const facts = parse("Remote and full-time work required.");
    expect(facts.status).toBe("COMPLETE");
    expect(facts.criteria.map(item => item.kind)).toEqual(["WORK_MODE", "EMPLOYMENT_TYPE"]);
    const alternative = parse("Required: bachelor's degree or 5 years of operations experience.");
    expect(alternative.status).toBe("COMPLETE");
    expect(alternative.criteria.map(item => item.kind)).toEqual(["EDUCATION", "EXPERIENCE"]);
    expect(alternative.tree?.kind === "ALL_OF" && alternative.tree.children[0].kind).toBe("ANY_OF");
    const finance = parse("Required: Bachelor's degree in finance OR five years of relevant experience.");
    expect(finance.status).toBe("COMPLETE");
    expect(finance.criteria.find(item => item.kind === "EDUCATION")).toMatchObject({ allowedFields: ["finance"] });
  });

  it("inherits explicit required list headings, keeps preferred sections separate, and holds an unknown item", () => {
    const result = parse("Requirements:\n- Proficient with Excel.\n- 3 years of operations experience.\nPreferred:\n- Familiar with Word.");
    expect(result.status).toBe("COMPLETE");
    expect(result.criteria.map(item => item.strength)).toEqual(["REQUIRED", "REQUIRED", "PREFERRED"]);
    expect(parse("Requirements:\n- Proficient with Excel.\n- Security clearance.").status).toBe("NEEDS_HUMAN_REVIEW");
    expect(parse("Required: proficient with Excel; security clearance.").status).toBe("NEEDS_HUMAN_REVIEW");
    const responsibilities = parse("Required: proficient with Excel.\nResponsibilities:\n- Coordinate service recovery.");
    expect(responsibilities.status).toBe("COMPLETE");
    expect(responsibilities.criteria.find(item => item.kind === "RESPONSIBILITY")).toMatchObject({ activity: "Coordinate service recovery.", strength: "PREFERRED", sourceLocator: "line:3:statement:1" });
  });

  it("does not strengthen negated requirements or let document instructions discharge candidate requirements", () => {
    expect(parse("Required: proficient with Excel. Bachelor's degree not required.").status).toBe("NEEDS_HUMAN_REVIEW");
    expect(parse("Requirements:\nNo experience required.").criteria).toEqual([]);
    expect(parse("Resume required. Cover letter optional. Required: proficient with Excel.").criteria.map(item => item.kind)).toEqual(["TOOL_CAPABILITY"]);
    expect(parse("Required: proficient with Excel. Remote full-time role in Virginia.").criteria.filter(item => item.kind !== "TOOL_CAPABILITY").every(item => item.strength === "INFORMATIONAL")).toBe(true);
  });

  it("does not split decimal money, degree abbreviations or initials", () => {
    const result = parse("Salary: $25.50 per hour. Required: Ph.D. degree.");
    expect(result.status).toBe("COMPLETE");
    expect(result.criteria.find(item => item.kind === "COMPENSATION")).toMatchObject({ lowerCents: 2550, period: "HOUR", sourceLocator: "line:1:statement:1" });
    expect(result.criteria.find(item => item.kind === "EDUCATION")).toMatchObject({ semanticKey: "required: ph.d. degree.", sourceLocator: "line:1:statement:2" });
    const abbreviation = parse("Required: proficient with tools, e.g. Excel and Word.");
    expect(abbreviation.status).toBe("NEEDS_HUMAN_REVIEW");
    expect(abbreviation.issues[0].text).toBe("Required: proficient with tools, e.g. Excel and Word.");
  });

  it.each(["1.0", "12.5", "1/2", "3-5", "3–5", "three to five"])("holds an unsupported duration instead of extracting only its final number: %s years", (duration) => {
    const text = `Required: ${duration} years of operations experience.`;
    const result = parse(text);
    expect(result.status).toBe("NEEDS_HUMAN_REVIEW");
    expect(result.criteria.filter(item => item.kind === "EXPERIENCE")).toEqual([]);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "AMBIGUOUS_HARD_REQUIREMENT", text }));
  });

  it.each([300, 301])("validates full typed meaning at the actual semantic-key character boundary %i", (length) => {
    const prefix = "Required: authorized to work ";
    const text = prefix + "é".repeat(length - prefix.length);
    const result = parse(text);
    expect(result.status).toBe(length === 300 ? "COMPLETE" : "NEEDS_HUMAN_REVIEW");
    if (length === 300) expect(result.criteria[0].semanticKey).toBe(text.toLowerCase());
    else expect(result.issues).toContainEqual(expect.objectContaining({ code: "INVALID_TYPED_REQUIREMENT", text }));
  });

  it.each([16_000, 16_001])("preserves the exact downstream original-line character limit %i, including multibyte text", (length) => {
    const prefix = "Required: proficient with Excel. About us: ";
    const text = prefix + "é".repeat(length - prefix.length);
    const result = parse(text);
    expect(text.length).toBe(length); expect(Buffer.byteLength(text, "utf8")).toBeGreaterThan(length);
    expect(result.status).toBe(length === 16_000 ? "COMPLETE" : "NEEDS_HUMAN_REVIEW");
    const rows = requirementPersistenceRows(result, text) as PersistedRequirementRow[];
    expect(rows.find(row => row.node_kind === "CRITERION")?.source_excerpt).toBe(text);
    if (length > 16_000) expect(result.issues.some(issue => issue.code === "INVALID_TYPED_REQUIREMENT")).toBe(true);
  });
});

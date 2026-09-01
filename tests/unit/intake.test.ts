import { describe, expect, it } from "vitest";
import { intakeSchema } from "@/lib/schemas/intake";

const valid = {
  email: "person@example.com",
  fullName: "Taylor Jordan",
  city: "Baltimore",
  state: "Maryland",
  timezone: "Eastern Time",
  linkedin: "",
  resumeFormat: "applypack",
  coverLetterPreference: "not_uploaded",
  backgroundTypes: ["Paid work"],
  backgroundDetails: "Ten years of teaching, documentation, planning, and customer communication.",
  tools: "",
  credentials: "",
  resumeCorrections: "",
  remoteRequirement: "preferred",
  hybridPolicy: "open",
  onSitePolicy: "exclude",
  remoteDetail: "Remote in the United States",
  minimumSalary: "$80,000",
  preferredSalary: "$90,000",
  minimumHourly: "",
  preferredHourly: "",
  unknownSalaryPolicy: "include_mark_unknown",
  employmentTypes: ["Full-time"],
  schedulePreferences: ["Weekdays"],
  requiredBenefits: ["Health insurance"],
  preferredBenefits: ["Paid time off"],
  unknownBenefitsPolicy: "include_mark_unknown",
  neverInclude: ["Sales"],
  tryAvoid: ["Heavy phone work"],
  previousDislikes: "",
  excludedIndustries: "",
  directionChoice: "ideas",
  targetTitles: "Customer operations",
  searchDistance: "adjacent",
  oldCareerExclusion: "",
  workAuthorization: "Authorized to work in the U.S.",
  needsSponsorship: "no",
  travelPreference: "No travel",
  commuteDistance: "",
  eligibilityRestrictions: "",
  criteriaApproved: true,
  researchAcknowledged: true,
  noGuaranteeAcknowledged: true,
  listingChangesAcknowledged: true,
  termsAccepted: true,
  accuracyConfirmed: true,
} as const;

describe("intake schema", () => {
  it("accepts a complete bounded intake", () => {
    expect(intakeSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a search without a hard exclusion", () => {
    expect(intakeSchema.safeParse({ ...valid, neverInclude: [] }).success).toBe(false);
  });

  it("requires all product acknowledgements", () => {
    for (const key of [
      "criteriaApproved",
      "researchAcknowledged",
      "noGuaranteeAcknowledged",
      "listingChangesAcknowledged",
    ] as const) {
      expect(intakeSchema.safeParse({ ...valid, [key]: false }).success).toBe(false);
    }
  });

  it("requires legal and accuracy confirmations", () => {
    expect(intakeSchema.safeParse({ ...valid, termsAccepted: false }).success).toBe(false);
    expect(intakeSchema.safeParse({ ...valid, accuracyConfirmed: false }).success).toBe(false);
  });

  it("rejects unbounded free text", () => {
    expect(intakeSchema.safeParse({ ...valid, backgroundDetails: "x".repeat(6001) }).success).toBe(false);
  });
});

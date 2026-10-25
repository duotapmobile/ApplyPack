import { describe, expect, it } from "vitest";
import { proposedSalaryReleasePolicy } from "@/lib/matching/proposed-salary-release-policy";

function fixture(): Parameters<typeof proposedSalaryReleasePolicy>[0] {
  return { snapshot: { id: "snapshot", schemaVersion: "criteria-v1", contentHash: "a".repeat(64), unpublishedSalaryPolicy: "ALLOW_WITH_WARNING" },
    evaluation: { snapshotId: "snapshot", rootResult: "UNKNOWN", eligibility: "ELIGIBLE_WITH_ALLOWED_UNKNOWNS", activeRootKeys: ["universal:salary", "requirement"],
      roots: [{ rootKey: "universal:salary", result: "UNKNOWN", resolutionIssue: "EMPLOYER_OMITTED", unknownTreatment: "ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING", consentVersion: `criteria-v1:${"a".repeat(64)}`, warning: "The employer did not publish compensation." },
        { rootKey: "requirement", result: "PASS", resolutionIssue: "NONE", unknownTreatment: "BLOCK" }],
      activeUnknownTreatments: ["ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING"], salaryStatus: "UNPUBLISHED", salaryDisposition: "ALLOWED_WITH_WARNING", customerWarnings: ["The employer did not publish compensation."] } };
}
describe("proposed, disconnected unpublished salary release policy", () => {
  it("permits only an explicitly consented unpublished salary omission with every other root passing", () => expect(proposedSalaryReleasePolicy(fixture())).toBe(true));
  it.each(["customer:commute:25-miles", "customer:benefit:health-insurance", "requirement", "universal:listing-legitimacy", "universal:listing-activity", "universal:application-path", "universal:source-authorization"])("does not broaden unknown root %s", (key) => {
    const f = fixture(); f.evaluation.roots[0].rootKey = key; f.evaluation.activeRootKeys[0] = key; expect(proposedSalaryReleasePolicy(f)).toBe(false);
  });
  it.each(["CANDIDATE_MISSING", "PARSER_UNCERTAIN", "EVIDENCE_CONFLICT", "NONE"] as const)("rejects %s", (issue) => { const f = fixture(); f.evaluation.roots[0].resolutionIssue = issue; expect(proposedSalaryReleasePolicy(f)).toBe(false); });
  it.each(["EXCLUDE", "", "HUMAN_REVIEW"])("rejects absent or excluded customer policy %s", (policy) => { const f = fixture(); f.snapshot.unpublishedSalaryPolicy = policy; expect(proposedSalaryReleasePolicy(f)).toBe(false); });
  it("rejects stale consent, wrong subject, empty warnings, unwaivable and BLOCK treatment", () => {
    for (const change of [{ consentVersion: "old" }, { warning: " " }, { unwaivable: true }, { unknownTreatment: "BLOCK" as const }]) {
      const f = fixture(); Object.assign(f.evaluation.roots[0], change); expect(proposedSalaryReleasePolicy(f)).toBe(false);
    }
    const f = fixture(); f.snapshot.id = "other"; expect(proposedSalaryReleasePolicy(f)).toBe(false);
    const missingWarning = fixture(); missingWarning.evaluation.customerWarnings = []; expect(proposedSalaryReleasePolicy(missingWarning)).toBe(false);
  });
  it("rejects hard failures, missing roots, duplicate roots, false root summaries and noncomparable salary", () => {
    const variants = [fixture(), fixture(), fixture(), fixture(), fixture()];
    variants[0].evaluation.roots[1].result = "FAIL"; variants[1].evaluation.roots.pop(); variants[2].evaluation.roots.push(variants[2].evaluation.roots[0]);
    variants[3].evaluation.rootResult = "PASS"; variants[4].evaluation.salaryStatus = "PUBLISHED_NONCOMPARABLE";
    for (const f of variants) expect(proposedSalaryReleasePolicy(f)).toBe(false);
  });
  it("retains a completely resolved eligible PASS with an empty active unknown summary", () => {
    const f = fixture(); f.evaluation.rootResult = "PASS"; f.evaluation.eligibility = "ELIGIBLE"; f.evaluation.activeUnknownTreatments = [];
    f.evaluation.roots[0] = { rootKey: "universal:salary", result: "PASS", resolutionIssue: "NONE", unknownTreatment: "BLOCK" };
    expect(proposedSalaryReleasePolicy(f)).toBe(true);
  });
});

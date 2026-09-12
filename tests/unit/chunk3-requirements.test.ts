import { describe, expect, it } from "vitest";
import { calculateVerifiedDuration, durationGate, evaluateRequirementTree, evaluateToolCapability, relatedEducationPass, validateRequirementTree, type EvaluatableRequirementNode, type LeafDecision } from "@/lib/matching/requirements";
import { equivalentToolAllowed, governedToolClusters, resolveToolTaskTree, taskTreePasses } from "@/lib/matching/tool-clusters";

let sequence = 1;
const uuid = () => `${(sequence++).toString(16).padStart(8, "0")}-0000-4000-8000-000000000001`;
function leaf(nodeId: string, semanticKey: string): EvaluatableRequirementNode {
  return { nodeId, semanticKey, kind: "CRITERION", criterion: { stableCriterionId: uuid(), semanticKey, strength: "REQUIRED", sourceLocator: "listing:1", parserCertainty: 1, version: "parser-v1", kind: "RESPONSIBILITY", activity: semanticKey, centrality: "CENTRAL", complexity: null, autonomy: null, scope: null, frequency: null } };
}
function decision(result: "PASS" | "FAIL" | "UNKNOWN", extras: Partial<LeafDecision> = {}): LeafDecision {
  return { result, resolutionIssue: result === "UNKNOWN" ? "CANDIDATE_MISSING" : "NONE", unknownTreatment: "BLOCK", importance: 3, evidenceConfidence: 0.9, candidateFactIds: result === "PASS" ? [uuid()] : [], jobEvidenceIds: result === "PASS" ? [uuid()] : [], relation: result === "PASS" ? "DIRECT" : "UNSUPPORTED", ...extras };
}

describe("Chunk 3 requirement semantics", () => {
  it.each([
    ["ALL_OF", ["PASS", "PASS"], "PASS"], ["ALL_OF", ["PASS", "UNKNOWN"], "UNKNOWN"], ["ALL_OF", ["FAIL", "UNKNOWN"], "FAIL"],
    ["ANY_OF", ["FAIL", "FAIL"], "FAIL"], ["ANY_OF", ["FAIL", "UNKNOWN"], "UNKNOWN"], ["ANY_OF", ["PASS", "UNKNOWN"], "PASS"],
  ] as const)("evaluates %s %j as %s", (kind, values, expected) => {
    const tree = { nodeId: `root-${kind}-${values.join("-")}`, semanticKey: `root.${kind}.${values.join(".")}`, kind, children: [leaf(`a-${uuid()}`, `a.${uuid()}`), leaf(`b-${uuid()}`, `b.${uuid()}`)] };
    const result = evaluateRequirementTree(tree, new Map(tree.children.map((node, index) => [node.nodeId, decision(values[index])])));
    expect(result.result).toBe(expected);
  });

  it("preserves A AND (B OR C) and makes a passed OR unknown immaterial", () => {
    const a = leaf("a", "a"), b = leaf("b", "b"), c = leaf("c", "c");
    const tree = { nodeId: "root", semanticKey: "root", kind: "ALL_OF" as const, children: [a, { nodeId: "or", semanticKey: "or", kind: "ANY_OF" as const, children: [b, c] }] };
    const result = evaluateRequirementTree(tree, new Map([["a", decision("PASS")], ["b", decision("PASS")], ["c", decision("UNKNOWN")]]));
    expect(result.result).toBe("PASS");
    expect(result.selectedSatisfactionPath).toEqual(["root", "a", "or", "b"]);
    expect(result.leafResults.find((item) => item.nodeId === "c")?.unknownTreatment).toBe("IMMATERIAL_ALTERNATIVE");
    expect(result.outcomeDeterminativeUnknownNodeIds).toEqual([]);
  });

  it("marks only UNKNOWN leaves capable of changing the current root outcome", () => {
    const a = leaf("a-determinative", "a-determinative"), b = leaf("b-pass", "b-pass"), c = leaf("c-immaterial", "c-immaterial");
    const tree = { nodeId: "root-determinative", semanticKey: "root-determinative", kind: "ALL_OF" as const, children: [a, { nodeId: "or-pass", semanticKey: "or-pass", kind: "ANY_OF" as const, children: [b, c] }] };
    const result = evaluateRequirementTree(tree, new Map([[a.nodeId, decision("UNKNOWN")], [b.nodeId, decision("PASS")], [c.nodeId, decision("UNKNOWN")]]));
    expect(result.result).toBe("UNKNOWN");
    expect(result.outcomeDeterminativeUnknownNodeIds).toEqual([a.nodeId]);
  });

  it("chooses a deterministic satisfaction path by importance, confidence, then ID", () => {
    const tree = { nodeId: "root", semanticKey: "root", kind: "ANY_OF" as const, children: [leaf("b", "b"), leaf("a", "a")] };
    expect(evaluateRequirementTree(tree, new Map([["a", decision("PASS", { importance: 2, evidenceConfidence: 0.9 })], ["b", decision("PASS", { importance: 2, evidenceConfidence: 0.9 })]])).selectedSatisfactionPath).toEqual(["root", "a"]);
    expect(evaluateRequirementTree(tree, new Map([["a", decision("PASS", { importance: 2, evidenceConfidence: 0.8 })], ["b", decision("PASS", { importance: 3, evidenceConfidence: 0.7 })]])).selectedSatisfactionPath).toEqual(["root", "b"]);
  });

  it("rejects empty, malformed, duplicate, non-required, and cyclic trees", () => {
    expect(() => validateRequirementTree({ nodeId: "r", semanticKey: "r", kind: "ALL_OF", children: [] })).toThrow("empty_requirement_operator");
    expect(() => validateRequirementTree({ nodeId: "r", semanticKey: "r", kind: "NOPE", children: [] })).toThrow("malformed_requirement_node");
    expect(() => validateRequirementTree({ nodeId: "r", semanticKey: "r", kind: "ALL_OF", children: [leaf("x", "same"), leaf("y", "same")] })).toThrow("duplicate_requirement_identity");
    const preferred = leaf("p", "preferred");
    if (preferred.kind !== "CRITERION") throw new Error("fixture_leaf_expected");
    preferred.criterion.strength = "PREFERRED";
    expect(() => validateRequirementTree(preferred)).toThrow("nonrequired_criterion_in_hard_tree");
    const cyclic: Record<string, unknown> = { nodeId: "r", semanticKey: "r", kind: "ALL_OF", children: [] }; (cyclic.children as unknown[]).push(cyclic);
    expect(() => validateRequirementTree(cyclic)).toThrow("cyclic_requirement_tree");
  });

  it("rejects missing decisions and passing leaves without linked evidence", () => {
    const one = leaf("a", "a");
    expect(() => evaluateRequirementTree(one, new Map())).toThrow("missing_or_invalid_leaf_decision");
    expect(() => evaluateRequirementTree(one, new Map([["a", decision("PASS", { jobEvidenceIds: [] })]]))).toThrow("passing_leaf_missing_evidence");
    expect(() => evaluateRequirementTree(one, new Map([["a", { ...decision("PASS"), result: "NOT_APPLICABLE" } as never]]))).toThrow("invalid_leaf_decision_union");
  });

  it.each([
    ["CURRENT_PROFICIENCY", "CAN_DO_NOW", "PASS", 1], ["CURRENT_PROFICIENCY", "DONE_BEFORE_NEEDS_REFRESHER", "UNKNOWN", 0], ["CURRENT_PROFICIENCY", "BASIC_EXPOSURE", "FAIL", 0], ["CURRENT_PROFICIENCY", "NOT_DONE", "FAIL", 0], ["CURRENT_PROFICIENCY", "UNSURE", "UNKNOWN", 0],
    ["PRIOR_EXPERIENCE", "CAN_DO_NOW", "PASS", 1], ["PRIOR_EXPERIENCE", "DONE_BEFORE_NEEDS_REFRESHER", "PASS", 1], ["PRIOR_EXPERIENCE", "BASIC_EXPOSURE", "UNKNOWN", 0], ["PRIOR_EXPERIENCE", "NOT_DONE", "FAIL", 0], ["PRIOR_EXPERIENCE", "UNSURE", "UNKNOWN", 0],
    ["FAMILIARITY", "CAN_DO_NOW", "PASS", 1], ["FAMILIARITY", "DONE_BEFORE_NEEDS_REFRESHER", "PASS", 1], ["FAMILIARITY", "BASIC_EXPOSURE", "PASS", 0.6], ["FAMILIARITY", "NOT_DONE", "FAIL", 0], ["FAMILIARITY", "UNSURE", "UNKNOWN", 0],
    ["PREFERRED", "CAN_DO_NOW", "PASS", 1], ["PREFERRED", "DONE_BEFORE_NEEDS_REFRESHER", "PASS", 0.75], ["PREFERRED", "BASIC_EXPOSURE", "PASS", 0.4], ["PREFERRED", "NOT_DONE", "PASS", 0], ["PREFERRED", "UNSURE", "PASS", 0],
  ] as const)("applies tool matrix %s/%s", (wording, status, result, factor) => expect(evaluateToolCapability(wording, status)).toMatchObject({ result, factor }));

  it("uses explicit Boolean generic tool clusters and posting-named task override", () => {
    expect(governedToolClusters.map((cluster) => cluster.clusterId)).toEqual(["SPREADSHEET", "CRM", "REPORTING_BI", "SQL", "SYSTEM_ADMINISTRATION"]);
    const crm = resolveToolTaskTree({ namedTasks: [], genericClusterId: "CRM" });
    expect(taskTreePasses(crm, new Set(["crm.update-records"]))).toBe(false);
    expect(taskTreePasses(crm, new Set(["crm.update-records", "crm.manage-pipeline"]))).toBe(true);
    const named = resolveToolTaskTree({ namedTasks: ["crm.update-records"], genericClusterId: "SQL" });
    expect(taskTreePasses(named, new Set(["crm.update-records"]))).toBe(true);
    expect(taskTreePasses(named, new Set(["sql.write-query", "sql.validate-result"]))).toBe(false);
  });

  it("keeps CRM, reporting, SQL, and administration separate and requires versioned equivalence", () => {
    const aliases = Object.fromEntries(governedToolClusters.map((cluster) => [cluster.clusterId, cluster.aliases]));
    expect(aliases.CRM).not.toContain("sql");
    expect(aliases.REPORTING_BI).not.toContain("system administration");
    expect(equivalentToolAllowed({ exact: false, mappingVersion: "tool-map-v1", rationale: "Same posting-named data export task.", mappedTasks: ["reporting.build-dashboard"] })).toBe(true);
    expect(equivalentToolAllowed({ exact: false, mappingVersion: "tool-map-v1", mappedTasks: ["reporting.build-dashboard"] })).toBe(false);
  });

  it("requires a versioned rationale for a related education field", () => {
    expect(relatedEducationPass({ exact: true, employerAllowsRelated: false })).toBe(true);
    expect(relatedEducationPass({ exact: false, employerAllowsRelated: true })).toBe(false);
    expect(relatedEducationPass({ exact: false, employerAllowsRelated: true, mappingVersion: "fields-v1", rationale: "Employer names finance-adjacent coursework." })).toBe(true);
  });

  it("preserves degree OR experience and degree AND experience semantics", () => {
    const degree = leaf("degree", "education.degree");
    const experience = leaf("experience", "experience.years");
    const orTree = { nodeId: "degree-or-experience", semanticKey: "degree-or-experience", kind: "ANY_OF" as const, children: [degree, experience] };
    const andTree = { nodeId: "degree-and-experience", semanticKey: "degree-and-experience", kind: "ALL_OF" as const, children: [degree, experience] };
    const decisions = new Map([["degree", decision("FAIL")], ["experience", decision("PASS")]]);
    expect(evaluateRequirementTree(orTree, decisions).result).toBe("PASS");
    expect(evaluateRequirementTree(andTree, decisions).result).toBe("FAIL");
  });

  it("leaves vague equivalent experience unknown instead of inventing a duration", () => {
    const vague = leaf("vague-equivalent", "education.vague-equivalent");
    expect(evaluateRequirementTree(vague, new Map([[vague.nodeId, decision("UNKNOWN", { resolutionIssue: "PARSER_UNCERTAIN" })]])).result).toBe("UNKNOWN");
  });

  it("calculates overlap-safe calendar and FTE duration without caregiving credit", () => {
    const duration = calculateVerifiedDuration([
      { startMonth: "2025-01", endMonth: "2025-06", intensityLower: 1, intensityUpper: 1, verified: true, relation: "DIRECT", kind: "PAID_EMPLOYMENT" },
      { startMonth: "2025-04", endMonth: "2025-09", intensityLower: 0.5, intensityUpper: 0.5, verified: true, relation: "DIRECT", kind: "VOLUNTEER" },
      { startMonth: "2024-01", endMonth: "2026-01", intensityLower: 1, intensityUpper: 1, verified: true, relation: "DIRECT", kind: "CAREGIVING" },
    ]);
    expect(duration).toMatchObject({ calendarMonths: 9, fteLowerMonths: 7.5, fteUpperMonths: 7.5 });
    expect(durationGate(9, "CALENDAR", duration)).toBe("PASS");
    expect(durationGate(8, "FTE", duration)).toBe("FAIL");
  });

  it("does not count ordinary adjacent evidence, but counts criterion-specific reviewed equivalence", () => {
    const ordinary = calculateVerifiedDuration([{ startMonth: "2025-01", endMonth: "2025-12", intensityLower: 1, intensityUpper: 1, verified: true, relation: "ADJACENT", kind: "PROJECT" }]);
    const context = { criterionId: uuid(), jobSnapshotId: uuid(), candidateFactVersionIds: [uuid()], rulesVersion: "matching-rules-v1", catalogVersion: "catalog-v1" };
    const reviewed = calculateVerifiedDuration([{ startMonth: "2025-01", endMonth: "2025-12", intensityLower: 1, intensityUpper: 1, verified: true, relation: "ADJACENT", kind: "PROJECT", equivalenceReview: { reviewId: uuid(), criterionId: context.criterionId, jobSnapshotId: context.jobSnapshotId, candidateFactVersionIds: [...context.candidateFactVersionIds], equivalentForCriterion: true, comparedTasks: ["coordinate escalations", "coordinate service recovery"], taskSimilarity: "STRONG", complexity: "comparable", autonomy: "comparable", scope: "comparable", domainContext: "adjacent", durationAndIntensity: "12 calendar months at full intensity", essentialTools: ["case system"], rationale: "The exact tasks and operating scope are strongly equivalent for this criterion.", reviewerId: uuid(), reviewedAt: "2026-09-05T12:00:00.000Z", rulesVersion: context.rulesVersion, catalogVersion: context.catalogVersion } }], context);
    expect(ordinary.calendarMonths).toBe(0);
    expect(reviewed.calendarMonths).toBe(12);
  });

  it("does not count transferable or unsupported evidence toward hard duration", () => {
    const duration = calculateVerifiedDuration([
      { startMonth: "2024-01", endMonth: "2024-12", intensityLower: 1, intensityUpper: 1, verified: true, relation: "TRANSFERABLE", kind: "PAID_EMPLOYMENT" },
      { startMonth: "2025-01", endMonth: "2025-12", intensityLower: 1, intensityUpper: 1, verified: true, relation: "UNSUPPORTED", kind: "PAID_EMPLOYMENT" },
    ]);
    expect(duration.calendarMonths).toBe(0);
  });

  it("leaves intermittent project duration unresolved when material intensity is unknown", () => {
    const duration = calculateVerifiedDuration([{ startMonth: "2025-01", endMonth: "2025-12", intensityLower: null, intensityUpper: null, verified: true, relation: "DIRECT", kind: "PROJECT" }]);
    expect(duration.unresolvedIntensity).toBe(true);
    expect(durationGate(1, "CALENDAR", duration)).toBe("UNKNOWN");
  });
});

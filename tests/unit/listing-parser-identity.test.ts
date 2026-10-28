import { describe, expect, it } from "vitest";
import { parseListingRequirements, requirementPersistenceRows, requirementNodeSemanticKey } from "@/lib/matching/listing-parser";
import { reconstructPersistedRequirementTree, deriveBoardRequirementGate, type PersistedCandidateFact, type PersistedIntakeForMatching, type PersistedRequirementRow } from "@/lib/matching/evidence-derived";
import { validateRequirementTree } from "@/lib/matching/requirements";
import type { TypedCriterion } from "@/lib/domain/foundation";

const jobId = "b1000000-0000-4000-8000-000000000001", snapshotId = "b1000000-0000-4000-8000-000000000002";
const mixed = "Required: 3 years of customer operations experience in this remote full-time role in Virginia.";
function parsed(text = mixed) { return parseListingRequirements({ jobSnapshotId: jobId, listingText: text }); }
function rows(text = mixed) { return requirementPersistenceRows(parsed(text), text) as PersistedRequirementRow[]; }

describe("versioned typed requirement tree identities", () => {
  it("reconstructs literal historical v6 records with unchanged IDs, meaning and bytes", () => {
    const criterion: TypedCriterion = { stableCriterionId: "4146f350-4702-4fc0-a3eb-39ed80738afc",
      semanticKey: "required: 3 years of customer operations experience.", strength: "REQUIRED", sourceLocator: "line:1",
      parserCertainty: 1, version: "listing-requirements-v6", kind: "EXPERIENCE", responsibilityOrDomain: "customer operations experience.",
      minimumMonths: 36, fteExplicit: false, permittedEquivalents: [], seniorityOrScope: null };
    const historical = [{ id: "94d79a1c-0442-4594-9248-7880b2a19b26", parent_id: null, position: 0, node_kind: "ALL_OF",
      semantic_key: `hard-root:${jobId}`, criterion_version: "listing-requirements-v6" },
    { id: criterion.stableCriterionId, parent_id: "94d79a1c-0442-4594-9248-7880b2a19b26", position: 0, node_kind: "CRITERION",
      stable_criterion_id: criterion.stableCriterionId, criterion_type: "EXPERIENCE", criterion_version: criterion.version,
      semantic_key: criterion.semanticKey, source_locator: "line:1", source_excerpt: "Required: 3 years of customer operations experience.",
      typed_value: criterion }] as PersistedRequirementRow[];
    const before = JSON.stringify(historical);
    expect(validateRequirementTree(reconstructPersistedRequirementTree(historical))).toEqual({
      nodeId: "94d79a1c-0442-4594-9248-7880b2a19b26", semanticKey: `hard-root:${jobId}`, kind: "ALL_OF",
      children: [{ nodeId: criterion.stableCriterionId, semanticKey: `EXPERIENCE:${criterion.semanticKey}`, kind: "CRITERION", criterion }],
    });
    expect(JSON.stringify(historical)).toBe(before);
    for (const version of ["listing-requirements-v5", "listing-requirements-v7"]) {
      const changed = structuredClone(historical); changed[1].criterion_version = version;
      expect(() => reconstructPersistedRequirementTree(changed)).toThrow("mismatched_typed_requirement_version");
    }
  });
  it("keeps same-line typed facts distinct through persistence and reconstruction", () => {
    const result = parsed(), persisted = rows();
    expect(result.status).toBe("COMPLETE");
    expect(result.criteria.map(c => c.kind)).toEqual(["WORK_MODE", "GEOGRAPHY", "EMPLOYMENT_TYPE", "EXPERIENCE"]);
    expect(new Set(result.criteria.map(c => c.semanticKey)).size).toBe(1);
    expect(new Set(result.criteria.map(c => c.stableCriterionId)).size).toBe(4);
    expect(validateRequirementTree(result.tree)).toEqual(reconstructPersistedRequirementTree(persisted));
    for (const criterion of result.criteria) {
      const row = persisted.find(row => row.stable_criterion_id === criterion.stableCriterionId)!;
      expect(row.typed_value).toEqual(criterion);
      expect(row.semantic_key).toBe(criterion.semanticKey);
      expect(row.source_excerpt).toBe(mixed);
      expect(row.source_locator).toBe("line:1:statement:1");
    }
  });

  it("still rejects duplicate same-kind meaning and duplicate node identities", () => {
    const result = parsed("Required: 3 years of customer operations experience.\nRequired: 3 years of customer operations experience.");
    expect(() => validateRequirementTree(result.tree)).toThrow("duplicate_requirement_identity");
    const tree = structuredClone(parsed().tree!);
    if (tree.kind === "CRITERION") throw new Error("fixture root");
    tree.children.push(structuredClone(tree.children[0]));
    expect(() => validateRequirementTree(tree)).toThrow("duplicate_requirement_identity");
  });

  it("preserves v5 stored meaning and its historical strict duplicate rejection", () => {
    const persisted = rows();
    for (const row of persisted) if (row.node_kind === "CRITERION") { row.criterion_version = "listing-requirements-v5"; (row.typed_value as TypedCriterion).version = "listing-requirements-v5"; }
    const bytes = JSON.stringify(persisted), tree = reconstructPersistedRequirementTree(persisted);
    expect(JSON.stringify(persisted)).toBe(bytes);
    expect(() => validateRequirementTree(tree)).toThrow("duplicate_requirement_identity");
    const single = rows("Required: 3 years of customer operations experience.");
    const leaf = single.find(row => row.node_kind === "CRITERION")!;
    (leaf.typed_value as TypedCriterion).version = "listing-requirements-v5";
    leaf.criterion_version = "listing-requirements-v5";
    expect(requirementNodeSemanticKey(leaf.typed_value as TypedCriterion)).toBe(leaf.semantic_key);
    expect(validateRequirementTree(reconstructPersistedRequirementTree(single))).toEqual(reconstructPersistedRequirementTree(single));
  });

  it.each(["stored", "typed", "missing"] as const)("rejects %s version disagreement before selecting v6 identity rules", (field) => {
    const persisted = rows();
    const leaf = persisted.find(row => row.node_kind === "CRITERION")!;
    if (field === "typed") (leaf.typed_value as TypedCriterion).version = "listing-requirements-v5";
    else leaf.criterion_version = field === "missing" ? null : "listing-requirements-v5";
    expect(() => reconstructPersistedRequirementTree(persisted)).toThrow("mismatched_typed_requirement_version");
  });

  it.each(["semantic_key", "criterion_type", "stable_criterion_id"] as const)("rejects a v6 persisted %s changed independently of the typed criterion", (key) => {
    const persisted = rows();
    const leaf = persisted.find(row => row.node_kind === "CRITERION")!;
    leaf[key] = key === "stable_criterion_id" ? snapshotId : "wrong";
    expect(() => reconstructPersistedRequirementTree(persisted)).toThrow(/mismatched/);
  });

  it("keeps exact candidate matching on the original semantic key", () => {
    const persisted = rows("Required: 3 years of customer operations experience.");
    const criterion = persisted.find(row => row.node_kind === "CRITERION")!;
    const fact: PersistedCandidateFact = { id: "b1000000-0000-4000-8000-000000000003", snapshot_id: snapshotId,
      semantic_key: criterion.semantic_key!, value_kind: "RESPONSIBILITY", typed_value: { activity: "customer operations" },
      verification: "CUSTOMER_CONFIRMED", source_kind: "CUSTOMER_ASSERTION", supplied_source_id: null, superseded_at: null,
      capability_status: "CAN_DO_NOW", calendar_duration_days: 1200, customer_display_label: "Customer operations", customer_display_value: "Customer operations" };
    const intake = { id: snapshotId } as PersistedIntakeForMatching;
    expect(deriveBoardRequirementGate(intake, persisted, [fact]).result).toBe("PASS");
    expect(deriveBoardRequirementGate(intake, persisted, [{ ...fact, semantic_key: `EXPERIENCE:${fact.semantic_key}` }]).result).toBe("UNKNOWN");
    (criterion.typed_value as TypedCriterion).version = "listing-requirements-v5";
    criterion.criterion_version = "listing-requirements-v5";
    expect(deriveBoardRequirementGate(intake, persisted, [fact]).result).toBe("PASS");
  });
});

import { describe, expect, it } from "vitest";
import {
  fitComponentNames,
  humanReviewRecordSchema,
  jobSnapshotProvenanceSchema,
  matchEvaluationSchema,
} from "@/lib/domain/evaluation";

const ids = Array.from({ length: 20 }, (_, index) => `${(index + 1).toString(16).padStart(8, "0")}-0000-4000-8000-000000000001`);
const criterion = {
  stableCriterionId: ids[2], semanticKey: "responsibility.operations", strength: "REQUIRED", sourceLocator: "listing:1", parserCertainty: 1, version: "criteria-v1",
  kind: "RESPONSIBILITY", activity: "coordinate operations", centrality: "CENTRAL", complexity: null, autonomy: null, scope: null, frequency: null,
};

describe("typed job and evaluation records", () => {
  it("validates complete immutable job provenance and rejects a conflicting posted-date marker", () => {
    const snapshot = {
      id: ids[0], discoverySource: "manual-reviewed", origin: "APPLYPACK_FOUND", externalJobId: null,
      canonicalApplicationUrl: "https://example.invalid/apply", applicationHostType: "EMPLOYER_HOSTED", canonicalEmployerListingUrl: null,
      sourceUrl: "https://example.invalid/job", company: "Example", exactTitle: "Coordinator", normalizedFingerprint: "a".repeat(64),
      capturedListing: "Coordinate operations.", retrievedAt: "2026-09-04T16:00:00.000Z", postedOn: null, postedDateUnknown: true,
      liveVerifiedAt: "2026-09-04T16:01:00.000Z", compensationText: null, compensationSource: null, locationAndWorkMode: { mode: "REMOTE" },
      requirementTree: { kind: "CRITERION", criterion }, parserVersion: "parser-v1", contentSha256: "b".repeat(64),
    };
    expect(jobSnapshotProvenanceSchema.safeParse(snapshot).success).toBe(true);
    expect(jobSnapshotProvenanceSchema.safeParse({ ...snapshot, postedDateUnknown: false }).success).toBe(false);
  });

  it("keeps eligibility, fit, confidence, salary, readiness, risk, warnings, versions, and review orthogonal", () => {
    const fitComponents = fitComponentNames.map((name, index) => ({
      name,
      applicability: "APPLICABLE",
      baseWeight: [35, 25, 20, 10, 10][index],
      coverage: 1,
      numerator: 3,
      denominator: 3,
      contributions: [{ criterionId: ids[2], importance: 3, evidenceRelation: "DIRECT", evidenceFactor: 1, capabilityOrDepthFactor: null }],
    }));
    const review = {
      id: ids[3], reviewerId: ids[4], reviewedAt: "2026-09-04T16:05:00.000Z", disposition: "APPROVED",
      rulesVersions: { matching: "match-v1" }, evidenceChanges: [], reason: "Evidence and source path reviewed.", adjacentEquivalence: null,
    };
    expect(humanReviewRecordSchema.safeParse(review).success).toBe(true);
    const evaluation = {
      id: ids[5], snapshotId: ids[6], jobSnapshotId: ids[0], eligibility: "ELIGIBLE", rootResult: "PASS",
      leafResults: [{ requirementNodeId: ids[7], result: "PASS", resolutionIssue: "NONE", unknownTreatment: "BLOCK", satisfactionPath: {
        requirementNodeId: ids[7], selectedChildNodeIds: [ids[7]], candidateFactIds: [ids[8]], jobEvidenceIds: [ids[9]], relation: "DIRECT", adjacentEquivalenceReviewId: null,
      } }],
      categoricalEvidenceSufficient: true, usefulnessRationale: "The core responsibility has direct confirmed support.", fitScore: 100, fitComponents,
      evidenceConfidence: 100, confidenceComponents: { candidateCompleteness: 1, employerCompleteness: 1, sourceQuality: 1, parserCertainty: 1, score: 100 },
      salaryStatus: "UNPUBLISHED", salaryDisposition: "ALLOWED_WITH_WARNING",
      softPreferences: { selectedCount: 0, score: null, components: [] }, applicationReadiness: "READY", presentationRisk: "LOW",
      presentationRiskReasons: [{ code: "configured-reason", allowlistVersion: "risk-v1", approved: true, evidenceIds: [ids[9]] }],
      warnings: [{ code: "salary-unpublished", messageKey: "salary.unpublished", evidenceIds: [ids[9]] }],
      candidateFactIds: [ids[8]], jobEvidence: [{ id: ids[9], jobSnapshotId: ids[0], field: "responsibility", sourceLocator: "listing:1", contentSha256: "c".repeat(64) }],
      versionBundle: { matching: "match-v1", parser: "parser-v1", catalog: "catalog-v1", criteria: "criteria-v1", selector: "selector-v1", jobSnapshot: "b".repeat(64) },
      humanReview: review,
    };
    expect(matchEvaluationSchema.safeParse(evaluation).success).toBe(true);
    expect(matchEvaluationSchema.safeParse({ ...evaluation, presentationRiskReasons: [{ ...evaluation.presentationRiskReasons[0], approved: false }] }).success).toBe(false);
    expect(matchEvaluationSchema.safeParse({ ...evaluation, confidenceComponents: { ...evaluation.confidenceComponents, score: 99 } }).success).toBe(false);
  });
});

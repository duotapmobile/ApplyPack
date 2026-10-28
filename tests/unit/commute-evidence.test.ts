import { describe, expect, it } from "vitest";
import { bindCommuteEvidence, commuteGateKey, reviewedCommuteResult, type CommuteObservation } from "@/lib/matching/commute-evidence";
import { matchingReviewRequestSchema } from "@/lib/matching/review";
import { deriveCustomerHardGates, type PersistedIntakeForMatching, type PersistedJobForMatching, type PersistedRequirementRow, type PersistedReview } from "@/lib/matching/evidence-derived";
import { parseListingRequirements, requirementPersistenceRows } from "@/lib/matching/listing-parser";

const id = (n: number) => `90000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.parse("2026-10-25T15:00:00Z");
const snapshot = { id: id(1), content_sha256: "a".repeat(64), travel: { zipCode: "23220", commuteDistanceMiles: 25 }, work_modes: ["ONSITE"], us_state_or_dc: "VA" } as PersistedIntakeForMatching;
const job = { id: id(2), content_sha256: "b".repeat(64) } as PersistedJobForMatching;
const listingText = "Onsite full-time role at 100 Example Street, Richmond, Virginia.\nRequired: 3 years of customer service experience.\nResponsibilities: answer customer calls.";
const parsed = parseListingRequirements({ jobSnapshotId: job.id, listingText });
const nodes = requirementPersistenceRows(parsed, listingText) as PersistedRequirementRow[];
const node = nodes.find((item) => item.criterion_type === "WORK_MODE")!;
const observation: CommuteObservation = { destinationNodeId: node.id, destination: "100 Example Street", destinationPrecision: "STREET_ADDRESS", method: "DRIVE", oneWayMiles: 12.4, oneWayMinutes: 28,
  routeSourceUrl: "https://maps.example.invalid/route/fictional", checkedAt: "2026-10-25T14:40:00.000Z", routeNotes: "Fictional route fixture, from the confirmed ZIP area to the named worksite.", reviewedOriginArea: true, reviewedExactWorksite: true };
const bound = (changes: Partial<CommuteObservation> = {}) => bindCommuteEvidence({ observation: { ...observation, ...changes }, snapshot, job, nodes, reviewerId: id(3), reviewedAt: "2026-10-25T14:50:00.000Z" });
const request = () => ({ snapshotId: snapshot.id, jobSnapshotId: job.id, reviewKind: "CUSTOMER_CRITERION", disposition: "RESOLVED_PASS", customerCriterionKey: commuteGateKey(snapshot), resolutionIssue: "NONE", unknownTreatment: "BLOCK", sourceEvidenceNodeIds: [node.id], candidateFactIds: [], evidenceChanges: ["Checked the route."], rationale: "Checked the actual employer destination and confirmed origin.", commuteObservation: observation });
const review = (evidence: unknown): PersistedReview => ({ id: id(4), snapshot_id: snapshot.id, job_snapshot_id: job.id, review_kind: "CUSTOMER_CRITERION", review_subject_key: commuteGateKey(snapshot), invalidated_at: null, reviewer_id: id(3), created_at: "2026-10-25T14:50:00.000Z", decision: { customerCriterionKey: commuteGateKey(snapshot), sourceEvidenceNodeIds: [node.id], unknownTreatment: "BLOCK", result: "PASS", commuteEvidence: evidence } });
const result = (evidence: unknown, changes = {}) => reviewedCommuteResult({ evidence, snapshot, job, nodes, reviewerId: id(3), now, ...changes });
const gate = (reviews: PersistedReview[] = [], criteria = parsed.criteria) => deriveCustomerHardGates({ snapshot, job, nodes, reviews, criteria, now }).find((item) => item.rootKey.startsWith("customer:commute"));

describe("checked commute evidence", () => {
  it("binds exact immutable subjects and derives the limit outcome from measured miles", () => {
    expect(bound()).toMatchObject({ snapshotId: snapshot.id, snapshotHash: snapshot.content_sha256, jobHash: job.content_sha256, originZip: "23220", maximumMiles: 25, reviewerId: id(3) });
    expect(result(bound())).toBe("PASS"); expect(result(bound({ oneWayMiles: 26 }))).toBe("FAIL");
    expect(gate([review(bound())])).toMatchObject({ result: "PASS" });
  });
  it.each(["snapshotId", "snapshotHash", "jobSnapshotId", "jobHash", "originZip", "maximumMiles", "reviewerId", "destinationSourceExcerpt", "destinationSourceLocator", "destinationNodeId"])("rejects mismatched %s", (key) => {
    const evidence = { ...bound(), [key]: key.endsWith("Id") ? id(99) : key.endsWith("Hash") ? "c".repeat(64) : key === "maximumMiles" ? 99 : "wrong" };
    expect(result(evidence)).toBeNull(); expect(gate([review(evidence)])).toMatchObject({ result: "UNKNOWN", unknownTreatment: "BLOCK" });
  });
  it.each([now + 24 * 60 * 60 * 1000, Date.parse("2026-10-25T14:49:00Z")])("rejects stale or future-dated evidence at %s", (time) => expect(result(bound(), { now: time })).toBeNull());
  it("rejects missing confirmed origin and invented employer destinations", () => {
    expect(() => bindCommuteEvidence({ observation, snapshot: { ...snapshot, travel: { commuteDistanceMiles: 25 } }, job, nodes, reviewerId: id(3), reviewedAt: new Date(now).toISOString() })).toThrow("origin");
    expect(() => bound({ destination: "900 Imaginary Road" })).toThrow("destination");
    expect(() => bound({ checkedAt: "2026-10-23T14:00:00Z" })).toThrow("stale");
  });
  it.each([{ oneWayMiles: -1 }, { oneWayMinutes: 0 }, { routeSourceUrl: "http://example.invalid" }, { routeSourceUrl: "https://secret@example.invalid" }, { method: "FLY" }, { reviewedOriginArea: false }])("rejects malformed observations %s", (change) => {
    expect(matchingReviewRequestSchema.safeParse({ ...request(), commuteObservation: { ...observation, ...change } }).success).toBe(false);
  });
  it("rejects generic PASS, cross-purpose observations, or waived unknown commutes", () => {
    expect(matchingReviewRequestSchema.safeParse(request()).success).toBe(true);
    expect(matchingReviewRequestSchema.safeParse({ ...request(), commuteObservation: undefined }).success).toBe(false);
    expect(matchingReviewRequestSchema.safeParse({ ...request(), customerCriterionKey: "customer:work-mode" }).success).toBe(false);
    expect(matchingReviewRequestSchema.safeParse({ ...request(), unknownTreatment: "ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING" }).success).toBe(false);
    expect(gate([review(undefined)])).toMatchObject({ result: "UNKNOWN", unknownTreatment: "BLOCK" });
  });
  it("does not accept another snapshot, another job, an invalidated review or a contradictory result", () => {
    for (const change of [{ snapshot_id: id(88) }, { job_snapshot_id: id(88) }, { invalidated_at: new Date(now).toISOString() }, { decision: { ...review(bound()).decision as object, result: "FAIL" } }]) {
      expect(gate([{ ...review(bound()), ...change }])).toMatchObject({ result: "UNKNOWN" });
    }
  });
  it("never compares an employer's maximum to the customer limit as a route measurement", () => {
    const employerLimit = { ...parsed.criteria[0], kind: "COMMUTE", maximum: 1, unit: "MILES", method: "DRIVE", originRegion: "Another city" } as typeof parsed.criteria[number];
    expect(gate([], [...parsed.criteria, employerLimit])).toMatchObject({ result: "UNKNOWN", resolutionIssue: "EVIDENCE_CONFLICT" });
  });
  it("requires no commute for exclusively remote work", () => {
    const remote = parseListingRequirements({ jobSnapshotId: job.id, listingText: "Remote full-time role in Virginia.\nResponsibilities: answer customer calls." });
    expect(gate([], remote.criteria)).toBeUndefined();
  });
});

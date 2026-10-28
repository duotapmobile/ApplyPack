import { describe, expect, it } from "vitest";
import { repairCaseStateRequestSchema, repairFeedbackBody, repairFeedbackRequestSchema, repairFollowupCanonicalJson } from "@/lib/materials/service-repair-followup";
const id = (n: number) => `a1020000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const request = { requestId: id(1), caseId: id(2), materialLineId: id(3), releaseId: id(4),
  items: [{ artifactId: id(5), fileVersionId: id(6), concern: "The accepted phone error remains in this file." }], sameAcceptedIssue: true };
describe("repair follow-up request boundaries", () => {
  it("retains exact normalized request bytes and explicit affected repaired files", () => {
    const body = repairFeedbackBody(request);
    expect(repairFollowupCanonicalJson(body)).toBe(repairFollowupCanonicalJson(JSON.parse(JSON.stringify(body))));
    expect(body.items).toEqual(request.items); expect(body.schemaVersion).toBe("applypack-service-repair-feedback-v1");
  });
  it.each([
    { sameAcceptedIssue: false }, { items: [...request.items, ...request.items] }, { items: [] },
    { customerId: id(9) }, { items: [{ ...request.items[0], concern: "x" }] },
    { items: Array.from({ length: 4 }, (_, index) => ({ ...request.items[0], fileVersionId: id(index + 10) })) },
  ])("rejects malformed or expanded request %j", (change) => expect(repairFeedbackRequestSchema.safeParse({ ...request, ...change }).success).toBe(false));
  it("requires the exact review context and two explicit owner checks", () => {
    const state = { requestId: id(1), caseId: id(2), acceptedScopeSha256: "a".repeat(64), expectedReviewContextSha256: "b".repeat(64),
      action: "RESOLVED", explanation: "I checked every affected repaired document.", reviewedRepairFiles: true, reviewedFeedback: true };
    expect(repairCaseStateRequestSchema.safeParse(state).success).toBe(true);
    for (const change of [{ expectedReviewContextSha256: null }, { reviewedRepairFiles: false }, { reviewedFeedback: false }, { action: "SEND" }])
      expect(repairCaseStateRequestSchema.safeParse({ ...state, ...change }).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { canonicalSha256 } from "@/lib/domain/foundation";
import { buildManualSourceInventory, manualSourceObservationSchema, type ManualSourceObservationInput } from "@/lib/jobs/manual-source-inventory";

const input: ManualSourceObservationInput = {
  observationId: "a1000000-0000-4000-8000-000000000001",
  posting: { sourceId: "vipdesk-connect", employerName: "VIPdesk Connect", title: "Operations Coordinator", externalJobId: "manual-1" },
  review: { checkedAt: "2026-09-22T12:00:00Z", officialListingUrl: "https://jobs.lever.co/vipdesk/manual-1",
    officialApplicationUrl: "https://jobs.lever.co/vipdesk/manual-1/apply",
    capturedText: "Remote full-time role in Virginia.\nRequired: 3 years of customer operations experience.\nResponsibilities: coordinate service recovery.",
    evidenceNotes: "Operator inspected the live official listing and application page.",
    transitionReason: "Operator recorded this official listing for independent manual research.",
    employerIdentityConfirmed: true, applicationPathConfirmed: true, listingActiveConfirmed: true, legitimacyConfirmed: true },
};
const now = new Date("2026-09-22T12:01:00Z");
describe("manual source verification evidence", () => {
  it("records human transcription and shared parsed requirements without an enumeration claim", () => {
    const result = buildManualSourceInventory(input, now);
    expect(result.snapshot.captured_listing.fieldEvidence.title.method).toBe("HUMAN_DIRECT_OFFICIAL_TRANSCRIPTION");
    expect(result.snapshot.captured_listing.fieldEvidence.salaryMin.method).toBe("UNKNOWN");
    expect(result.snapshot.content_sha256).toBe(canonicalSha256(result.snapshot.captured_listing));
    expect(result.requirementNodes.length).toBeGreaterThan(1);
    expect(result).not.toHaveProperty("runId");
    expect(result).not.toHaveProperty("inventoryMemberId");
  });
  it("requires the review reason and all direct verification gates", () => {
    expect(manualSourceObservationSchema.safeParse({ ...input, review: { ...input.review, transitionReason: "" } }).success).toBe(false);
    expect(manualSourceObservationSchema.safeParse({ ...input, review: { ...input.review, legitimacyConfirmed: false } }).success).toBe(false);
  });
  it("rejects stale capture and unresolved requirements", () => {
    expect(() => buildManualSourceInventory(input, new Date("2026-09-22T13:00:00Z"))).toThrow("time_invalid");
    expect(() => buildManualSourceInventory({ ...input, review: { ...input.review,
      capturedText: "Must satisfy the employer's bespoke certification matrix." } }, now)).toThrow("parser_review_required");
  });
});

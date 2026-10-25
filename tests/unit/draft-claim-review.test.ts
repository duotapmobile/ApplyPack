import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { draftClaimReviewRequestSchema, prepareDraftClaimReview } from "@/lib/documents/draft-claim-review";
import { DRAFT_RENDER_SOURCE_VERSION, type DraftRenderSource } from "@/lib/documents/draft-render-source";

const id = (n: number) => `79000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const now = new Date("2026-10-25T12:00:00.000Z");
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortKeys(item)]));
  return value;
}
// Focused review-projection fixture. Full packet/proposal/render-source validation
// is exercised separately; this tests the owner's exact saved-source boundary.
function fixture() {
  const claim = { claimId: id(1), placement: "resume.skills.0", text: "Handled appointment scheduling.", wordingSha256: digest("Handled appointment scheduling."),
    kind: "CANDIDATE_FACT", origin: "MODEL_PROPOSAL", qualification: "EXACT", state: "OWNER_REVIEW_REQUIRED",
    factRefs: [{ factId: id(2), attributionFactId: id(2), field: "responsibilities.0", valueSha256: "f".repeat(64) }],
    jobEvidenceIds: [], referencePermissionIds: [], contactBinding: null,
    questionInsights: [{ questionId: id(3), interpretation: "POTENTIAL_EMPLOYER_PRIORITY_NOT_A_CANDIDATE_QUALIFICATION" }] };
  const sourceBody = { schemaVersion: DRAFT_RENDER_SOURCE_VERSION, expected: { customerId: id(10), materialLineId: id(11), revisionId: id(12) },
    packetSha256: "a".repeat(64), state: "OWNER_REVIEW_REQUIRED", deliveryAuthorized: false,
    validUntil: "2026-10-25T12:30:00.000Z", ownerReviewClaims: [claim] };
  const source = { ...sourceBody, renderSourceSha256: digest(JSON.stringify(sortKeys(sourceBody))) } as unknown as DraftRenderSource;
  const binding = { ...source.expected, versionId: id(13), packetSha256: source.packetSha256, sourceSha256: source.renderSourceSha256 };
  const request = { versionId: binding.versionId, packetSha256: binding.packetSha256, sourceSha256: binding.sourceSha256,
    claims: [{ claimId: claim.claimId, wordingSha256: claim.wordingSha256, decision: "APPROVED" }] };
  return { source, binding, reviewerId: id(14), request };
}

describe("explicit owner wording review", () => {
  it("derives database references from saved source and keeps private wording/question context only in the encrypted payload", () => {
    const input = fixture(), result = prepareDraftClaimReview(input, now);
    expect(result.reviewSha256).toBe(digest(result.body));
    expect(result.metadata[0]).toEqual({ claimId: id(1), wordingSha256: digest("Handled appointment scheduling."), decision: "APPROVED",
      kind: "CANDIDATE_FACT", qualification: "EXACT", factRefs: input.source.ownerReviewClaims[0].factRefs, jobEvidenceIds: [], referencePermissionIds: [] });
    expect(JSON.stringify(result.metadata)).not.toContain("Handled appointment");
    expect(JSON.stringify(result.metadata)).not.toContain(id(3));
    expect(JSON.parse(result.body)).toMatchObject({ reviewerId: id(14), reviewedAt: now.toISOString(),
      claims: [{ text: "Handled appointment scheduling.", decision: "APPROVED", questionInsights: [{ questionId: id(3) }] }] });
  });
  it.each(["version", "packet", "source", "wording", "claim"])("rejects changed %s rather than applying old approval", (kind) => {
    const input = fixture();
    if (kind === "version") input.request.versionId = id(99);
    if (kind === "packet") input.request.packetSha256 = "b".repeat(64);
    if (kind === "source") input.request.sourceSha256 = "b".repeat(64);
    if (kind === "wording") input.request.claims[0].wordingSha256 = "b".repeat(64);
    if (kind === "claim") input.request.claims[0].claimId = id(99);
    expect(() => prepareDraftClaimReview(input, now)).toThrow();
  });
  it.each(["customerId", "materialLineId", "revisionId"] as const)("rejects a saved source from another %s", (key) => {
    const input = fixture(); input.binding[key] = id(99);
    expect(() => prepareDraftClaimReview(input, now)).toThrow();
  });
  it("rejects duplicate approvals and omitted decisions", () => {
    const input = fixture(); input.request.claims.push({ ...input.request.claims[0] });
    expect(() => prepareDraftClaimReview(input, now)).toThrow();
    input.request.claims = []; expect(() => prepareDraftClaimReview(input, now)).toThrow();
  });
  it("does not accept browser-provided provenance or reviewer identity", () => {
    const input = fixture();
    expect(draftClaimReviewRequestSchema.safeParse({ ...input.request, reviewerId: id(99) }).success).toBe(false);
    expect(draftClaimReviewRequestSchema.safeParse({ ...input.request,
      claims: [{ ...input.request.claims[0], factRefs: input.source.ownerReviewClaims[0].factRefs }] }).success).toBe(false);
  });
  it("rejects expired evidence and altered saved-source bytes", () => {
    const input = fixture();
    expect(() => prepareDraftClaimReview(input, new Date("2026-10-25T12:30:00Z"))).toThrow();
    input.source.ownerReviewClaims[0].text = "Managed the whole company.";
    expect(() => prepareDraftClaimReview(input, now)).toThrow();
  });
  it("rejects a negative or absent explicit approval", () => {
    const input = fixture();
    expect(() => prepareDraftClaimReview({ ...input, request: { ...input.request,
      claims: [{ ...input.request.claims[0], decision: "REJECTED" }] } }, now)).toThrow();
  });
});

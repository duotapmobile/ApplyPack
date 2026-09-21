import { describe, expect, it, vi } from "vitest";
import { buildVerifiedSourceInventory, promoteVerifiedSourceInventory, type SourceVerificationInput } from "@/lib/jobs/verified-source-inventory";
import { captureRawSourceEvidence } from "@/lib/jobs/raw-source-evidence";
import { normalizeJob } from "@/lib/jobs/normalize";
import type { RawJobPosting } from "@/lib/jobs/types";

const now = new Date("2026-09-20T12:05:00Z");
const text = "Remote full-time role in Virginia.\nRequired: 3 years of customer operations experience.\nResponsibilities: coordinate service recovery.";
const posting: RawJobPosting = { sourceId: "vipdesk-connect", employerName: "VIPdesk Connect", externalJobId: "bridge-1",
  title: "Operations Coordinator", description: text, sourceJobUrl: "https://jobs.lever.co/vipdesk/bridge-1",
  officialApplicationUrl: "https://jobs.lever.co/vipdesk/bridge-1/apply", lastVerifiedAt: "2026-09-20T12:00:00Z",
  rawSourceEvidence: captureRawSourceEvidence("lever-v3", { id: "bridge-1", descriptionPlain: text }) };
const input: SourceVerificationInput = { projectionId: "a1000000-0000-4000-8000-000000000001", snapshotId: "b1000000-0000-4000-8000-000000000001",
  checkedAt: "2026-09-20T12:04:00Z", officialListingUrl: posting.sourceJobUrl!, officialApplicationUrl: posting.officialApplicationUrl!, capturedText: text,
  evidenceNotes: "Operator compared official live listing and actionable application destination.",
  employerIdentityConfirmed: true, applicationPathConfirmed: true, listingActiveConfirmed: true, legitimacyConfirmed: true };
const binding = { jobId: "c1000000-0000-4000-8000-000000000001", observedAt: "2026-09-20T12:00:00Z",
  observedHash: normalizeJob(posting, now).contentHash, adapterVersion: "lever-v3" };

describe("verified source inventory bridge", () => {
  it("uses shared parsing and retains direct capture and provider evidence without manufacturing evaluations", () => {
    const result = buildVerifiedSourceInventory(input, posting, binding, now);
    expect(result.snapshot.application_host_type).toBe("APPROVED_THIRD_PARTY");
    expect(result.snapshot.canonical_employer_domain).toBeNull();
    expect(result.snapshot.legacy_job_id).toBe(binding.jobId);
    expect(result.snapshot.captured_listing.rawSourceEvidence).toEqual(posting.rawSourceEvidence);
    expect(result.requirementNodes.length).toBeGreaterThan(1);
    expect(result.review.method).toBe("HUMAN_DIRECT_OFFICIAL_REVIEW");
    expect(result.snapshot).not.toHaveProperty("fit_score");
    expect(result.snapshot).not.toHaveProperty("eligibility");
  });
  it.each([
    { checkedAt: "2026-09-20T11:00:00Z" }, { checkedAt: "2026-09-20T12:06:00Z" },
    { capturedText: "Changed requirements" }, { officialListingUrl: "https://jobs.lever.co/vipdesk/another" },
    { officialApplicationUrl: "https://unrelated.example/apply" },
  ])("rejects stale or mismatched direct verification %j", (change) => {
    expect(() => buildVerifiedSourceInventory({ ...input, ...change }, posting, binding, now)).toThrow();
  });
  it("rejects provider evidence tampering and unresolved parser requirements", () => {
    expect(() => buildVerifiedSourceInventory(input, { ...posting, rawSourceEvidence: undefined }, binding, now)).toThrow("raw_evidence_invalid");
    const unresolved = { ...posting, description: "Must satisfy the employer's bespoke certification matrix." };
    expect(() => buildVerifiedSourceInventory({ ...input, capturedText: unresolved.description! }, unresolved,
      { ...binding, observedHash: normalizeJob(unresolved, now).contentHash }, now)).toThrow("parser_review_required");
  });
  it("refuses partial collection before any promotion RPC", async () => {
    const rows: Record<string, unknown> = {
      job_source_listing_projections: { id: input.projectionId, run_id: "run", listing_key: "key", job_id: binding.jobId },
      job_source_run_listings: { captured_listing: posting, content_sha256: binding.observedHash, observed_at: binding.observedAt },
      job_source_runs: { adapter_version: "lever-v3", status: "partial", enumeration_status: "partial" },
      ap_feasibility_coverage_plans: { inventory_version_id: "inventory" },
    };
    const rpc = vi.fn();
    const admin = { rpc, from: (table: string) => {
      const q = { select: () => q, eq: () => q, order: () => q, limit: () => q,
        maybeSingle: async () => ({ data: rows[table], error: null }) }; return q;
    } } as unknown as Parameters<typeof promoteVerifiedSourceInventory>[0];
    await expect(promoteVerifiedSourceInventory(admin, "operator", input)).rejects.toThrow("inventory_or_run_unavailable");
    expect(rpc).not.toHaveBeenCalled();
  });
});

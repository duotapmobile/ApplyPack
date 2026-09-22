import { describe, expect, it } from "vitest";
import { resumeSourceCheckpoint } from "@/lib/jobs/source-checkpoint";
import { sourceCompensation, sourceFieldEvidence } from "@/lib/jobs/field-evidence";
import type { RawJobPosting } from "@/lib/jobs/types";
import { normalizeJob } from "@/lib/jobs/normalize";

const prior = { scope_sha256: "scope", adapter_version: "lever-v3", enumeration_status: "partial",
  response_classification: "bounded_partial", checkpoint_end: { cursor: "100" } };
const posting: RawJobPosting = { sourceId: "vipdesk-connect", employerName: "VIPdesk Connect", title: "Coordinator",
  sourceJobUrl: "https://jobs.lever.co/vipdesk/1" };

describe("source continuation and field evidence", () => {
  it("resumes only a bounded page under the same scope and adapter version", () => {
    expect(resumeSourceCheckpoint(prior, "scope", "lever-v3")).toBe("100");
    expect(resumeSourceCheckpoint(prior, "new-authority", "lever-v3")).toBeNull();
    expect(resumeSourceCheckpoint(prior, "scope", "lever-v4")).toBeNull();
    expect(resumeSourceCheckpoint(prior, "scope", null)).toBeNull();
    expect(resumeSourceCheckpoint({ ...prior, response_classification: "invalid_payload" }, "scope", "lever-v3")).toBeNull();
    expect(resumeSourceCheckpoint({ ...prior, enumeration_status: "complete" }, "scope", "lever-v3")).toBeNull();
  });
  it.each(["0", "-1", "100001", "NaN", "1.5", "1e2", "99999999999999999999"])("rejects unsafe cursor %s", (cursor) => {
    expect(resumeSourceCheckpoint({ ...prior, checkpoint_end: { cursor } }, "scope", "lever-v3")).toBeNull();
  });
  it("preserves unknown compensation rather than inventing currency or period", () => {
    expect(sourceCompensation(posting)).toEqual({ text: null, source: null, completeness: 0 });
    expect(sourceCompensation({ ...posting, salaryMin: 20 })).toEqual({
      text: "Currency unspecified 20 period unspecified", source: posting.sourceJobUrl, completeness: 50,
    });
    expect(sourceCompensation({ ...posting, salaryMin: 20, salaryMax: 25, salaryCurrency: "USD", payPeriod: "hour" })).toEqual({
      text: "USD 20–25 hour", source: posting.sourceJobUrl, completeness: 100,
    });
  });
  it("distinguishes missing fields from observed zero amounts", () => {
    expect(sourceFieldEvidence(posting).salaryMin.method).toBe("UNKNOWN");
    expect(sourceFieldEvidence({ ...posting, salaryMin: 0 }).salaryMin.method).toBe("PROVIDER_STRUCTURED_FIELD");
  });
  it("keeps cross-source fingerprints separate from application-path verification", () => {
    const base = { ...posting, sourceJobUrl: "https://jobs.lever.co/vipdesk/one", externalJobId: null };
    const first = normalizeJob({ ...base, officialApplicationUrl: "https://jobs.lever.co/vipdesk/one" });
    const second = normalizeJob({ ...base, officialApplicationUrl: "https://jobs.lever.co/vipdesk/two" });
    expect(first.contentHash).not.toBe(second.contentHash);
    expect(first.deduplicationKey).toBe(second.deduplicationKey);
    expect(normalizeJob({ ...base, salaryMin: 40 }).deduplicationKey).not.toBe(first.deduplicationKey);
  });
  it("invalidates a normalized snapshot when pay or eligibility changes without description changes", () => {
    const base = normalizeJob(posting).contentHash;
    expect(normalizeJob({ ...posting, salaryMin: 25 }).contentHash).not.toBe(base);
    expect(normalizeJob({ ...posting, eligibleStates: ["VA"] }).contentHash).not.toBe(base);
    expect(sourceFieldEvidence(posting).phoneIntensity.method).toBe("HEURISTIC_REQUIRES_REVIEW");
  });
});

import { describe, expect, it } from "vitest";
import { bindPacketEvidence } from "@/lib/documents/job-match-packet/evidence";
import { jobMatchPacketFilename, jobMatchPacketIdentity } from "@/lib/documents/job-match-packet/identity";
import { parseFinalJobMatchPacketContent } from "@/lib/documents/job-match-packet/schema";
import { jobMatchPacketFixture } from "../fixtures/job-match-packet";

describe("final job-match packet content", () => {
  it("requires exactly 10 distinct approved jobs", () => {
    const fixture = jobMatchPacketFixture();
    expect(() => parseFinalJobMatchPacketContent({ ...fixture, jobs: fixture.jobs.slice(0, 9) })).toThrow();
    expect(() => parseFinalJobMatchPacketContent({ ...fixture, jobs: [...fixture.jobs, { ...fixture.jobs[0], jobId: "eleventh-job" }] })).toThrow();
    expect(() => parseFinalJobMatchPacketContent({ ...fixture, jobs: fixture.jobs.map((job, index) => index ? job : { ...job, approval: { ...job.approval, disposition: "REJECTED" } }) })).toThrow();
    expect(() => parseFinalJobMatchPacketContent({ ...fixture, jobs: fixture.jobs.map((job, index) => index ? job : { ...job, nonNegotiableDisposition: "FAIL" }) })).toThrow();
    expect(() => parseFinalJobMatchPacketContent({ ...fixture, jobs: fixture.jobs.map((job, index) => index ? job : { ...job, directApplicationUrl: "" }) })).toThrow();
  });

  it("rejects missing governed unknowns and evidence references from another record", () => {
    const fixture = jobMatchPacketFixture();
    const missingUnknown = structuredClone(fixture);
    missingUnknown.jobs[0].unknownWarnings = missingUnknown.jobs[0].unknownWarnings.filter((warning) => warning.field !== "Compensation");
    expect(() => parseFinalJobMatchPacketContent(missingUnknown)).toThrow(/Compensation/);

    const crossRecord = structuredClone(fixture);
    crossRecord.jobs[0].strongConnections[0].claimId = "job-match:another-order-job:strong:0";
    expect(() => parseFinalJobMatchPacketContent(crossRecord)).toThrow(/packet claim/);

    const dangling = structuredClone(fixture);
    dangling.jobs[0].strongConnections[0].evidenceIds = ["candidate-fact:not-a-uuid"];
    expect(() => parseFinalJobMatchPacketContent(dangling)).toThrow();
  });

  it("preserves explicit unknowns and treats input as inert text", () => {
    const parsed = parseFinalJobMatchPacketContent(jobMatchPacketFixture({ malicious: true }));
    expect(parsed.jobs[0].unknownWarnings[0]).toMatchObject({ field: "Health benefits", status: "NOT_CONFIRMED" });
    expect(parsed.customerDisplayName).toContain("<script>");
    expect(parsed.jobs[0].positionTitle).toContain("onerror");
  });

  it("creates stable versioned identities and deterministic customer filenames", () => {
    const content = jobMatchPacketFixture();
    expect(jobMatchPacketIdentity(content)).toBe(jobMatchPacketIdentity(structuredClone(content)));
    expect(jobMatchPacketFilename("Jane D. Example")).toBe("Jane_D._Example_ApplyPack_Job_Matches.pdf");
    expect(jobMatchPacketFilename("Jane: Example / Final")).toBe("Jane_Example_Final_ApplyPack_Job_Matches.pdf");
  });

  it("accepts each evidence group at its 30-item bound and rejects 31", () => {
    const maximum = structuredClone(jobMatchPacketFixture());
    const job = maximum.jobs[0];
    const sourceJobId = "b1000000-0000-4000-8000-000000000001";
    job.strongConnections = bindPacketEvidence(job.jobId, sourceJobId, "strong", Array.from({ length: 30 }, (_, index) => ({
      kind: "TRANSFERABLE" as const,
      statement: `Approved maximum connection ${index + 1} remains grounded in the stored review.`,
      evidenceIds: ["candidate-fact:c1000000-0000-4000-8000-000000000001", "job-field:description"],
    })));
    job.thingsToConsider = bindPacketEvidence(job.jobId, sourceJobId, "consideration", Array.from({ length: 30 }, (_, index) => ({
      kind: "GAP" as const,
      statement: `Approved maximum consideration ${index + 1} remains visible to the customer.`,
      evidenceIds: ["job-field:description"],
    })));
    job.compensationDisplay = undefined;
    job.unknownWarnings = bindPacketEvidence(job.jobId, sourceJobId, "unknown", [
      { field: "Health benefits", status: "NOT_CONFIRMED" as const, evidenceIds: ["job-field:benefits_status"] },
      { field: "Travel requirements", status: "NOT_STATED" as const, evidenceIds: ["job-field:description"] },
      { field: "Compensation", status: "NOT_STATED" as const, evidenceIds: ["job-field:salary_text"] },
      ...Array.from({ length: 27 }, (_, index) => ({
        field: `Additional governed unknown ${index + 1}`,
        status: "UNKNOWN" as const,
        evidenceIds: ["job-field:description"],
      })),
    ]);
    expect(() => parseFinalJobMatchPacketContent(maximum)).not.toThrow();

    const overflow = structuredClone(maximum);
    overflow.jobs[0].strongConnections = bindPacketEvidence(job.jobId, sourceJobId, "strong", [
      ...overflow.jobs[0].strongConnections,
      { kind: "TRANSFERABLE", statement: "Thirty-first connection.", evidenceIds: ["candidate-fact:c1000000-0000-4000-8000-000000000001", "job-field:description"] },
    ]);
    expect(() => parseFinalJobMatchPacketContent(overflow)).toThrow();
  });
});

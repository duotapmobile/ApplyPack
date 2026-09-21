import { describe, expect, it, vi } from "vitest";
import { pendingProjectionRow, projectSourceRun, SOURCE_PROJECTOR_VERSION } from "@/lib/jobs/source-projection";
import type { RawJobPosting } from "@/lib/jobs/types";

const posting: RawJobPosting = {
  sourceId: "vipdesk-connect", employerName: "VIPdesk Connect", externalJobId: "lever-123",
  title: "Operations Coordinator", description: "Coordinate schedules and document operating procedures.",
  location: "Remote, US", sourceJobUrl: "https://jobs.lever.co/vipdesk/lever-123",
  officialApplicationUrl: "https://jobs.lever.co/vipdesk/lever-123/apply",
  lastVerifiedAt: "2026-09-20T12:00:00.000Z",
};

function observation(overrides: Partial<RawJobPosting> = {}) {
  const captured = { ...posting, ...overrides };
  return { listing_key: `external:${captured.externalJobId}`, captured_listing: captured,
    content_sha256: pendingProjectionRow(captured).content_hash };
}

function client(data: unknown[], readError: Error | null = null) {
  const query = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn() };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockResolvedValue({ data, error: readError });
  const rpc = vi.fn().mockResolvedValue({ data: "canonical-job-id", error: null });
  const from = vi.fn().mockReturnValue(query);
  return { admin: { from, rpc } as unknown as Parameters<typeof projectSourceRun>[0], from, rpc, query };
}

describe("pending source projection", () => {
  it("retains observed content while withholding verification and customer visibility", () => {
    expect(pendingProjectionRow(posting)).toMatchObject({
      source_id: posting.sourceId, external_job_id: posting.externalJobId, raw_title: posting.title,
      description: posting.description, is_active: false, listing_status: "inactive",
      application_path_status: "unverified", source_freshness_status: "unknown",
      last_verified_at: null, last_successfully_verified_at: null,
      last_observed_at: posting.lastVerifiedAt,
    });
  });

  it("rejects unknown sources and prohibited employers", () => {
    expect(() => pendingProjectionRow({ ...posting, sourceId: "not-a-registered-source" })).toThrow("Unknown job source");
    expect(() => pendingProjectionRow({ ...posting, employerName: "Liveops" })).toThrow("source_projection_rejected_listing");
  });

  it("does not write when a captured posting is malformed", async () => {
    const fake = client([{ listing_key: "broken", captured_listing: null, content_sha256: "a".repeat(64) }]);
    await expect(projectSourceRun(fake.admin, "run-1")).rejects.toThrow();
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("rejects changed observation content before invoking the persistence RPC", async () => {
    const fake = client([{ ...observation(), content_sha256: "0".repeat(64) }]);
    await expect(projectSourceRun(fake.admin, "run-1")).rejects.toThrow("source_projection_content_changed");
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("rejects 501 observations before any writes", async () => {
    const fake = client(Array.from({ length: 501 }, () => observation()));
    await expect(projectSourceRun(fake.admin, "run-1")).rejects.toThrow("source_projection_bound_exceeded");
    expect(fake.query.limit).toHaveBeenCalledWith(501);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("sends identical replay inputs to the database idempotency boundary", async () => {
    const entry = observation();
    const fake = client([entry]);
    const expected = { projected: 1, verified: 0, customerVisible: 0 };
    await expect(projectSourceRun(fake.admin, "run-1")).resolves.toEqual(expected);
    await expect(projectSourceRun(fake.admin, "run-1")).resolves.toEqual(expected);
    expect(fake.rpc.mock.calls[0]).toEqual(fake.rpc.mock.calls[1]);
    expect(fake.rpc.mock.calls[0]).toEqual(["ap_project_source_observation", {
      p_run_id: "run-1", p_listing_key: entry.listing_key, p_content_sha256: entry.content_sha256,
      p_projector_version: SOURCE_PROJECTOR_VERSION, p_normalized: pendingProjectionRow(posting),
    }]);
    // Actual idempotent writes and concurrent replay require the database integration suite.
  });

  it("propagates RPC failures and stops before later observations", async () => {
    const fake = client([observation(), observation({ externalJobId: "lever-124" })]);
    const failure = new Error("source_projection_evidence_or_authority_invalid");
    fake.rpc.mockResolvedValueOnce({ data: null, error: failure });
    await expect(projectSourceRun(fake.admin, "run-1")).rejects.toBe(failure);
    expect(fake.rpc).toHaveBeenCalledTimes(1);
  });

  it("propagates read failures without writes", async () => {
    const failure = new Error("observation_read_failed");
    const fake = client([], failure);
    await expect(projectSourceRun(fake.admin, "run-1")).rejects.toBe(failure);
    expect(fake.rpc).not.toHaveBeenCalled();
  });

  it("reports zero verified and visible jobs for empty and populated runs", async () => {
    const empty = client([]);
    await expect(projectSourceRun(empty.admin, "empty")).resolves.toEqual({ projected: 0, verified: 0, customerVisible: 0 });
    const populated = client([observation(), observation({ externalJobId: "lever-124" })]);
    await expect(projectSourceRun(populated.admin, "run-2")).resolves.toEqual({ projected: 2, verified: 0, customerVisible: 0 });
  });
});

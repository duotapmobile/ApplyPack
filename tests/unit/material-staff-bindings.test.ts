import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { loadMaterialStaffLines } from "@/lib/materials/admin";
import { DOCUMENT_GENERATOR_VERSION } from "@/lib/documents/requirements";

const records: Record<string, unknown[]> = {};
const admin = { from: vi.fn((table: string) => {
  const query: Record<string, unknown> = {};
  for (const method of ["select", "in", "is", "eq", "order", "limit"]) query[method] = () => query;
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: records[table] ?? [], error: null }).then(resolve);
  return query;
}) } as unknown as Parameters<typeof loadMaterialStaffLines>[0];

beforeEach(() => {
  records.ap_material_lines = [{ id: "line", fulfillment: "READY_TO_RELEASE", substitution: "NONE", materials_due_at: null, active_revision: 2 }];
  records.ap_material_line_revisions = [{ id: "current-revision", line_id: "line", version: 2, job_snapshot_id: "job", source_snapshot_id: "source", employer_rule_snapshot_id: "rule" }];
  records.ap_job_snapshots = [{ id: "job", company: "Example", exact_title: "Receptionist" }];
  records.ap_employer_submission_rules = [{ id: "rule", content_sha256: "a".repeat(64) }];
  records.ap_material_listing_checks = [
    { id: "final", material_line_id: "line", line_revision_id: "current-revision", phase: "BEFORE_RELEASE", result: "ACTIVE", checked_at: "2026-10-25T16:00:00Z" },
  ];
  records.ap_generated_artifacts = [
    { id: "old", material_line_id: "line", source_line_revision_id: "old-revision", artifact_type: "RESUME", current_file_version: 1, reference_regeneration_id: null, generator_version: DOCUMENT_GENERATOR_VERSION },
    { id: "current", material_line_id: "line", source_line_revision_id: "current-revision", artifact_type: "RESUME", current_file_version: 2, reference_regeneration_id: null, generator_version: DOCUMENT_GENERATOR_VERSION },
  ];
  records.ap_generated_file_versions = ["old", "current"].map((id) => ({ id: `${id}-file`, artifact_id: id, version: id === "old" ? 1 : 2,
    safe_filename: `${id}.pdf`, checksum_sha256: "b".repeat(64), superseded_at: null, downloads_revoked_at: null }));
  records.ap_artifact_quality_reviews = ["old", "current"].map((id) => ({ file_version_id: `${id}-file`, automated_passed_at: "2026-10-25T15:50:00Z",
    content_approved_at: "2026-10-25T15:52:00Z", content_approved_by: "content-owner", visual_approved_at: "2026-10-25T15:55:00Z",
    visual_approved_by: "visual-owner", renderer_identity: "renderer", document_font_family: "Liberation Sans", document_font_resolved: true, invalidated_at: null }));
});

describe("staff view exact release evidence", () => {
  it("shows only the active revision files and carries their exact review identities", async () => {
    const [line] = await loadMaterialStaffLines(admin);
    expect(line.files).toHaveLength(1);
    expect(line.files[0]).toMatchObject({ fileVersionId: "current-file", version: 2, checksumSha256: "b".repeat(64),
      contentApprovedAt: "2026-10-25T15:52:00Z", contentApprovedBy: "content-owner", visualApprovedAt: "2026-10-25T15:55:00Z", visualApprovedBy: "visual-owner" });
    expect(line).toMatchObject({ releaseCheckId: "final", releaseCheckAt: "2026-10-25T16:00:00Z" });
  });

  it("does not fall back to an older active check after a new blocked check", async () => {
    records.ap_material_listing_checks.unshift({ id: "blocked", material_line_id: "line", line_revision_id: "current-revision",
      phase: "BEFORE_RELEASE", result: "INSTRUCTION_BLOCKED", checked_at: "2026-10-25T16:01:00Z" });
    const [line] = await loadMaterialStaffLines(admin);
    expect(line.releaseCheckId).toBeNull(); expect(line.releaseCheckAt).toBeNull();
  });

  it("never borrows a final check from a superseded revision", async () => {
    records.ap_material_listing_checks = [{ id: "old-final", material_line_id: "line", line_revision_id: "old-revision",
      phase: "BEFORE_RELEASE", result: "ACTIVE", checked_at: "2026-10-25T16:01:00Z" }];
    const [line] = await loadMaterialStaffLines(admin);
    expect(line.releaseCheckId).toBeNull(); expect(line.releaseCheckAt).toBeNull();
  });
});

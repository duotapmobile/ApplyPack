import { describe, expect, it, vi } from "vitest";
import { registerMaterialArtifact, type ArtifactRegistrationInput } from "@/lib/documents/artifact-registration";

vi.mock("server-only", () => ({}));

const artifactId = "77000000-0000-4000-8000-000000000001";
const fileVersionId = "77000000-0000-4000-8000-000000000002";
const lineId = "77000000-0000-4000-8000-000000000003";
const hash = "a".repeat(64);
const input: ArtifactRegistrationInput = {
  p_artifact_id: artifactId, p_file_version_id: fileVersionId, p_material_line_id: lineId,
  p_reviewer_id: lineId, p_artifact_type: "RESUME", p_source_snapshot_id: lineId,
  p_source_line_revision_id: lineId, p_job_snapshot_id: lineId,
  p_reference_regeneration_id: null, p_reference_permission_ids: [], p_claim_provenance: {},
  p_generator_version: "fixture", p_storage_bucket: "customer-deliveries",
  p_storage_path: `${lineId}/materials/${lineId}/${fileVersionId}/resume.pdf`,
  p_safe_filename: "resume.pdf", p_checksum_sha256: hash, p_mime_type: "application/pdf", p_size_bytes: 123,
  p_binding_sha256: hash, p_package_qa_sha256: hash, p_structural_checks: {}, p_provenance_checks: {},
  p_extracted_text_sha256: hash, p_rendered_page_count: 1, p_renderer_identity: "fixture",
  p_arial_font_sha256: hash, p_malware_scanner_identity: "fixture",
  p_render_preview_bucket: "operator-render-previews", p_render_preview_path: "fixture.pdf",
  p_render_preview_sha256: hash, p_rendered_page_sha256: [hash], p_arial_resolved: true,
};
const receipt = { artifactId, fileVersionId, version: 1, automatedPassed: true };

function client(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as unknown as Parameters<typeof registerMaterialArtifact>[0];
}

describe("material registration response loss", () => {
  it("accepts the exact receipt once without retrying a version-creating transaction", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: receipt, error: null });
    expect(await registerMaterialArtifact(client(rpc), input)).toEqual(receipt);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("ap_register_material_artifact_version", input);
  });

  it.each(["returned error", "lost response"])("preserves files after commit with %s", async (failure) => {
    const state = { registered: false, cleanupIntents: 3, files: 3 };
    const rpc = vi.fn(async () => {
      // Simulate the committed registration and its transactional cleanup trigger.
      state.registered = true;
      state.cleanupIntents = 0;
      if (failure === "lost response") throw new Error("private provider diagnostics");
      return { data: null, error: { message: "private provider diagnostics" } };
    });
    await expect(registerMaterialArtifact(client(rpc), input)).rejects.toThrow("material_registration_outcome_unconfirmed");
    expect(state).toEqual({ registered: true, cleanupIntents: 0, files: 3 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("leaves failed uncommitted uploads queued for guarded cleanup, without a blind retry", async () => {
    const state = { registered: false, cleanupIntents: 3, files: 3 };
    const rpc = vi.fn().mockRejectedValue(new Error("connection failed before commit"));
    await expect(registerMaterialArtifact(client(rpc), input)).rejects.toThrow("material_registration_outcome_unconfirmed");
    expect(state).toEqual({ registered: false, cleanupIntents: 3, files: 3 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it.each([
    null, true, {}, { ...receipt, artifactId: lineId }, { ...receipt, fileVersionId: lineId },
    { ...receipt, version: 0 }, { ...receipt, automatedPassed: "true" }, { ...receipt, extra: true },
  ])("rejects a malformed or wrong-version receipt without claiming registration failed", async (data) => {
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    await expect(registerMaterialArtifact(client(rpc), input)).rejects.toThrow("material_registration_outcome_unconfirmed");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("preserves a valid registered file whose automated quality checks did not pass", async () => {
    const data = { ...receipt, automatedPassed: false };
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    expect(await registerMaterialArtifact(client(rpc), input)).toEqual(data);
  });
});

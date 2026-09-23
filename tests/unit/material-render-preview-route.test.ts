import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.requireAdmin }));

import { GET } from "@/app/api/admin/material-files/[id]/render-preview/route";
import { DOCUMENT_GENERATOR_VERSION } from "@/lib/documents/requirements";

const fileVersionId = "10000000-0000-4000-8000-000000000001";
const artifactId = "20000000-0000-4000-8000-000000000001";

function request() {
  return GET(new Request("https://example.test/api/admin/material-files/" + fileVersionId + "/render-preview"), {
    params: Promise.resolve({ id: fileVersionId }),
  });
}

function authenticatedFixture(input: {
  file?: Record<string, unknown> | null;
  artifact?: Record<string, unknown> | null;
  quality?: Record<string, unknown> | null;
} = {}) {
  const rows: Record<string, unknown> = {
    ap_artifact_quality_reviews: input.quality === undefined ? {
      render_preview_bucket: "operator-render-previews",
      render_preview_path: "customer/materials/render-preview.pdf",
      render_preview_sha256: "a".repeat(64),
      renderer_identity: "fixture-renderer",
      arial_resolved: true,
    } : input.quality,
    ap_generated_file_versions: input.file === undefined ? {
      artifact_id: artifactId,
      version: 2,
      superseded_at: null,
      downloads_revoked_at: null,
    } : input.file,
    ap_generated_artifacts: input.artifact === undefined ? {
      generator_version: DOCUMENT_GENERATOR_VERSION,
      current_file_version: 2,
    } : input.artifact,
  };
  const createSignedUrl = vi.fn(async () => ({
    data: { signedUrl: "https://storage.example.test/signed-preview" },
    error: null,
  }));
  const admin = {
    from: vi.fn((table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
        }),
      }),
    })),
    storage: { from: vi.fn(() => ({ createSignedUrl })) },
  };
  mocks.requireAdmin.mockResolvedValue({ ok: true, user: { id: "operator" }, admin });
  return { createSignedUrl };
}

describe("private rendered-page preview route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires admin authentication", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await request()).status).toBe(401);
  });

  it("signs only the current preview with private no-store headers", async () => {
    const fixture = authenticatedFixture();
    const response = await request();
    expect(response.status).toBe(303);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(fixture.createSignedUrl).toHaveBeenCalledWith("customer/materials/render-preview.pdf", 300, {
      download: false,
    });
  });

  it.each([
    {
      file: { artifact_id: artifactId, version: 2, superseded_at: "2026-09-23T12:00:00Z", downloads_revoked_at: null },
      artifact: { generator_version: DOCUMENT_GENERATOR_VERSION, current_file_version: 2 },
    },
    {
      file: { artifact_id: artifactId, version: 2, superseded_at: null, downloads_revoked_at: "2026-09-23T12:00:00Z" },
      artifact: { generator_version: DOCUMENT_GENERATOR_VERSION, current_file_version: 2 },
    },
    {
      file: { artifact_id: artifactId, version: 2, superseded_at: null, downloads_revoked_at: null },
      artifact: { generator_version: DOCUMENT_GENERATOR_VERSION, current_file_version: 3 },
    },
    {
      file: { artifact_id: artifactId, version: 2, superseded_at: null, downloads_revoked_at: null },
      artifact: { generator_version: "stale-generator", current_file_version: 2 },
    },
  ])("rejects stale, revoked, noncurrent, or old-generator previews", async ({ file, artifact }) => {
    const fixture = authenticatedFixture({ file, artifact });
    expect((await request()).status).toBe(409);
    expect(fixture.createSignedUrl).not.toHaveBeenCalled();
  });
});

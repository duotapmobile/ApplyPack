import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: mocks.requireAdmin }));

import { GET } from "@/app/api/admin/material-files/[id]/source-docx/route";
import { DOCUMENT_GENERATOR_VERSION } from "@/lib/documents/requirements";

const fileVersionId = "10000000-0000-4000-8000-000000000001";
const artifactId = "20000000-0000-4000-8000-000000000001";

function request() {
  return GET(new Request("https://example.test/api/admin/material-files/" + fileVersionId + "/source-docx"), {
    params: Promise.resolve({ id: fileVersionId }),
  });
}

function authenticatedFixture(input: {
  source?: Record<string, unknown> | null;
  file?: Record<string, unknown> | null;
  artifact?: Record<string, unknown> | null;
  auditError?: Error | null;
  signedUrl?: string | null;
  signingError?: Error | null;
} = {}) {
  const rows: Record<string, unknown> = {
    ap_artifact_source_docx: input.source === undefined ? {
      storage_bucket: "operator-drafts",
      storage_path: "customer/materials/source.docx",
      safe_filename: "Candidate_Resume_Employer.docx",
      checksum_sha256: "a".repeat(64),
    } : input.source,
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
  const auditInsert = vi.fn(async () => ({ error: input.auditError || null }));
  const createSignedUrl = vi.fn(async () => ({
    data: { signedUrl: input.signedUrl === undefined ? "https://storage.example.test/signed" : input.signedUrl },
    error: input.signingError || null,
  }));
  const from = vi.fn((table: string) => {
    if (table === "audit_logs") return { insert: auditInsert };
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
        }),
      }),
    };
  });
  const admin = { from, storage: { from: vi.fn(() => ({ createSignedUrl })) } };
  mocks.requireAdmin.mockResolvedValue({
    ok: true,
    user: { id: "30000000-0000-4000-8000-000000000001" },
    admin,
  });
  return { from, auditInsert, createSignedUrl };
}

describe("internal editable DOCX source route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires the existing protected admin authentication boundary", async () => {
    mocks.requireAdmin.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    const response = await request();
    expect(response.status).toBe(401);
  });

  it("audits and signs only the current source with private no-store headers", async () => {
    const fixture = authenticatedFixture();
    const response = await request();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://storage.example.test/signed");
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(fixture.auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      action: "material_source_docx_download_authorized",
      entity_id: fileVersionId,
    }));
    expect(fixture.createSignedUrl).toHaveBeenCalledWith("customer/materials/source.docx", 300, {
      download: "Candidate_Resume_Employer.docx",
    });
  });

  it("returns 404 when the private source record is missing", async () => {
    authenticatedFixture({ source: null });
    expect((await request()).status).toBe(404);
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
  ])("rejects stale, revoked, noncurrent, or old-generator sources", async ({ file, artifact }) => {
    const fixture = authenticatedFixture({ file, artifact });
    expect((await request()).status).toBe(409);
    expect(fixture.auditInsert).not.toHaveBeenCalled();
    expect(fixture.createSignedUrl).not.toHaveBeenCalled();
  });

  it("fails closed when access auditing fails", async () => {
    const fixture = authenticatedFixture({ auditError: new Error("audit unavailable") });
    expect((await request()).status).toBe(503);
    expect(fixture.createSignedUrl).not.toHaveBeenCalled();
  });

  it("returns 503 when signing fails after authorization was audited", async () => {
    const fixture = authenticatedFixture({ signingError: new Error("signing unavailable"), signedUrl: null });
    expect((await request()).status).toBe(503);
    expect(fixture.auditInsert).toHaveBeenCalledOnce();
  });
});

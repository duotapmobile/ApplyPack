import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const adminRoute = readFileSync(resolve(process.cwd(), "src/app/api/admin/search-orders/[id]/job-match-packet/route.ts"), "utf8");
const customerRoute = readFileSync(resolve(process.cwd(), "src/app/api/customer/search-orders/[id]/job-match-packet/route.ts"), "utf8");
const repository = readFileSync(resolve(process.cwd(), "src/lib/documents/job-match-packet/supabase-repository.ts"), "utf8");

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/202609040024_pdfcn_job_match_packet.sql"), "utf8");
describe("job-match packet route boundaries", () => {
  it("keeps rendering on the authenticated Node server path", () => {
    expect(adminRoute).toContain('export const runtime = "nodejs"');
    expect(adminRoute).toContain("requireAdmin()");
    expect(adminRoute).toContain("isSameOriginRequest(request)");
    expect(customerRoute).toContain("supabase.auth.getUser()");
  });

  it("uses private storage, short-lived signed URLs, and no content logging", () => {
    expect(repository).toContain('.storage.from("customer-deliveries")');
    expect(repository).toContain("createSignedUrl");
    expect(repository).not.toMatch(/console\.(log|info|warn|error)/u);
    expect(repository).not.toContain("content_snapshot: event");
    expect(repository).toContain("directApplicationUrl: string(job.official_application_url)");
    expect(repository).not.toMatch(/directApplicationUrl:.*source_job_url/u);
  });

  it("uses a bounded crash-recoverable render lease with an optimistic stale-claim guard", () => {
    expect(repository).toContain("render_lease_until: new Date(Date.now() + 5 * 60_000)");
    expect(repository).toContain('existing.status === "RENDERING"');
    expect(repository).toContain("leaseExpired");
    expect(repository).toContain('restart.eq("render_lease_until"');
    expect(repository).toContain("render_attempts:");
  });
    expect(repository).toContain("render_generation: randomUUID()");
    expect(repository).toContain('.eq("render_generation", renderGeneration)');
    expect(repository).toContain('.download(storagePath)');
    expect(repository).toContain("privateObjectMatchesChecksum(existing.data, output.checksumSha256)");
    expect(repository).not.toContain("remove([storagePath])");
});

  it("normalizes schedule unknowns independently and enforces one warning gate at staging and correction", () => {
    expect(repository).toContain("optional(job.schedule_type) ?? optional(job.timezone_requirement)");
    expect(migration).not.toContain("packet_value_is_unknown(concat_ws");
    expect(migration).toContain("packet_value_is_unknown(job_row.schedule_type) and public.packet_value_is_unknown(job_row.timezone_requirement)");
    expect(migration.match(/packet_unknown_warnings_are_complete\(/gu)).toHaveLength(5);
    expect(migration).toContain("replacement material unknown warning missing");
  });

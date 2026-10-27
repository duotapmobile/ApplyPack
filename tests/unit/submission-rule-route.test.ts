// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
vi.mock("server-only", () => ({}));
const auth = vi.hoisted(() => vi.fn());
const createPort = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/require-admin", () => ({ requireAdmin: auth }));
vi.mock("@/lib/documents/submission-rule-supabase", async (original) => ({ ...await original<typeof import("@/lib/documents/submission-rule-supabase")>(), createSubmissionRulePort: createPort }));
import { GET, POST } from "@/app/api/admin/job-snapshots/[id]/submission-rules/route";
import { canonicalSha256 } from "@/lib/domain/foundation";
import { SubmissionRuleSqlFailure } from "@/lib/documents/submission-rule-supabase";
import type { SubmissionRuleOwnerPort } from "@/lib/documents/submission-rule-owner-server";
import { submissionRuleConfirmationSchema } from "@/lib/documents/submission-rule-proposal";

const id = (n: number) => `a1160000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const job = id(1), reviewer = id(2), node = id(3), requestId = id(4);
const text = "Resume required.\nCover letter optional.\nAccepted formats: PDF.\nSubmission method: HTTPS upload.", captured = { text };
const basis = { contractVersion: "applypack-employer-rule-review-v1", jobSnapshotId: job, jobContentSha256: canonicalSha256(captured), jobRecordSha256: "b".repeat(64),
  sourceAuthoritySha256: "c".repeat(64), sourceEvidenceSha256: "d".repeat(64), currentRuleId: null, currentRuleRecordSha256: null };
const input = () => submissionRuleConfirmationSchema.parse({ requestId, jobSnapshotId: job, expectedBasis: basis,
  choices: { resumeRequirement: "REQUIRED", coverLetterRequirement: "OPTIONAL", allowedFormats: ["PDF"], resumePageLimit: null, coverLetterPageLimit: null,
    resumeFilenameInstruction: null, coverLetterFilenameInstruction: null, referenceFilenameInstruction: null, referenceTiming: "LATER_OR_UNKNOWN", referenceCount: null,
    submissionChannel: "HTTPS_UPLOAD", portfolioInstruction: null, workSampleInstruction: null },
  fieldEvidence: { resumeRequirement: "Resume required.", coverLetterRequirement: "Cover letter optional.", allowedFormats: "Accepted formats: PDF.", submissionChannel: "Submission method: HTTPS upload.",
    resumePageLimit: null, coverLetterPageLimit: null, resumeFilenameInstruction: null, coverLetterFilenameInstruction: null, referenceFilenameInstruction: null, referenceTiming: null, referenceCount: null, portfolioInstruction: null, workSampleInstruction: null },
  checklist: { listingOpened: true, applicationOpened: true, sourceCompared: true, requirementsConfirmed: true, questionsReviewed: true, noUnsupportedDefaults: true } });
const source = () => ({ job: { id: job, legacy_job_id: id(10), content_sha256: basis.jobContentSha256, company: "Fixture employer", exact_title: "Support",
  canonical_application_url: "https://example.test/apply", source_url: "https://example.test/job", captured_listing: captured, retrieved_at: new Date().toISOString(), live_verified_at: new Date().toISOString(),
  discovery_source: "manual-example", external_job_id: null, source_run_id: null, source_authorization_id: null, listing_activity_result: "PASS", application_path_result: "PASS", legitimacy_result: "PASS" },
  nodes: [{ id: node, job_snapshot_id: job, source_excerpt: text, classification_method: "employer-instruction-source-v1" }], questionAuthority: null });
type Confirmation = Parameters<SubmissionRuleOwnerPort["confirm"]>[0];
function outcome(value: Confirmation, current = true) { const time = new Date().toISOString(); return { receipt: { request_id: value.requestId, job_snapshot_id: value.jobSnapshotId, reviewer_id: value.reviewerId,
  expected_basis: value.expectedBasis, confirmed_rules: value.confirmedRules, confirmed_rules_sha256: "e".repeat(64), review_checklist: value.checklist, review_evidence: value.reviewEvidence,
  rule_id: id(5), rule_content_sha256: "f".repeat(64), checked_at: time, receipt_sha256: "1".repeat(64), created_at: time }, replayed: false, current }; }
let port: { [K in keyof SubmissionRuleOwnerPort]: Mock<SubmissionRuleOwnerPort[K]> };
const context = (value = job) => ({ params: Promise.resolve({ id: value }) });
const base = `https://applypack.test/api/admin/job-snapshots/${job}/submission-rules`;
const post = (body: unknown = input(), suffix = "", headers: Record<string, string> = {}) => new Request(base + suffix, { method: "POST", headers: { origin: "https://applypack.test", "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://applypack.test"); auth.mockReset().mockResolvedValue({ ok: true, user: { id: reviewer }, admin: {}, role: "operator" });
  const fixedSource = source();
  port = { basis: vi.fn<SubmissionRuleOwnerPort["basis"]>().mockResolvedValue({ basis, sourceEvidenceId: node, currentRule: null, effectivePrepurchaseCheckedAt: null }),
    source: vi.fn<SubmissionRuleOwnerPort["source"]>().mockResolvedValue(fixedSource), prepare: vi.fn<SubmissionRuleOwnerPort["prepare"]>().mockResolvedValue({ sourceEvidenceId: node, created: true, basis }),
    confirm: vi.fn<SubmissionRuleOwnerPort["confirm"]>().mockImplementation(async (value) => outcome(value)), receipt: vi.fn<SubmissionRuleOwnerPort["receipt"]>().mockResolvedValue(null) };
  createPort.mockReset().mockReturnValue(port);
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("actual owner submission-rule handlers", () => {
  it.each([401, 403, 503])("preserves authorization/MFA denial%d without a source read or mutation", async (status) => {
    auth.mockImplementation(async () => ({ ok: false, response: Response.json({ error: "Staff verification required" }, { status }) }));
    const result = await POST(post(), context()); expect(result.status).toBe(status); expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(result.headers.get("x-robots-tag")).toContain("noindex"); expect(createPort).not.toHaveBeenCalled();
    const read = await GET(new Request(base), context()); expect(read.status).toBe(status); expect(read.headers.get("cache-control")).toBe("private, no-store");
    expect(createPort).not.toHaveBeenCalled();
  });
  it.each(["https://evil.test", "null", ""]) ("rejects missing/foreign origin %s before auth", async (origin) => {
    expect((await POST(post(input(), "", { origin }), context())).status).toBe(403); expect(auth).not.toHaveBeenCalled();
  });
  it.each(["?unknown=1", `?requestId=${requestId}&requestId=${requestId}`, "?requestId=", "?requestId=bad", `?requestId=${"a".repeat(200)}`])("rejects bad GET query%s", async (suffix) => {
    expect((await GET(new Request(base + suffix), context())).status).toBe(400); expect(createPort).not.toHaveBeenCalled();
  });
  it("rejects cross-site GET and invalid path without loading employer data", async () => {
    expect((await GET(new Request(base, { headers: { "sec-fetch-site": "cross-site" } }), context())).status).toBe(403);
    expect((await GET(new Request(base), context("bad"))).status).toBe(400); expect(createPort).not.toHaveBeenCalled();
  });
  it("GET is read-only, while source preparation is explicit and uses the trusted reviewer", async () => {
    port.basis.mockResolvedValue({ basis, sourceEvidenceId: null, currentRule: null, effectivePrepurchaseCheckedAt: null });
    const read = await GET(new Request(base), context()); expect(read.status).toBe(200); expect(await read.json()).toMatchObject({ status: "PREPARATION_REQUIRED", jobSnapshotId: job });
    expect(port.prepare).not.toHaveBeenCalled(); expect(port.confirm).not.toHaveBeenCalled();
    const prepared = await POST(post({ action: "PREPARE_SOURCE" }), context()); expect(await prepared.json()).toEqual({ prepared: true });
    expect(port.prepare).toHaveBeenCalledWith(job, reviewer);
  });
  it.each([{ checkedAt: new Date().toISOString() }, { reviewerId: id(99) }, { sourceEvidenceIds: [node] }, { applicationQuestions: [] }, { contentSha256: "a".repeat(64) }])("rejects browser authority %j", async (extra) => {
    expect((await POST(post({ ...input(), ...extra }), context())).status).toBe(400); expect(createPort).not.toHaveBeenCalled();
  });
  it("rejects mismatched path, missing checklist, POST query and malformed JSON/media type", async () => {
    expect((await POST(post(), context(id(99)))).status).toBe(400);
    expect((await POST(post({ ...input(), checklist: {} }), context())).status).toBe(400);
    expect((await POST(post(input(), "?requestId=" + requestId), context())).status).toBe(400);
    expect((await POST(post(input(), "", { "content-type": "text/plain" }), context())).status).toBe(400);
    expect((await POST(new Request(base, { method: "POST", headers: { origin: "https://applypack.test", "content-type": "application/json" }, body: "{" }), context())).status).toBe(400);
    expect(createPort).not.toHaveBeenCalled();
  });
  it("enforces actual streamed bytes as well as declared size and rejects invalid UTF8", async () => {
    expect((await POST(post(input(), "", { "content-length": String(128 * 1024 + 1) }), context())).status).toBe(400);
    const headers = { origin: "https://applypack.test", "content-type": "application/json", "content-length": "2" };
    expect((await POST(new Request(base, { method: "POST", headers, body: " ".repeat(128 * 1024 + 1) }), context())).status).toBe(400);
    expect((await POST(new Request(base, { method: "POST", headers, body: new Uint8Array([0xff]) }), context())).status).toBe(400);
    expect(createPort).not.toHaveBeenCalled();
  });
  it("cancels a stalled body after five seconds without calling the data adapter", async () => {
    vi.useFakeTimers(); const canceled = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel: canceled });
    const request = new Request(base, { method: "POST", headers: { origin: "https://applypack.test", "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
    const pending = POST(request, context());
    await vi.advanceTimersByTimeAsync(5001);
    expect((await pending).status).toBe(400); expect(canceled).toHaveBeenCalled(); expect(createPort).not.toHaveBeenCalled();
  });
  it("an absent CHECK during an original in-flight save never cancels or changes that request", async () => {
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    port.confirm.mockImplementation(async (value) => { await hold; const saved = outcome(value); port.receipt.mockResolvedValue(saved); return saved; });
    const pending = POST(post(), context()); await vi.waitFor(() => expect(port.confirm).toHaveBeenCalledTimes(1));
    const checked = await GET(new Request(base + "?requestId=" + requestId), context()); expect(await checked.json()).toEqual({ saved: null });
    release(); const original = await pending; expect(original.status).toBe(200);
    const retry = await POST(post(), context()); expect(retry.status).toBe(200); expect(port.confirm).toHaveBeenCalledTimes(1);
    expect(await retry.json()).toEqual(await original.json());
  });
  it("saves only a validated exact request and reconciles a lost response without new source reads", async () => {
    const first = await POST(post(), context()); expect(first.status).toBe(200);
    const result = await first.json(); expect(result.saved).toMatchObject({ requestId, jobSnapshotId: job });
    const original = outcome(port.confirm.mock.calls[0][0], false); port.receipt.mockResolvedValue(original); port.source.mockClear(); port.confirm.mockClear();
    const checked = await GET(new Request(base + "?requestId=" + requestId), context()); expect((await checked.json()).saved.current).toBe(false);
    const retry = await POST(post(), context()); expect(retry.status).toBe(200); expect((await retry.json()).saved.ruleId).toBe(id(5));
    expect(port.source).not.toHaveBeenCalled(); expect(port.confirm).not.toHaveBeenCalled();
  });
  it("clears stale review only after real confirm-stage SQL rejection and a successful absent receipt read", async () => {
    port.basis.mockResolvedValue({ basis: { ...basis, sourceAuthoritySha256: "f".repeat(64) }, sourceEvidenceId: node, currentRule: null, effectivePrepurchaseCheckedAt: null });
    port.confirm.mockRejectedValue(new SubmissionRuleSqlFailure("CONFIRM", { code: "P0001", message: "employer_rule_review_basis_changed" }));
    const result = await POST(post(), context()); expect(result.status).toBe(409); expect(await result.json()).toMatchObject({ code: "REVIEW_CHANGED", saved: null });
    expect(port.confirm.mock.calls[0][0].expectedBasis).toEqual(basis); expect(port.receipt).toHaveBeenCalledTimes(2);
  });
  it("an original accepted save visible during reconciliation wins over the later stale error", async () => {
    port.confirm.mockImplementation(async (value) => { port.receipt.mockResolvedValue(outcome(value)); throw new SubmissionRuleSqlFailure("CONFIRM", { code: "P0001", message: "employer_rule_review_basis_changed" }); });
    const result = await POST(post(), context()); expect(result.status).toBe(200); expect((await result.json()).saved.requestId).toBe(requestId);
  });
  it("explains the exact paid-binding rejection without clearing the pending request", async () => {
    port.confirm.mockRejectedValue(new SubmissionRuleSqlFailure("CONFIRM", { code: "P0001", message: "employer_rule_paid_binding_requires_explicit_change" }));
    const result = await POST(post(), context()); expect(result.status).toBe(409);
    const body = await result.json(); expect(body).toMatchObject({ code: "PAID_RULE_CHANGE_REQUIRED" }); expect(body.error).toContain("A checkout or paid Apply Pack already uses different instructions");
    expect(body).not.toHaveProperty("saved"); expect(port.confirm.mock.calls[0][0].requestId).toBe(requestId);
  });
  it.each([
    new Error("employer_rule_review_basis_changed"),
    new SubmissionRuleSqlFailure("BASIS", { code: "P0001", message: "employer_rule_review_basis_changed" }),
    new SubmissionRuleSqlFailure("CONFIRM", { code: "40001", message: "archive_maintenance_retry_required" }),
    new SubmissionRuleSqlFailure("CONFIRM", { code: "55P03", message: "lock timeout" }),
    new SubmissionRuleSqlFailure("CONFIRM", { code: "40P01", message: "deadlock detected" }),
    new SubmissionRuleSqlFailure("BASIS", { code: "P0001", message: "employer_rule_paid_binding_requires_explicit_change" }),
    new SubmissionRuleSqlFailure("CONFIRM", { code: "40001", message: "employer_rule_paid_binding_requires_explicit_change" }),
  ])("never claims absence after ambiguous or wrong-stage error %#", async (error) => {
    port.confirm.mockRejectedValue(error); const result = await POST(post(), context()); expect(result.status).toBe(409);
    const body = await result.json(); expect(body.code).toBe("RESULT_UNCONFIRMED"); expect(body).not.toHaveProperty("saved"); expect(JSON.stringify(body)).not.toContain(error.message);
  });
  it("holds pending after inconsistent pre-write reads or failed rejection reconciliation", async () => {
    port.basis.mockResolvedValueOnce({ basis, sourceEvidenceId: node, currentRule: null, effectivePrepurchaseCheckedAt: null })
      .mockResolvedValueOnce({ basis: { ...basis, sourceAuthoritySha256: "f".repeat(64) }, sourceEvidenceId: node, currentRule: null, effectivePrepurchaseCheckedAt: null });
    expect(await (await POST(post(), context())).json()).not.toHaveProperty("saved"); expect(port.confirm).not.toHaveBeenCalled();
    port.basis.mockResolvedValue({ basis, sourceEvidenceId: node, currentRule: null, effectivePrepurchaseCheckedAt: null });
    port.confirm.mockRejectedValue(new SubmissionRuleSqlFailure("CONFIRM", { code: "P0001", message: "employer_rule_review_basis_changed" }));
    port.receipt.mockResolvedValueOnce(null).mockRejectedValue(new Error("failed receipt read"));
    expect(await (await POST(post(), context())).json()).not.toHaveProperty("saved");
  });
  it("never exposes a foreign reviewer receipt or changes a saved body on altered retry", async () => {
    const first = await POST(post(), context()); expect(first.status).toBe(200);
    const saved = outcome(port.confirm.mock.calls[0][0]);
    port.receipt.mockResolvedValue({ ...saved, receipt: { ...saved.receipt, reviewer_id: id(99) } });
    const foreign = await GET(new Request(base + "?requestId=" + requestId), context()); expect(foreign.status).toBe(409); expect(await foreign.json()).not.toHaveProperty("saved");
    port.receipt.mockResolvedValue(saved); port.confirm.mockClear();
    const changed = input(); changed.choices.coverLetterRequirement = "REQUIRED";
    const result = await POST(post(changed), context()); expect(result.status).toBe(409); expect((await result.json()).code).toBe("RECEIPT_CONFLICT");
    expect(port.confirm).not.toHaveBeenCalled();
  });
});

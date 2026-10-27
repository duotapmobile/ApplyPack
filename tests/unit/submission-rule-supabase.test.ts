// @vitest-environment node
import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { Database } from "@/lib/database.types";
import { canonicalSha256 } from "@/lib/domain/foundation";
import { createSubmissionRulePort, loadSubmissionRuleQueue, submissionRuleQueueCursor, SubmissionRuleSqlFailure } from "@/lib/documents/submission-rule-supabase";
import type { SubmissionRuleOwnerPort } from "@/lib/documents/submission-rule-owner-server";

const id = (n: number) => `a1160000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = new Date("2026-10-27T12:00:00.000Z"), observed = "2026-10-27T11:00:00.000Z", captured = { text: "Resume required." };
const job = () => ({ id: id(1), legacy_job_id: id(2), company: "Fictional employer", exact_title: "Support", content_sha256: canonicalSha256(captured),
  canonical_application_url: "https://example.test/apply", source_url: "https://example.test/job", captured_listing: captured, retrieved_at: observed, live_verified_at: observed,
  discovery_source: "fixture", external_job_id: "42", source_run_id: id(3), source_authorization_id: id(4), listing_activity_result: "PASS", application_path_result: "PASS", legitimacy_result: "PASS", application_host_type: "EMPLOYER_HOSTED" });
const ordinary = () => ({ id: id(5), job_snapshot_id: id(1), parent_id: null, position: 0, node_kind: "ALL_OF", criterion_type: null, stable_criterion_id: null,
  semantic_key: null, requirement_strength: null, source_locator: null, source_excerpt: null, parser_certainty: null, criterion_version: null,
  classification_method: "human-reviewed", importance: null, human_correction_history: [], typed_value: null });
const summary = (n: number) => ({ id: id(n), legacy_job_id: id(1000 + n), company: "Fictional employer", exact_title: `Role${n}`, live_verified_at: observed, content_sha256: "a".repeat(64) });
const verification = (n: number) => ({ id: id(n), legacy_job_id: id(1000 + n), live_verified_at: observed, requirement_completeness: 100 });
let ledger: { url: URL; method: string; body: unknown; signal: AbortSignal | null | undefined }[];
let answer: (url: URL) => unknown;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  ledger = []; answer = (url) => url.pathname.endsWith("/ap_job_snapshots") ? job() : [];
  fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input)); ledger.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : null, signal: init?.signal });
    return Response.json(answer(url));
  });
});
afterEach(() => { vi.restoreAllMocks(); });
const client = () => createClient<Database>("https://fixture.supabase.test", "fictional-service-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetcher } });
const port = (signal = AbortSignal.timeout(5000)) => createSubmissionRulePort(client(), signal);
const confirmInput = (): Parameters<SubmissionRuleOwnerPort["confirm"]>[0] => ({ jobSnapshotId: id(1), reviewerId: id(6), requestId: id(7),
  expectedBasis: { contractVersion: "applypack-employer-rule-review-v1", jobSnapshotId: id(1), jobContentSha256: "a".repeat(64), jobRecordSha256: "b".repeat(64), sourceAuthoritySha256: "c".repeat(64), sourceEvidenceSha256: "d".repeat(64), currentRuleId: null, currentRuleRecordSha256: null },
  confirmedRules: { sourceEvidenceIds: [id(5)], resumeRequirement: "REQUIRED", coverLetterRequirement: "OPTIONAL", allowedFormats: ["PDF"], resumePageLimit: null, coverLetterPageLimit: null,
    resumeFilenameInstruction: null, coverLetterFilenameInstruction: null, referenceFilenameInstruction: null, referenceTiming: "LATER_OR_UNKNOWN", referenceCount: null, submissionChannel: "HTTPS_UPLOAD",
    portfolioInstruction: null, workSampleInstruction: null, applicationQuestions: [], parserVersion: "applypack-submission-rule-proposal-v1", injectionScanState: "CLEAR", hardBlockReason: null },
  checklist: { listingOpened: true, applicationOpened: true, sourceCompared: true, requirementsConfirmed: true, questionsReviewed: true, noUnsupportedDefaults: true },
  reviewEvidence: { version: "applypack-employer-rule-citations-v1", sourceEvidenceId: id(5), sourceTextSha256: "a".repeat(64), citations: [] } });

describe("genuine104 typed Supabase adapter", () => {
  it("calls only the four generated public RPCs with exact arguments and retains explicit receipt null", async () => {
    answer = (url) => url.pathname.endsWith("ap_employer_rule_review_receipt") ? null : { fictional: true };
    const adapter = port(), value = confirmInput();
    await adapter.basis(id(1), id(6)); await adapter.prepare(id(1), id(6)); await adapter.confirm(value); expect(await adapter.receipt(id(7), id(6))).toBeNull();
    expect(ledger.map((entry) => entry.url.pathname.split("/").at(-1))).toEqual(["ap_employer_rule_review_basis", "ap_prepare_employer_rule_source_evidence", "ap_confirm_employer_submission_rules", "ap_employer_rule_review_receipt"]);
    expect(ledger[2].body).toEqual({ p_job_snapshot_id: id(1), p_reviewer_id: id(6), p_request_id: id(7), p_expected_basis: value.expectedBasis,
      p_confirmed_rules: value.confirmedRules, p_review_checklist: value.checklist, p_review_evidence: value.reviewEvidence });
    expect(ledger.every((entry) => entry.method === "POST" && entry.signal instanceof AbortSignal)).toBe(true);
    expect(ledger[3].body).toEqual({ p_request_id: id(7), p_reviewer_id: id(6) });
  });
  it("classifies SQL failure by actual operation/code while transport errors remain unconfirmed", async () => {
    fetcher.mockImplementationOnce(async () => Response.json({ code: "P0001", message: "employer_rule_review_basis_changed", details: "not for the browser" }, { status: 400 }));
    await expect(port().confirm(confirmInput())).rejects.toMatchObject({ operation: "CONFIRM", sqlState: "P0001", reason: "employer_rule_review_basis_changed" });
    fetcher.mockImplementationOnce(async () => { throw new Error("network unavailable"); });
    try { await port().confirm(confirmInput()); throw new Error("expected failure"); } catch (error) {
      expect(error).toBeInstanceOf(SubmissionRuleSqlFailure); expect(error).not.toMatchObject({ sqlState: "P0001" });
    }
  });
  it("reads exact source IDs and complete bounded tree without fetching employer URLs or customer data", async () => {
    answer = (url) => url.pathname.endsWith("/ap_job_snapshots") ? job() : [ordinary()];
    const result = await port().source(id(1)); expect(result).toMatchObject({ job: { id: id(1) }, questionAuthority: null, nodes: [{ id: id(5) }] });
    expect(result).toHaveProperty("job"); expect(Object.keys((result as { job: object }).job)).not.toContain("application_host_type");
    expect(ledger).toHaveLength(2); expect(ledger[0].url.searchParams.get("id")).toBe(`eq.${id(1)}`);
    expect(ledger[0].url.searchParams.get("select")).toContain("captured_listing"); expect(ledger[1].url.searchParams.get("job_snapshot_id")).toBe(`eq.${id(1)}`);
    expect(ledger[1].url.searchParams.get("limit")).toBe("502"); expect(ledger[1].url.searchParams.get("select")).toContain("parent_id,position,node_kind");
    expect(ledger.every((entry) => entry.url.origin === "https://fixture.supabase.test")).toBe(true);
  });
  it("loads run/head/authorization only for declared question captures, with exact job-bound predicates", async () => {
    answer = (url) => {
      if (url.pathname.endsWith("/ap_job_snapshots")) return { ...job(), captured_listing: { ...captured, applicationQuestionObservation: {} } };
      if (url.pathname.endsWith("/ap_requirement_nodes")) return [ordinary()];
      if (url.pathname.endsWith("/job_source_runs")) return { id: id(3) };
      if (url.pathname.endsWith("/ap_source_authorizations")) return { id: id(4) };
      return { source_id: "fixture" };
    };
    await port().source(id(1)); expect(ledger).toHaveLength(5);
    expect(ledger.find((entry) => entry.url.pathname.endsWith("/job_source_runs"))?.url.searchParams.get("id")).toBe(`eq.${id(3)}`);
    expect(ledger.find((entry) => entry.url.pathname.endsWith("/ap_source_authorizations"))?.url.searchParams.get("id")).toBe(`eq.${id(4)}`);
    expect(ledger.find((entry) => entry.url.pathname.endsWith("/ap_source_authorization_heads"))?.url.searchParams.get("source_id")).toBe("eq.fixture");
  });
  it.each(["foreign-job", "foreign-node", "overflow", "marker"]) ("rejects %s source reads", async (kind) => {
    answer = (url) => url.pathname.endsWith("/ap_job_snapshots") ? { ...job(), ...(kind === "foreign-job" ? { id: id(99) } : {}) }
      : kind === "overflow" ? Array.from({ length: 502 }, () => ordinary())
      : [{ ...ordinary(), ...(kind === "foreign-node" ? { job_snapshot_id: id(99) } : kind === "marker" ? { criterion_version: "employer-instruction-source-v1" } : {}) }];
    await expect(port().source(id(1))).rejects.toThrow();
  });
  it("does not start SDK work after abort", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(port(controller.signal).basis(id(1), id(6))).rejects.toMatchObject({ code: "UNAVAILABLE" }); expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("bounded current-source queue", () => {
  it("retains PostgreSQL microseconds across a greater-than50 equal-time keyset boundary", async () => {
    const precise = "2026-10-27T11:00:00.123456+00:00";
    let next = false;
    answer = (url) => {
      if (url.pathname.endsWith("/ap_job_snapshots")) {
        next = url.searchParams.has("or");
        return (next ? [summary(50)] : Array.from({ length: 51 }, (_, i) => summary(100 - i))).map((row) => ({ ...row, live_verified_at: precise }));
      }
      return (next ? [verification(50)] : Array.from({ length: 50 }, (_, i) => verification(100 - i))).map((row) => ({ ...row, live_verified_at: precise }));
    };
    const first = await loadSubmissionRuleQueue(client(), null, AbortSignal.timeout(5000), now);
    expect(submissionRuleQueueCursor(first.nextCursor)).toEqual({ liveVerifiedAt: precise, id: id(51) });
    const second = await loadSubmissionRuleQueue(client(), first.nextCursor, AbortSignal.timeout(5000), now);
    expect(ledger[2].url.searchParams.get("or")).toBe(`(live_verified_at.lt.${precise},and(live_verified_at.eq.${precise},id.lt.${id(51)}))`);
    expect(new Set([...first.jobs, ...second.jobs].map((row) => row.id)).size).toBe(51);
    expect(second.jobs.map((row) => row.id)).toEqual([id(50)]);
  });
  it("consumes50 of51 stable rows and batches verification; invalid-only pages still advance", async () => {
    answer = (url) => url.pathname.endsWith("/ap_job_snapshots") ? Array.from({ length: 51 }, (_, i) => summary(100 - i)) : [];
    const result = await loadSubmissionRuleQueue(client(), null, AbortSignal.timeout(5000), now);
    expect(result.unavailable).toBe(false); expect(result.jobs).toEqual([]); expect(submissionRuleQueueCursor(result.nextCursor)).toEqual({ liveVerifiedAt: observed, id: id(51) });
    expect(ledger[0].url.searchParams.get("order")).toBe("live_verified_at.desc,id.desc"); expect(ledger[0].url.searchParams.get("limit")).toBe("51");
    expect((ledger[1].body as { p_job_ids: string[] }).p_job_ids).toHaveLength(50);
  });
  it("encodes only validated tuple filters, displays exact current snapshot IDs and never hides query failures as empty", async () => {
    const cursor = Buffer.from(JSON.stringify({ liveVerifiedAt: observed, id: id(100) })).toString("base64url");
    answer = (url) => url.pathname.endsWith("/ap_job_snapshots") ? [summary(99), summary(98)] : [verification(98)];
    const result = await loadSubmissionRuleQueue(client(), cursor, AbortSignal.timeout(5000), now);
    expect(result.jobs.map((row) => row.id)).toEqual([id(98)]); expect(result.nextCursor).toBeNull();
    expect(ledger[0].url.searchParams.get("or")).toBe(`(live_verified_at.lt.${observed},and(live_verified_at.eq.${observed},id.lt.${id(100)}))`);
    fetcher.mockImplementationOnce(async () => Response.json({ message: "read failed", code: "XX000" }, { status: 500 }));
    expect(await loadSubmissionRuleQueue(client(), null, AbortSignal.timeout(5000), now)).toEqual({ jobs: [], nextCursor: null, unavailable: true });
  });
  it.each(["bad!!", "a".repeat(257), Buffer.from('{"liveVerifiedAt":"x),id.gt.0","id":"bad"}').toString("base64url"), ["cursor"]])("rejects invalid cursor before any SDK call %#", async (cursor) => {
    await expect(loadSubmissionRuleQueue(client(), cursor, AbortSignal.timeout(5000), now)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects foreign/duplicate verification identities", async () => {
    answer = (url) => url.pathname.endsWith("/ap_job_snapshots") ? [summary(1)] : [verification(99)];
    expect((await loadSubmissionRuleQueue(client(), null, AbortSignal.timeout(5000), now)).unavailable).toBe(true);
    answer = (url) => url.pathname.endsWith("/ap_job_snapshots") ? [summary(1)] : [verification(1), verification(1)];
    expect((await loadSubmissionRuleQueue(client(), null, AbortSignal.timeout(5000), now)).unavailable).toBe(true);
  });
});

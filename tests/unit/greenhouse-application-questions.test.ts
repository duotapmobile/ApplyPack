import { afterEach, describe, expect, it, vi } from "vitest";
import { GreenhouseAdapter } from "@/lib/jobs/adapters/greenhouse";
import { getSource } from "@/lib/jobs/source-registry";
import { deriveGreenhouseApplicationQuestions, type QuestionCaptureAuthority } from "@/lib/jobs/application-question-evidence";
import type { SourceDefinition } from "@/lib/jobs/types";

const authority: QuestionCaptureAuthority = { sourceRunId: "76000000-0000-4000-8000-000000000001",
  authorizationId: "76000000-0000-4000-8000-000000000002", authorizationVersion: "test-v1", authorizationHeadRevision: 1, scopeSha256: "a".repeat(64) };
const posting = { id: 123, title: "Customer care", absolute_url: "https://job-boards.greenhouse.io/duolingo/jobs/123", content: "Help customers" };
const question = { label: "Describe how you solved a customer's problem.", required: true, fields: [{ name: "question_1", type: "textarea" }] };
function source(): SourceDefinition {
  return { ...getSource("duolingo")!, authorizationStatus: "AUTHORIZED_AUTOMATED", authorizationEvidenceId: authority.authorizationId,
    authorizationVersion: authority.authorizationVersion, authorizationAllowedHosts: ["boards-api.greenhouse.io"],
    authorizationAllowedActions: ["ENUMERATE_JOBS", "READ_APPLICATION_QUESTIONS"] };
}
function options() { return { questionCaptureAuthority: authority, beforeRequest: vi.fn().mockResolvedValue(undefined),
  requestBound: 3, maximumResponseBytes: 50_000 }; }
function responses(detail: unknown = { ...posting, questions: [question] }, status = 200, list = [posting]) {
  process.env.APP_JOB_SOURCE_MIN_INTERVAL_MS = "250";
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ jobs: list }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(detail), { status }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => { vi.unstubAllGlobals(); delete process.env.APP_JOB_SOURCE_MIN_INTERVAL_MS; });

describe("authorized Greenhouse question capture", () => {
  it("makes only bounded GETs and requests a fresh action-specific lease before the detail request", async () => {
    const fetch = responses(), settings = options();
    const result = await new GreenhouseAdapter(source()).enumerateJobs(settings);
    expect(result).toMatchObject({ completion: "complete", counts: { pagesRequested: 1, pagesCompleted: 1, detailRequests: 1 } });
    expect(settings.beforeRequest.mock.calls).toEqual([[], ["READ_APPLICATION_QUESTIONS"]]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[1][0])).toBe("https://boards-api.greenhouse.io/v1/boards/duolingo/jobs/123?questions=true");
    for (const [, request] of fetch.mock.calls) expect(request).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
    expect(fetch.mock.calls[1][1].body).toBeUndefined();
    expect(deriveGreenhouseApplicationQuestions(result.jobs[0].applicationQuestionObservation)).toMatchObject({ status: "OBSERVED", questions: [{ prompt: question.label }] });
    expect(result.jobs[0].rawSourceEvidence?.payload).toMatchObject({ applicationQuestionObservation: { authority } });
  });
  it.each(["missing action", "missing authority", "wrong authority", "missing fresh lease", "host absent"])("does not grant form access for %s", async (reason) => {
    const fetch = responses(), definition = source(), settings = options();
    if (reason === "missing action") definition.authorizationAllowedActions = ["ENUMERATE_JOBS"];
    if (reason === "missing authority") Object.assign(settings, { questionCaptureAuthority: undefined });
    if (reason === "wrong authority") settings.questionCaptureAuthority = { ...authority, authorizationId: "76000000-0000-4000-8000-000000000009" };
    if (reason === "missing fresh lease") Object.assign(settings, { beforeRequest: undefined });
    if (reason === "host absent") definition.authorizationAllowedHosts = ["example.invalid"];
    const result = await new GreenhouseAdapter(definition).enumerateJobs(settings);
    expect(fetch).toHaveBeenCalledTimes(reason === "host absent" ? 0 : 1);
    if (reason !== "host absent") expect(deriveGreenhouseApplicationQuestions(result.jobs[0].applicationQuestionObservation).status).toBe("NOT_INSPECTED");
  });
  it("aborts the collection before a detail GET if the current lease or specific action was revoked", async () => {
    const fetch = responses(), settings = options();
    settings.beforeRequest.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("job_source_authority_or_lease_changed"));
    const result = await new GreenhouseAdapter(source()).enumerateJobs(settings);
    expect(result.completion).toBe("failed");
    expect(result.jobs).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("counts detail requests against the shared request bound without claiming uninspected forms empty", async () => {
    const fetch = responses(undefined, 200, [posting, { ...posting, id: 124, absolute_url: "https://job-boards.greenhouse.io/duolingo/jobs/124" }]);
    const result = await new GreenhouseAdapter(source()).enumerateJobs({ ...options(), requestBound: 2 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.counts.detailRequests).toBe(1);
    expect(result.jobs[1].applicationQuestionObservation).toMatchObject({ outcome: "NOT_INSPECTED", reasonCode: "REQUEST_BOUND" });
  });
  it.each([
    [{ ...posting, id: 999, questions: [question] }, "wrong job"],
    [{ ...posting, absolute_url: "https://job-boards.greenhouse.io/other/jobs/123", questions: [question] }, "wrong board"],
    [{ ...posting, absolute_url: "https://outside.invalid/jobs/123", questions: [question] }, "wrong host"],
  ])("rejects response identity mismatch: %s (%s)", async (detail) => {
    responses(detail);
    const result = await new GreenhouseAdapter(source()).enumerateJobs(options());
    expect(result.jobs[0].applicationQuestionObservation).toMatchObject({ outcome: "FAILED", rawResponse: null });
  });
  it.each([302, 403, 404, 429, 503])("keeps HTTP %i distinct from no questions and never retries or follows redirects", async (status) => {
    const fetch = responses({}, status);
    const result = await new GreenhouseAdapter(source()).enumerateJobs(options());
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.jobs[0].applicationQuestionObservation).toMatchObject({ outcome: [403, 404].includes(status) ? "INACCESSIBLE" : "FAILED", httpStatus: status, rawResponse: null });
    expect(result.completion).toBe("complete"); // listing completeness is separate from form visibility
  });
  it("rejects oversized responses without using partial JSON as questions", async () => {
    responses({ ...posting, questions: [question], extra: "x".repeat(1000) });
    const result = await new GreenhouseAdapter(source()).enumerateJobs({ ...options(), maximumResponseBytes: 500 });
    expect(result.jobs[0].applicationQuestionObservation).toMatchObject({ outcome: "FAILED", rawResponse: null });
  });
  it("honors source backoff across remaining jobs after a rate limit", async () => {
    const fetch = responses({}, 429, [posting, { ...posting, id: 124, absolute_url: "https://job-boards.greenhouse.io/duolingo/jobs/124" }]);
    const result = await new GreenhouseAdapter(source()).enumerateJobs(options());
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.jobs[0].applicationQuestionObservation).toMatchObject({ outcome: "FAILED", httpStatus: 429 });
    expect(result.jobs[1].applicationQuestionObservation).toMatchObject({ outcome: "NOT_INSPECTED", reasonCode: "SOURCE_BACKOFF" });
  });
  it("retains missing-versus-empty API questions without fabricating a form", async () => {
    responses({ ...posting });
    const result = await new GreenhouseAdapter(source()).enumerateJobs(options());
    expect(deriveGreenhouseApplicationQuestions(result.jobs[0].applicationQuestionObservation).status).toBe("PARTIAL");
  });
});

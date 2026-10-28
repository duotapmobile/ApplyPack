import { describe, expect, it } from "vitest";
import { APPLICATION_QUESTION_ACTION, GREENHOUSE_QUESTION_CAPTURE_VERSION, bindGreenhouseQuestionCapture,
  deriveGreenhouseApplicationQuestions, greenhouseQuestionUrl, questionResponseSha256, validateGreenhouseQuestionCapture,
  type GreenhouseQuestionCapture } from "@/lib/jobs/application-question-evidence";

const id = (n: number) => `76000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export function questionCapture(questions: unknown = [{ label: "Describe how you helped a customer.", required: true,
  fields: [{ name: "question_123", type: "textarea" }] }]): GreenhouseQuestionCapture {
  const raw = { id: 123, absolute_url: "https://job-boards.greenhouse.io/duolingo/jobs/123", questions };
  return { schemaVersion: GREENHOUSE_QUESTION_CAPTURE_VERSION, sourceId: "duolingo", boardToken: "duolingo", externalJobId: "123",
    sourceUrl: greenhouseQuestionUrl("duolingo", "123"), capturedAt: "2026-10-25T12:00:00Z",
    authority: { sourceRunId: id(1), authorizationId: id(2), authorizationVersion: "test-v1", authorizationHeadRevision: 1, scopeSha256: "c".repeat(64) },
    outcome: "RESPONSE", reasonCode: "CAPTURED", httpStatus: 200,
    rawResponse: raw as GreenhouseQuestionCapture["rawResponse"], rawResponseSha256: questionResponseSha256(raw) };
}

describe("read-only application question evidence", () => {
  it("derives exact prompts and deterministic IDs from the captured response", () => {
    const capture = questionCapture(), result = deriveGreenhouseApplicationQuestions(capture);
    expect(result).toMatchObject({ status: "OBSERVED", scope: "PUBLIC_API_RESPONSE_ONLY", questions: [{
      prompt: "Describe how you helped a customer.", required: true, wordLimit: null, characterLimit: null, sourceQuestionId: "question_123",
    }] });
    expect(result.questions[0].id).toMatch(/^[a-f0-9-]{36}$/);
    expect(deriveGreenhouseApplicationQuestions(capture)).toEqual(result);
    expect(APPLICATION_QUESTION_ACTION).toBe("READ_APPLICATION_QUESTIONS");
  });
  it("distinguishes a missing field from an actually inspected empty array", () => {
    expect(deriveGreenhouseApplicationQuestions(questionCapture(null)).status).toBe("PARTIAL");
    expect(deriveGreenhouseApplicationQuestions(questionCapture([])).status).toBe("NONE_OBSERVED");
  });
  it("keeps conditional forms partial and never invents a limit", () => {
    const result = deriveGreenhouseApplicationQuestions(questionCapture([{ label: "Describe your experience.", required: false,
      condition: { equals: "yes" }, word_limit: 100, fields: [{ name: "question_456", type: "textarea", max_length: 200 }] }]));
    expect(result).toMatchObject({ status: "PARTIAL", questions: [{ required: false, wordLimit: null, characterLimit: null }] });
  });
  it("does not treat contact, uploads, demographics or choice fields as writing priorities", () => {
    const result = deriveGreenhouseApplicationQuestions(questionCapture([
      { label: "Email", fields: [{ name: "email", type: "input_text" }] },
      { label: "Resume", fields: [{ name: "resume", type: "input_file" }, { name: "resume_text", type: "textarea" }] },
      { label: "Demographic detail", fields: [{ name: "demographic_custom", type: "textarea" }] },
      { label: "Availability", fields: [{ name: "question_4", type: "multi_value_single_select" }] },
    ]));
    expect(result).toMatchObject({ status: "NONE_OBSERVED", questions: [] });
  });
  it.each(["What is your gender?", "Email address", "What is your race?", "Please provide your date of birth", "Describe your disability", "Veteran status"])("excludes recognizable sensitive custom label %s", (label) => {
    expect(deriveGreenhouseApplicationQuestions(questionCapture([{ label, fields: [{ name: "question_123", type: "input_text" }] }]))).toMatchObject({ status: "PARTIAL", questions: [] });
  });
  it("keeps a phone-service experience prompt and never treats an ambiguous filtered label as absence", () => {
    const label = "Describe how you handle customer phone calls";
    expect(deriveGreenhouseApplicationQuestions(questionCapture([{ label, fields: [{ name: "question_1", type: "textarea" }] }]))).toMatchObject({ status: "OBSERVED", questions: [{ prompt: label }] });
    expect(deriveGreenhouseApplicationQuestions(questionCapture([{ label: "Describe your experience supporting people with disabilities", fields: [{ name: "question_2", type: "textarea" }] }]))).toMatchObject({ status: "PARTIAL", questions: [] });
  });
  it.each([{}, { label: "Unknown control", fields: [{ name: "question_4", type: "future_type" }] },
    { label: "Malformed", fields: [{ name: "question_4" }] }])("marks unsupported question structures partial", (question) => {
    expect(deriveGreenhouseApplicationQuestions(questionCapture([question])).status).toBe("PARTIAL");
  });
  it("preserves unknown requiredness instead of defaulting it", () => {
    expect(deriveGreenhouseApplicationQuestions(questionCapture([{ label: "Why this role?", fields: [{ name: "question_4", type: "textarea" }] }])).questions[0].required).toBeNull();
  });
  it.each(["NOT_INSPECTED", "FAILED", "INACCESSIBLE"] as const)("keeps %s distinct from observed-none", (outcome) => {
    const capture = { ...questionCapture(), outcome, reasonCode: outcome === "NOT_INSPECTED" ? "ACTION_NOT_AUTHORIZED" : "HTTP_FAILURE",
      rawResponse: null, rawResponseSha256: null };
    expect(deriveGreenhouseApplicationQuestions(capture)).toMatchObject({ status: outcome, questions: [] });
  });
  it("rejects altered raw payload, wrong endpoint and normalized invented metadata", () => {
    const capture = questionCapture();
    expect(() => validateGreenhouseQuestionCapture({ ...capture, rawResponse: { id: 999, questions: [] } })).toThrow();
    expect(() => validateGreenhouseQuestionCapture({ ...capture, sourceUrl: greenhouseQuestionUrl("other", "123") })).toThrow();
    expect(() => validateGreenhouseQuestionCapture({ ...capture, questions: [{ prompt: "Invented" }] })).toThrow();
  });
  it("requires the actual immutable source run and raw wrapper at fresh snapshot publication", () => {
    const capture = questionCapture();
    const expected = { ...capture.authority!, sourceId: capture.sourceId, boardToken: capture.boardToken,
      externalJobId: capture.externalJobId, observedAt: capture.capturedAt,
      rawSourcePayload: { listing: { id: 123 }, applicationQuestionObservation: capture } };
    expect(bindGreenhouseQuestionCapture(capture, expected)).toEqual(capture);
    for (const changed of [{ sourceRunId: id(9) }, { authorizationId: id(9) }, { authorizationHeadRevision: 2 },
      { scopeSha256: "d".repeat(64) }, { boardToken: "other" }, { externalJobId: "999" },
      { observedAt: "2026-10-25T11:00:00Z" }, { rawSourcePayload: { listing: { id: 123 } } }]) {
      expect(() => bindGreenhouseQuestionCapture(capture, { ...expected, ...changed })).toThrow();
    }
    const alteredWrapper = JSON.parse(JSON.stringify(expected.rawSourcePayload));
    alteredWrapper.applicationQuestionObservation.rawResponse.questions[0].label = "Describe  how you helped a customer.";
    expect(() => bindGreenhouseQuestionCapture(capture, { ...expected, rawSourcePayload: alteredWrapper })).toThrow();
  });
});

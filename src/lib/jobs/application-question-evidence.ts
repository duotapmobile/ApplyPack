import { z } from "zod";
import { canonicalSha256 } from "@/lib/domain/foundation";
import { captureRawSourceEvidence, type SourceEvidenceJson } from "./raw-source-evidence";

export const GREENHOUSE_QUESTION_CAPTURE_VERSION = "applypack-greenhouse-question-capture-v1";
export const APPLICATION_QUESTION_ACTION = "READ_APPLICATION_QUESTIONS";
const uuid = z.uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const questionCaptureAuthoritySchema = z.object({
  sourceRunId: uuid, authorizationId: uuid, authorizationVersion: z.string().min(1).max(120),
  authorizationHeadRevision: z.number().int().positive(), scopeSha256: sha256,
}).strict();
export type QuestionCaptureAuthority = z.infer<typeof questionCaptureAuthoritySchema>;
const captureSchema = z.object({
  schemaVersion: z.literal(GREENHOUSE_QUESTION_CAPTURE_VERSION),
  sourceId: z.string().min(1).max(120), boardToken: z.string().regex(/^[A-Za-z0-9_-]{1,120}$/),
  externalJobId: z.string().regex(/^\d{1,18}$/), sourceUrl: z.url(), capturedAt: z.iso.datetime(),
  authority: questionCaptureAuthoritySchema.nullable(),
  outcome: z.enum(["RESPONSE", "NOT_INSPECTED", "INACCESSIBLE", "FAILED"]),
  reasonCode: z.enum(["CAPTURED", "ACTION_NOT_AUTHORIZED", "REQUEST_BOUND", "DEADLINE", "SOURCE_BACKOFF", "AUTHORITY_MISSING", "HTTP_INACCESSIBLE", "HTTP_FAILURE", "TRANSPORT_OR_PAYLOAD_FAILURE"]),
  httpStatus: z.number().int().min(100).max(599).nullable(), rawResponse: z.unknown().nullable(), rawResponseSha256: sha256.nullable(),
}).strict();
export type GreenhouseQuestionCapture = Omit<z.infer<typeof captureSchema>, "rawResponse"> & { rawResponse: SourceEvidenceJson | null };
export type ObservedApplicationQuestion = {
  id: string; sourceQuestionId: string; prompt: string; required: boolean | null;
  wordLimit: number | null; characterLimit: number | null;
};
export type DerivedApplicationQuestions = {
  status: "NOT_INSPECTED" | "OBSERVED" | "NONE_OBSERVED" | "PARTIAL" | "INACCESSIBLE" | "FAILED";
  scope: "PUBLIC_API_RESPONSE_ONLY"; questions: ObservedApplicationQuestion[];
};

export function greenhouseQuestionUrl(boardToken: string, externalJobId: string) {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(boardToken) || !/^\d{1,18}$/.test(externalJobId)) throw new Error("application_question_identity_invalid");
  return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs/${externalJobId}?questions=true`;
}

export function questionResponseSha256(raw: unknown) {
  return captureRawSourceEvidence(GREENHOUSE_QUESTION_CAPTURE_VERSION, raw).payloadSha256;
}

/** A hash binds captured parsed JSON, not authenticated provider testimony.
 * Callers must independently bind the collection run and verified snapshot. */
export function validateGreenhouseQuestionCapture(raw: unknown): GreenhouseQuestionCapture {
  if (Buffer.byteLength(JSON.stringify(raw), "utf8") > 520_000) throw new Error("application_question_capture_too_large");
  const capture = captureSchema.parse(raw);
  if (capture.sourceUrl !== greenhouseQuestionUrl(capture.boardToken, capture.externalJobId)) throw new Error("application_question_source_mismatch");
  if (capture.outcome === "RESPONSE") {
    if (!capture.authority || capture.reasonCode !== "CAPTURED" || capture.httpStatus !== 200
      || !record(capture.rawResponse) || questionResponseSha256(capture.rawResponse) !== capture.rawResponseSha256
      || String(capture.rawResponse.id) !== capture.externalJobId) throw new Error("application_question_response_binding_invalid");
  } else if (capture.rawResponse !== null || capture.rawResponseSha256 !== null || capture.reasonCode === "CAPTURED") {
    throw new Error("application_question_failure_binding_invalid");
  }
  return capture as GreenhouseQuestionCapture;
}

export type QuestionCaptureRunBinding = {
  sourceRunId: string; authorizationId: string; authorizationHeadRevision: number; scopeSha256: string;
};
export function bindGreenhouseQuestionCapture(raw: unknown, expected: QuestionCaptureRunBinding & {
  sourceId: string; boardToken: string; externalJobId: string; observedAt: string; rawSourcePayload: unknown;
}) {
  const capture = validateGreenhouseQuestionCapture(raw);
  const wrapped = expected.rawSourcePayload;
  if (capture.sourceId !== expected.sourceId || capture.boardToken !== expected.boardToken || capture.externalJobId !== expected.externalJobId
    || !capture.authority || capture.authority.sourceRunId !== expected.sourceRunId
    || capture.authority.authorizationId !== expected.authorizationId
    || capture.authority.authorizationHeadRevision !== expected.authorizationHeadRevision || capture.authority.scopeSha256 !== expected.scopeSha256
    || !Number.isFinite(Date.parse(expected.observedAt)) || Date.parse(capture.capturedAt) > Date.parse(expected.observedAt)
    || !record(wrapped) || questionResponseSha256(wrapped.applicationQuestionObservation) !== questionResponseSha256(capture)) {
    throw new Error("application_question_run_binding_invalid");
  }
  return capture;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function questionId(capture: GreenhouseQuestionCapture, index: number, fieldNames: string[]) {
  const hash = canonicalSha256({ sourceId: capture.sourceId, board: capture.boardToken, job: capture.externalJobId,
    rawResponseSha256: capture.rawResponseSha256, index, fieldNames });
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
const privateOrUploadNames = new Set(["first_name", "last_name", "email", "phone", "resume", "resume_text", "cover_letter", "cover_letter_text", "location", "latitude", "longitude", "country", "city", "school", "degree", "discipline", "start_date", "end_date"]);
const nonProseTypes = new Set(["input_file", "input_hidden", "multi_value_single_select", "multi_value_multi_select"]);
// Custom providers can name these fields question_123 too. These recognizable
// labels are administrative/sensitive inputs, not resume tailoring priorities.
// This conservative filter is not a claim of exhaustive semantic detection.
const excludedPrompt = /\b(?:first name|last name|full name|email(?: address)?|e-mail|phone number|telephone number|home address|mailing address|street address|date of birth|birth date|social security|national (?:id|identity)|passport|gender|ethnicity|ethnic|your race|racial|sexual orientation|religion|religious|disability|disabilities|disabled|veteran(?: status)?|citizenship|nationality|immigration|work authori[sz]ation|visa|sponsorship|criminal history|background check|salary expectations|expected salary|consent to)\b/iu;

/** Only the inspected public response is covered. Conditional/later steps are
 * never inferred absent, and requiredness means a form field, not qualification. */
export function deriveGreenhouseApplicationQuestions(raw: unknown): DerivedApplicationQuestions {
  const capture = validateGreenhouseQuestionCapture(raw);
  const output: DerivedApplicationQuestions = { status: capture.outcome === "RESPONSE" ? "PARTIAL" : capture.outcome,
    scope: "PUBLIC_API_RESPONSE_ONLY", questions: [] };
  if (capture.outcome !== "RESPONSE") return output;
  const payload = capture.rawResponse as Record<string, unknown>;
  if (!Array.isArray(payload.questions)) return output;
  let incomplete = payload.questions.length > 100;
  const conditional = (value: Record<string, unknown>) => Object.keys(value).some((key) => /condition|depend|visibility|follow.?up/i.test(key));
  if (conditional(payload)) incomplete = true;
  const seenFields = new Set<string>();
  for (const [index, question] of payload.questions.slice(0, 100).entries()) {
    if (!record(question) || !Array.isArray(question.fields) || !question.fields.length) { incomplete = true; continue; }
    if (conditional(question)) incomplete = true;
    const fields = question.fields;
    if (fields.some((field) => !record(field) || typeof field.name !== "string" || typeof field.type !== "string")) { incomplete = true; continue; }
    const typed = fields as Array<Record<string, unknown> & { name: string; type: string }>;
    if (typed.some(conditional)) incomplete = true;
    if (typed.some((field) => privateOrUploadNames.has(field.name) || /^(?:demographic|compliance|eeoc|gdpr|consent|data_compliance)/i.test(field.name))) continue;
    if (typed.every((field) => nonProseTypes.has(field.type))) continue;
    if (typed.some((field) => !["input_text", "textarea"].includes(field.type))) { incomplete = true; continue; }
    if (typeof question.label !== "string" || !question.label.trim() || question.label.length > 4000
      || /[\u0000-\u001f\u007f]/u.test(question.label)) { incomplete = true; continue; }
    // A heuristic label exclusion is not evidence that no short answer exists.
    if (excludedPrompt.test(question.label)) { incomplete = true; continue; }
    if (typed.some((field) => !field.name.trim() || seenFields.has(field.name))) { incomplete = true; continue; }
    typed.forEach((field) => seenFields.add(field.name));
    output.questions.push({ id: questionId(capture, index, typed.map((field) => field.name)),
      sourceQuestionId: typed.map((field) => field.name).join("|"), prompt: question.label,
      required: typeof question.required === "boolean" ? question.required : null,
      // The public API contract does not document word/character limit fields.
      wordLimit: null, characterLimit: null });
  }
  output.status = incomplete ? "PARTIAL" : output.questions.length ? "OBSERVED" : "NONE_OBSERVED";
  return output;
}

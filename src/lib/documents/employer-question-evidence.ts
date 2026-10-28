import { z } from "zod";
import { canonicalSha256 } from "@/lib/domain/foundation";
import { containsPromptInjection } from "@/lib/materials/contract";
import { bindGreenhouseQuestionCapture, deriveGreenhouseApplicationQuestions, type QuestionCaptureRunBinding } from "@/lib/jobs/application-question-evidence";
import { validRawSourceEvidence, type RawSourceEvidence } from "@/lib/jobs/raw-source-evidence";

export const EMPLOYER_QUESTION_OBSERVATION_VERSION = "applypack-employer-question-observation-v1";
export const employerQuestionStatuses = ["NOT_INSPECTED", "OBSERVED", "NONE_OBSERVED", "PARTIAL", "INACCESSIBLE", "FAILED"] as const;
const publicUrl = z.url().max(2000).refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !url.hash &&
    ![...url.searchParams.keys()].some((key) => /token|password|secret|authorization|session|email|phone/i.test(key));
});
export const employerQuestionObservationSchema = z.object({
  schemaVersion: z.literal(EMPLOYER_QUESTION_OBSERVATION_VERSION), observationId: z.uuid(),
  status: z.enum(employerQuestionStatuses), scope: z.enum(["INSPECTED_PUBLIC_PAGE_ONLY", "INSPECTED_PUBLIC_API_RESPONSE_ONLY"]),
  sourceEvidenceNodeId: z.uuid().nullable(), sourceUrl: publicUrl, sourceObservedAt: z.iso.datetime({ offset: true }),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  questions: z.array(z.object({ id: z.uuid(), prompt: z.string().min(1).max(4000).refine((value) => !!value.trim()), required: z.boolean().nullable(),
    wordLimit: z.number().int().min(1).max(10000).nullable(), characterLimit: z.number().int().min(1).max(100000).nullable() }).strict()).max(30),
}).strict().superRefine((value, ctx) => {
  if (["OBSERVED", "PARTIAL", "NONE_OBSERVED"].includes(value.status) && (!value.sourceEvidenceNodeId || !value.sourceSha256)) ctx.addIssue({ code: "custom", message: "Captured evidence is required." });
  if (value.status === "OBSERVED" && !value.questions.length || !["OBSERVED", "PARTIAL"].includes(value.status) && value.questions.length) ctx.addIssue({ code: "custom", message: "Questions conflict with inspection status." });
  if (new Set(value.questions.map((question) => question.id)).size !== value.questions.length) ctx.addIssue({ code: "custom", message: "Question identifiers must be distinct." });
});
export type EmployerQuestionObservation = z.infer<typeof employerQuestionObservationSchema>;
export type EmployerQuestionContext = {
  jobSnapshotId: string; jobSha256: string; ruleId: string; ruleSha256: string; ruleCheckedAt: string; humanConfirmedAt: string;
  ruleSourceEvidenceIds: readonly string[];
  rawSource: { sourceUrl: string; observedAt: string; value: unknown };
  nodes: readonly { id: string; job_snapshot_id: string; source_excerpt: string | null }[];
  captureBinding?: (QuestionCaptureRunBinding & { sourceId: string; boardToken: string; externalJobId: string; authorizationVersion: string; adapterVersion: string }) | null;
};
type IssueCode = "UNVERIFIED_QUESTION_DATA" | "SOURCE_PROOF_MISMATCH" | "SOURCE_TIME_INVALID" | "DUPLICATE_OBSERVATION" | "PROMPT_NOT_IN_SOURCE" | "POTENTIAL_PROMPT_INJECTION" | "ABSENCE_NOT_ESTABLISHED";
const reviewedListingTextSchema = z.object({ text: z.string().min(1).max(100000), parserIssues: z.array(z.unknown()).max(500), correctionOf: z.uuid().optional() }).strict();
const capturedApiListingSchema = z.object({ text: z.string().min(1).max(100000), parserIssues: z.array(z.unknown()).max(500),
  rawSourceEvidence: z.object({ adapterVersion: z.string(), payload: z.json(), payloadSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  fieldEvidence: z.json(), applicationQuestionObservation: z.unknown() }).strict();
const suspiciousPrompt = (value: string) => containsPromptInjection(value) || /ignore\s+(?:all\s+|previous\s+|prior\s+)?(?:instructions|rules)|(?:system|developer)\s*(?:message|prompt)/i.test(value);

/** A rule URL or arbitrary application_questions JSON is not source evidence.
 * Fresh API captures additionally require the actual authorized collection run
 * and exact immutable raw response. Neither path creates candidate qualifications. */
export function buildEmployerQuestionInsights(raw: unknown, context: EmployerQuestionContext, now = new Date()) {
  const observations: EmployerQuestionObservation[] = [];
  const captures: { captureSha256: string; status: EmployerQuestionObservation["status"]; scope: "PUBLIC_API_RESPONSE_ONLY";
    sourceUrl: string; capturedAt: string; sourceRunId: string; authorizationId: string; rawResponseSha256: string | null }[] = [];
  const issues: { observationId: string | null; code: IssueCode }[] = [];
  const questions: { id: string; observationId: string; prompt: string; required: boolean | null; wordLimit: number | null; characterLimit: number | null;
    sourceUrl: string; sourceObservedAt: string; sourceEvidenceNodeId: string | null; sourceSha256: string;
    sourceCaptureSha256: string | null; sourceRunId: string | null;
    jobSnapshotId: string; jobSha256: string; ruleId: string; ruleSha256: string; textTrust: "UNTRUSTED_DATA_NOT_INSTRUCTIONS";
    interpretation: "POTENTIAL_EMPLOYER_PRIORITY_NOT_A_CANDIDATE_QUALIFICATION";
    metadataVerification: "LIMITS_AND_REQUIREDNESS_NOT_ESTABLISHED" | "REQUIREDNESS_FROM_PUBLIC_FORM_LIMITS_UNDOCUMENTED"; providerEligible: boolean }[] = [];
  const result = (status: EmployerQuestionObservation["status"]) => ({ schemaVersion: EMPLOYER_QUESTION_OBSERVATION_VERSION, status,
    scope: "INSPECTED_PUBLIC_SOURCE_ONLY" as const, verification: issues.length ? "UNVERIFIED_OR_PARTIAL" as const : questions.length || captures.some((item) => item.status === "NONE_OBSERVED") ? "BOUND_SOURCE_EVIDENCE" as const : "NOT_AVAILABLE" as const,
    observations, captures, questions, issues, answeredQuestionDeliverable: false as const, applicationSubmissionAuthorized: false as const });
  let bounded = false;
  try { bounded = Array.isArray(raw) && raw.length <= 100 && Buffer.byteLength(JSON.stringify(raw), "utf8") <= 128_000; } catch { /* Invalid input has no source authority. */ }
  if (!bounded || !Array.isArray(raw)) {
    issues.push({ observationId: null, code: "UNVERIFIED_QUESTION_DATA" }); return result("FAILED");
  }
  const seen = new Set<string>(), questionIds = new Set<string>(), statuses: EmployerQuestionObservation["status"][] = [];
  const listing = reviewedListingTextSchema.safeParse(context.rawSource.value);
  const rawText = listing.success ? listing.data.text : null;
  if (context.rawSource.value && typeof context.rawSource.value === "object" && "applicationQuestionObservation" in context.rawSource.value) {
    try {
      const source = capturedApiListingSchema.parse(context.rawSource.value), binding = context.captureBinding;
      if (!binding || !validRawSourceEvidence(source.rawSourceEvidence as RawSourceEvidence, binding.adapterVersion)
        || canonicalSha256(source) !== context.jobSha256 || Date.parse(context.rawSource.observedAt) > Date.parse(context.humanConfirmedAt)
        || Date.parse(context.rawSource.observedAt) > Date.parse(context.ruleCheckedAt) || !Number.isFinite(now.getTime()) || Date.parse(context.rawSource.observedAt) > now.getTime()) throw new Error("source_proof_invalid");
      const capture = bindGreenhouseQuestionCapture(source.applicationQuestionObservation, { ...binding, observedAt: context.rawSource.observedAt, rawSourcePayload: source.rawSourceEvidence.payload });
      if (capture.authority?.authorizationVersion !== binding.authorizationVersion) throw new Error("source_version_invalid");
      const derived = deriveGreenhouseApplicationQuestions(capture), captureSha256 = canonicalSha256(capture);
      const observationId = `${captureSha256.slice(0, 8)}-${captureSha256.slice(8, 12)}-5${captureSha256.slice(13, 16)}-a${captureSha256.slice(17, 20)}-${captureSha256.slice(20, 32)}`;
      captures.push({ captureSha256, status: derived.status, scope: derived.scope, sourceUrl: capture.sourceUrl, capturedAt: capture.capturedAt,
        sourceRunId: binding.sourceRunId, authorizationId: binding.authorizationId, rawResponseSha256: capture.rawResponseSha256 });
      statuses.push(derived.status); seen.add(observationId);
      for (const question of derived.questions) {
        const suspicious = suspiciousPrompt(question.prompt); questionIds.add(question.id);
        if (suspicious) issues.push({ observationId, code: "POTENTIAL_PROMPT_INJECTION" });
        questions.push({ ...question, observationId, sourceUrl: capture.sourceUrl, sourceObservedAt: capture.capturedAt,
          sourceEvidenceNodeId: null, sourceSha256: capture.rawResponseSha256!, sourceCaptureSha256: captureSha256, sourceRunId: binding.sourceRunId,
          jobSnapshotId: context.jobSnapshotId, jobSha256: context.jobSha256, ruleId: context.ruleId, ruleSha256: context.ruleSha256,
          textTrust: "UNTRUSTED_DATA_NOT_INSTRUCTIONS", interpretation: "POTENTIAL_EMPLOYER_PRIORITY_NOT_A_CANDIDATE_QUALIFICATION",
          metadataVerification: "REQUIREDNESS_FROM_PUBLIC_FORM_LIMITS_UNDOCUMENTED", providerEligible: !suspicious });
      }
    } catch { issues.push({ observationId: null, code: "SOURCE_PROOF_MISMATCH" }); }
  }
  for (const input of raw) {
    const parsed = employerQuestionObservationSchema.safeParse(input);
    if (!parsed.success) { issues.push({ observationId: null, code: "UNVERIFIED_QUESTION_DATA" }); continue; }
    const item = parsed.data;
    observations.push(item);
    const issue = (code: IssueCode) => { issues.push({ observationId: item.observationId, code }); };
    if (seen.has(item.observationId) || item.questions.some((question) => questionIds.has(question.id))) {
      for (let index = questions.length - 1; index >= 0; index -= 1) if (questions[index].observationId === item.observationId || item.questions.some((question) => question.id === questions[index].id)) questions.splice(index, 1);
      issue("DUPLICATE_OBSERVATION"); continue;
    }
    seen.add(item.observationId); item.questions.forEach((question) => questionIds.add(question.id));
    if (!Number.isFinite(now.getTime()) || Date.parse(item.sourceObservedAt) > now.getTime() || Date.parse(item.sourceObservedAt) > Date.parse(context.humanConfirmedAt)) { issue("SOURCE_TIME_INVALID"); continue; }
    if (["NOT_INSPECTED", "INACCESSIBLE", "FAILED"].includes(item.status)) { statuses.push(item.status); continue; }
    // A pasted listing text cannot establish that a complete application form has
    // no short answers. A future verified API capture has its own raw schema.
    if (item.status === "NONE_OBSERVED") { issue("ABSENCE_NOT_ESTABLISHED"); continue; }
    const node = context.nodes.find((candidate) => candidate.id === item.sourceEvidenceNodeId && candidate.job_snapshot_id === context.jobSnapshotId);
    if (item.scope !== "INSPECTED_PUBLIC_PAGE_ONLY" || !node || !context.ruleSourceEvidenceIds.includes(node.id) || item.sourceSha256 !== context.jobSha256 ||
      item.sourceUrl !== context.rawSource.sourceUrl || item.sourceObservedAt !== context.rawSource.observedAt ||
      canonicalSha256(context.rawSource.value) !== context.jobSha256 || rawText === null) { issue("SOURCE_PROOF_MISMATCH"); continue; }
    statuses.push(item.status);
    for (const question of item.questions) {
      if (!node.source_excerpt?.includes(question.prompt) || !rawText.includes(question.prompt)) { issue("PROMPT_NOT_IN_SOURCE"); continue; }
      const suspicious = suspiciousPrompt(question.prompt);
      if (suspicious) issue("POTENTIAL_PROMPT_INJECTION");
      questions.push({ ...question, required: null, wordLimit: null, characterLimit: null,
        metadataVerification: "LIMITS_AND_REQUIREDNESS_NOT_ESTABLISHED", observationId: item.observationId, sourceUrl: item.sourceUrl, sourceObservedAt: item.sourceObservedAt,
        sourceEvidenceNodeId: node.id, sourceSha256: item.sourceSha256!, sourceCaptureSha256: null, sourceRunId: null, jobSnapshotId: context.jobSnapshotId, jobSha256: context.jobSha256,
        ruleId: context.ruleId, ruleSha256: context.ruleSha256, textTrust: "UNTRUSTED_DATA_NOT_INSTRUCTIONS",
        interpretation: "POTENTIAL_EMPLOYER_PRIORITY_NOT_A_CANDIDATE_QUALIFICATION", providerEligible: !suspicious });
    }
  }
  if (issues.length) return result(questions.length ? "PARTIAL" : "FAILED");
  if (statuses.includes("PARTIAL") || questions.length && statuses.some((status) => status !== "OBSERVED")) return result("PARTIAL");
  if (questions.length) return result("OBSERVED");
  if (statuses.includes("INACCESSIBLE")) return result("INACCESSIBLE");
  if (statuses.includes("FAILED")) return result("FAILED");
  if (statuses.length && statuses.every((status) => status === "NONE_OBSERVED")) return result("NONE_OBSERVED");
  return result("NOT_INSPECTED");
}
export type EmployerQuestionInsights = ReturnType<typeof buildEmployerQuestionInsights>;

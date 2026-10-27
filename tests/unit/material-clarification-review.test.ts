import { describe, expect, it } from "vitest";
import { canonicalSha256 } from "@/lib/domain/foundation";
import { buildConfirmedReview } from "@/lib/intake/confirmed-review";
import { buildFourStepSnapshot, emptyFourStepDraft, fourStepDraftSchema, validateFourStep, type FourStepDraft } from "@/lib/intake/four-step";
import { clarificationAnswerReceiptSchema } from "@/lib/intake/clarification-contract";

const question = { questionId: "10000000-0000-4000-8000-000000000001", prompt: "Which scheduling tools did you actually use?", answer: "I booked appointments in a paper calendar; I am unsure about the software name." };
const answers: FourStepDraft = { ...emptyFourStepDraft, entryMode: "GUIDED", fullName: "Fixture Person", email: "person@example.invalid", noPriorEmployment: true, backgroundReviewed: true, clarifications: [question] };
const context = { resume: null, facts: [], presentedFactIds: new Set<string>() };
describe("complete clarification review", () => {
  it("displays the exact prompt and actual answer with a section edit destination", () => {
    expect(buildConfirmedReview(answers, [], []).find((section) => section.title === "Clarifications")).toEqual({ title: "Clarifications", step: 2, controlId: "clarification-answers", lines: [question.prompt, `Your answer: ${question.answer}`] });
    expect(buildFourStepSnapshot(answers, "a".repeat(64), "applypack-c14n-v1")).toHaveProperty("clarifications", [question]);
  });
  it("requires answers but retains explicit uncertainty without inventing a positive qualification", () => {
    expect(validateFourStep(2, answers, context)).toEqual([]);
    expect(validateFourStep(2, { ...answers, clarifications: [{ ...question, answer: "  " }] }, context)).toContainEqual(expect.objectContaining({ fieldId: `clarification-${question.questionId}` }));
    expect(buildFourStepSnapshot(answers, "a".repeat(64), "applypack-c14n-v1").clarifications).toEqual([question]);
  });
  it("changes both the complete review and snapshot digest after an answer edit", () => {
    const changed = { ...answers, clarifications: [{ ...question, answer: "I only answered calls; I did not schedule appointments." }] };
    expect(canonicalSha256(buildConfirmedReview(answers, [], []))).not.toBe(canonicalSha256(buildConfirmedReview(changed, [], [])));
    expect(canonicalSha256(buildFourStepSnapshot(answers, "a".repeat(64), "applypack-c14n-v1"))).not.toBe(canonicalSha256(buildFourStepSnapshot(changed, "a".repeat(64), "applypack-c14n-v1")));
  });
  it("preserves the absence of clarification keys on historical ordinary intakes", () => {
    expect(fourStepDraftSchema.parse(emptyFourStepDraft)).not.toHaveProperty("clarifications");
    expect(buildFourStepSnapshot(emptyFourStepDraft, "a".repeat(64), "applypack-c14n-v1")).not.toHaveProperty("clarifications");
    expect(buildConfirmedReview(emptyFourStepDraft, [], []).some((section) => section.title === "Clarifications")).toBe(false);
  });
  it("keeps document contact separate while preserving the historical default and exact review binding", () => {
    expect(fourStepDraftSchema.parse(emptyFourStepDraft)).not.toHaveProperty("documentContactEmail");
    const original = buildFourStepSnapshot(answers, "a".repeat(64), "applypack-c14n-v1");
    const changedAnswers = { ...answers, documentContactEmail: "resume@example.invalid" };
    const changed = buildFourStepSnapshot(changedAnswers, "a".repeat(64), "applypack-c14n-v1");
    expect(original.documentContactEmail).toBe(answers.email);
    expect(changed.accessEmailNormalized).toBe(answers.email);
    expect(changed.documentContactEmail).toBe("resume@example.invalid");
    expect(buildFourStepSnapshot({ ...answers, documentContactEmail: "" }, "a".repeat(64), "applypack-c14n-v1")).toEqual(original);
    expect(buildConfirmedReview(changedAnswers, [], [])[0].lines).toContain(`Account access email: ${answers.email}`);
    expect(buildConfirmedReview(changedAnswers, [], [])[0].lines).toContain("Email on your documents: resume@example.invalid");
    expect(canonicalSha256(changed)).not.toBe(canonicalSha256(original));
    expect(validateFourStep(0, { ...answers, documentContactEmail: "invalid" }, context)).toContainEqual(expect.objectContaining({ fieldId: "document-contact-email" }));
  });
  it.each([[], [question, question], [{ ...question, answer: "a".repeat(5001) }], [{ ...question, approved: true }], Array.from({ length: 21 }, () => question)].map((clarifications) => ({ clarifications })))
    ("rejects incomplete or unbounded clarification collections", ({ clarifications }) => {
    expect(fourStepDraftSchema.safeParse({ ...answers, clarifications }).success).toBe(false);
  });
  it("accepts only bounded known answer receipts and never a capability in JSON", () => {
    const receipt = { state: "FULL_REVIEW_REQUIRED", draftId: question.questionId, version: 2, expiresAt: "2026-10-26T00:00:00+00:00", replayed: false };
    expect(clarificationAnswerReceiptSchema.safeParse(receipt).success).toBe(true);
    for (const bad of [{}, { ...receipt, secret: "private" }, { ...receipt, version: 0 }, { ...receipt, state: "CONFIRMED" }]) expect(clarificationAnswerReceiptSchema.safeParse(bad).success).toBe(false);
    expect(clarificationAnswerReceiptSchema.safeParse({ state: "REVIEW_REQUIRED", factId: question.questionId }).success).toBe(true);
  });
});

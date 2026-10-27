import { z } from "zod";

export const clarificationQuestionsSchema = z.array(z.object({ id: z.uuid(), prompt: z.string().min(10).max(1_000),
  answered: z.boolean(), review_required: z.boolean() }).strict()).max(100)
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length, "Question identities must be unique.");

export const clarificationRequestSchema = z.union([
  z.object({ questionId: z.uuid(), answer: z.string().trim().min(1).max(5_000), confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal("RESUME"), questionId: z.uuid() }).strict(),
]);

export const clarificationAnswerReceiptSchema = z.union([
  z.object({ state: z.literal("FULL_REVIEW_REQUIRED"), draftId: z.uuid(), version: z.number().int().positive(),
    expiresAt: z.iso.datetime({ offset: true }), replayed: z.boolean() }).strict(),
  z.object({ state: z.enum(["REVIEW_REQUIRED", "LEGACY_EVIDENCE_RECORDED"]), factId: z.uuid() }).strict(),
]);

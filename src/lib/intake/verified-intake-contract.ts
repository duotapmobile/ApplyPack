import { z } from "zod";

export const INTAKE_DRAFT_HEADER = "x-applypack-draft-id";
export const verifiedIntakeSummarySchema = z.object({
  rootDraftId: z.uuid(), draftId: z.uuid(),
  state: z.enum(["IN_PROGRESS", "COMPLETE", "LOCKED_TO_CHECKOUT"]),
  version: z.number().int().positive(), capabilityVersion: z.number().int().positive(),
  expiresAt: z.iso.datetime({ offset: true }), createdAt: z.iso.datetime({ offset: true }), updatedAt: z.iso.datetime({ offset: true }),
  accessEmail: z.email().max(320), verifiedEmail: z.email().max(320),
  questionPending: z.boolean(), reviewRequired: z.boolean(),
}).strict();
export type VerifiedIntakeSummary = z.infer<typeof verifiedIntakeSummarySchema>;

export const verifiedIntakeAccessSchema = z.object({
  verifiedEmail: z.email().max(320), browserDraftId: z.uuid().nullable(),
  current: verifiedIntakeSummarySchema.nullable(),
  drafts: z.array(verifiedIntakeSummarySchema.extend({ state: z.enum(["IN_PROGRESS", "COMPLETE"]) })).max(20).refine(items => new Set(items.map(item => item.rootDraftId)).size === items.length),
  claimAvailable: z.boolean(),
}).strict();
export type VerifiedIntakeAccess = z.infer<typeof verifiedIntakeAccessSchema>;

const browserDraftId = z.uuid().nullable();
export const verifiedIntakeActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("START"), requestId: z.uuid(), expectedBrowserDraftId: browserDraftId, replaceUnlinkedBrowserIntake: z.boolean().default(false) }).strict(),
  z.object({ action: z.literal("CLAIM"), expectedBrowserDraftId: z.uuid() }).strict(),
  z.object({ action: z.literal("RESUME"), rootDraftId: z.uuid(), expectedDraftId: z.uuid(), expectedCapabilityVersion: z.number().int().positive(),
    expectedBrowserDraftId: browserDraftId, replaceUnlinkedBrowserIntake: z.boolean().default(false) }).strict(),
]);
export type VerifiedIntakeAction = z.infer<typeof verifiedIntakeActionSchema>;
export const verifiedIntakeActionReceiptSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("OPENED"), draftId: z.uuid() }).strict(),
  z.object({ state: z.literal("RESUME_REQUIRED"), rootDraftId: z.uuid() }).strict(),
]);

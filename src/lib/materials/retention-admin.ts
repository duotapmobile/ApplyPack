import { z } from "zod";
import { ONE_OFF_RETENTION_POLICY } from "./retention-access";

export const retentionHoldReasons = {
  LEGAL_REQUIREMENT: "Required legal retention",
  PAYMENT_DISPUTE: "Payment dispute under review",
  SUPPORT_REVIEW: "Open customer support review",
  UNFULFILLED_WORK: "Paid work still owed",
} as const;
export const retentionHoldReasonSchema = z.enum(["LEGAL_REQUIREMENT", "PAYMENT_DISPUTE", "SUPPORT_REVIEW", "UNFULFILLED_WORK"]);
const timestamp = z.iso.datetime({ offset: true }).nullable();
export const adminRetentionStatusSchema = z.object({
  policyVersion: z.literal(ONE_OFF_RETENTION_POLICY),
  orders: z.array(z.object({
    order_id: z.uuid(), customer_id: z.uuid(), action_expires_at: timestamp, access_expires_at: timestamp,
    family_expires_at: timestamp, state: z.string().regex(/^[A-Z_]{1,60}$/), purged_at: timestamp, protected: z.boolean(),
    holds: z.array(z.object({ id: z.uuid(), reason_code: retentionHoldReasonSchema, created_at: z.iso.datetime({ offset: true }), released_at: timestamp }).strict()).max(100),
  }).strict()).max(100),
}).strict();
export type AdminRetentionStatus = z.infer<typeof adminRetentionStatusSchema>;

export const retentionHoldRequestSchema = z.object({
  orderId: z.uuid(), reasonCode: retentionHoldReasonSchema, holdId: z.uuid().nullable(),
  release: z.boolean(), reviewed: z.literal(true),
}).strict().refine((value) => value.release === (value.holdId !== null), "Choose the exact active hold to release");

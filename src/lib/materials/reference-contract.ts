import { z } from "zod";

export const referencePayloadSchema = z.object({
  name: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(120),
  organization: z.string().trim().min(1).max(160),
  relationship: z.string().trim().min(1).max(160),
  email: z.email().max(254),
  phone: z.string().trim().min(7).max(40),
  sharedWorkContext: z.string().trim().min(1).max(500),
  capabilitiesCanVerify: z.array(z.string().trim().min(1).max(120)).min(1).max(12),
  approvedContextLine: z.string().trim().max(240).nullable().optional(),
}).strict();

export type ReferencePayload = z.infer<typeof referencePayloadSchema>;

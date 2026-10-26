import { z } from "zod";

const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
export const draftChangeRequestSchema = z.object({ jobId: uuid, expectedVersionId: uuid,
  expectedSourceSha256: hash, requestId: uuid,
  instructions: z.string().trim().min(10).max(2400).refine((value) =>
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/u.test(value)),
}).strict();
export type DraftChangeRequest = z.infer<typeof draftChangeRequestSchema>;
/** Content-free immutable lineage, separate from the newly generated proposal
 * digest. The server binds this to the actual097 request row before use. */
export const draftChangeLineageSchema = z.object({ schemaVersion: z.literal("applypack-draft-change-lineage-v1"),
  requestId: uuid, requestSha256: hash, requestPayloadSha256: hash,
  priorVersionId: uuid, priorSourceSha256: hash, priorProposalSourceSha256: hash,
}).strict();
export type DraftChangeLineage = z.infer<typeof draftChangeLineageSchema>;

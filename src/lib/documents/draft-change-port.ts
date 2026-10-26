import { z } from "zod";
const uuid = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
export const draftChangeRecordSchema = z.object({ id: uuid, customer_id: uuid, material_line_id: uuid, job_id: uuid,
  parent_version_id: uuid, successor_version_id: uuid, encrypted_payload_id: uuid, request_sha256: hash, payload_sha256: hash,
  parent_source_sha256: hash, parent_proposal_sha256: hash, packet_sha256: hash, context_sha256: hash,
  reviewer_id: uuid, created_at: z.iso.datetime({ offset: true }) }).strict();
export type DraftChangeRecord = z.infer<typeof draftChangeRecordSchema>;
/** Exact finite097 surface until the real generated Database artifact is
 * available. Implementations are server-owned; every response is parsed. */
export type DraftChangePort = {
  readRequest(requestId: string, signal: AbortSignal): Promise<unknown>;
  readEvidence(versionId: string, signal: AbortSignal): Promise<unknown>;
  commit(args: { p_job_id: string; p_expected_version_id: string; p_expected_source_sha256: string;
    p_request_id: string; p_payload_id: string; p_request_sha256: string; p_payload_sha256: string;
    p_parent_proposal_sha256: string; p_reviewer_id: string }, signal: AbortSignal): Promise<unknown>;
  reserve(args: { p_job_id: string; p_lease_token: string; p_version_id: string; p_request_id: string; p_policy_id: string;
    p_input_token_cap: number; p_output_token_cap: number; p_change_request_id: string; p_change_payload_sha256: string }, signal: AbortSignal): Promise<unknown>;
};

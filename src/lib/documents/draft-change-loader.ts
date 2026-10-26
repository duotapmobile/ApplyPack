import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import type { DraftingEvidencePacket } from "./drafting-evidence";
import { draftChangeRecordSchema, type DraftChangePort } from "./draft-change-port";
import { readDraftChangePayload } from "./draft-change-request";
import { readEncryptedDraftPayload } from "./draft-packet-worker";
import { exactOwnerEditJson } from "./draft-owner-edit";

const uuid = z.uuid();
const bindingSchema = z.object({ jobId: uuid, versionId: uuid, customerId: uuid, materialLineId: uuid }).strict();
/** The finite port resolves the nearest immutable request through same-job
 * version history, including an explicit fresh packet. It does not authorize
 * dispatch; the097 reservation must recheck this exact payload under DB locks. */
export async function loadDraftChangeForVersion(admin: SupabaseClient<Database>, port: DraftChangePort,
  raw: z.infer<typeof bindingSchema>, packet: DraftingEvidencePacket, signal: AbortSignal, now: () => Date) {
  const binding = bindingSchema.parse(raw);
  const check = () => { if (signal.aborted) throw new Error("DRAFT_CHANGE_ABORTED"); };
  check(); const value = await port.readEvidence(binding.versionId, signal); check();
  if (value === null) return null;
  const record = draftChangeRecordSchema.parse(value);
  if (record.job_id !== binding.jobId || record.customer_id !== binding.customerId || record.material_line_id !== binding.materialLineId
    || Date.parse(record.created_at) > now().getTime()) throw new Error("DRAFT_CHANGE_BINDING_INVALID");
  let bytes: Buffer | undefined;
  try {
    bytes = await readEncryptedDraftPayload(admin, { customerId: binding.customerId, jobId: binding.jobId,
      payloadId: record.encrypted_payload_id, sha256: record.payload_sha256, purpose: "MATERIAL_DRAFT_CHANGE_REQUEST" }, { signal }); check();
    const body = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const request = readDraftChangePayload(body, { requestId: record.id, requestSha256: record.request_sha256,
      payloadSha256: record.payload_sha256, jobId: binding.jobId, customerId: binding.customerId, materialLineId: binding.materialLineId,
      parentVersionId: record.parent_version_id, parentSourceSha256: record.parent_source_sha256,
      parentProposalSha256: record.parent_proposal_sha256, packetSha256: record.packet_sha256,
      contextSha256: record.context_sha256, reviewerId: record.reviewer_id }, packet, now());
    check(); const after = draftChangeRecordSchema.parse(await port.readEvidence(binding.versionId, signal)); check();
    if (exactOwnerEditJson(record) !== exactOwnerEditJson(after)) throw new Error("DRAFT_CHANGE_RECORD_CHANGED");
    return { lineage: request.lineage, providerContext: request.providerContext, ownerInstructions: request.payload.request.instructions };
  } finally { bytes?.fill(0); }
}

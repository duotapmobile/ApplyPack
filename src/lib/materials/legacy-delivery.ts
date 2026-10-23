import { z } from "zod";

export const legacyDocumentKinds = z.enum(["resume", "cover_letter"]);
export type LegacyDeliveryRevision = {
  id: string;
  apply_pack_item_id: string;
  version: number;
  correction_request_id: string | null;
  resume_path: string;
  cover_letter_path: string;
  delivered_at: string;
  reviewed_by: string | null;
};

export function legacyDeliveryPath(input: {
  customerId: string; orderId: string; itemId: string;
  revision: LegacyDeliveryRevision; kind: z.infer<typeof legacyDocumentKinds>;
}, now = Date.now()): string | null {
  const { revision } = input;
  if (![input.customerId, input.orderId, input.itemId, revision.id, revision.reviewed_by].every((id) => z.uuid().safeParse(id).success)
    || revision.apply_pack_item_id !== input.itemId || !Number.isSafeInteger(revision.version) || revision.version < 1
    || !Number.isFinite(Date.parse(revision.delivered_at)) || Date.parse(revision.delivered_at) > now
    || (revision.correction_request_id !== null && !z.uuid().safeParse(revision.correction_request_id).success)) return null;
  const base = `${input.customerId}/orders/${input.orderId}/items/${input.itemId}`
    + (revision.correction_request_id ? `/corrections/${revision.correction_request_id}` : "");
  // Historical uploads used these exact owner/order/item paths with upsert:false.
  // Neither the item row nor a caller-supplied path can choose another object.
  if (revision.resume_path !== `${base}/resume.docx` || revision.cover_letter_path !== `${base}/cover-letter.docx`) return null;
  return input.kind === "resume" ? revision.resume_path : revision.cover_letter_path;
}

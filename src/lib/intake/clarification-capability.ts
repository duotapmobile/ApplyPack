import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { hashDraftSecret, parseDraftCapability, serializeDraftCapability, type DraftCapability } from "@/lib/security/draft-capability";

const lineageSchema = z.object({ sourceDraftId: z.uuid(), successorDraftId: z.uuid().nullable() }).strict();

/** The lineage must come from an authenticated database read, never request JSON. */
export function clarificationSuccessorCapability(
  current: Pick<DraftCapability, "draftId" | "secret">,
  trustedLineage: z.infer<typeof lineageSchema>,
): DraftCapability {
  const lineage = lineageSchema.parse(trustedLineage);
  const capability = parseDraftCapability(serializeDraftCapability(current));
  if (!capability || lineage.sourceDraftId === lineage.successorDraftId) throw new Error("clarification_capability_invalid");
  if (lineage.successorDraftId === capability.draftId) {
    return { ...capability, secretHash: hashDraftSecret(capability.secret) };
  }
  if (lineage.sourceDraftId !== capability.draftId) throw new Error("clarification_capability_invalid");
  // The original secure cookie can recover an ambiguously committed answer.
  // Domain separation prevents reusing the original secret for the successor.
  const secret = createHmac("sha256", Buffer.from(capability.secret, "base64url"))
    .update(`applypack-material-clarification-capability-v1\u0000${lineage.sourceDraftId}`, "utf8")
    .digest("base64url");
  return { draftId: lineage.successorDraftId ?? randomUUID(), secret, secretHash: hashDraftSecret(secret) };
}

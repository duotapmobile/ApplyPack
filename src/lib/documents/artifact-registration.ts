import "server-only";

import { z } from "zod";
import type { Database } from "@/lib/database.types";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
type GeneratedArguments = Database["public"]["Functions"]["ap_register_material_artifact_version"]["Args"];
// PostgreSQL's generated function signature does not describe argument nullability.
// The SQL contract uses NULL specifically for the original resume/letter pair.
export type ArtifactRegistrationInput = Omit<GeneratedArguments, "p_reference_regeneration_id"> & {
  p_reference_regeneration_id: string | null;
};

const receiptSchema = z.object({
  artifactId: z.uuid(),
  fileVersionId: z.uuid(),
  version: z.number().int().positive(),
  automatedPassed: z.boolean(),
}).strict();

/** The transaction clears pre-upload cleanup intents when registration commits.
 * A missing response does not establish rollback. Leave those intents alone:
 * committed files stay referenced, and unregistered uploads remain available to
 * guarded cleanup. Never retry this version-creating RPC or delete its files
 * merely because the transport, database response or receipt is uncertain. */
export async function registerMaterialArtifact(
  admin: Pick<AdminClient, "rpc">,
  input: ArtifactRegistrationInput,
) {
  try {
    const result = await admin.rpc("ap_register_material_artifact_version", input);
    if (result.error) throw new Error("unconfirmed");
    const receipt = receiptSchema.safeParse(result.data);
    if (!receipt.success || receipt.data.artifactId !== input.p_artifact_id
      || receipt.data.fileVersionId !== input.p_file_version_id) throw new Error("unconfirmed");
    return receipt.data;
  } catch {
    throw new Error("material_registration_outcome_unconfirmed");
  }
}

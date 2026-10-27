import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { hashDraftSecret, type DraftCapability } from "@/lib/security/draft-capability";
import { verifiedIntakeSummarySchema, type VerifiedIntakeSummary } from "./verified-intake-contract";

export type VerifiedIntakeIdentity = { customerId: string; verifiedEmail: string };
type Admin = SupabaseClient<Database>;
const ownedMetadataSchema = verifiedIntakeSummarySchema.extend({ claimed: z.literal(true), replayed: z.boolean() }).strict();
const ownedListSchema = z.array(ownedMetadataSchema.omit({ replayed: true })).max(20)
  .refine(items => new Set(items.map(item => item.rootDraftId)).size === items.length);

export function ownedIntakeMetadata(value: unknown, identity: VerifiedIntakeIdentity, allowCheckout = false, now = Date.now()) {
  const parsed = ownedMetadataSchema.parse(value);
  if (parsed.verifiedEmail !== identity.verifiedEmail || parsed.accessEmail !== parsed.accessEmail.trim().normalize("NFC").toLocaleLowerCase("en-US")
    || Date.parse(parsed.expiresAt) <= now || (!allowCheckout && parsed.state === "LOCKED_TO_CHECKOUT")) throw new Error("owned_intake_unavailable");
  const summary = verifiedIntakeSummarySchema.parse({ rootDraftId: parsed.rootDraftId, draftId: parsed.draftId, state: parsed.state,
    version: parsed.version, capabilityVersion: parsed.capabilityVersion, expiresAt: parsed.expiresAt, createdAt: parsed.createdAt,
    updatedAt: parsed.updatedAt, accessEmail: parsed.accessEmail, verifiedEmail: parsed.verifiedEmail,
    questionPending: parsed.questionPending, reviewRequired: parsed.reviewRequired });
  return { summary, replayed: parsed.replayed };
}

export function ownedIntakeList(value: unknown, identity: VerifiedIntakeIdentity, now = Date.now()): VerifiedIntakeSummary[] {
  return ownedListSchema.parse(value).map(item => ownedIntakeMetadata({ ...item, replayed: false }, identity, false, now).summary);
}

export async function verifiedIntakeIdentity(): Promise<VerifiedIntakeIdentity | null> {
  const client = await createSupabaseServerClient();
  if (!client) return null;
  const { data, error } = await client.auth.getUser();
  const user = data.user;
  if (error || !user || user.is_anonymous || !user.email_confirmed_at || !z.uuid().safeParse(user.id).success) return null;
  const email = z.email().max(320).safeParse(user.email?.trim().normalize("NFC").toLocaleLowerCase("en-US"));
  return email.success ? { customerId: user.id, verifiedEmail: email.data } : null;
}

export async function readOwnedIntakeContext(admin: Admin, identity: VerifiedIntakeIdentity, capability: Pick<DraftCapability, "draftId" | "secret">) {
  const result = await admin.rpc("ap_owned_intake_draft_context", { p_customer_id: identity.customerId,
    p_draft_id: capability.draftId, p_secret_hash: hashDraftSecret(capability.secret) }).abortSignal(AbortSignal.timeout(10_000));
  if (result.error?.message === "owned_intake_unavailable") return null;
  if (result.error) throw new Error("owned_intake_unavailable");
  const { summary } = ownedIntakeMetadata(result.data, identity, true);
  if (summary.draftId !== capability.draftId) throw new Error("owned_intake_unavailable");
  return summary;
}

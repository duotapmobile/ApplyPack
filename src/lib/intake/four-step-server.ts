import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { emptyFourStepDraft, fourStepDraftSchema, type FourStepDraft, type IntakeDocument, type FactSuggestion } from "./four-step";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

export function parseStoredFourStepDraft(value: unknown): FourStepDraft {
  const merged = { ...emptyFourStepDraft, ...(value && typeof value === "object" ? value : {}) };
  const parsed = fourStepDraftSchema.safeParse(merged);
  if (!parsed.success) throw new Error("stored_four_step_draft_invalid");
  return parsed.data;
}

export async function fourStepPrivateState(admin: AdminClient, draftId: string) {
  const [documentsResult, factsResult, presentationsResult] = await Promise.all([
    admin.from("ap_document_versions")
      .select("id,version,kind,safe_display_name,size_bytes,verified_mime_type,processing_state,failure_code")
      .eq("draft_id", draftId).eq("is_current", true),
    admin.from("ap_candidate_facts")
      .select("id,semantic_key,fact_tier,verification,document_version_id,source_locator,customer_display_label,customer_display_value")
      .eq("draft_id", draftId).is("superseded_at", null),
    admin.from("ap_fact_presentations").select("fact_id").eq("draft_id", draftId),
  ]);
  if (documentsResult.error || factsResult.error || presentationsResult.error) throw new Error("four_step_state_unavailable");
  const documents = (documentsResult.data || []).map((row: Record<string, unknown>): IntakeDocument => ({
    id: String(row.id), version: Number(row.version), kind: row.kind as IntakeDocument["kind"],
    name: String(row.safe_display_name), size: Number(row.size_bytes), mimeType: String(row.verified_mime_type),
    processingState: row.processing_state as IntakeDocument["processingState"], failureCode: row.failure_code ? String(row.failure_code) : null,
  }));
  const facts = (factsResult.data || []).flatMap((row: Record<string, unknown>): FactSuggestion[] => {
    if (!row.customer_display_label || !row.customer_display_value || !row.document_version_id) return [];
    const value = row.customer_display_value as Record<string, unknown>;
    const displayValue = typeof value.summary === "string" ? value.summary : null;
    if (!displayValue) return [];
    return [{ id: String(row.id), semanticKey: String(row.semantic_key), displayLabel: String(row.customer_display_label),
      displayValue, tier: row.fact_tier as FactSuggestion["tier"], verification: row.verification as FactSuggestion["verification"],
      documentVersionId: String(row.document_version_id), sourceLocator: String(row.source_locator) }];
  });
  return { documents, facts, presentedFactIds: (presentationsResult.data || []).map((row: Record<string, unknown>) => String(row.fact_id)) };
}

export function publicFourStepDraft(row: Record<string, unknown>, privateState?: Awaited<ReturnType<typeof fourStepPrivateState>>) {
  return {
    id: row.id, version: row.version, state: row.state, currentStep: row.current_step,
    answers: parseStoredFourStepDraft(row.answers), expiresAt: row.expires_at,
    finalizedSnapshotId: row.finalized_snapshot_id ?? null,
    documents: privateState?.documents ?? [], facts: privateState?.facts ?? [], presentedFactIds: privateState?.presentedFactIds ?? [],
  };
}

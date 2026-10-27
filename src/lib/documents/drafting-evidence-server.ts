import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { z } from "zod";
import { loadDraftReferenceMetadata } from "./draft-owner-references";
import { materialRuleEvidenceProjectionSchema, materialRuleProjectionForPacket } from "./material-rule-evidence";
import { buildDraftingEvidencePacket, draftingEvidenceExpectationSchema, DraftingEvidenceError,
  type DraftingEvidenceExpectation, type DraftingEvidencePacket } from "./drafting-evidence";

type Admin = SupabaseClient<Database>;
type Options = { now?: () => Date; signal?: AbortSignal };
const FACT_COLUMNS = "id,snapshot_id,customer_id,draft_id,semantic_key,value_kind,typed_value,source_kind,document_version_id,customer_assertion_snapshot_id,assertion_control_id,source_locator,verification,confirmed_or_corrected_at,superseded_at,supersedes_fact_id,schema_version,catalog_version,starts_on,ends_on,calendar_duration_days,intensity_percent,capability_status,customer_display_label" as const;
function fail(code: string): never { throw new DraftingEvidenceError(code); }
const managedJobSchema = z.object({ id: z.uuid(), customer_id: z.uuid(), material_line_id: z.uuid(), line_revision_id: z.uuid(),
  source_snapshot_id: z.uuid(), active_version_id: z.uuid().nullable(), lease_generation: z.number().int().nonnegative() }).strict();
const contextSchema = z.string().regex(/^[a-f0-9]{64}$/);

async function readRecords(admin: Admin, expected: DraftingEvidenceExpectation, signal: AbortSignal, now: () => Date) {
  async function result<T>(query: PromiseLike<{ data: T; error: unknown }>): Promise<NonNullable<T>> {
    if (signal.aborted) fail("READ_ABORTED");
    const answer = await query;
    if (signal.aborted) fail("READ_ABORTED");
    if (answer.error || answer.data === null || answer.data === undefined) fail("SOURCE_UNAVAILABLE");
    return answer.data;
  }
  const line = await result(admin.from("ap_material_lines")
    .select("id,purchase_id,payment_attempt_id,delivered_order_id,delivered_match_id,active_revision,allocated_amount_cents,fulfillment,materials_payment_verified_at,materials_started_at,materials_due_at,selected_reference_sheet")
    .eq("id", expected.materialLineId).abortSignal(signal).single());
  const readManagedJob = async () => {
    const parsed = managedJobSchema.safeParse(await result(admin.from("ap_material_draft_jobs")
      .select("id,customer_id,material_line_id,line_revision_id,source_snapshot_id,active_version_id,lease_generation")
      .eq("customer_id", expected.customerId).eq("material_line_id", expected.materialLineId).eq("line_revision_id", expected.revisionId).abortSignal(signal).single()));
    if (!parsed.success || parsed.data.customer_id !== expected.customerId || parsed.data.material_line_id !== expected.materialLineId
      || parsed.data.line_revision_id !== expected.revisionId) fail("DRAFT_JOB_BINDING_INVALID");
    return parsed.data;
  };
  const draftJob = await readManagedJob();
  const readContext = async () => {
    const parsed = contextSchema.safeParse(await result(admin.rpc("ap_material_draft_context_sha256", { p_job_id: draftJob.id }).abortSignal(signal)));
    if (!parsed.success) fail("DRAFT_CONTEXT_INVALID"); return parsed.data;
  };
  const initialContext = await readContext();
  const [purchase, payment, revision, item, refunds] = await Promise.all([
    result(admin.from("ap_material_purchases").select("id,customer_id,checkout_intent_id,payment_attempt_id,amount_cents,currency,completed_at").eq("id", line.purchase_id).abortSignal(signal).single()),
    result(admin.from("ap_payment_attempts").select("id,customer_id,amount_cents,currency,settlement,payment_verified_at,immediate_charge_verified,dispute,funds_reversed_at").eq("id", line.payment_attempt_id).abortSignal(signal).single()),
    result(admin.from("ap_material_line_revisions").select("id,line_id,version,binding_sha256,source_snapshot_id,job_snapshot_id,employer_rule_snapshot_id,revision_kind,parent_revision_id,accepted_at,started_at,due_at,superseded_at,reference_scope")
      .eq("id", expected.revisionId).eq("line_id", line.id).eq("version", expected.revisionVersion).abortSignal(signal).single()),
    result(admin.from("ap_material_checkout_items").select("id,checkout_intent_id,material_line_id,delivered_match_id,job_snapshot_id,submission_rule_id,emphasis_note,do_not_mention_note").eq("material_line_id", line.id).abortSignal(signal).single()),
    result(admin.from("ap_refund_operations").select("id").eq("material_line_id", line.id).is("superseded_at", null).limit(1).abortSignal(signal)),
  ]);
  if (!purchase.checkout_intent_id || !revision.source_snapshot_id || !revision.job_snapshot_id || !revision.employer_rule_snapshot_id) fail("SOURCE_BINDING_INVALID");
  if (draftJob.source_snapshot_id !== revision.source_snapshot_id) fail("DRAFT_JOB_BINDING_INVALID");
  const [snapshot, intent, job, rule, listingCheck, successors, ownsSnapshot] = await Promise.all([
    result(admin.from("ap_intake_snapshots").select("id,customer_id,draft_id,schema_version,canonicalization_version,content_sha256,sensitive_payload_id,finalized_at,confirmed_review,parent_snapshot_id").eq("id", revision.source_snapshot_id).abortSignal(signal).single()),
    result(admin.from("ap_material_checkout_intents").select("id,customer_id,purchase_id,payment_attempt_id,delivered_order_id,delivered_release_id,source_snapshot_id,state,line_count,amount_cents,currency,selection_sha256,document_contact_confirmed,document_facts_confirmed,contact_payload_id,career_break_choice,career_break_custom_label,cover_letter_break_consent").eq("id", purchase.checkout_intent_id).abortSignal(signal).single()),
    result(admin.from("ap_job_snapshots").select("id,legacy_job_id,content_sha256,company,exact_title,canonical_application_url,source_url,captured_listing,retrieved_at,live_verified_at,discovery_source,external_job_id,source_run_id,source_authorization_id,listing_activity_result,application_path_result,legitimacy_result").eq("id", revision.job_snapshot_id).abortSignal(signal).single()),
    result(admin.from("ap_employer_submission_rules").select("id,job_snapshot_id,content_sha256,checked_at,human_confirmed_at,human_confirmed_by,is_current,superseded_at,injection_scan_state,hard_block_reason,allowed_formats,resume_page_limit,cover_letter_page_limit,resume_requirement,cover_letter_requirement,resume_filename_instruction,cover_letter_filename_instruction,reference_timing,reference_count,source_evidence_ids,application_questions").eq("id", revision.employer_rule_snapshot_id).abortSignal(signal).single()),
    result(admin.from("ap_material_listing_checks").select("id,material_line_id,line_revision_id,job_snapshot_id,submission_rule_id,evidence_sha256,phase,result,checked_at")
      .eq("material_line_id", line.id).eq("line_revision_id", revision.id).eq("phase", "BEFORE_GENERATION").order("checked_at", { ascending: false }).order("id", { ascending: false }).limit(1).abortSignal(signal).single()),
    result(admin.from("ap_job_snapshots").select("id").eq("supersedes_job_snapshot_id", revision.job_snapshot_id).limit(1).abortSignal(signal)),
    result(admin.rpc("ap_customer_owns_snapshot", { p_customer_id: expected.customerId, p_snapshot_id: revision.source_snapshot_id }).abortSignal(signal)),
  ]);
  if (snapshot.schema_version !== "applypack-intake-v4" || !snapshot.confirmed_review) fail("LEGACY_INTAKE_UNSUPPORTED");
  if (!snapshot.draft_id || !snapshot.sensitive_payload_id || !job.legacy_job_id) fail("SOURCE_BINDING_INVALID");
  if (rule.source_evidence_ids.length > 100) fail("TOO_LARGE");
  const capture = job.captured_listing && typeof job.captured_listing === "object" && !Array.isArray(job.captured_listing)
    && "applicationQuestionObservation" in job.captured_listing;
  const questionSourceAuthority = capture && job.source_run_id && job.source_authorization_id ? await (async () => {
    const [run, authorization, head] = await Promise.all([
      result(admin.from("job_source_runs").select("id,source_id,adapter_version,source_authorization_id,authorization_head_revision,scope_sha256,status,enumeration_status").eq("id", job.source_run_id!).abortSignal(signal).single()),
      result(admin.from("ap_source_authorizations").select("id,source_id,authorization_version,allowed_actions,state").eq("id", job.source_authorization_id!).abortSignal(signal).single()),
      result(admin.from("ap_source_authorization_heads").select("source_id,current_authorization_id,revision").eq("source_id", job.discovery_source).abortSignal(signal).single()),
    ]);
    return { run, authorization, head };
  })() : null;
  const [draft, sourcePayload, contact, contactFact, facts, documents, factReviews, requirements, reviews, questionSourceNodes, verified, originalReferences] = await Promise.all([
    result(admin.from("ap_anonymous_drafts").select("id,converted_customer_id,finalized_snapshot_id,version,confirmation_receipt,answers,retention_state").eq("id", snapshot.draft_id).abortSignal(signal).single()),
    result(admin.from("ap_sensitive_payloads").select("id,customer_id,draft_id,content_sha256,retention_state").eq("id", snapshot.sensitive_payload_id).abortSignal(signal).single()),
    result(admin.from("ap_sensitive_payloads").select("id,customer_id,content_sha256,retention_state").eq("id", intent.contact_payload_id).abortSignal(signal).single()),
    result(admin.from("ap_candidate_facts").select("id,snapshot_id,customer_id,semantic_key,value_kind,typed_value,source_kind,customer_assertion_snapshot_id,assertion_control_id,source_locator,verification,confirmed_or_corrected_at,superseded_at,catalog_version,schema_version")
      .eq("id", intent.contact_payload_id).abortSignal(signal).single()),
    result(admin.from("ap_candidate_facts").select(FACT_COLUMNS).eq("snapshot_id", snapshot.id).neq("semantic_key", "document_contact.confirmed").is("superseded_at", null).limit(501).abortSignal(signal)),
    result(admin.rpc("ap_effective_intake_documents", { p_draft_id: snapshot.draft_id }).select("id,draft_id,customer_id,kind,version,content_sha256:sha256,retention_state").limit(101).abortSignal(signal)),
    result(admin.from("ap_fact_review_history").select("id,draft_id,snapshot_id,fact_id,correction_fact_id,decision,reviewed_at").eq("snapshot_id", snapshot.id).limit(501).abortSignal(signal)),
    result(admin.from("ap_requirement_nodes").select("id,job_snapshot_id,node_kind,stable_criterion_id,source_excerpt,source_locator,requirement_strength,typed_value,position").eq("job_snapshot_id", job.id).eq("node_kind", "CRITERION").limit(201).abortSignal(signal)),
    result(admin.from("ap_human_review_records").select("id,snapshot_id,customer_id,job_snapshot_id,review_kind,reviewer_id,created_at,invalidated_at,rationale,decision")
      .eq("snapshot_id", snapshot.id).eq("job_snapshot_id", job.id).in("review_kind", ["MATCH_EVIDENCE", "ADJACENT_EQUIVALENCE"]).is("invalidated_at", null).limit(401).abortSignal(signal)),
    result(admin.from("ap_requirement_nodes").select("id,job_snapshot_id,source_excerpt").in("id", rule.source_evidence_ids).eq("job_snapshot_id", job.id).limit(101).abortSignal(signal)),
    result(admin.rpc("ap_current_verified_job_snapshots", { p_job_ids: [job.legacy_job_id] }).abortSignal(signal)),
    result(admin.from("ap_material_checkout_references").select("reference_permission_id").eq("checkout_item_id", item.id).limit(21).abortSignal(signal)),
  ]);
  if (factReviews.length > 500 || documents.length > 100) fail("TOO_LARGE");
  const lineageResult = await admin.rpc("ap_intake_source_lineage", { p_draft_id: snapshot.draft_id }).abortSignal(signal);
  if (lineageResult.error || signal.aborted) fail("SOURCE_UNAVAILABLE");
  const lineageEvidence = lineageResult.data === null ? {} : { sourceLineage: lineageResult.data };
  const { parent_snapshot_id: parentSnapshotId, ...ordinarySnapshot } = snapshot;
  // Other historical revision kinds also use parent_snapshot_id. Preserve their
  // existing packet shape; only authenticated clarification lineage adds it.
  const confirmedSnapshot = lineageResult.data !== null && parentSnapshotId
    ? { ...ordinarySnapshot, parent_snapshot_id: parentSnapshotId } : ordinarySnapshot;
  // Replaced uploads can leave earlier extraction rows on the same draft. Only the
  // source IDs in this snapshot's immutable review history belong to its packet.
  const sourceFacts = factReviews.length ? await result(admin.from("ap_candidate_facts").select(FACT_COLUMNS)
    .in("id", factReviews.map((review) => review.fact_id)).eq("draft_id", snapshot.draft_id).is("snapshot_id", null).limit(501).abortSignal(signal)) : [];
  let referencePermissionIds = originalReferences.map((link) => link.reference_permission_id);
  if (revision.reference_scope !== null) {
    const scope = revision.reference_scope;
    if (!scope || typeof scope !== "object" || Array.isArray(scope) || Object.keys(scope).some((key) => !["selected", "permissionIds"].includes(key)) ||
      scope.selected !== line.selected_reference_sheet || !Array.isArray(scope.permissionIds) || scope.permissionIds.some((id) => typeof id !== "string")) fail("REFERENCE_SCOPE_INVALID");
    referencePermissionIds = scope.permissionIds as string[];
  }
  if (referencePermissionIds.length > 20) fail("REFERENCE_SCOPE_INVALID");
  const referencePermissions = referencePermissionIds.length ? await result(admin.from("ap_reference_permissions")
    .select("id,customer_id,delivered_release_id,job_snapshot_id,job_snapshot_hash,reference_record_version_id,revoked_at,contact_version_changed_at")
    .in("id", referencePermissionIds).limit(21).abortSignal(signal)) : [];
  const referenceEvidence = referencePermissionIds.length ? await (async () => {
    const [referenceMetadata, filenameRule] = await Promise.all([
      loadDraftReferenceMetadata(admin, referencePermissionIds, signal),
      result(admin.from("ap_employer_submission_rules").select("id,content_sha256,reference_filename_instruction")
        .eq("id", rule.id).abortSignal(signal).single()),
    ]);
    if (filenameRule.id !== rule.id || filenameRule.content_sha256 !== rule.content_sha256) fail("READ_CHANGED");
    return { referenceMetadata, referenceFilenameInstruction: filenameRule.reference_filename_instruction };
  })() : {};
  // Only the service092 projection can establish rule revalidation. It is read
  // between current-context checks, never reconstructed from browser evidence.
  const rawRuleEvidence = await result(admin.rpc("ap_material_draft_rule_evidence", { p_job_id: draftJob.id }).abortSignal(signal));
  const projection = materialRuleEvidenceProjectionSchema.safeParse(rawRuleEvidence);
  if (!projection.success || projection.data.activeVersionId !== draftJob.active_version_id || projection.data.leaseGeneration !== draftJob.lease_generation) fail("READ_CHANGED");
  const ruleEvidence = materialRuleProjectionForPacket(projection.data, {
    jobId: draftJob.id, customerId: expected.customerId, materialLineId: line.id, lineRevisionId: revision.id,
    sourceSnapshotId: snapshot.id, jobSnapshotId: job.id, jobContentSha256: job.content_sha256,
    ruleId: rule.id, ruleSha256: rule.content_sha256, originalCheckedAt: rule.checked_at,
  }, now());
  if (await readContext() !== initialContext || JSON.stringify(await readManagedJob()) !== JSON.stringify(draftJob)) fail("READ_CHANGED");
  return { contextSha256: initialContext, jobFence: draftJob, records: { line, purchase, payment, revision, snapshot: confirmedSnapshot, draft, sourcePayload, intent, contact, contactFact, item, job, rule, listingCheck,
    draftJobId: draftJob.id, ruleEvidence,
    ...referenceEvidence, ...lineageEvidence,
    facts, sourceFacts, documents, factReviews, requirements, reviews, questionSourceNodes, questionSourceAuthority, referencePermissions, referencePermissionIds,
    ownsSnapshot, verifiedJobSnapshotIds: verified.map((row) => row.id), successorJobIds: successors.map((row) => row.id), refundIds: refunds.map((row) => row.id) } };
}

/** The caller supplies an authenticated, service-only DB client and identifiers from its
 * durable job claim, never from a customer request. A second read detects read races;
 * it is not a lock. Commit requires a DB CAS over revision, packet hash and worker fence. */
export async function loadDraftingEvidencePacket(admin: Admin, expected: DraftingEvidenceExpectation, options: Options = {}): Promise<DraftingEvidencePacket> {
  const parsed = draftingEvidenceExpectationSchema.safeParse(expected);
  if (!parsed.success) fail("EXPECTATION_INVALID");
  const expectation = parsed.data;
  if (options.signal?.aborted) fail("READ_ABORTED");
  const controller = new AbortController();
  const abort = () => controller.abort();
  const interrupted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(new DraftingEvidenceError("READ_ABORTED")), { once: true });
  });
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(abort, 20_000);
  try {
    return await Promise.race([interrupted, (async () => {
      const now = options.now ?? (() => new Date());
      const firstRead = await readRecords(admin, expectation, controller.signal, now);
      const first = buildDraftingEvidencePacket(firstRead.records, expectation, now());
      const secondRead = await readRecords(admin, expectation, controller.signal, now);
      const second = buildDraftingEvidencePacket(secondRead.records, expectation, now());
      if (controller.signal.aborted) fail("READ_ABORTED");
      if (first.packetSha256 !== second.packetSha256 || firstRead.contextSha256 !== secondRead.contextSha256
        || JSON.stringify(firstRead.jobFence) !== JSON.stringify(secondRead.jobFence)) fail("READ_CHANGED");
      return second;
    })()]);
  } catch (error) {
    if (error instanceof DraftingEvidenceError) throw error;
    throw new DraftingEvidenceError("SOURCE_UNAVAILABLE");
  } finally { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); }
}

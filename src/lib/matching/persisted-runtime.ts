import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { canonicalSha256 } from "@/lib/domain/foundation";
import { SELECTOR_VERSION, baseRankWithExplanations, selectWithBoundedDiversity, type RankCandidate } from "@/lib/matching/evaluation-engine";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;
type SourceAuthorization = { id: string; source_id: string; state: string; access_method: string; authorization_version: string; created_at: string };
type CandidateFactRow = {
  id: string;
  semantic_key: string;
  value_kind: string;
  verification: string;
  source_kind: string;
  supplied_source_id: string | null;
  superseded_at: string | null;
  customer_display_label: string | null;
  customer_display_value: unknown;
};

type JobSnapshotRow = {
  id: string;
  legacy_job_id: string | null;
  company: string;
  exact_title: string;
  discovery_source: string;
  canonical_application_url: string;
  canonical_employer_domain: string | null;
  normalized_fingerprint: string;
  posted_on: string | null;
  first_seen_at: string | null;
  live_verified_at: string;
  listing_activity_result: string | null;
  application_path_result: string | null;
  legitimacy_result: string | null;
  source_authorization_id: string | null;
  source_authorization: SourceAuthorization | null;
  current_source_authorization: SourceAuthorization | null;
};

export type PersistedSelection = {
  baseRank: number;
  selectedRank: number | null;
  rankExplanation: Record<string, unknown>;
  selectorExplanation: Record<string, unknown>;
  runId?: string;
};

export type PersistedMatchEvaluation = {
  id: string;
  snapshot_id: string;
  job_snapshot_id: string;
  eligibility: string;
  categorical_evidence_sufficient: boolean;
  fit_score: number | null;
  evidence_confidence: number | null;
  preference_alignment: number | null;
  confidence_label: "HIGH" | "MEDIUM" | "LOW" | null;
  salary_status: string;
  salary_disposition: string;
  usefulness_result: string | null;
  application_readiness: string;
  candidate_fact_ids: string[];
  root_results: unknown;
  leaf_results: unknown;
  satisfaction_paths: unknown;
  job_evidence: unknown;
  explanation_evidence: unknown;
  warnings: unknown;
  candidate_facts: CandidateFactRow[];
  job_snapshot: JobSnapshotRow;
  selection?: PersistedSelection;
};

function one<T>(value: T | T[]): T {
  return Array.isArray(value) ? value[0] : value;
}

function isCurrentAuthorization(job: JobSnapshotRow) {
  const linked = job.source_authorization;
  const current = job.current_source_authorization;
  return Boolean(linked && current && linked.id === current.id && ["AUTHORIZED_AUTOMATED", "AUTHORIZED_MANUAL_ONLY"].includes(current.state));
}

function activeCandidateFacts(row: PersistedMatchEvaluation) {
  return row.candidate_facts.length === row.candidate_fact_ids.length && row.candidate_facts.every((fact) => fact.superseded_at == null
    && (fact.verification === "CUSTOMER_CONFIRMED" || (fact.verification === "HUMAN_VERIFIED" && fact.source_kind === "HUMAN_VERIFICATION" && Boolean(fact.supplied_source_id))));
}

export function isPersistedEvaluationDeliverable(row: PersistedMatchEvaluation) {
  return ["ELIGIBLE", "ELIGIBLE_WITH_ALLOWED_UNKNOWNS"].includes(row.eligibility)
    && row.categorical_evidence_sufficient
    && row.usefulness_result === "PASS"
    && row.fit_score != null
    && Number.isFinite(row.fit_score)
    && row.evidence_confidence != null
    && Number.isFinite(row.evidence_confidence)
    && row.confidence_label != null
    && row.salary_disposition !== "FAIL"
    && row.application_readiness !== "BLOCKED"
    && row.job_snapshot.listing_activity_result === "PASS"
    && row.job_snapshot.application_path_result === "PASS"
    && row.job_snapshot.legitimacy_result === "PASS"
    && isCurrentAuthorization(row.job_snapshot)
    && activeCandidateFacts(row)
    && Boolean(row.job_snapshot.legacy_job_id);
}

function rankInput(row: PersistedMatchEvaluation): RankCandidate {
  return {
    jobId: row.job_snapshot_id,
    employerId: row.job_snapshot.canonical_employer_domain || row.job_snapshot.normalized_fingerprint,
    titleFamily: row.job_snapshot.exact_title.trim().toLocaleLowerCase("en-US"),
    discoverySourceId: row.job_snapshot.discovery_source,
    fit: row.fit_score ?? 0,
    preference: row.preference_alignment,
    confidence: row.evidence_confidence ?? 0,
    confidenceLabel: row.confidence_label ?? "LOW",
    postedOn: row.job_snapshot.posted_on,
    firstSeenAt: row.job_snapshot.first_seen_at || row.job_snapshot.live_verified_at,
    eligible: isPersistedEvaluationDeliverable(row),
    evidenceSufficient: row.categorical_evidence_sufficient && row.usefulness_result === "PASS",
  };
}

export async function loadPersistedEvaluationsForSnapshot(admin: AdminClient, snapshotId: string, limit = 500) {
  const { data, error } = await admin.from("ap_match_evaluations").select(
    "id,snapshot_id,job_snapshot_id,eligibility,categorical_evidence_sufficient,fit_score,evidence_confidence,preference_alignment,confidence_label,salary_status,salary_disposition,usefulness_result,application_readiness,candidate_fact_ids,root_results,leaf_results,satisfaction_paths,job_evidence,explanation_evidence,warnings,job_snapshot:ap_job_snapshots!inner(id,legacy_job_id,company,exact_title,discovery_source,canonical_application_url,canonical_employer_domain,normalized_fingerprint,posted_on,first_seen_at,live_verified_at,listing_activity_result,application_path_result,legitimacy_result,source_authorization_id,source_authorization:ap_source_authorizations(id,source_id,state,access_method,authorization_version,created_at))",
  ).eq("snapshot_id", snapshotId).eq("legacy_compatibility", false).is("invalidated_at", null).limit(limit);
  if (error) throw error;
  const records = (data || []).map((record) => ({ ...record, job_snapshot: { ...one(record.job_snapshot), source_authorization: one(one(record.job_snapshot).source_authorization) } }));
  const sourceIds = [...new Set(records.map((record) => record.job_snapshot.source_authorization?.source_id).filter((id): id is string => Boolean(id)))];
  const factIds = [...new Set(records.flatMap((record) => record.candidate_fact_ids as string[]))];
  const [{ data: authorizations, error: authorizationError }, { data: facts, error: factError }] = await Promise.all([
    sourceIds.length ? admin.from("ap_source_authorizations").select("id,source_id,state,access_method,authorization_version,created_at").in("source_id", sourceIds).order("created_at", { ascending: false }).order("authorization_version", { ascending: false }) : Promise.resolve({ data: [] as SourceAuthorization[], error: null }),
    factIds.length ? admin.from("ap_candidate_facts").select("id,semantic_key,value_kind,verification,source_kind,supplied_source_id,superseded_at,customer_display_label,customer_display_value").in("id", factIds) : Promise.resolve({ data: [] as CandidateFactRow[], error: null }),
  ]);
  if (authorizationError || factError) throw authorizationError || factError;
  const currentBySource = new Map<string, SourceAuthorization>();
  for (const authorization of authorizations || []) if (!currentBySource.has(authorization.source_id)) currentBySource.set(authorization.source_id, authorization);
  const factById = new Map((facts || []).map((fact) => [fact.id, fact]));
  return records.map((record) => ({
    ...record,
    candidate_facts: (record.candidate_fact_ids as string[]).map((id: string) => factById.get(id)).filter((fact: CandidateFactRow | undefined): fact is CandidateFactRow => Boolean(fact)),
    job_snapshot: {
      ...record.job_snapshot,
      current_source_authorization: record.job_snapshot.source_authorization ? currentBySource.get(record.job_snapshot.source_authorization.source_id) ?? null : null,
    },
  })) as unknown as PersistedMatchEvaluation[];
}

export async function loadPersistedEvaluationsForOrder(admin: AdminClient, orderId: string, limit = 500) {
  const { data: service, error } = await admin.from("ap_search_services").select("active_snapshot_id").eq("legacy_order_id", orderId).maybeSingle();
  if (error) throw error;
  if (!service?.active_snapshot_id) throw new Error("active_criteria_snapshot_required");
  return loadPersistedEvaluationsForSnapshot(admin, service.active_snapshot_id, limit);
}

export function selectPersistedEvaluations(rows: readonly PersistedMatchEvaluation[], count: number) {
  const deliverable = rows.filter(isPersistedEvaluationDeliverable);
  const inputs = deliverable.map(rankInput);
  const base = baseRankWithExplanations(inputs);
  const selection = selectWithBoundedDiversity(inputs, count);
  const selectedRank = new Map(selection.selected.map((candidate, index) => [candidate.jobId, index + 1]));
  const displacementByAnchor = new Map(selection.displacements.map((item) => [item.anchorId, item]));
  const displacementBySelected = new Map(selection.displacements.map((item) => [item.selectedId, item]));
  const rowByJob = new Map(deliverable.map((row) => [row.job_snapshot_id, row]));
  const rankedRows: Array<PersistedMatchEvaluation & { selection: PersistedSelection }> = base.map(({ candidate, baseRank, explanation }) => {
    const displacement = displacementByAnchor.get(candidate.jobId) ?? displacementBySelected.get(candidate.jobId);
    const selectionState = selectedRank.has(candidate.jobId) ? displacementBySelected.has(candidate.jobId) ? "DIVERSITY_SELECTED" : "BASE_RANK_RETAINED" : displacementByAnchor.has(candidate.jobId) ? "DIVERSITY_DISPLACED" : "NOT_SELECTED";
    return {
      ...rowByJob.get(candidate.jobId)!,
      selection: {
        baseRank,
        selectedRank: selectedRank.get(candidate.jobId) ?? null,
        rankExplanation: explanation,
        selectorExplanation: { state: selectionState, displacement: displacement ?? null, selectorVersion: selection.version },
      },
    };
  });
  return {
    ranked: rankedRows,
    selected: rankedRows.filter((row) => row.selection.selectedRank != null).sort((a, b) => a.selection.selectedRank! - b.selection.selectedRank!),
    displacements: selection.displacements,
    version: selection.version,
  };
}

export async function selectAndPersistEvaluations(admin: AdminClient, rows: readonly PersistedMatchEvaluation[], count: number, purpose: "ADMIN_PREVIEW" | "SEARCH_WORKFLOW" | "RELEASE" | "CONFLICT_REPLACEMENT", scopeKey: string) {
  const selection = selectPersistedEvaluations(rows, count);
  if (!selection.ranked.length) return { ...selection, runId: null };
  const evaluationSetSha256 = canonicalSha256(selection.ranked.map((row) => ({ evaluationId: row.id, fit: row.fit_score, preference: row.preference_alignment, confidence: row.evidence_confidence })));
  const members = selection.ranked.map((row) => ({ evaluationId: row.id, baseRank: row.selection!.baseRank, selectedRank: row.selection!.selectedRank, rankExplanation: row.selection!.rankExplanation, selectorExplanation: row.selection!.selectorExplanation }));
  const contentSha256 = canonicalSha256({ snapshotId: selection.ranked[0].snapshot_id, purpose, scopeKey, count, selectorVersion: SELECTOR_VERSION, evaluationSetSha256, members });
  const { data: runId, error } = await admin.rpc("ap_persist_match_selection", {
    p_snapshot_id: selection.ranked[0].snapshot_id,
    p_purpose: purpose,
    p_scope_key: scopeKey,
    p_requested_count: count,
    p_selector_version: SELECTOR_VERSION,
    p_evaluation_set_sha256: evaluationSetSha256,
    p_content_sha256: contentSha256,
    p_members: members,
  });
  if (error || !runId) throw error || new Error("selection_run_not_persisted");
  for (const row of selection.ranked) row.selection = { ...row.selection!, runId };
  return { ...selection, runId };
}

export function persistedFitSummary(row: PersistedMatchEvaluation) {
  const confidence = row.confidence_label?.toLocaleLowerCase("en-US") ?? "unresolved";
  return `${row.job_snapshot.exact_title} at ${row.job_snapshot.company} passed the persisted eligibility and categorical-evidence gates with ${confidence} evidence confidence. Final human review remains required before release.`;
}

function warningStrings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((warning) => {
    if (typeof warning === "string") return warning;
    const item = warning && typeof warning === "object" ? warning as Record<string, unknown> : {};
    return String(item.messageKey || item.code || "Persisted evaluation warning");
  });
}

function evidenceRecords(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((evidence) => evidence && typeof evidence === "object" ? [evidence as Record<string, unknown>] : []);
}

function evidenceStrings(value: unknown, ids?: ReadonlySet<string>) {
  return evidenceRecords(value).filter((record) => !ids || ids.has(String(record.id))).map((record) => {
    const field = typeof record.field === "string" ? record.field : "listing evidence";
    const locator = typeof record.sourceLocator === "string" ? record.sourceLocator : typeof record.source_locator === "string" ? record.source_locator : "captured listing";
    return `${field}: ${locator}`;
  });
}

function candidateFactStrings(row: PersistedMatchEvaluation, ids?: ReadonlySet<string>) {
  return row.candidate_facts.filter((fact) => !ids || ids.has(fact.id)).map((fact) => {
    const label = fact.customer_display_label || fact.semantic_key;
    const value = fact.customer_display_value;
    const display = typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : value == null ? fact.value_kind : JSON.stringify(value);
    return `${label}: ${display}`;
  });
}

function section(row: PersistedMatchEvaluation, key: string) {
  const sections = row.explanation_evidence && typeof row.explanation_evidence === "object" && !Array.isArray(row.explanation_evidence) ? row.explanation_evidence as Record<string, unknown> : {};
  const value = sections[key] && typeof sections[key] === "object" && !Array.isArray(sections[key]) ? sections[key] as Record<string, unknown> : {};
  return {
    sourceIds: new Set(Array.isArray(value.sourceEvidenceNodeIds) ? value.sourceEvidenceNodeIds.map(String) : []),
    factIds: new Set(Array.isArray(value.candidateFactIds) ? value.candidateFactIds.map(String) : []),
  };
}

function allRootResultsPass(value: unknown) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => item && typeof item === "object" && ["PASS", "UNKNOWN"].includes(String((item as Record<string, unknown>).result)));
}

function criteriaAcceptable(value: unknown, criterionTypes: readonly string[]) {
  const relevant = evidenceRecords(value).filter((item) => criterionTypes.includes(String(item.criterionType)));
  return relevant.every((item) => item.result === "PASS" || item.result === "NOT_APPLICABLE" || item.result === "UNKNOWN" && item.unknownTreatment === "ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING");
}

export function searchCandidateRow(orderId: string, row: PersistedMatchEvaluation) {
  if (!row.selection?.runId || row.selection.selectedRank == null) throw new Error("persisted_selection_required");
  return {
    search_order_id: orderId,
    job_id: row.job_snapshot.legacy_job_id!,
    evaluation_id: row.id,
    ranking_score: Math.round(row.fit_score ?? 0),
    ranking_reason_codes: { selectionRunId: row.selection.runId, baseRank: row.selection.baseRank, selectedRank: row.selection.selectedRank, rank: row.selection.rankExplanation, selector: row.selection.selectorExplanation },
    fit_summary: persistedFitSummary(row),
    requirements: evidenceStrings(row.job_evidence),
    concerns: warningStrings(row.warnings),
  };
}

export function deliveryRow(row: PersistedMatchEvaluation, position: number) {
  if (!isPersistedEvaluationDeliverable(row)) throw new Error("persisted_evaluation_not_deliverable");
  if (!row.selection?.runId || row.selection.selectedRank == null) throw new Error("persisted_selection_required");
  const involves = section(row, "whatJobInvolves");
  const why = section(row, "whyMadeList");
  const experience = section(row, "howExperienceConnects");
  const newWork = section(row, "whatMayBeNew");
  const know = section(row, "whatToKnow");
  const matchingExperience = candidateFactStrings(row, experience.factIds);
  const coreResponsibilities = evidenceStrings(row.job_evidence, involves.sourceIds);
  const requirements = evidenceStrings(row.job_evidence, new Set([...why.sourceIds, ...experience.sourceIds]));
  if (!matchingExperience.length || !coreResponsibilities.length || !requirements.length) throw new Error("customer_explanation_evidence_required");
  const criteriaSatisfied = allRootResultsPass(row.root_results);
  return {
    job_id: row.job_snapshot.legacy_job_id!,
    position,
    fit_summary: persistedFitSummary(row),
    matching_experience: matchingExperience,
    primary_outcome: coreResponsibilities.join("; "),
    core_responsibilities: coreResponsibilities,
    requirements,
    hidden_job_functions: evidenceStrings(row.job_evidence, newWork.sourceIds),
    concerns: [...warningStrings(row.warnings), ...evidenceStrings(row.job_evidence, know.sourceIds)],
    criteria_checks: {
      dutiesAligned: coreResponsibilities.length > 0,
      experienceConfirmed: matchingExperience.length > 0 && criteriaAcceptable(row.leaf_results, ["EXPERIENCE", "RESPONSIBILITY", "TOOL_CAPABILITY"]),
      levelAcceptable: criteriaAcceptable(row.leaf_results, ["EXPERIENCE", "EDUCATION", "CERTIFICATION_LICENSE"]),
      scheduleAcceptable: criteriaAcceptable(row.leaf_results, ["SCHEDULE"]),
      locationAcceptable: criteriaAcceptable(row.leaf_results, ["GEOGRAPHY", "WORK_MODE"]),
      compensationAcceptable: ["PASS", "ALLOWED_WITH_WARNING", "NOT_APPLICABLE"].includes(row.salary_disposition),
      nonNegotiablesSatisfied: criteriaSatisfied,
    },
    ranking_score: Math.round(row.fit_score ?? 0),
    ranking_reason_codes: { selectionRunId: row.selection.runId, baseRank: row.selection.baseRank, selectedRank: row.selection.selectedRank, rank: row.selection.rankExplanation, selector: row.selection.selectorExplanation, evaluationId: row.id },
  };
}

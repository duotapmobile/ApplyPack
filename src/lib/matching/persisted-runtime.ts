import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { selectWithBoundedDiversity, type RankCandidate } from "@/lib/matching/evaluation-engine";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

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
  root_results: unknown;
  leaf_results: unknown;
  job_evidence: unknown;
  warnings: unknown;
  rank_explanation: unknown;
  selector_explanation: unknown;
  job_snapshot: JobSnapshotRow;
};

function one<T>(value: T | T[]): T {
  return Array.isArray(value) ? value[0] : value;
}

function isDeliverable(row: PersistedMatchEvaluation) {
  return ["ELIGIBLE", "ELIGIBLE_WITH_ALLOWED_UNKNOWNS"].includes(row.eligibility)
    && row.categorical_evidence_sufficient
    && row.usefulness_result === "PASS"
    && row.fit_score != null
    && row.evidence_confidence != null
    && row.confidence_label != null
    && row.salary_disposition !== "FAIL"
    && row.application_readiness !== "BLOCKED"
    && row.job_snapshot.listing_activity_result === "PASS"
    && row.job_snapshot.application_path_result === "PASS"
    && row.job_snapshot.legitimacy_result === "PASS"
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
    eligible: isDeliverable(row),
    evidenceSufficient: row.categorical_evidence_sufficient && row.usefulness_result === "PASS",
  };
}

export async function loadPersistedEvaluationsForSnapshot(admin: AdminClient, snapshotId: string, limit = 500) {
  const { data, error } = await admin.from("ap_match_evaluations").select(
    "id,snapshot_id,job_snapshot_id,eligibility,categorical_evidence_sufficient,fit_score,evidence_confidence,preference_alignment,confidence_label,salary_status,salary_disposition,usefulness_result,application_readiness,root_results,leaf_results,job_evidence,warnings,rank_explanation,selector_explanation,job_snapshot:ap_job_snapshots!inner(id,legacy_job_id,company,exact_title,discovery_source,canonical_application_url,canonical_employer_domain,normalized_fingerprint,posted_on,first_seen_at,live_verified_at,listing_activity_result,application_path_result,legitimacy_result)",
  ).eq("snapshot_id", snapshotId).eq("legacy_compatibility", false).is("invalidated_at", null).limit(limit);
  if (error) throw error;
  return (data || []).map((record) => ({ ...record, job_snapshot: one(record.job_snapshot) })) as unknown as PersistedMatchEvaluation[];
}

export async function loadPersistedEvaluationsForOrder(admin: AdminClient, orderId: string, limit = 500) {
  const { data: service, error } = await admin.from("ap_search_services").select("active_snapshot_id").eq("legacy_order_id", orderId).maybeSingle();
  if (error) throw error;
  if (!service?.active_snapshot_id) throw new Error("active_criteria_snapshot_required");
  return loadPersistedEvaluationsForSnapshot(admin, service.active_snapshot_id, limit);
}

export function selectPersistedEvaluations(rows: readonly PersistedMatchEvaluation[], count: number) {
  const bySnapshot = new Map(rows.map((row) => [row.job_snapshot_id, row]));
  const selection = selectWithBoundedDiversity(rows.map(rankInput), count);
  return {
    selected: selection.selected.map((item) => bySnapshot.get(item.jobId)!),
    displacements: selection.displacements,
    version: selection.version,
  };
}

export function persistedFitSummary(row: PersistedMatchEvaluation) {
  const confidence = row.confidence_label?.toLocaleLowerCase("en-US") ?? "unresolved";
  return `${row.job_snapshot.exact_title} at ${row.job_snapshot.company} passed the persisted eligibility and categorical-evidence gates with fit ${Math.round(row.fit_score ?? 0)} and ${confidence} evidence confidence. Final human review remains required before release.`;
}

function warningStrings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((warning) => {
    if (typeof warning === "string") return warning;
    if (warning && typeof warning === "object") {
      const record = warning as Record<string, unknown>;
      return String(record.messageKey || record.code || "Persisted evaluation warning");
    }
    return "Persisted evaluation warning";
  });
}

function evidenceStrings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((evidence) => {
    if (!evidence || typeof evidence !== "object") return null;
    const record = evidence as Record<string, unknown>;
    const field = typeof record.field === "string" ? record.field : "listing evidence";
    const locator = typeof record.sourceLocator === "string" ? record.sourceLocator : typeof record.source_locator === "string" ? record.source_locator : "captured listing";
    return `${field}: ${locator}`;
  }).filter((value): value is string => Boolean(value));
}

export function searchCandidateRow(orderId: string, row: PersistedMatchEvaluation, selectedRank: number) {
  return {
    search_order_id: orderId,
    job_id: row.job_snapshot.legacy_job_id!,
    evaluation_id: row.id,
    ranking_score: Math.round(row.fit_score ?? 0),
    ranking_reason_codes: { rank: row.rank_explanation, selector: row.selector_explanation, selectedRank },
    fit_summary: persistedFitSummary(row),
    requirements: evidenceStrings(row.job_evidence),
    concerns: warningStrings(row.warnings),
  };
}

export function deliveryRow(row: PersistedMatchEvaluation, position: number) {
  if (!isDeliverable(row)) throw new Error("persisted_evaluation_not_deliverable");
  const evidence = evidenceStrings(row.job_evidence);
  if (!evidence.length) throw new Error("persisted_job_evidence_required");
  return {
    job_id: row.job_snapshot.legacy_job_id!,
    position,
    fit_summary: persistedFitSummary(row),
    matching_experience: evidence,
    primary_outcome: `Perform the responsibilities captured in the approved ${row.job_snapshot.exact_title} listing.`,
    core_responsibilities: evidence,
    requirements: evidence,
    hidden_job_functions: [],
    concerns: warningStrings(row.warnings),
    criteria_checks: {
      dutiesAligned: true,
      experienceConfirmed: true,
      levelAcceptable: true,
      scheduleAcceptable: true,
      locationAcceptable: true,
      compensationAcceptable: row.salary_disposition !== "FAIL",
      nonNegotiablesSatisfied: true,
    },
    ranking_score: Math.round(row.fit_score ?? 0),
    ranking_reason_codes: { rank: row.rank_explanation, selector: row.selector_explanation, evaluationId: row.id },
  };
}

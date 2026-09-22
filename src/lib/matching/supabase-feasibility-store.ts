import type { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runFeasibilityWorker, type FeasibilityWorkerStore } from "@/lib/matching/feasibility-worker";
import type { FeasibilityReason, PersistedInventoryEvaluation } from "@/lib/matching/feasibility";
import { assertCurrentCoverageAuthority } from "./coverage-authority";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

function first<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function classify(row: Record<string, unknown>): PersistedInventoryEvaluation["classification"] {
  const snapshot = first(row.job_snapshot as Record<string, unknown> | Record<string, unknown>[] | null);
  const deliverable = ["ELIGIBLE", "ELIGIBLE_WITH_ALLOWED_UNKNOWNS"].includes(String(row.eligibility))
    && row.categorical_evidence_sufficient === true
    && row.usefulness_result === "PASS"
    && row.salary_disposition !== "FAIL"
    && row.application_readiness !== "BLOCKED"
    && snapshot?.legitimacy_result === "PASS"
    && snapshot?.listing_activity_result === "PASS"
    && snapshot?.application_path_result === "PASS";
  if (deliverable) return "PRELIMINARILY_DELIVERABLE";
  const definitiveFailure = ["INELIGIBLE", "INVALID"].includes(String(row.eligibility))
    || row.usefulness_result === "FAIL"
    || row.categorical_evidence_sufficient === false
    || row.salary_disposition === "FAIL"
    || snapshot?.legitimacy_result === "FAIL"
    || snapshot?.listing_activity_result === "FAIL"
    || snapshot?.application_path_result === "FAIL";
  return definitiveFailure ? "EXCLUDED" : "REVIEWABLE";
}

function blocker(row: Record<string, unknown>): PersistedInventoryEvaluation["resolutionBlocker"] {
  if (row.eligibility === "NEEDS_CANDIDATE_INPUT") return "NEEDS_CANDIDATE_INPUT";
  return classify(row) === "REVIEWABLE" ? "NEEDS_HUMAN_REVIEW" : "NONE";
}

function exclusion(row: Record<string, unknown>): Exclude<FeasibilityReason, "INVENTORY_SHORTAGE"> | null {
  if (row.salary_status === "PUBLISHED_BELOW_MINIMUM") return "COMPENSATION_BELOW_MINIMUM";
  if (["UNPUBLISHED", "ESTIMATE_ONLY", "PUBLISHED_NONCOMPARABLE"].includes(String(row.salary_status)) && row.salary_disposition === "FAIL") return "COMPENSATION_UNCONFIRMED";
  if (["INELIGIBLE", "INVALID"].includes(String(row.eligibility))) return "QUALIFICATION_GAP";
  if (row.categorical_evidence_sufficient === false || row.usefulness_result === "FAIL") return "EVIDENCE_GAP";
  return null;
}

export function createSupabaseFeasibilityStore(admin: AdminClient): FeasibilityWorkerStore {
  return {
    async claim(requestId, workerId) {
      const { data, error } = await admin.rpc("ap_claim_feasibility_request", { p_request_id: requestId, p_worker_id: workerId });
      const row = first(data);
      if (error || !row) throw error || new Error("feasibility_request_not_claimable");
      return { requestId: row.request_id, snapshotId: row.snapshot_id, draftId: row.draft_id, workerId };
    },
    async load(claim) {
      const [{ data: snapshot, error: snapshotError }, { data: plan, error: planError }] = await Promise.all([
        admin.from("ap_intake_snapshots").select("id,content_sha256").eq("id", claim.snapshotId).maybeSingle(),
        admin.from("ap_feasibility_coverage_plans").select("id,snapshot_id,inventory_version_id,plan_version,typed_inputs,coverage_disposition,constraint_proof,content_sha256").eq("snapshot_id", claim.snapshotId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (snapshotError || planError || !snapshot || !plan) throw snapshotError || planError || new Error("persisted_feasibility_plan_required");
      const [{ data: cells, error: cellsError }, { data: inventoryVersion, error: inventoryError }, { data: members, error: membersError }] = await Promise.all([
        admin.from("ap_feasibility_coverage_cells").select("id,source_id,query_family_id,source_authorization_id,configuration_id,authorization_mode,query_fingerprint,pagination_bound,lookback_bound,result_bound,execution_path,terminal_outcome,result_count,configured_bound_satisfied,normalized_and_deduplicated,manual_checklist_complete,parser_result,cursor_or_stop_reason,authorization:ap_source_authorizations(state)").eq("plan_id", plan.id).limit(2001),
        admin.from("ap_inventory_versions").select("source_registry_version,query_version,parser_version,content_sha256,cutoff_at").eq("id", plan.inventory_version_id).maybeSingle(),
        admin.from("ap_inventory_members").select("id,inventory_version_id,job_snapshot_id").eq("inventory_version_id", plan.inventory_version_id).eq("selected_by_deduplication", true).limit(5001),
      ]);
      if (cellsError || inventoryError || membersError || !inventoryVersion) throw cellsError || inventoryError || membersError || new Error("persisted_inventory_required");
      if((cells?.length||0)>2000||(members?.length||0)>5000)throw new Error("feasibility_inventory_bound_exceeded");
      const from=admin.from.bind(admin) as unknown as (table:string)=>ReturnType<typeof admin.from>;
      const cellIds=(cells||[]).map(c=>c.id);
      const sourceIds=[...new Set((cells||[]).map(c=>c.source_id))];
      const configurationIds=[...new Set((cells||[]).map(c=>c.configuration_id).filter((id):id is string=>Boolean(id)))];
      const [heads,configurations,manualReviews,automatedReviews]=cellIds.length?await Promise.all([
        from("ap_source_authorization_heads").select("source_id,current_authorization_id,revision").in("source_id",sourceIds).limit(2001),
        admin.from("ap_feasibility_source_configurations").select("id,source_authorization_id,pagination_bound,lookback_bound,result_bound").in("id",configurationIds).limit(2001),
        from("ap_manual_research_reviews").select("cell_id,source_authorization_id,authorization_head_revision,reviewed_at").in("cell_id",cellIds).limit(2001),
        from("ap_research_cell_reviews").select("cell_id,source_run_id").in("cell_id",cellIds).limit(2001),
      ]):[{data:[],error:null},{data:[],error:null},{data:[],error:null},{data:[],error:null}];
      if([heads,configurations,manualReviews,automatedReviews].some(r=>r.error||(r.data?.length||0)>2000))throw new Error("feasibility_source_evidence_unavailable");
      const runIds=(automatedReviews.data||[]).map(r=>String((r as Record<string,unknown>).source_run_id));
      const runs=runIds.length?await admin.from("job_source_runs").select("id,source_id,source_authorization_id,authorization_head_revision,status,enumeration_status,checkpoint_start,completed_at").in("id",runIds).limit(2001):{data:[],error:null};
      if(runs.error||(runs.data?.length||0)>2000)throw new Error("feasibility_source_runs_unavailable");
      assertCurrentCoverageAuthority({cells:cells||[],heads:(heads.data||[]) as Record<string,unknown>[],configurations:configurations.data||[],manualReviews:(manualReviews.data||[]) as Record<string,unknown>[],automatedReviews:(automatedReviews.data||[]) as Record<string,unknown>[],runs:runs.data||[]});
      const memberIds = (members || []).map((member) => member.id);
      const { data: evaluations, error: evaluationsError } = memberIds.length ? await admin.from("ap_match_evaluations").select("id,snapshot_id,job_snapshot_id,inventory_member_id,inventory_version_id,eligibility,categorical_evidence_sufficient,usefulness_result,salary_status,salary_disposition,application_readiness,job_snapshot:ap_job_snapshots!inner(legacy_job_id,legitimacy_result,listing_activity_result,application_path_result)").eq("snapshot_id", claim.snapshotId).eq("legacy_compatibility", false).is("invalidated_at", null).in("inventory_member_id", memberIds).limit(5001) : { data: [], error: null };
      if (evaluationsError) throw evaluationsError;
      if((evaluations?.length||0)>5000)throw new Error("feasibility_evaluation_bound_exceeded");
      const jobIds=[...new Set((evaluations||[]).map(e=>first(e.job_snapshot)?.legacy_job_id).filter((id):id is string=>Boolean(id)))];
      const rpc=admin.rpc.bind(admin) as unknown as (name:string,args:Record<string,unknown>)=>Promise<{data:Array<{id:string}>|null;error:unknown}>;
      const current=jobIds.length?await rpc("ap_current_verified_job_snapshots",{p_job_ids:jobIds}):{data:[],error:null};
      if(current.error)throw new Error("feasibility_current_inventory_unavailable");
      const currentIds=new Set((current.data||[]).map(j=>j.id));
      if((evaluations||[]).some(e=>!currentIds.has(e.job_snapshot_id)))throw new Error("feasibility_inventory_verification_stale");
      const byMember = new Map((evaluations || []).map((evaluation) => [evaluation.inventory_member_id, evaluation as unknown as Record<string, unknown>]));
      if (byMember.size !== memberIds.length || (evaluations?.length || 0) !== memberIds.length) throw new Error("persisted_evaluation_coverage_incomplete");
      const inventory = (members || []).map((member) => {
        const evaluation = byMember.get(member.id);
        if (!evaluation || evaluation.job_snapshot_id !== member.job_snapshot_id || evaluation.inventory_version_id !== member.inventory_version_id) throw new Error("persisted_evaluation_inventory_mismatch");
        return {
          inventoryMemberId: member.id,
          inventoryVersionId: member.inventory_version_id,
          evaluationId: String(evaluation.id),
          snapshotId: String(evaluation.snapshot_id),
          jobSnapshotId: String(evaluation.job_snapshot_id),
          classification: classify(evaluation),
          resolutionBlocker: blocker(evaluation),
          exclusionReason: exclusion(evaluation),
        } satisfies PersistedInventoryEvaluation;
      });
      const typedInputs = plan.typed_inputs && typeof plan.typed_inputs === "object" ? plan.typed_inputs as Record<string, unknown> : {};
      return {
        plan: {
          id: plan.id,
          inventoryVersionId: plan.inventory_version_id,
          snapshotHash: snapshot.content_sha256,
          breadth: String(typedInputs.breadth || ""),
          requiredFamilyIds: Array.isArray(typedInputs.requiredFamilyIds) ? typedInputs.requiredFamilyIds.map(String) : [],
          cells: (cells || []).map((cell) => ({
            id: cell.id,
            familyId: cell.query_family_id || "",
            sourceId: cell.source_id,
            authorizationState: String(first(cell.authorization)?.state || "UNVERIFIED_DISABLED") as "AUTHORIZED_AUTOMATED" | "AUTHORIZED_MANUAL_ONLY" | "UNVERIFIED_DISABLED" | "BLOCKED",
            authorizationEvidenceId: cell.source_authorization_id,
            path: cell.execution_path,
            queryFingerprint: cell.query_fingerprint,
            paginationBound: cell.pagination_bound,
            lookbackBound: Number.parseInt(String(cell.lookback_bound), 10),
            resultBound: cell.result_bound,
            outcome: cell.terminal_outcome === "SUCCEEDED_WITH_RESULTS" || cell.terminal_outcome === "SUCCEEDED_EMPTY" ? cell.terminal_outcome : cell.terminal_outcome === "PENDING" ? "PENDING" : "RETRIEVAL_ERROR",
            resultCount: cell.result_count,
            configuredBoundSatisfied: cell.configured_bound_satisfied,
            normalizedAndDeduplicated: cell.normalized_and_deduplicated,
            manualChecklistComplete: cell.manual_checklist_complete,
            parserResult: (first(cell.parser_result as Record<string, unknown> | null) as Record<string, unknown> | null)?.status === "COMPLETE" ? "COMPLETE" : "ERROR",
            stopReason: cell.cursor_or_stop_reason,
          })),
          versions: { source: inventoryVersion.source_registry_version, query: inventoryVersion.query_version, inventory: inventoryVersion.content_sha256, parser: inventoryVersion.parser_version, cutoff: inventoryVersion.cutoff_at },
          disposition: plan.coverage_disposition,
          collisionProof: plan.constraint_proof as { kind: "TYPED_CONTRADICTION"; inputHash: string; version: string } | null,
          contentHash: plan.content_sha256,
        },
        inventory,
        currentSnapshotId: snapshot.id,
        currentSnapshotHash: snapshot.content_sha256,
        expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      };
    },
    async persistComplete(claim, result, _expiresAt, workerVersion) {
      if (result.runState !== "COMPLETE") throw new Error("complete_feasibility_result_required");
      const { data, error } = await admin.rpc("ap_persist_derived_feasibility_assessment", { p_request_id: claim.requestId, p_worker_id: claim.workerId, p_rules_version: workerVersion });
      if (error || !data) throw error || new Error("derived_feasibility_assessment_not_persisted");
      return String(data);
    },
    async complete(requestId, workerId, assessmentId) {
      const { error } = await admin.rpc("ap_complete_feasibility_request", { p_request_id: requestId, p_worker_id: workerId, p_assessment_id: assessmentId });
      if (error) throw error;
    },
    async defer(requestId, workerId, reason) {
      const { error } = await admin.rpc("ap_defer_feasibility_request", { p_request_id: requestId, p_worker_id: workerId, p_reason: reason });
      if (error) throw error;
    },
    async markStale(requestId, workerId, reason) {
      const { error } = await admin.rpc("ap_stale_feasibility_request", { p_request_id: requestId, p_worker_id: workerId, p_reason: reason });
      if (error) throw error;
    },
    async fail(requestId, workerId, errorCode) {
      const { error } = await admin.rpc("ap_fail_feasibility_request", { p_request_id: requestId, p_worker_id: workerId, p_error_code: errorCode });
      if (error) throw error;
    },
  };
}

export async function processPendingFeasibilityRequests(admin: AdminClient, limit = 5) {
  const workerId = process.env.APP_FEASIBILITY_WORKER_ID?.trim();
  if (!workerId) return { status: "disabled" as const, reason: "APP_FEASIBILITY_WORKER_ID_UNSET", processed: 0, results: [] };
  const { data, error } = await admin.from("ap_feasibility_requests").select("id").eq("state", "PENDING").order("created_at").limit(limit);
  if (error) throw error;
  const store = createSupabaseFeasibilityStore(admin);
  const results: Array<{ requestId: string; status: "complete" | "deferred" | "failed" }> = [];
  for (const request of data || []) {
    try {
      const result = await runFeasibilityWorker(store, request.id, workerId);
      results.push({ requestId: request.id, status: result.runState === "COMPLETE" ? "complete" : "deferred" });
    } catch {
      results.push({ requestId: request.id, status: "failed" });
    }
  }
  return { status: "enabled" as const, processed: results.length, results };
}

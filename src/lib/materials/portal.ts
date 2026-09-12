import "server-only";

import type { MatchForSelection } from "@/components/portal/apply-pack-selector-v2";
import type { MaterialDeliveryView } from "@/components/portal/material-deliveries";
import type { DeliveredReferenceJob } from "@/components/portal/reference-manager";
import { publicMaterialState } from "@/lib/materials/contract";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

type Supabase = NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>;

export type SearchRelease = { id: string; order_id: string; committed_at: string; release_kind: string };
export type SearchService = { legacy_order_id: string; original_snapshot_id: string | null };
export type DeliveredMatchGroup = {
  deliveredOrderId: string;
  deliveredReleaseId: string;
  sourceSnapshotId: string;
  evaluatedAt: string;
  matches: MatchForSelection[];
};

export async function loadDeliveredMatchGroups(input: {
  supabase: Supabase;
  releases: SearchRelease[];
  services: SearchService[];
}) {
  const exactReleases = input.releases.filter((release) => release.release_kind === "SEARCH_EXACT_TEN");
  if (!exactReleases.length) return { groups: [] as DeliveredMatchGroup[], jobs: [] as DeliveredReferenceJob[] };
  const releaseIds = exactReleases.map((release) => release.id);
  const membersResult = await input.supabase.from("ap_release_members")
    .select("release_id,member_id,position").in("release_id", releaseIds)
    .eq("member_type", "JOB_MATCH").order("position");
  if (membersResult.error) throw new Error("delivered_release_members_unavailable");
  const members = membersResult.data || [];
  const matchIds = [...new Set(members.map((member) => member.member_id))];
  if (!matchIds.length) return { groups: [], jobs: [] };
  const matchesResult = await input.supabase.from("job_matches")
    .select("id,search_order_id,release_evaluation_id,position,fit_summary,matching_experience,primary_outcome,core_responsibilities,requirements,hidden_job_functions,concerns,ranking_reason_codes,release_explanation,allowed_unknown_warnings,source_provenance,compensation_status,posted_on,posted_date_unknown,last_checked_at,job:jobs(company,title,source_url,official_application_url,source_name,source_category,location_text,salary_text,checked_at,listing_status,employment_type,w2_or_contractor,work_mode,remote_scope,eligible_states,eligible_countries,timezone_requirement,schedule_type,pay_model,phone_intensity,sales_flag,commission_flag,marketing_flag,high_volume_contact_center_flag,equipment_requirement,equipment_cost_responsibility,applicant_cost,benefits_status,experience_level,is_active,review_status,rejection_reason)")
    .in("id", matchIds);
  if (matchesResult.error) throw new Error("delivered_matches_unavailable");
  const rawMatches = matchesResult.data || [];
  const evaluationIds = rawMatches.map((match) => match.release_evaluation_id).filter((id): id is string => Boolean(id));
  const evaluationsResult = evaluationIds.length ? await input.supabase.from("ap_match_evaluations")
    .select("id,job_snapshot_id").in("id", evaluationIds).is("invalidated_at", null) : { data: [], error: null };
  if (evaluationsResult.error) throw new Error("delivered_evaluations_unavailable");
  const evaluations = new Map((evaluationsResult.data || []).map((evaluation) => [evaluation.id, evaluation.job_snapshot_id]));
  const jobSnapshotIds = [...new Set(evaluations.values())];
  const rulesResult = jobSnapshotIds.length ? await input.supabase.from("ap_employer_submission_rules")
    .select("id,job_snapshot_id,reference_timing,reference_count,checked_at")
    .in("job_snapshot_id", jobSnapshotIds).eq("is_current", true).is("superseded_at", null) : { data: [], error: null };
  if (rulesResult.error) throw new Error("submission_rules_unavailable");
  const rules = new Map((rulesResult.data || []).map((rule) => [rule.job_snapshot_id, rule]));
  const normalized = new Map<string, MatchForSelection>();
  for (const item of rawMatches) {
    const jobSnapshotId = item.release_evaluation_id ? evaluations.get(item.release_evaluation_id) : null;
    const rule = jobSnapshotId ? rules.get(jobSnapshotId) : null;
    const job = Array.isArray(item.job) ? item.job[0] : item.job;
    if (!job || !jobSnapshotId) continue;
    normalized.set(item.id, {
      ...item,
      position: Number(item.position),
      concerns: stringArray(item.concerns),
      matching_experience: stringArray(item.matching_experience),
      core_responsibilities: stringArray(item.core_responsibilities),
      requirements: stringArray(item.requirements),
      hidden_job_functions: stringArray(item.hidden_job_functions),
      allowed_unknown_warnings: stringArray(item.allowed_unknown_warnings),
      release_explanation: jsonObject(item.release_explanation),
      source_provenance: jsonObject(item.source_provenance),
      job_snapshot_id: jobSnapshotId,
      submission_rule_id: rule?.id || null,
      reference_timing: rule?.reference_timing || "LATER_OR_UNKNOWN",
      reference_count: rule?.reference_count || null,
      job,
    } as MatchForSelection);
  }
  const services = new Map(input.services.map((service) => [service.legacy_order_id, service]));
  const groups: DeliveredMatchGroup[] = [];
  for (const release of exactReleases) {
    const service = services.get(release.order_id);
    const releaseMembers = members.filter((member) => member.release_id === release.id)
      .sort((left, right) => Number(left.position) - Number(right.position));
    const matches = releaseMembers.map((member) => normalized.get(member.member_id)).filter((match): match is MatchForSelection => Boolean(match));
    const positions = releaseMembers.map((member) => Number(member.position));
    if (!service?.original_snapshot_id || releaseMembers.length !== 10 || matches.length !== 10
      || new Set(releaseMembers.map((member) => member.member_id)).size !== 10
      || positions.join(",") !== "1,2,3,4,5,6,7,8,9,10") continue;
    groups.push({
      deliveredOrderId: release.order_id,
      deliveredReleaseId: release.id,
      sourceSnapshotId: service.original_snapshot_id,
      evaluatedAt: release.committed_at,
      matches: matches.map((match, index) => ({ ...match, position: index + 1 })),
    });
  }
  const jobs = groups.flatMap((group) => group.matches.map((match) => ({
    deliveredReleaseId: group.deliveredReleaseId,
    jobSnapshotId: match.job_snapshot_id,
    employer: match.job.company,
    exactPosition: match.job.title,
  })));
  return { groups, jobs };
}

export async function loadMaterialDeliveries(input: { supabase: Supabase; customerId: string }) {
  const purchasesResult = await input.supabase.from("ap_material_purchases")
    .select("id").eq("customer_id", input.customerId).order("created_at", { ascending: false });
  if (purchasesResult.error) throw new Error("material_purchases_unavailable");
  const purchaseIds = (purchasesResult.data || []).map((purchase) => purchase.id);
  if (!purchaseIds.length) return [] as MaterialDeliveryView[];
  const linesResult = await input.supabase.from("ap_material_lines")
    .select("id,purchase_id,delivered_match_id,fulfillment,substitution,materials_due_at,active_revision")
    .in("purchase_id", purchaseIds).order("created_at", { ascending: false });
  if (linesResult.error) throw new Error("material_lines_unavailable");
  const lines = linesResult.data || [];
  const lineIds = lines.map((line) => line.id);
  const matchIds = [...new Set(lines.map((line) => line.delivered_match_id))];
  const [revisionsResult, proposalsResult, refundsResult, artifactsResult, regenerationsResult, matchesResult] = await Promise.all([
    input.supabase.from("ap_material_line_revisions").select("id,line_id,version,job_snapshot_id")
      .in("line_id", lineIds).is("superseded_at", null),
    input.supabase.from("ap_material_change_proposals")
      .select("id,material_line_id,kind,state,reason_code,target_job_snapshot_id,fact_diff,proposal_expires_at")
      .in("material_line_id", lineIds).eq("state", "PROPOSED"),
    input.supabase.from("ap_refund_operations").select("material_line_id,state,created_at")
      .in("material_line_id", lineIds).eq("scope", "MATERIAL_LINE").is("superseded_at", null),
    input.supabase.from("ap_generated_artifacts").select("id,material_line_id,artifact_type,current_file_version")
      .in("material_line_id", lineIds).in("artifact_type", ["RESUME", "COVER_LETTER", "REFERENCE_SHEET"]),
    input.supabase.from("ap_reference_regenerations").select("material_line_id,state,due_at,created_at")
      .in("material_line_id", lineIds).in("state", ["REQUESTED", "ACTIVE", "HUMAN_REVIEW"]),
    input.supabase.from("job_matches").select("id,job:jobs(company,title)").in("id", matchIds),
  ]);
  if (revisionsResult.error || proposalsResult.error || refundsResult.error || artifactsResult.error || regenerationsResult.error || matchesResult.error) {
    throw new Error("material_status_unavailable");
  }
  const artifacts = artifactsResult.data || [];
  const artifactIds = artifacts.map((artifact) => artifact.id);
  const filesResult = artifactIds.length ? await input.supabase.from("ap_generated_file_versions")
    .select("id,artifact_id,version,safe_filename,checksum_sha256,mime_type,created_at,superseded_at,downloads_revoked_at")
    .in("artifact_id", artifactIds) : { data: [], error: null };
  if (filesResult.error) throw new Error("material_files_unavailable");
  const proposals = proposalsResult.data || [];
  const currentRevisions = revisionsResult.data || [];
  const jobSnapshotIds = [...new Set([
    ...currentRevisions.map((revision) => revision.job_snapshot_id),
    ...proposals.map((proposal) => proposal.target_job_snapshot_id),
  ].filter((id): id is string => Boolean(id)))];
  const snapshotsResult = jobSnapshotIds.length ? await input.supabase.from("ap_job_snapshots")
    .select("id,company,exact_title").in("id", jobSnapshotIds) : { data: [], error: null };
  if (snapshotsResult.error) throw new Error("material_job_snapshots_unavailable");
  const snapshots = new Map((snapshotsResult.data || []).map((snapshot) => [snapshot.id, snapshot]));
  const legacyMatches = new Map((matchesResult.data || []).map((match) => {
    const job = Array.isArray(match.job) ? match.job[0] : match.job;
    return [match.id, job];
  }));
  return lines.map((line) => {
    const revision = currentRevisions.find((candidate) => candidate.line_id === line.id && Number(candidate.version) === Number(line.active_revision));
    const snapshot = revision?.job_snapshot_id ? snapshots.get(revision.job_snapshot_id) : null;
    const legacyJob = legacyMatches.get(line.delivered_match_id);
    const refund = (refundsResult.data || []).filter((candidate) => candidate.material_line_id === line.id)
      .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))[0];
    const publicState = publicMaterialState({
      fulfillment: line.fulfillment,
      substitution: line.substitution,
      refundState: refund?.state || null,
      dueAt: line.materials_due_at,
    });
    const proposal = proposals.find((candidate) => candidate.material_line_id === line.id);
    const targetSnapshot = proposal?.target_job_snapshot_id ? snapshots.get(proposal.target_job_snapshot_id) : null;
    const regeneration = (regenerationsResult.data || []).filter((candidate) => candidate.material_line_id === line.id)
      .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))[0];
    const lineArtifacts = artifacts.filter((artifact) => artifact.material_line_id === line.id).flatMap((artifact) => {
      const current = (filesResult.data || []).find((file) => file.artifact_id === artifact.id && Number(file.version) === Number(artifact.current_file_version));
      if (!current || !current.safe_filename) return [];
      return [{
        id: artifact.id,
        type: artifact.artifact_type,
        version: Number(current.version),
        filename: current.safe_filename,
        checksum: current.checksum_sha256,
        mimeType: current.mime_type,
        createdAt: current.created_at,
        downloadsRevokedAt: current.downloads_revoked_at,
        supersededAt: current.superseded_at,
      }];
    });
    return {
      lineId: line.id,
      company: snapshot?.company || legacyJob?.company || "Employer",
      title: snapshot?.exact_title || legacyJob?.title || "Selected job",
      jobSnapshotId: revision?.job_snapshot_id || "00000000-0000-4000-8000-000000000000",
      stateLabel: publicState.label,
      stateMessage: publicState.message,
      dueAt: line.materials_due_at,
      refundState: (refund?.state || "NONE") as MaterialDeliveryView["refundState"],
      proposal: proposal ? {
        id: proposal.id,
        kind: proposal.kind,
        reasonCode: proposal.reason_code,
        expiresAt: proposal.proposal_expires_at,
        targetJobSnapshotId: proposal.target_job_snapshot_id,
        targetCompany: targetSnapshot?.company || null,
        targetTitle: targetSnapshot?.exact_title || null,
        factDiff: proposal.fact_diff ? jsonObject(proposal.fact_diff) : null,
      } : null,
      regeneration: regeneration ? { state: regeneration.state, dueAt: regeneration.due_at } : null,
      artifacts: lineArtifacts,
    } as MaterialDeliveryView;
  });
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => typeof entry === "string" ? entry : JSON.stringify(entry)) : [];
}

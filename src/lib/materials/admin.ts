import "server-only";

import type { MaterialStaffLine } from "@/components/admin/chunk5-material-staff-queue";
import type { createSupabaseAdminClient } from "@/lib/supabase/admin";

type AdminClient = NonNullable<ReturnType<typeof createSupabaseAdminClient>>;

export async function loadMaterialStaffLines(admin: AdminClient): Promise<MaterialStaffLine[]> {
  const linesResult = await admin.from("ap_material_lines")
    .select("id,fulfillment,substitution,materials_due_at,active_revision,created_at")
    .in("fulfillment", ["PAID", "GENERATING", "HUMAN_REVIEW", "READY_TO_RELEASE", "DELIVERED"])
    .order("materials_due_at", { ascending: true, nullsFirst: false }).limit(100);
  if (linesResult.error) throw new Error("material_staff_lines_unavailable");
  const lines = linesResult.data || [];
  if (!lines.length) return [];
  const lineIds = lines.map((line) => line.id);
  const [revisionsResult, checksResult, artifactsResult, proposalsResult, supportsResult, regenerationsResult] = await Promise.all([
    admin.from("ap_material_line_revisions").select("id,line_id,version,job_snapshot_id,source_snapshot_id,employer_rule_snapshot_id").in("line_id", lineIds).is("superseded_at", null),
    admin.from("ap_material_listing_checks").select("material_line_id,phase,result,checked_at").in("material_line_id", lineIds).order("checked_at", { ascending: false }),
    admin.from("ap_generated_artifacts").select("id,material_line_id,artifact_type,current_file_version,reference_regeneration_id").in("material_line_id", lineIds),
    admin.from("ap_material_change_proposals").select("material_line_id,kind,state").in("material_line_id", lineIds).eq("state", "PROPOSED"),
    admin.from("ap_material_support_cases").select("material_line_id,state").in("material_line_id", lineIds).eq("state", "OPEN"),
    admin.from("ap_reference_regenerations").select("id,material_line_id,state,due_at,created_at").in("material_line_id", lineIds).in("state", ["REQUESTED", "ACTIVE", "HUMAN_REVIEW"]),
  ]);
  if (revisionsResult.error || checksResult.error || artifactsResult.error || proposalsResult.error || supportsResult.error || regenerationsResult.error) {
    throw new Error("material_staff_context_unavailable");
  }
  const revisions = revisionsResult.data || [];
  const jobIds = [...new Set(revisions.map((revision) => revision.job_snapshot_id).filter((value): value is string => Boolean(value)))];
  const ruleIds = [...new Set(revisions.map((revision) => revision.employer_rule_snapshot_id).filter((value): value is string => Boolean(value)))];
  const artifacts = artifactsResult.data || [];
  const artifactIds = artifacts.map((artifact) => artifact.id);
  const [jobsResult, rulesResult, filesResult] = await Promise.all([
    jobIds.length ? admin.from("ap_job_snapshots").select("id,company,exact_title").in("id", jobIds) : Promise.resolve({ data: [], error: null }),
    ruleIds.length ? admin.from("ap_employer_submission_rules").select("id,content_sha256").in("id", ruleIds).eq("is_current", true) : Promise.resolve({ data: [], error: null }),
    artifactIds.length ? admin.from("ap_generated_file_versions").select("id,artifact_id,version,safe_filename,superseded_at,downloads_revoked_at").in("artifact_id", artifactIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (jobsResult.error || rulesResult.error || filesResult.error) throw new Error("material_staff_bindings_unavailable");
  const files = filesResult.data || [];
  const fileIds = files.map((file) => file.id);
  const qualityResult = fileIds.length ? await admin.from("ap_artifact_quality_reviews")
    .select("file_version_id,automated_passed_at,content_approved_at,visual_approved_at,renderer_identity,arial_resolved,invalidated_at")
    .in("file_version_id", fileIds) : { data: [], error: null };
  if (qualityResult.error) throw new Error("material_staff_quality_unavailable");
  const jobs = new Map((jobsResult.data || []).map((job) => [job.id, job]));
  const rules = new Map((rulesResult.data || []).map((rule) => [rule.id, rule]));
  const qualities = new Map((qualityResult.data || []).map((quality) => [quality.file_version_id, quality]));
  return lines.map((line) => {
    const revision = revisions.find((candidate) => candidate.line_id === line.id && Number(candidate.version) === Number(line.active_revision));
    const job = revision?.job_snapshot_id ? jobs.get(revision.job_snapshot_id) : null;
    const rule = revision?.employer_rule_snapshot_id ? rules.get(revision.employer_rule_snapshot_id) : null;
    const lineChecks = (checksResult.data || []).filter((check) => check.material_line_id === line.id && check.result === "ACTIVE");
    const proposal = (proposalsResult.data || []).find((candidate) => candidate.material_line_id === line.id);
    const regeneration = (regenerationsResult.data || []).filter((candidate) => candidate.material_line_id === line.id)
      .sort((left, right) => String(right.created_at).localeCompare(String(left.created_at)))[0];
    const lineFiles = artifacts.filter((artifact) => artifact.material_line_id === line.id).flatMap((artifact) => {
      const file = files.find((candidate) => candidate.artifact_id === artifact.id && Number(candidate.version) === Number(artifact.current_file_version));
      const quality = file ? qualities.get(file.id) : null;
      if (!file || !quality || file.superseded_at || file.downloads_revoked_at || quality.invalidated_at) return [];
      return [{
        artifactType: artifact.artifact_type,
        fileVersionId: file.id,
        version: Number(file.version),
        filename: file.safe_filename || "Invalid filename",
        automatedPassed: Boolean(quality.automated_passed_at),
        contentApproved: Boolean(quality.content_approved_at),
        visualApproved: Boolean(quality.visual_approved_at),
        rendererIdentity: quality.renderer_identity,
        arialResolved: Boolean(quality.arial_resolved),
      }];
    });
    return {
      lineId: line.id,
      fulfillment: line.fulfillment,
      substitution: line.substitution,
      dueAt: line.materials_due_at,
      activeRevision: Number(line.active_revision),
      revisionId: revision?.id || null,
      jobSnapshotId: revision?.job_snapshot_id || null,
      sourceSnapshotId: revision?.source_snapshot_id || null,
      company: job?.company || "Employer",
      title: job?.exact_title || "Selected job",
      submissionRuleId: rule?.id || null,
      ruleSha256: rule?.content_sha256 || null,
      generationCheckAt: lineChecks.find((check) => check.phase === "BEFORE_GENERATION")?.checked_at || null,
      releaseCheckAt: lineChecks.find((check) => check.phase === "BEFORE_RELEASE")?.checked_at || null,
      files: lineFiles,
      openProposalKind: proposal?.kind || null,
      openSupportCases: (supportsResult.data || []).filter((support) => support.material_line_id === line.id).length,
      regeneration: regeneration ? { id: regeneration.id, state: regeneration.state, dueAt: regeneration.due_at } : null,
    };
  });
}

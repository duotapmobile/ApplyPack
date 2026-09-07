import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminMfa } from "@/components/admin/admin-mfa";
import { AdminOperations } from "@/components/admin/admin-operations";
import { Chunk5MaterialStaffQueue } from "@/components/admin/chunk5-material-staff-queue";
import { PendingIntakes } from "@/components/admin/pending-intakes";
import { Chunk4StaffQueue, type StaffQueueRow, type StaffReviewCandidate } from "@/components/admin/chunk4-staff-queue";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { isAdminEmailAllowed } from "@/lib/auth/require-admin";
import { loadMaterialStaffLines } from "@/lib/materials/admin";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { candidatePayload } from "@/lib/workflow/candidates";

export const metadata: Metadata = { title: "ApplyPack Operations", robots: { index: false, follow: false } };

export default async function AdminPage() {
  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  if (!supabase || !admin) return <AdminSetup />;
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/sign-in?next=/admin");
  if (!isAdminEmailAllowed(authData.user.email)) redirect("/my-applypack");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", authData.user.id).maybeSingle();
  if (!profile || !["operator", "admin"].includes(profile.role)) redirect("/my-applypack");
  const { data: assurance } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (!assurance || assurance.currentLevel !== "aal2") return <AdminMfa />;
  const [{ data: orders }, { data: capacity }, { data: failures }, { data: applyRows }, { data: conflictRows }, { data: correctionRows }, { data: capacityLimits }, { data: candidateRows }] = await Promise.all([
    admin.from("orders").select("id,product_kind,status,amount_cents,delivery_deadline,created_at,intake_id,intake:intakes(email,direction,priorities,dealbreakers,location_preference,schedule_preference,minimum_salary,experience_summary,notes,cover_letter_path,source_scan_status,source_deleted_at,intake_answers(answers))").in("status", ["paid", "in_fulfillment"]).order("delivery_deadline"),
    admin.from("capacity_reservations").select("id,kind,units,status,reserved_at,expires_at,confirmed_at").in("status", ["reserved", "confirmed"]).order("reserved_at", { ascending: false }),
    admin.from("webhook_events").select("id,event_type,error_message,received_at").not("error_message", "is", null).order("received_at", { ascending: false }).limit(10),
    admin.from("apply_pack_items").select("id,order_id,status,emphasis_notes,do_not_mention_notes,customer_update_notes,draft_resume_path,draft_cover_letter_path,draft_generated_at,draft_generator_version,orders!inner(status),job_match:job_matches(job:jobs(company,title))").in("orders.status", ["paid", "in_fulfillment"]).neq("status", "delivered"),
    admin.from("conflict_reviews").select("id,explanation,job_match:job_matches(job:jobs(company,title))").eq("status", "submitted").order("created_at"),
    admin.from("correction_requests").select("id,correction_text,apply_pack_item:apply_pack_items(job_match:job_matches(job:jobs(company,title)))").eq("status", "submitted").order("created_at"),
    admin.from("capacity_limits").select("kind,units_per_24h,enabled").order("kind"),
    admin.from("search_candidates").select("search_order_id,evaluation_id,ranking_score,fit_summary,requirements,concerns,job:jobs(*)").eq("review_status", "proposed").order("ranking_score", { ascending: false }),
  ]);
  const { data: pendingRequests } = await admin.from("ap_feasibility_requests").select("id,snapshot_id,state,created_at").eq("state", "PENDING").order("created_at");
  const pendingSnapshotIds = (pendingRequests || []).map((request) => request.snapshot_id);
  const { data: pendingSnapshots } = pendingSnapshotIds.length
    ? await admin.from("ap_intake_snapshots").select("id,access_email_normalized,desired_activities,avoided_activities,search_breadth,guidance_requested,work_modes,preferred_work_mode,us_state_or_dc,employment_types,preferred_employment_type,schedules,benefits,work_condition_preferences,dealbreakers,employer_unknown_policy,salary_hard_minimum_cents,salary_period,finalized_at").in("id", pendingSnapshotIds)
    : { data: [] };
  const { data: staffQueueData } = await admin.from("ap_staff_queue")
    .select("queue_kind,subject_id,order_id,due_at,state,non_sensitive_metadata")
    .order("due_at", { ascending: true, nullsFirst: false });
  const staffQueue: StaffQueueRow[] = (staffQueueData || []).map((row) => ({
    queueKind: row.queue_kind || "UNKNOWN",
    subjectId: row.subject_id || "unknown",
    orderId: row.order_id,
    dueAt: row.due_at,
    state: row.state || "UNKNOWN",
    metadata: row.non_sensitive_metadata && typeof row.non_sensitive_metadata === "object" && !Array.isArray(row.non_sensitive_metadata)
      ? row.non_sensitive_metadata as Record<string, unknown> : {},
  }));
  const correctedServiceIds = staffQueue
    .filter((row) => ["RESEARCHING", "JOB_REVIEW", "PACKAGE_REVIEW", "RELEASE", "ADJUSTMENT", "LATENESS", "REFUND"].includes(row.queueKind))
    .map((row) => row.subjectId);
  const { data: correctedServices } = correctedServiceIds.length
    ? await admin.from("ap_search_services").select("id,active_snapshot_id").in("id", correctedServiceIds)
    : { data: [] };
  const snapshotToService = new Map((correctedServices || []).filter((service) => service.active_snapshot_id)
    .map((service) => [service.active_snapshot_id!, service.id]));
  const activeSnapshotIds = [...snapshotToService.keys()];
  const { data: reviewEvaluationRows } = activeSnapshotIds.length
    ? await admin.from("ap_match_evaluations")
      .select("id,snapshot_id,job_snapshot_id,eligibility,root_result,root_results,leaf_results,resolution_issues,unknown_treatments,satisfaction_paths,categorical_evidence_sufficient,fit_score,fit_components,evidence_confidence,confidence_components,confidence_label,salary_status,salary_disposition,soft_preferences,application_readiness,presentation_risk,presentation_risk_reasons,warnings,candidate_fact_ids,job_evidence,explanation_evidence,version_bundle,active_root_keys,usefulness_result,calculation_input_sha256,calculation_version,job_snapshot:ap_job_snapshots!inner(id,discovery_source,source_authorization_id,source_url,canonical_employer_listing_url,canonical_application_url,application_host_type,company,exact_title,retrieved_at,live_verified_at,compensation_text,compensation_source,location_and_work_mode,parser_version,content_sha256,canonicalization_version,employer_identity_result,application_path_result,listing_activity_result,legitimacy_result,requirement_completeness,compensation_completeness,fraud_signals,material_restrictions)")
      .in("snapshot_id", activeSnapshotIds).is("invalidated_at", null).order("fit_score", { ascending: false }).limit(100)
    : { data: [] };
  const reviewRows = reviewEvaluationRows || [];
  const reviewFactIds = [...new Set(reviewRows.flatMap((evaluation) => evaluation.candidate_fact_ids || []))];
  const reviewAuthorizationIds = [...new Set(reviewRows.flatMap((evaluation) => {
    const job = Array.isArray(evaluation.job_snapshot) ? evaluation.job_snapshot[0] : evaluation.job_snapshot;
    return job?.source_authorization_id ? [job.source_authorization_id] : [];
  }))];
  const [{ data: activeCriteriaRows }, { data: reviewFactRows }, { data: reviewAuthorizationRows }] = await Promise.all([
    activeSnapshotIds.length ? admin.from("ap_intake_snapshots")
      .select("id,version,snapshot_kind,desired_activities,avoided_activities,optional_titles,confirmed_title_restriction,optional_industries,blocked_industries,search_breadth,guidance_requested,work_modes,preferred_work_mode,us_state_or_dc,employment_types,preferred_employment_type,schedules,travel,benefits,work_condition_preferences,dealbreakers,salary_target_cents,salary_hard_minimum_cents,salary_minimum_flexible,salary_period,salary_basis,salary_overlap_policy,salary_unpublished_policy,salary_noncomparable_policy,salary_variable_pay_policy,employer_unknown_policy,canonicalization_version,schema_version,content_sha256,finalized_at")
      .in("id", activeSnapshotIds) : Promise.resolve({ data: [] }),
    reviewFactIds.length ? admin.from("ap_candidate_facts")
      .select("id,semantic_key,value_kind,typed_value,source_kind,source_locator,verification,confirmed_or_corrected_at,catalog_version,schema_version,capability_status,extraction_confidence,superseded_at")
      .in("id", reviewFactIds) : Promise.resolve({ data: [] }),
    reviewAuthorizationIds.length ? admin.from("ap_source_authorizations")
      .select("id,source_id,source_display_name,state,access_method,authorization_version,verified_at,content_sha256")
      .in("id", reviewAuthorizationIds) : Promise.resolve({ data: [] }),
  ]);
  const criteriaById = new Map((activeCriteriaRows || []).map((row) => [row.id, row]));
  const factsById = new Map((reviewFactRows || []).map((row) => [row.id, row]));
  const authorizationById = new Map((reviewAuthorizationRows || []).map((row) => [row.id, row]));
  const staffReviewCandidates: StaffReviewCandidate[] = reviewRows.flatMap((evaluation) => {
    const job = Array.isArray(evaluation.job_snapshot) ? evaluation.job_snapshot[0] : evaluation.job_snapshot;
    const serviceId = snapshotToService.get(evaluation.snapshot_id);
    if (!job || !serviceId) return [];
    const criteria = criteriaById.get(evaluation.snapshot_id);
    const authorization = job.source_authorization_id ? authorizationById.get(job.source_authorization_id) : null;
    return [{
      serviceId,
      evaluationId: evaluation.id,
      snapshotId: evaluation.snapshot_id,
      jobSnapshotId: evaluation.job_snapshot_id,
      company: job.company,
      title: job.exact_title,
      eligibility: evaluation.eligibility,
      rootResult: evaluation.root_result,
      fitScore: evaluation.fit_score === null ? null : Number(evaluation.fit_score),
      fitComponents: evaluation.fit_components,
      evidenceConfidence: evaluation.evidence_confidence === null ? null : Number(evaluation.evidence_confidence),
      confidenceLabel: evaluation.confidence_label,
      confidenceComponents: evaluation.confidence_components,
      salaryStatus: evaluation.salary_status,
      salaryDisposition: evaluation.salary_disposition,
      compensationText: job.compensation_text,
      compensationSource: job.compensation_source,
      applicationReadiness: evaluation.application_readiness,
      presentationRisk: evaluation.presentation_risk,
      presentationRiskReasons: evaluation.presentation_risk_reasons,
      resolutionIssues: Array.isArray(evaluation.resolution_issues) ? evaluation.resolution_issues.map(String) : [],
      warnings: Array.isArray(evaluation.warnings) ? evaluation.warnings.map((warning) => typeof warning === "string" ? warning : JSON.stringify(warning)) : [],
      liveVerifiedAt: job.live_verified_at,
      retrievedAt: job.retrieved_at,
      applicationHostType: job.application_host_type,
      applicationUrl: job.canonical_application_url,
      employerListingUrl: job.canonical_employer_listing_url,
      sourceUrl: job.source_url,
      sourceName: authorization?.source_display_name || job.discovery_source,
      sourceState: authorization?.state || "UNVERIFIED_DISABLED",
      sourceAuthorizationVersion: authorization?.authorization_version || "missing",
      gates: {
        salaryDisposition: evaluation.salary_disposition,
        categoricalEvidenceSufficient: evaluation.categorical_evidence_sufficient,
        usefulnessResult: evaluation.usefulness_result,
        activeRootKeys: evaluation.active_root_keys,
        unknownTreatments: evaluation.unknown_treatments,
        employerIdentity: job.employer_identity_result,
        applicationPath: job.application_path_result,
        listingActivity: job.listing_activity_result,
        legitimacy: job.legitimacy_result,
        requirementCompleteness: job.requirement_completeness,
        compensationCompleteness: job.compensation_completeness,
        fraudSignals: job.fraud_signals,
        materialRestrictions: job.material_restrictions,
      },
      activeCriteria: criteria || {},
      candidateFacts: (evaluation.candidate_fact_ids || []).flatMap((factId: string) => {
        const fact = factsById.get(factId);
        return fact ? [fact as Record<string, unknown>] : [{ id: factId, unavailable: true }];
      }),
      rootResults: evaluation.root_results,
      leafResults: evaluation.leaf_results,
      satisfactionPaths: evaluation.satisfaction_paths,
      jobEvidence: evaluation.job_evidence,
      explanationEvidence: evaluation.explanation_evidence,
      versionBundle: {
        evaluation: evaluation.version_bundle,
        calculationInputSha256: evaluation.calculation_input_sha256,
        calculationVersion: evaluation.calculation_version,
        jobContentSha256: job.content_sha256,
        jobParserVersion: job.parser_version,
        jobCanonicalizationVersion: job.canonicalization_version,
        sourceAuthorizationContentSha256: authorization?.content_sha256 || null,
        sourceAuthorizationVerifiedAt: authorization?.verified_at || null,
      },
    }];
  });
  const materialStaffLines = await loadMaterialStaffLines(admin).catch(() => []);
  const applyItems = (applyRows || []).map((item) => {
    const match = Array.isArray(item.job_match) ? item.job_match[0] : item.job_match;
    const job = Array.isArray(match?.job) ? match.job[0] : match?.job;
    return { id: item.id, order_id: item.order_id, status: item.status, emphasis_notes: item.emphasis_notes, do_not_mention_notes: item.do_not_mention_notes, customer_update_notes: item.customer_update_notes, draft_resume_path: item.draft_resume_path, draft_cover_letter_path: item.draft_cover_letter_path, draft_generated_at: item.draft_generated_at, draft_generator_version: item.draft_generator_version, company: job?.company || "Employer", title: job?.title || "Selected job" };
  });
  const conflicts = (conflictRows || []).map((item) => {
    const match = Array.isArray(item.job_match) ? item.job_match[0] : item.job_match;
    const job = Array.isArray(match?.job) ? match.job[0] : match?.job;
    return { id: item.id, explanation: item.explanation, company: job?.company || "Employer", title: job?.title || "Matched job" };
  });
  const corrections = (correctionRows || []).map((item) => {
    const pack = Array.isArray(item.apply_pack_item) ? item.apply_pack_item[0] : item.apply_pack_item;
    const match = Array.isArray(pack?.job_match) ? pack.job_match[0] : pack?.job_match;
    const job = Array.isArray(match?.job) ? match.job[0] : match?.job;
    return { id: item.id, correction_text: item.correction_text, company: job?.company || "Employer", title: job?.title || "Apply Pack" };
  });
  const candidatesByOrder = new Map<string, ReturnType<typeof candidatePayload>[]>();
  for (const candidate of candidateRows || []) {
    const job = Array.isArray(candidate.job) ? candidate.job[0] : candidate.job;
    if (!job) continue;
    const current = candidatesByOrder.get(candidate.search_order_id) || [];
    current.push(candidatePayload(candidate as unknown as Record<string, unknown>, job as unknown as Record<string, unknown>));
    candidatesByOrder.set(candidate.search_order_id, current);
  }
  const searchOrders = (orders || []).filter((order) => order.product_kind === "job_search").map((order) => {
    const intake = Array.isArray(order.intake) ? order.intake[0] : order.intake;
    const answerRow = Array.isArray(intake?.intake_answers) ? intake.intake_answers[0] : intake?.intake_answers;
    return {
      id: order.id,
      delivery_deadline: order.delivery_deadline,
      intake_id: order.intake_id,
      source_scan_status: intake?.source_scan_status || "pending",
      source_deleted: Boolean(intake?.source_deleted_at),
      has_cover_letter: Boolean(intake?.cover_letter_path),
      intake_details: intake ? { email: intake.email, direction: intake.direction, priorities: intake.priorities, dealbreakers: intake.dealbreakers, location_preference: intake.location_preference, schedule_preference: intake.schedule_preference, minimum_salary: intake.minimum_salary, experience_summary: intake.experience_summary, notes: intake.notes, answers: answerRow?.answers } : {},
      suggested_matches: candidatesByOrder.get(order.id) || [],
    };
  });
  return (
    <main id="main-content" className="admin-page">
      <div className="page-frame">
        <div className="admin-heading"><div><p className="eyebrow eyebrow--light">APPLYPACK OPERATIONS</p><h1>Fulfillment queue</h1></div><div><p>Manual-first controls. Every delivery requires human review.</p><SignOutButton /></div></div>
        <div className="admin-metrics"><article><span>Open work</span><strong>{orders?.length || 0}</strong></article><article><span>Active capacity units</span><strong>{capacity?.reduce((sum, item) => sum + item.units, 0) || 0}</strong></article><article><span>Webhook failures</span><strong>{failures?.length || 0}</strong></article></div>
        <Chunk4StaffQueue rows={staffQueue} candidates={staffReviewCandidates} />
        <Chunk5MaterialStaffQueue lines={materialStaffLines} />
        <AdminOperations searchOrders={searchOrders} applyItems={applyItems} conflicts={conflicts} corrections={corrections} capacityLimits={capacityLimits || []} />
        <PendingIntakes requests={pendingRequests || []} snapshots={pendingSnapshots || []} />
        <section className="admin-table-wrap">
          <h2>Orders due</h2>
          {orders?.length ? <div className="admin-table-scroll"><table className="admin-table">
            <caption className="sr-only">Paid ApplyPack work ordered by delivery deadline</caption>
            <thead><tr><th scope="col">Product and order</th><th scope="col">Status</th><th scope="col">Amount</th><th scope="col">Deadline</th></tr></thead>
            <tbody>{orders.map((order) => <tr key={order.id}>
              <th scope="row"><strong>{order.product_kind.replaceAll("_", " ")}</strong><span>{order.id}</span></th>
              <td>{order.status.replaceAll("_", " ")}</td>
              <td>{"$" + (order.amount_cents / 100).toFixed(2)}</td>
              <td>{order.delivery_deadline ? new Date(order.delivery_deadline).toLocaleString("en-US", { timeZone: "America/New_York" }) + " ET" : "Awaiting deadline"}</td>
            </tr>)}</tbody>
          </table></div> : <p>No paid work is waiting.</p>}
        </section>
        {failures?.length ? <section className="admin-alerts"><h2>Provider failures</h2>{failures.map((failure) => <p key={failure.id}><strong>{failure.event_type}</strong> {failure.error_message}</p>)}</section> : null}
      </div>
    </main>
  );
}

function AdminSetup() {
  return <main id="main-content" className="auth-page"><section className="auth-card"><p className="eyebrow">OPERATIONS</p><h1>Provider setup required.</h1><p>Supabase server credentials must be connected before the private operator queue can open.</p></section></main>;
}

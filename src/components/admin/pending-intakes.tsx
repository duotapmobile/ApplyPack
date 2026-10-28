import Link from "next/link";
import type { FeasibilityQueue, FeasibilityQueueAssessment, FeasibilityQueueRequest } from "@/lib/matching/feasibility-queue";

const friendly = (value: string) => value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const values = (value: unknown) => Array.isArray(value) ? value.map((item) => friendly(String(item))).join(", ") || "None" : "None";
const preferences = (value: unknown) => value && typeof value === "object" && !Array.isArray(value)
  ? Object.entries(value).map(([key, preference]) => `${friendly(key)}: ${Array.isArray(preference) ? values(preference) : friendly(String(preference))}`).join("; ") || "None"
  : "None";

function resultText(request: FeasibilityQueueRequest, assessment: FeasibilityQueueAssessment | undefined, now: number) {
  if (request.state === "ERROR") return "Research failed. Review the source and worker failure before retrying; do not invite checkout.";
  if (request.state === "CLAIMED") return "Research in progress. A payment invitation is not available from this request.";
  if (request.state === "PENDING") return "Waiting for research. Review source coverage and worker availability if this does not progress.";
  if (!assessment || assessment.id !== request.completed_assessment_id || assessment.snapshot_id !== request.snapshot_id) {
    return "Assessment unavailable. Do not invite checkout until the exact result is recovered.";
  }
  if (assessment.invalidated_at || !assessment.expires_at || !Number.isFinite(Date.parse(assessment.expires_at)) || Date.parse(assessment.expires_at) <= now) {
    return "Assessment expired or replaced. Recheck the current intake and job evidence before an invitation.";
  }
  if (assessment.state !== "COMPLETE") return "Assessment incomplete. Resolve the research exception before an invitation.";
  if (assessment.outcome === "LIMITED") return "Limited matches. Review the coverage and missing evidence; do not charge for an unsupported search.";
  if (assessment.outcome === "INFEASIBLE") return "Search not currently feasible. Review the constraints and findings before discussing any change with the customer.";
  if (assessment.resolution_blocker !== "NONE") return "Review required. Resolve the recorded blocker before an invitation.";
  if (assessment.outcome === "LIKELY" && (assessment.preliminarily_deliverable_count ?? 0) >= 10) {
    return "Enough preliminary matches. Review the separate checkout-invitation queue and capacity before inviting payment.";
  }
  return "Insufficient verified matches. Review this assessment before an invitation.";
}

export function PendingIntakes({ requests, snapshots, assessments, unavailable, page, hasMore, checkedAt, now = checkedAt }: FeasibilityQueue & { now?: number }) {
  const byId = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const assessmentsById = new Map(assessments.map((assessment) => [assessment.id, assessment]));
  return <section id="intake-feasibility" className="admin-table-wrap" aria-labelledby="pending-intakes-title">
    <h2 id="pending-intakes-title">Intake research and exceptions</h2>
    <p>Track waiting, active and completed research, including failures and shortages. These results do not reserve capacity or authorize payment.</p>
    {unavailable ? <p role="alert">The intake research queue could not be loaded. Its workload is unknown. Refresh this page before taking action.</p>
      : requests.length ? <div className="admin-table-scroll"><table className="admin-table">
        <caption className="sr-only">Customer intake research results and next steps, page {page}</caption>
        <thead><tr><th scope="col">Intake</th><th scope="col">Direction</th><th scope="col">Requirements</th><th scope="col">Research and next step</th></tr></thead>
        <tbody>{requests.map((request) => {
          const snapshot = byId.get(request.snapshot_id);
          const candidate = assessmentsById.get(request.completed_assessment_id || "");
          const assessment = candidate?.snapshot_id === request.snapshot_id ? candidate : undefined;
          const errorCode = request.error_code && /^[A-Z][A-Z0-9_]{0,99}$/u.test(request.error_code) ? request.error_code : null;
          return <tr key={request.id}>
            <th scope="row"><strong>{snapshot?.access_email_normalized || "Protected contact"}</strong><span>{request.snapshot_id}</span></th>
            <td>{snapshot ? `${values(snapshot.desired_activities)} · ${friendly(snapshot.search_breadth)}${snapshot.guidance_requested ? " · Guidance requested" : ""}` : "Intake details unavailable. Review before taking action."}</td>
            <td>{snapshot ? `${values(snapshot.work_modes)}${snapshot.preferred_work_mode ? ` (prefer ${friendly(snapshot.preferred_work_mode)})` : ""} · ${snapshot.us_state_or_dc || "State missing"} · ${values(snapshot.employment_types)} · Conditions: ${preferences(snapshot.work_condition_preferences)} · Benefits: ${preferences(snapshot.benefits)} · Exclude: ${values(snapshot.dealbreakers)} · Unknown handling: ${preferences(snapshot.employer_unknown_policy)}${snapshot.salary_hard_minimum_cents === null ? "" : ` · Minimum $${(snapshot.salary_hard_minimum_cents / 100).toLocaleString("en-US")} ${snapshot.salary_period === "HOUR" ? "hourly" : "annual"}`}` : "Unavailable"}</td>
            <td><strong>{friendly(request.state)}{assessment?.outcome ? ` · ${friendly(assessment.outcome)}` : ""}</strong>
              <p>{resultText(request, assessment, now)}</p>
              {assessment ? <p>{assessment.preliminarily_deliverable_count ?? "Unknown"} preliminary matches. Reasons: {values(assessment.reasons)}. Blocker: {friendly(assessment.resolution_blocker)}.</p> : null}
              {errorCode ? <small>Failure reference: {errorCode}</small> : null}
              <p><small>Updated {new Date(request.updated_at).toLocaleString("en-US", { timeZone: "America/New_York" })} ET</small></p>
            </td>
          </tr>;
        })}</tbody>
      </table></div> : <p>{page === 1 ? "No current intake research requests." : "No intake research requests on this page."}</p>}
    <nav aria-label="Intake research pages">
      {page > 1 ? <Link href={`/admin?intakePage=${page - 1}#intake-feasibility`}>Previous intake page</Link> : null}
      <span> Page {page} </span>
      {!unavailable && hasMore ? <Link href={`/admin?intakePage=${page + 1}#intake-feasibility`}>Next intake page</Link> : null}
    </nav>
  </section>;
}

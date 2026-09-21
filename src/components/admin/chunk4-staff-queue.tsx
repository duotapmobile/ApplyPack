"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { formatEasternDeadline } from "@/lib/commerce/presentation";

export type StaffQueueRow = {
  queueKind: string;
  subjectId: string;
  orderId: string | null;
  dueAt: string | null;
  state: string;
  metadata: Record<string, unknown>;
};

export type StaffReviewCandidate = {
  serviceId: string;
  evaluationId: string;
  snapshotId: string;
  jobSnapshotId: string;
  company: string;
  title: string;
  eligibility: string;
  rootResult: string;
  fitScore: number | null;
  fitComponents: unknown;
  evidenceConfidence: number | null;
  confidenceLabel: string | null;
  confidenceComponents: unknown;
  salaryStatus: string;
  salaryDisposition: string;
  compensationText: string | null;
  compensationSource: string | null;
  applicationReadiness: string;
  presentationRisk: string;
  presentationRiskReasons: unknown;
  resolutionIssues: string[];
  warnings: string[];
  liveVerifiedAt: string;
  retrievedAt: string;
  applicationHostType: string;
  applicationUrl: string;
  employerListingUrl: string | null;
  sourceUrl: string;
  sourceName: string;
  sourceState: string;
  sourceAuthorizationVersion: string;
  gates: Record<string, unknown>;
  activeCriteria: Record<string, unknown>;
  candidateFacts: Array<Record<string, unknown>>;
  rootResults: unknown;
  leafResults: unknown;
  satisfactionPaths: unknown;
  jobEvidence: unknown;
  explanationEvidence: unknown;
  versionBundle: unknown;
};

const decisions = [
  ["APPROVED", "Approve for release consideration"],
  ["REJECTED", "Reject"],
  ["EVIDENCE_REQUIRED", "Require more evidence"],
  ["CUSTOMER_INPUT_REQUIRED", "Require customer input"],
] as const;

export function Chunk4StaffQueue({ rows, candidates }: { rows: StaffQueueRow[]; candidates: StaffReviewCandidate[] }) {
  const router = useRouter();
  const [rationales, setRationales] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [messages, setMessages] = useState<Record<string, string>>({});
  const counts = useMemo(() => rows.reduce<Record<string, number>>((result, row) => {
    result[row.queueKind] = (result[row.queueKind] || 0) + 1;
    return result;
  }, {}), [rows]);

  async function review(candidate: StaffReviewCandidate, decision: typeof decisions[number][0]) {
    const rationale = rationales[candidate.evaluationId]?.trim() || "";
    if (rationale.length < 20) {
      setMessages((current) => ({ ...current, [candidate.evaluationId]: "Add a specific rationale of at least 20 characters." }));
      return;
    }
    setBusy(candidate.evaluationId);
    setMessages((current) => ({ ...current, [candidate.evaluationId]: "" }));
    try {
      const response = await fetch(`/api/admin/search-services/${encodeURIComponent(candidate.serviceId)}/reviews`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ evaluationId: candidate.evaluationId, decision, rationale }),
      });
      const result = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "The review could not be recorded.");
      setMessages((current) => ({ ...current, [candidate.evaluationId]: `${humanize(decision)} review recorded and bound to the current evidence versions.` }));
      router.refresh();
    } catch (error) {
      setMessages((current) => ({ ...current, [candidate.evaluationId]: error instanceof Error ? error.message : "The review could not be recorded." }));
    } finally {
      setBusy("");
    }
  }

  return <>
    <section className="admin-table-wrap" aria-labelledby="chunk4-queue-heading">
      <div className="portal-section__heading">
        <div><p className="eyebrow">CORRECTED SEARCH OPERATIONS</p><h2 id="chunk4-queue-heading">Durable staff queue</h2></div>
        <p>Research, review, adjustment, deadline, refund, and email failures remain distinct. No queue state auto-approves a customer release.</p>
      </div>
      {Object.keys(counts).length ? <div className="staff-queue-counts">{Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).map(([kind, count]) => <span key={kind}><strong>{count}</strong> {humanize(kind)}</span>)}</div> : null}
      {rows.length ? <div className="admin-table-scroll"><table className="admin-table">
        <caption className="sr-only">Corrected search operations ordered by contractual due time</caption>
        <thead><tr><th scope="col">Queue</th><th scope="col">Subject</th><th scope="col">State</th><th scope="col">Due</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={`${row.queueKind}:${row.subjectId}`}>
          <th scope="row"><strong>{humanize(row.queueKind)}</strong><span>{row.subjectId}</span></th>
          <td>{row.orderId ? `Order ${row.orderId}` : "Operational evidence record"}</td>
          <td>{humanize(row.state)}</td>
          <td>{row.dueAt ? formatEasternDeadline(row.dueAt) : "No customer deadline"}</td>
        </tr>)}</tbody>
      </table></div> : <p>No corrected-search work is waiting.</p>}
    </section>

    {candidates.length ? <section className="admin-table-wrap" aria-labelledby="chunk4-review-heading">
      <div className="portal-section__heading">
        <div><p className="eyebrow">BOUND HUMAN REVIEW</p><h2 id="chunk4-review-heading">Current candidate evidence</h2></div>
        <p>Each decision is immutable and bound to the current intake snapshot, job snapshot, candidate facts, and version bundle.</p>
      </div>
      <div className="staff-review-grid">{candidates.map((candidate) => <article key={candidate.evaluationId}>
        <p className="eyebrow">{humanize(candidate.eligibility)}</p>
        <h3>{candidate.title}</h3>
        <p><strong>{candidate.company}</strong></p>
        <dl>
          <div><dt>Fit score</dt><dd>{candidate.fitScore ?? "Not ranked"}</dd></div>
          <div><dt>Evidence confidence</dt><dd>{candidate.evidenceConfidence ?? "Not scored"} {candidate.confidenceLabel ? `· ${humanize(candidate.confidenceLabel)}` : ""}</dd></div>
          <div><dt>Compensation</dt><dd>{humanize(candidate.salaryStatus)}</dd></div>
          <div><dt>Application</dt><dd>{humanize(candidate.applicationReadiness)} · {humanize(candidate.applicationHostType)}</dd></div>
          <div><dt>Live check</dt><dd>{formatEasternDeadline(candidate.liveVerifiedAt)}</dd></div>
          <div><dt>Presentation risk</dt><dd>{humanize(candidate.presentationRisk)}</dd></div>
          <div><dt>Source authorization</dt><dd>{candidate.sourceName} · {humanize(candidate.sourceState)} · {candidate.sourceAuthorizationVersion}</dd></div>
        </dl>
        <p><strong>Published compensation:</strong> {candidate.compensationText || "Not published"}{candidate.compensationSource ? ` (${candidate.compensationSource})` : ""}</p>
        {candidate.resolutionIssues.length ? <p className="match-warning"><strong>Resolution issues:</strong> {candidate.resolutionIssues.map(humanize).join("; ")}</p> : null}
        {candidate.warnings.length ? <p className="match-warning"><strong>Warnings:</strong> {candidate.warnings.join(" ")}</p> : null}
        <nav aria-label={`Evidence links for ${candidate.title}`}><a href={candidate.applicationUrl} target="_blank" rel="noreferrer">Application destination</a>{" · "}<a href={candidate.sourceUrl} target="_blank" rel="noreferrer">Captured source</a>{candidate.employerListingUrl ? <>{" · "}<a href={candidate.employerListingUrl} target="_blank" rel="noreferrer">Canonical employer listing</a></> : null}</nav>
        <div className="staff-review-identifiers"><span>Evaluation {candidate.evaluationId}</span><span>Criteria snapshot {candidate.snapshotId}</span><span>Job snapshot {candidate.jobSnapshotId}</span><span>Retrieved {formatEasternDeadline(candidate.retrievedAt)}</span></div>
        <JsonEvidence label="Active criteria and criteria versions" value={candidate.activeCriteria} />
        <JsonEvidence label="Candidate facts and provenance" value={candidate.candidateFacts} />
        <JsonEvidence label="Gate results" value={{ rootResult: candidate.rootResult, ...candidate.gates }} />
        <JsonEvidence label="Root and leaf evidence" value={{ rootResults: candidate.rootResults, leafResults: candidate.leafResults, satisfactionPaths: candidate.satisfactionPaths }} />
        <JsonEvidence label="Job and explanation evidence" value={{ jobEvidence: candidate.jobEvidence, explanationEvidence: candidate.explanationEvidence }} />
        <JsonEvidence label="Score, confidence, and risk components" value={{ fit: candidate.fitComponents, confidence: candidate.confidenceComponents, presentationRiskReasons: candidate.presentationRiskReasons }} />
        <JsonEvidence label="Bound rules and version bundle" value={candidate.versionBundle} />
        <label>Review rationale <span>(required; minimum 20 characters)</span><textarea value={rationales[candidate.evaluationId] || ""} onChange={(event) => setRationales((current) => ({ ...current, [candidate.evaluationId]: event.target.value }))} maxLength={2_000} /></label>
        <div className="admin-buttons">{decisions.map(([decision, label]) => <button type="button" key={decision} disabled={busy === candidate.evaluationId} onClick={() => void review(candidate, decision)}>{label}</button>)}</div>
        <p className={messages[candidate.evaluationId] ? "form-message" : "sr-only"} role="status" aria-live="polite">{messages[candidate.evaluationId] || "No review submitted."}</p>
      </article>)}</div>
    </section> : null}
  </>;
}

function humanize(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
}

function JsonEvidence({ label, value }: { label: string; value: unknown }) {
  return <details className="staff-review-evidence"><summary>{label}</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>;
}

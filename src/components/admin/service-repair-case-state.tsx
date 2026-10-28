"use client";
import { useId, useState } from "react";
import { matchesRepairCaseState, matchesRepairFeedback } from "@/lib/materials/service-repair-followup-client";
import { repairArtifactLabel, repairCaseReviewSchema, repairCaseStateRequestSchema, repairFeedbackRequestSchema,
  type RepairCaseReview, type RepairCaseStateRequest, type RepairFeedbackRequest } from "@/lib/materials/service-repair-followup";

export function ServiceRepairCaseState({ caseId }: { caseId: string }) { return <CaseStateForm key={caseId} caseId={caseId} />; }
function CaseStateForm({ caseId }: { caseId: string }) {
  const heading = useId(), path = `/api/admin/service-errors/${caseId}/state`;
  const [review, setReview] = useState<RepairCaseReview | null>(null), [note, setNote] = useState(""), [filesChecked, setFilesChecked] = useState(false), [feedbackChecked, setFeedbackChecked] = useState(false);
  const [feedback, setFeedback] = useState<RepairFeedbackRequest | null>(null), [pending, setPending] = useState<RepairCaseStateRequest | null>(null);
  const [busy, setBusy] = useState(false), [retry, setRetry] = useState(false), [message, setMessage] = useState("");
  async function load() {
    if (pending) return; setBusy(true); setFilesChecked(false); setFeedbackChecked(false); setFeedback(null); setReview(null); setNote("");
    try {
      const response = await fetch(path, { cache: "no-store", signal: AbortSignal.timeout(50_000) });
      if (!response.ok) throw new Error(); const value = repairCaseReviewSchema.parse(await response.json()); if (value.caseId !== caseId) throw new Error();
      setReview(value); setMessage("");
    } catch { setMessage("The current case review is unavailable. Check your staff sign-in and reload."); }
    finally { setBusy(false); }
  }
  async function readFeedback(requestId: string) {
    if (pending) return; setBusy(true); setFeedback(null); setFeedbackChecked(false);
    try {
      const response = await fetch(`${path}?feedbackId=${requestId}`, { cache: "no-store", signal: AbortSignal.timeout(50_000) }), value = await response.json();
      if (!response.ok) throw new Error(); const request = repairFeedbackRequestSchema.parse(value.request);
      if (request.caseId !== caseId || request.requestId !== requestId || !await matchesRepairFeedback(value.receipt, request)) throw new Error();
      setFeedback(request); setMessage("");
    } catch { setMessage("This feedback could not be loaded with its current case binding. Reload the case before deciding."); setReview(null); setFilesChecked(false); }
    finally { setBusy(false); }
  }
  const finish = (request: RepairCaseStateRequest) => {
    setPending(null); setReview(null); setFeedback(null); setNote(""); setFilesChecked(false); setFeedbackChecked(false);
    setMessage(request.action === "RESOLVED" ? "The reviewed case was marked resolved. This did not generate or send documents." : "The existing case was reopened for review. No new error scope or document changes were approved.");
  };
  async function save(request: RepairCaseStateRequest) {
    setPending(request); setRetry(false); setBusy(true); setMessage("");
    try {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: AbortSignal.timeout(50_000) }), value = await response.json();
      if (response.status === 409 && value.code === "CASE_CHANGED") {
        // The atomic CAS rejected before mutation and the server confirmed no
        // event for this ID. A fresh review requires fresh explicit checkboxes.
        setPending(null); setReview(null); setFeedback(null); setFilesChecked(false); setFeedbackChecked(false);
        setMessage("The case changed before your decision was saved. Reload and review the new feedback or repair work."); return;
      }
      if (!response.ok || value.result?.status !== "RECORDED" || !await matchesRepairCaseState(value.result.receipt, request)) throw new Error(); finish(request);
    } catch { setMessage("The result is unconfirmed. Keep this review open and check the saved decision before trying again."); }
    finally { setBusy(false); }
  }
  async function reconcile() {
    if (!pending) return; setBusy(true); setRetry(false);
    try {
      const response = await fetch(`${path}?requestId=${pending.requestId}`, { cache: "no-store", signal: AbortSignal.timeout(50_000) }), value = await response.json();
      if (!response.ok || !Object.hasOwn(value, "receipt")) throw new Error();
      if (value.receipt === null) { setRetry(true); setMessage("No decision receipt was found. You may retry the same reviewed request; current case checks still apply."); }
      else { if (!await matchesRepairCaseState(value.receipt, pending)) throw new Error(); finish(pending); }
    } catch { setMessage("The saved decision is still unconfirmed. Keep this review open and check again."); }
    finally { setBusy(false); }
  }
  function submit(action: RepairCaseStateRequest["action"]) {
    if (!review || busy || pending) return;
    const request = repairCaseStateRequestSchema.safeParse({ requestId: crypto.randomUUID(), caseId, action,
      acceptedScopeSha256: review.acceptedScopeSha256, expectedReviewContextSha256: review.reviewContextSha256,
      explanation: note, reviewedRepairFiles: filesChecked, reviewedFeedback: feedbackChecked });
    if (request.success) void save(request.data);
  }
  return <section className="material-support" aria-labelledby={heading}><h3 id={heading}>Resolve or reopen the existing repair case</h3>
    <p>Review every accepted affected document and the customer’s latest feedback. These actions do not accept new facts, rewrite files, approve drafts, or send anything.</p>
    <button disabled={busy || Boolean(pending)} onClick={load}>Load current case review</button><p role="status">{message}</p>
    {review && <><p>Case status: {review.state === "OPEN" ? "Open" : "Resolved"}.</p>
      <ul>{review.members.map((member) => <li key={member.fileVersionId}>{repairArtifactLabel[member.artifactType]} — {member.completed ? "accepted repair delivered" : "accepted repair unfinished"}</li>)}</ul>
      {!review.canResolve && <p>The complete accepted scope has not been delivered, or a newer repair version is unfinished. The case cannot be resolved yet.</p>}
      <h4>Customer feedback on repaired files</h4>{review.feedback.length === 0 ? <p>No follow-up feedback is recorded.</p> : <ul>{review.feedback.map((row) => <li key={row.requestId}>
        <button disabled={busy || Boolean(pending)} onClick={() => readFeedback(row.requestId)}>Read feedback from <time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString()}</time></button>
      </li>)}</ul>}
      {feedback && <section aria-label="Selected customer feedback">{feedback.items.map((item) => { const member = review.members.find((value) => value.artifactId === item.artifactId);
        return <p key={item.fileVersionId}>{member ? repairArtifactLabel[member.artifactType] : "Repaired document"}: {item.concern}</p>; })}</section>}
      <fieldset disabled={busy || Boolean(pending)}><legend>Explicit case decision</legend>
        <label>Reason for this case decision<textarea minLength={10} maxLength={4000} value={note} onChange={(event) => { setNote(event.target.value); setFilesChecked(false); setFeedbackChecked(false); }} /></label>
        <label><input type="checkbox" checked={filesChecked} onChange={(event) => setFilesChecked(event.target.checked)} />I reviewed the actual repaired files and every accepted affected document.</label>
        <label><input type="checkbox" checked={feedbackChecked} onChange={(event) => setFeedbackChecked(event.target.checked)} />I reviewed the latest customer feedback and current repair work.</label>
        <button disabled={review.state === "RESOLVED" || !review.canResolve || !filesChecked || !feedbackChecked || note.trim().length < 10} onClick={() => submit("RESOLVED")}>Mark reviewed case resolved</button>
        <button disabled={review.state !== "RESOLVED" || !filesChecked || !feedbackChecked || note.trim().length < 10} onClick={() => submit("REOPENED")}>Reopen existing case</button>
      </fieldset></>}
    {pending && <div><button disabled={busy} onClick={reconcile}>Check saved case decision</button> <button disabled={busy || !retry} onClick={() => save(pending)}>Retry the same case decision</button></div>}
  </section>;
}

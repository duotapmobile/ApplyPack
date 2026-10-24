"use client";

import { useState, type FormEvent } from "react";
import { formatEasternDeadline } from "@/lib/commerce/presentation";
import type { SearchInvitationCandidate } from "@/lib/commerce/search-invitation-queue";

export function SearchCheckoutInvitations({ candidates, unavailable }: {
  candidates: SearchInvitationCandidate[]; unavailable: boolean;
}) {
  return <section className="admin-table-wrap" aria-labelledby="search-invitations-title">
    <h2 id="search-invitations-title">Ready for a checkout invitation</h2>
    <p>Review the intake and current feasibility evidence before reserving the one daily search slot. Each invitation offers exactly ten reviewed jobs for $18.99 and expires after 15 minutes. The server checks capacity again when you issue it.</p>
    {unavailable ? <p role="alert">The invitation queue could not be verified. Refresh the page before issuing an invitation.</p>
      : candidates.length ? <>{candidates.map((candidate) => <InvitationForm key={`${candidate.draftId}:${candidate.snapshotId}:${candidate.assessmentId}`} candidate={candidate} />)}
        <p>Showing eligible intakes from the oldest 100 active completed intakes. Existing invitations remain reserved until they expire or complete checkout.</p></>
        : <p>No current completed intake has an eligible assessment. Finish feasibility review first, then refresh this page.</p>}
  </section>;
}

function InvitationForm({ candidate }: { candidate: SearchInvitationCandidate }) {
  const [rationale, setRationale] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [message, setMessage] = useState("");
  const [issued, setIssued] = useState<{ url: string; expiresAt: string } | null>(null);
  const id = candidate.draftId;

  async function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || attempted || issued || candidate.activeInvitationExpiresAt || !reviewed || rationale.trim().length < 20) return;
    setBusy(true);
    setAttempted(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/search-checkout-invitations", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId: id, snapshotId: candidate.snapshotId, assessmentId: candidate.assessmentId,
          rationale: rationale.trim(), expiresInMinutes: 15 }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "The invitation could not be issued.");
      if (typeof result.url !== "string" || typeof result.expiresAt !== "string") throw new Error("The invitation response was incomplete. Refresh the queue before retrying.");
      setIssued({ url: result.url, expiresAt: result.expiresAt });
      setMessage("Invitation created. Copy the private link and share it only with this customer through your approved support channel.");
    } catch (error) {
      setMessage(`${error instanceof Error ? error.message : "The request could not be confirmed."} Refresh the queue before trying again; an invitation may already have been reserved.`);
    } finally { setBusy(false); }
  }

  return <article className="admin-control">
    <h3>{candidate.email}</h3>
    <p>{candidate.direction} · {candidate.requirements}</p>
    <p>{candidate.eligibleJobs} preliminary eligible jobs. Assessment expires {formatEasternDeadline(candidate.assessmentExpiresAt)}.</p>
    <details><summary>Review identifiers</summary><p>Intake: {candidate.snapshotId}<br />Assessment: {candidate.assessmentId}</p></details>
    {candidate.activeInvitationExpiresAt ? <p role="status">An invitation or checkout is already active until {formatEasternDeadline(candidate.activeInvitationExpiresAt)}. Use the original private link; refresh after it expires before issuing another.</p>
      : issued ? <div>
        <label htmlFor={`invitation-link-${id}`}>Private invitation link</label>
        <input id={`invitation-link-${id}`} readOnly value={issued.url} onFocus={(event) => event.currentTarget.select()} />
        <p>Expires {formatEasternDeadline(issued.expiresAt)}. Copy it before leaving this page; the secret cannot be retrieved later.</p>
        <button type="button" onClick={async () => {
          try { await navigator.clipboard.writeText(issued.url); setMessage("Private invitation link copied."); }
          catch { setMessage("Copy the link from the selected field using your keyboard or device menu."); }
        }}>Copy invitation link</button>
      </div> : <form onSubmit={(event) => void issue(event)}>
        <label htmlFor={`invitation-review-${id}`}><input id={`invitation-review-${id}`} type="checkbox" checked={reviewed}
          onChange={(event) => setReviewed(event.target.checked)} disabled={busy} /> I reviewed this intake and its current evidence and can deliver ten reviewed jobs within the 24-hour service deadline.</label>
        <label htmlFor={`invitation-rationale-${id}`}>Why this search is ready</label>
        <textarea id={`invitation-rationale-${id}`} required minLength={20} maxLength={1000} value={rationale}
          onChange={(event) => setRationale(event.target.value)} disabled={busy} />
        <button type="submit" disabled={busy || attempted || !reviewed || rationale.trim().length < 20}>{busy ? "Reserving invitation…" : "Reserve slot and create invitation"}</button>
        {attempted && !busy ? <button type="button" onClick={() => window.location.reload()}>Refresh invitation queue</button> : null}
      </form>}
    <p role="status" aria-live="polite">{message}</p>
  </article>;
}

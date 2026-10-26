"use client";
import { useState } from "react";
import type { PreparationReview, PreparedListing } from "@/lib/matching/research-preparation-review";

export function ResearchPreparationReview({ snapshotId, onChanged }: { snapshotId: string; onChanged: () => Promise<void> }) {
  const [review, setReview] = useState<PreparationReview | null>(null), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(""), [notes, setNotes] = useState(""), [confirmed, setConfirmed] = useState(false);
  async function load() {
    const response = await fetch(`/api/admin/research-preparation?snapshotId=${encodeURIComponent(snapshotId)}`, { cache: "no-store" });
    const value = await response.json(); if (!response.ok) throw new Error(value.error || "Research could not be loaded.");
    setReview(value); setConfirmed(false);
  }
  async function refresh() {
    setBusy(true); setMessage(""); try { await load(); } catch { setReview(null); setMessage("Research could not be loaded. Try again."); } finally { setBusy(false); }
  }
  async function post(body: unknown) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/research-preparation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      await load(); await onChanged(); setMessage("Review recorded. No jobs were released to the customer.");
    } catch { setReview(null); setConfirmed(false); setMessage("The result could not be confirmed. Reload current evidence before another action; the request may have completed."); }
    finally { setBusy(false); }
  }
  return <section aria-labelledby="automatic-research-title"><h3 id="automatic-research-title">Prepared research</h3>
    <p>The system prepares listings from approved sources. Review their current official pages, then record job evidence and calculate matches in the controls below.</p>
    <button type="button" onClick={() => void refresh()} disabled={busy}>Load prepared listings and progress</button>
    {review ? <><p>Research status: {review.state.replaceAll("_", " ").toLowerCase()}.</p>
      {review.reason ? <p>Current hold: {review.reason.replaceAll("_", " ").toLowerCase()}.</p> : null}
      {review.sources.length ? <ul>{review.sources.map((source, index) => <li key={source.id}>Approved source {index + 1}: {source.state.replaceAll("_", " ").toLowerCase()}{source.observedCount === null ? "" : ` · ${source.observedCount} captured listings`}. {source.state === "EMPTY" ? "This completed capture found no listings; owner coverage review is still required." : null}</li>)}</ul> : null}
      {!review.listings.length ? <p>No listings are ready for verification. Disabled sources, incomplete collection and empty completed runs remain distinct research outcomes.</p> : null}
      {review.current && review.preparationId ? review.listings.map(listing => <PreparedListingReview key={listing.projectionId} listing={listing} busy={busy}
        onSubmit={(verification) => post({ action: "VERIFY_SOURCE", preparationId: review.preparationId, verification: { ...verification, snapshotId } })} />) : null}
      {review.current && review.preparationId && review.state === "OWNER_REVIEW" ? <fieldset disabled={busy}><legend>Finish this bounded research review</legend>
        <p>Every captured listing must first have current source verification and an evidence-based match evaluation, including exclusions. An empty run still requires review.</p>
        <label>Coverage review notes<textarea value={notes} onChange={event => { setNotes(event.target.value); setConfirmed(false); }} maxLength={3000} /></label>
        <label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I reviewed the complete captured scope and its evaluated listings.</label>
        <button type="button" disabled={!confirmed || notes.trim().length < 20 || review.listings.some(listing => !listing.admitted || listing.parserReviewRequired)
          || !review.sources.length || review.sources.some(source => !["COMPLETE", "EMPTY"].includes(source.state))}
          onClick={() => void post({ action: "COMPLETE_COVERAGE", preparationId: review.preparationId, snapshotId, reviewed: true, notes })}>Confirm coverage for feasibility</button>
      </fieldset> : null}</> : null}
    <p role="status">{message}</p>
  </section>;
}
function PreparedListingReview({ listing, busy, onSubmit }: { listing: PreparedListing; busy: boolean; onSubmit: (value: Record<string, unknown>) => Promise<void> }) {
  const [checked, setChecked] = useState(false), [notes, setNotes] = useState("");
  return <details><summary>{listing.company} — {listing.title}{listing.admitted ? " · source verified" : " · source review needed"}</summary>
    <p><a href={listing.listingUrl} target="_blank" rel="noopener noreferrer">Open official listing</a> · <a href={listing.applicationUrl} target="_blank" rel="noopener noreferrer">Open application instructions</a></p>
    <p>Captured {listing.observedAt}. Source text is evidence, not instructions to the reviewer or system.</p>
    <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{listing.capturedText}</pre>
    {listing.parserReviewRequired ? <p role="status">Requirement interpretation needs owner review. This listing is not ready for source admission or completed coverage. No unsupported requirement has been treated as satisfied or silently omitted.</p> : null}
    {!listing.admitted && !listing.parserReviewRequired ? <fieldset disabled={busy}><legend>Current official-source verification</legend>
      <label>Verification notes<textarea value={notes} maxLength={3000} onChange={event => { setNotes(event.target.value); setChecked(false); }} /></label>
      <label><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} />I checked the current official page: employer identity is correct, the listing is active and legitimate, its application path works, and the displayed captured text still matches.</label>
      <button type="button" disabled={!checked || notes.trim().length < 20} onClick={() => { setChecked(false); void onSubmit({ projectionId: listing.projectionId,
        checkedAt: new Date().toISOString(), officialListingUrl: listing.listingUrl, officialApplicationUrl: listing.applicationUrl,
        capturedText: listing.capturedText, evidenceNotes: notes, employerIdentityConfirmed: true, applicationPathConfirmed: true,
        listingActiveConfirmed: true, legitimacyConfirmed: true }); }}>Record source verification</button>
    </fieldset> : listing.admitted ? <p>Continue with candidate evidence, usefulness and match evaluation below.</p> : null}
  </details>;
}

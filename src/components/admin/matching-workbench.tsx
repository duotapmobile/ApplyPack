"use client";

import { useState } from "react";
import { MatchingGuidedControls } from "./matching-guided-controls";
import { ManualResearchControls } from "./manual-research-controls";
import { ManualSourceObservation, type ManualObservationSource } from "./manual-source-observation";
import { evidenceRecord, evidenceRows, evidenceText, type PreparedResearchOperation } from "./matching-review-form";

type CapturedListing = { id: string; label: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function MatchingWorkbench({ intakes = [] }: { intakes?: Array<{ id: string; label: string }> }) {
  const [snapshot, setSnapshot] = useState("");
  const [loadedSnapshot, setLoadedSnapshot] = useState("");
  const [packet, setPacket] = useState<unknown>(null);
  const [sources, setSources] = useState<ManualObservationSource[]>([]);
  const [captured, setCaptured] = useState<CapturedListing[]>([]);
  const [pending, setPending] = useState<PreparedResearchOperation | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [revision, setRevision] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const available = packet !== null && loadedSnapshot === snapshot;

  async function load(id = snapshot) {
    if (!intakes.some((intake) => intake.id === id)) throw new Error("Choose a current intake from the list.");
    const [packetResponse, sourcesResponse] = await Promise.all([
      fetch("/api/admin/matching-research?snapshotId=" + encodeURIComponent(id), { cache: "no-store" }),
      fetch("/api/admin/job-sources", { cache: "no-store" }),
    ]);
    const result = await packetResponse.json();
    if (!packetResponse.ok) throw new Error(result.error || "Current review evidence could not be loaded.");
    const sourceResult = await sourcesResponse.json().catch(() => ({}));
    setSources(sourcesResponse.ok && Array.isArray(sourceResult.sources) ? sourceResult.sources : []);
    setPacket(result); setLoadedSnapshot(id); setPending(null); setConfirmed(false); setNeedsRefresh(false);
    setRevision((current) => current + 1);
    if (!sourcesResponse.ok) setMessage("Review evidence loaded. Source permissions are unavailable; reload before capturing another listing.");
  }
  async function refresh() {
    setBusy(true); setMessage("");
    try { await load(); } catch (error) { setPacket(null); setPending(null); setMessage(error instanceof Error ? error.message : "Review evidence could not be loaded."); }
    finally { setBusy(false); }
  }
  function prepare(operation: PreparedResearchOperation) {
    if (busy || needsRefresh || !available) return;
    setPending(operation); setConfirmed(false); setMessage("");
  }
  async function recordOperation() {
    if (busy || !pending || !confirmed || needsRefresh) return;
    const operation = pending;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/" + operation.endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(operation.payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The reviewed operation was not accepted.");
      if (operation.endpoint === "job-source-manual-observations") {
        if (!uuid.test(result.jobSnapshotId || "")) throw new Error("The listing response was incomplete.");
        const posting = evidenceRecord(operation.payload.posting);
        const listing = { id: result.jobSnapshotId, label: evidenceText(posting.title) + " at " + evidenceText(posting.employerName) };
        setCaptured((current) => [...current.filter((item) => item.id !== listing.id), listing]);
      }
      if (operation.payload.action === "ADMIT") setCaptured((current) => current.filter((item) => item.id !== operation.payload.jobSnapshotId));
      await load();
      setMessage(operation.endpoint === "job-source-manual-observations"
        ? "Official listing recorded. Choose its research round below and admit it before leaving this page."
        : "Reviewed operation recorded. Current evidence has been reloaded; no jobs were released.");
    } catch (error) {
      setConfirmed(false);
      if (operation.endpoint !== "job-source-manual-observations") setNeedsRefresh(true);
      setMessage((error instanceof Error ? error.message : "The operation could not be confirmed.")
        + (operation.endpoint === "job-source-manual-observations"
          ? " An unchanged retry uses the same observation reference."
          : " Reload the evidence before making another change; the prior request may have completed."));
    } finally { setBusy(false); }
  }

  return <section aria-labelledby="matching-workbench">
    <h2 id="matching-workbench">Research and evidence review</h2>
    <p>Choose an intake, review official listings and confirmed candidate facts, then calculate each match. Questions and missing evidence remain unresolved. Customer release requires the separate final review.</p>
    <label>Customer intake<select value={snapshot} disabled={busy || Boolean(pending)} onChange={(event) => {
      setSnapshot(event.target.value); setPacket(null); setPending(null); setCaptured([]); setConfirmed(false); setNeedsRefresh(false);
    }}><option value="">Choose a current intake</option>{intakes.map((intake) => <option key={intake.id} value={intake.id}>{intake.label}</option>)}</select></label>
    {!intakes.length ? <p>No current intake is waiting for research.</p> : null}
    <button type="button" disabled={busy || !snapshot} onClick={() => void refresh()}>Load or refresh review evidence</button>
    {available ? <fieldset disabled={busy || Boolean(pending) || needsRefresh} key={revision}>
      <legend>Current intake research</legend>
      <MatchingGuidedControls snapshotId={snapshot} packet={packet} onPrepare={prepare} />
      <ManualSourceObservation sources={sources} busy={busy} onPrepare={(payload, summary) => prepare({
        endpoint: "job-source-manual-observations", payload, summary,
      })} />
      <AdmitListing snapshotId={snapshot} packet={packet} captured={captured} onPrepare={prepare} />
      <ManualResearchControls packet={packet} onPrepare={(payload) => prepare({
        endpoint: "matching-research", payload: evidenceRecord(payload),
        summary: "Complete the bounded manual research checklist. " + evidenceText(evidenceRecord(payload).notes),
      })} />
    </fieldset> : null}
    {pending ? <section aria-labelledby="prepared-research-title">
      <h3 id="prepared-research-title">Confirm this reviewed operation</h3>
      <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{pending.summary}</p>
      <label><input type="checkbox" checked={confirmed} disabled={busy || needsRefresh} onChange={(event) => setConfirmed(event.target.checked)} />I confirm this exact prepared operation and its evidence.</label>
      <button type="button" disabled={busy || needsRefresh || !confirmed} onClick={() => void recordOperation()}>{busy ? "Recording…" : "Record reviewed operation"}</button>
      <button type="button" disabled={busy || needsRefresh} onClick={() => { setPending(null); setConfirmed(false); }}>Cancel and revise</button>
    </section> : null}
    <p role="status" aria-live="polite">{message}</p>
  </section>;
}

function AdmitListing({ snapshotId, packet, captured, onPrepare }: {
  snapshotId: string; packet: unknown; captured: CapturedListing[]; onPrepare: (operation: PreparedResearchOperation) => void;
}) {
  const [listingId, setListingId] = useState("");
  const [planId, setPlanId] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const plans = evidenceRows(evidenceRecord(packet).ap_feasibility_coverage_plans)
    .filter((plan) => plan.snapshot_id === snapshotId && uuid.test(evidenceText(plan.inventory_version_id)));
  const listing = captured.find((item) => item.id === listingId);
  const plan = plans.find((item) => item.id === planId);
  return <fieldset><legend>Add a captured listing to this research</legend>
    {!captured.length ? <p>Record an official listing above first. Its verified record can then be added without copying an identifier.</p> : <>
      <label>Captured official listing<select value={listingId} onChange={(event) => { setListingId(event.target.value); setReviewed(false); }}><option value="">Choose the listing just recorded</option>{captured.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <label>Research round receiving this listing<select value={planId} onChange={(event) => { setPlanId(event.target.value); setReviewed(false); }}><option value="">Choose a current research round</option>{plans.map((item) => <option key={evidenceText(item.id)} value={evidenceText(item.id)}>Round {evidenceText(evidenceRecord(item.typed_inputs).round) || "recorded"} · {evidenceText(item.created_at)}</option>)}</select></label>
      <label><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} />I reviewed this captured listing and chose the appropriate research round for this customer.</label>
      <button type="button" disabled={!listing || !plan || !reviewed} onClick={() => onPrepare({
        endpoint: "matching-research", payload: { action: "ADMIT", snapshotId, inventoryVersionId: plan?.inventory_version_id, jobSnapshotId: listing?.id },
        summary: "Admit " + listing?.label + " to the selected customer research round. This does not approve its fit or release it.",
      })}>Prepare listing admission</button>
    </>}
  </fieldset>;
}

"use client";

import { useState } from "react";
import { commuteGateKey, commuteOrigin, commuteObservationSchema } from "@/lib/matching/commute-evidence";
import { evidenceRecord, evidenceRows, evidenceText, type EvidenceRow, type PreparedResearchOperation } from "./matching-review-form";

export function MatchingCommuteForm({ snapshotId, packet, member, onPrepare }: {
  snapshotId: string; packet: EvidenceRow; member: EvidenceRow; onPrepare: (operation: PreparedResearchOperation) => void;
}) {
  const [error, setError] = useState("");
  const [nodeId, setNodeId] = useState("");
  const snapshot = evidenceRows(packet.ap_intake_snapshots).find((item) => item.id === snapshotId);
  const origin = commuteOrigin({ travel: snapshot?.travel });
  const job = evidenceRecord(member.job_snapshot);
  const nodes = evidenceRows(packet.requirementNodes).filter((node) => node.job_snapshot_id === member.job_snapshot_id
    && node.node_kind === "CRITERION" && node.source_locator && node.source_excerpt
    && ["GEOGRAPHY", "WORK_MODE", "COMMUTE"].includes(evidenceText(evidenceRecord(node.typed_value).kind)));
  const node = nodes.find((item) => item.id === nodeId);
  if (!origin.zip || origin.maximumMiles == null) return <p role="status">This intake needs a confirmed starting ZIP and commute limit before a route can be approved. Ask for the missing information before final intake confirmation.</p>;
  return <form onChange={(event) => {
    const checkbox = event.currentTarget.elements.namedItem("reviewed") as HTMLInputElement | null;
    if (checkbox && (event.target as EventTarget) !== checkbox) checkbox.checked = false;
    setError("");
  }} onSubmit={(event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    try {
      if (!event.currentTarget.reportValidity() || values.get("reviewed") !== "on") throw new Error("Check the route and confirm the review before continuing.");
      const checked = new Date(String(values.get("checkedAt")));
      const observation = commuteObservationSchema.parse({ destinationNodeId: nodeId,
        destination: String(values.get("destination")).trim(), destinationPrecision: values.get("destinationPrecision"),
        method: values.get("method"), oneWayMiles: Number(values.get("oneWayMiles")), oneWayMinutes: Number(values.get("oneWayMinutes")),
        routeSourceUrl: String(values.get("routeSourceUrl")).trim(), checkedAt: checked.toISOString(),
        routeNotes: String(values.get("routeNotes")).trim(), reviewedOriginArea: true, reviewedExactWorksite: true });
      if (!node || !evidenceText(node.source_excerpt).includes(observation.destination)) throw new Error("Copy the actual worksite address or name exactly from the selected employer evidence. A city alone is insufficient.");
      const result = observation.oneWayMiles <= origin.maximumMiles! ? "RESOLVED_PASS" : "RESOLVED_FAIL";
      onPrepare({ endpoint: "matching-reviews", payload: { snapshotId, jobSnapshotId: member.job_snapshot_id,
        reviewKind: "CUSTOMER_CRITERION", customerCriterionKey: commuteGateKey({ travel: snapshot?.travel }),
        disposition: result, resolutionIssue: "NONE", unknownTreatment: "BLOCK", sourceEvidenceNodeIds: [nodeId], candidateFactIds: [],
        evidenceChanges: ["Reviewed the documented one-way route from the confirmed starting ZIP to the employer's exact worksite."],
        rationale: observation.routeNotes, commuteObservation: observation },
        summary: `${evidenceText(job.company)}: ${observation.oneWayMiles} miles / ${observation.oneWayMinutes} minutes one way by ${observation.method.toLowerCase()}, from ZIP ${origin.zip} to ${observation.destination}. Customer limit: ${origin.maximumMiles} miles. ${result === "RESOLVED_PASS" ? "Within" : "Outside"} that limit. ${observation.routeNotes}` });
    } catch (cause) {
      setError(cause instanceof Error && !cause.message.startsWith("[") ? cause.message : "Complete the route fields with valid measured values and the source you checked.");
    }
  }}>
    <p>Confirmed starting area: <strong>{origin.zip}</strong>. Maximum one-way commute: <strong>{origin.maximumMiles} miles</strong>.</p>
    <p>Check a real route yourself. Record the displayed distance and time; no journey is calculated here. ZIP-area estimates are not a home-address journey. Record any limitation in your review. Refresh this evidence within 24 hours of selection and delivery.</p>
    <label>Employer worksite evidence<select required value={nodeId} onChange={(event) => setNodeId(event.target.value)}>
      <option value="">Choose the listing evidence with the actual worksite</option>
      {nodes.map((item) => <option key={evidenceText(item.id)} value={evidenceText(item.id)}>{evidenceText(item.source_excerpt).slice(0, 220)}</option>)}
    </select></label>
    {node ? <blockquote>{evidenceText(node.source_excerpt)}</blockquote> : null}
    <label>Exact worksite name or address from that evidence<input name="destination" required minLength={6} maxLength={500} /></label>
    <label>Worksite detail<select name="destinationPrecision" required defaultValue=""><option value="">Choose</option><option value="STREET_ADDRESS">Street address</option><option value="NAMED_WORKSITE">Named, identifiable worksite</option></select></label>
    <label>Travel method<select name="method" required defaultValue=""><option value="">Choose the method checked</option><option value="DRIVE">Driving</option><option value="TRANSIT">Public transit</option><option value="WALK">Walking</option><option value="BICYCLE">Bicycling</option></select></label>
    <label>One-way route distance in miles<input name="oneWayMiles" type="number" required min="0.01" max="1000" step="0.01" /></label>
    <label>One-way route time in minutes<input name="oneWayMinutes" type="number" required min="0.1" max="1440" step="0.1" /></label>
    <label>Route source link<input name="routeSourceUrl" type="url" required maxLength={2000} placeholder="https://" /></label>
    <label>When you checked the route (your local time)<input name="checkedAt" type="datetime-local" required /></label>
    <label>Route conditions, limitations and review explanation<textarea name="routeNotes" required minLength={10} maxLength={1000} /></label>
    <label><input name="reviewed" type="checkbox" required />I checked this starting ZIP, the exact employer worksite, travel method and displayed one-way measurements. I did not substitute a city center or an employer commute limit for a checked route.</label>
    {error ? <p role="alert">{error}</p> : null}
    <button type="submit">Prepare commute review</button>
  </form>;
}

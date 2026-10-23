"use client";

import { useState } from "react";
import { MatchingReviewForm, evidenceRecord, evidenceRows, evidenceText, researchActions, type PreparedResearchOperation } from "./matching-review-form";

export function MatchingGuidedControls({ snapshotId, packet, onPrepare }: {
  snapshotId: string; packet: unknown; onPrepare: (operation: PreparedResearchOperation) => void;
}) {
  const data = evidenceRecord(packet);
  const [action, setAction] = useState<string>("BEGIN");
  const [memberId, setMemberId] = useState("");
  const members = evidenceRows(data.inventoryMembers).filter((member) => member.selected_by_deduplication === true);
  const member = members.find((item) => item.id === memberId);
  return <section aria-labelledby="guided-matching-title">
    <h3 id="guided-matching-title">Review research and evidence</h3>
    <label>Research action<select value={action} onChange={(event) => setAction(event.target.value)}>
      {researchActions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></label>
    {action !== "BEGIN" ? <label>Job to review<select value={memberId} onChange={(event) => setMemberId(event.target.value)}>
      <option value="">Choose a verified job</option>
      {members.map((item) => { const job = evidenceRecord(item.job_snapshot); return <option key={evidenceText(item.id)} value={evidenceText(item.id)}>{evidenceText(job.company)} — {evidenceText(job.exact_title)}</option>; })}
    </select></label> : null}
    {action === "BEGIN" || member ? <MatchingReviewForm key={snapshotId + ":" + action + ":" + memberId} snapshotId={snapshotId}
      packet={data} action={action} member={member} onPrepare={onPrepare} /> : <p>Select a job already admitted to this research inventory. Capture and admit an official listing below if needed.</p>}
  </section>;
}

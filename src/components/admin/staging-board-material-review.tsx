"use client";

import { useState } from "react";
import type { StagingBoardReviewJob as Job } from "@/lib/job-board/staging-review";

export function StagingBoardMaterialReview({ initialJobs }: { initialJobs: Job[] }) {
  const [jobs, setJobs] = useState(initialJobs);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [attestations, setAttestations] = useState<Record<string, string>>({});
  if (!initialJobs.length) return null;
  async function review(job: Job) {
    setBusy(job.id); setMessage("");
    const response = await fetch("/api/admin/staging-board-material-review", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: job.id, attestation: attestations[job.id] || "",
        resumeRequirement: "OPTIONAL", coverLetterRequirement: "OPTIONAL",
        allowedFormats: ["DOCX", "PDF"], submissionChannel: "HTTPS_UPLOAD" }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(null);
    setMessage(response.ok ? `Recorded the current fictional listing and instruction review for ${job.title}.`
      : String(body.error || "The review could not be recorded."));
    if (response.ok) setJobs((prior) => prior.map((item) => item.id === job.id
      ? { ...item, materialsReady: true, snapshotId: String(body.snapshotId), ruleCheckedAt: String(body.reviewedAt) } : item));
  }
  return <section className="admin-table-wrap" aria-labelledby="staging-board-review-heading">
    <div className="portal-section__heading"><div><p className="eyebrow">STAGING ONLY</p>
      <h2 id="staging-board-review-heading">Fictional board materials preflight</h2></div>
      <p>These records exercise board-origin $8 checkout. They never prove a real source, employer, or vacancy.</p></div>
    {message ? <p role="status">{message}</p> : null}
    <div className="material-staff-grid">{jobs.map((job) => <article key={job.id}>
      <h3>{job.title}</h3><p>{job.company}</p>
      <p>Status: <strong>{job.materialsReady ? "Current human rule recorded" : "Human review required"}</strong></p>
      <a href={job.source_url} target="_blank" rel="noreferrer">Inspect fictional application page</a>
      <label>Review attestation
        <textarea value={attestations[job.id] || ""} onChange={(event) => setAttestations((prior) => ({ ...prior, [job.id]: event.target.value }))}
          placeholder="I inspected the fictional listing, application path, accepted DOCX/PDF instructions, and injection-safe content." />
      </label>
      <button disabled={busy === job.id || (attestations[job.id] || "").trim().length < 30} onClick={() => void review(job)}>
        {busy === job.id ? "Recording..." : "Record current review"}
      </button>
    </article>)}</div>
  </section>;
}

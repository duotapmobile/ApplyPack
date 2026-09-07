"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type MaterialStaffFile = {
  artifactType: string;
  fileVersionId: string;
  version: number;
  filename: string;
  automatedPassed: boolean;
  contentApproved: boolean;
  visualApproved: boolean;
  rendererIdentity: string | null;
  arialResolved: boolean;
};

export type MaterialStaffLine = {
  lineId: string;
  fulfillment: string;
  substitution: string;
  dueAt: string | null;
  activeRevision: number;
  revisionId: string | null;
  jobSnapshotId: string | null;
  sourceSnapshotId: string | null;
  company: string;
  title: string;
  submissionRuleId: string | null;
  ruleSha256: string | null;
  generationCheckAt: string | null;
  releaseCheckAt: string | null;
  files: MaterialStaffFile[];
  openProposalKind: string | null;
  openSupportCases: number;
  regeneration: { id: string; state: string; dueAt: string | null } | null;
};

export function Chunk5MaterialStaffQueue({ lines }: { lines: MaterialStaffLine[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [messages, setMessages] = useState<Record<string, string>>( {} );
  const [attestations, setAttestations] = useState<Record<string, string>>( {} );
  const [generationJson, setGenerationJson] = useState<Record<string, string>>( {} );
  const [proposalJson, setProposalJson] = useState<Record<string, string>>( {} );

  async function action(lineId: string, body: Record<string, unknown>) {
    setBusy(lineId);
    setMessages((current) => ({ ...current, [lineId]: "" }));
    try {
      const response = await fetch(`/api/admin/material-lines/${lineId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The guarded staff action failed.");
      setMessages((current) => ({ ...current, [lineId]: "The guarded staff action was recorded." }));
      router.refresh();
    } catch (error) {
      setMessages((current) => ({ ...current, [lineId]: error instanceof Error ? error.message : "The guarded staff action failed." }));
    } finally {
      setBusy("");
    }
  }

  async function generate(line: MaterialStaffLine, regeneration = false) {
    setBusy(line.lineId);
    setMessages((current) => ({ ...current, [line.lineId]: "" }));
    try {
      let body: Record<string, unknown>;
      if (regeneration && line.regeneration) {
        body = { mode: "REFERENCE_REGENERATION", regenerationId: line.regeneration.id, requestId: crypto.randomUUID() };
      } else {
        const parsed = JSON.parse(generationJson[line.lineId] || "{}") as Record<string, unknown>;
        body = { ...parsed, mode: "LINE", requestId: crypto.randomUUID() };
      }
      const response = await fetch(`/api/admin/material-lines/${line.lineId}/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Generation failed closed.");
      setMessages((current) => ({ ...current, [line.lineId]: "New private artifact versions passed automated registration and await separate human approvals." }));
      router.refresh();
    } catch (error) {
      setMessages((current) => ({ ...current, [line.lineId]: error instanceof Error ? error.message : "Generation JSON is invalid." }));
    } finally {
      setBusy("");
    }
  }

  async function submitProposal(line: MaterialStaffLine) {
    try {
      const parsed = JSON.parse(proposalJson[line.lineId] || "{}") as Record<string, unknown>;
      await action(line.lineId, { ...parsed, idempotencyKey: crypto.randomUUID() });
    } catch {
      setMessages((current) => ({ ...current, [line.lineId]: "Proposal JSON is invalid." }));
    }
  }

  if (!lines.length) return <section className="admin-table-wrap"><div className="portal-section__heading"><div><p className="eyebrow">CHUNK 5 MATERIALS</p><h2>Evidence-bound materials queue</h2></div><p>No corrected materials work is waiting.</p></div></section>;
  return <section className="admin-table-wrap" aria-labelledby="chunk5-material-heading">
    <div className="portal-section__heading"><div><p className="eyebrow">CHUNK 5 MATERIALS</p><h2 id="chunk5-material-heading">Evidence-bound materials queue</h2></div><p>Listing checks, generation, content approval, visual approval, and atomic release are separate guarded actions. Reference PII is never shown here.</p></div>
    <div className="material-staff-grid">{lines.map((line) => {
      const attestation = attestations[line.lineId] || "";
      return <article key={line.lineId}>
        <p className="eyebrow">{humanize(line.fulfillment)}</p><h3>{line.title}</h3><p><strong>{line.company}</strong></p>
        <dl><div><dt>Line</dt><dd>{line.lineId}</dd></div><div><dt>Revision</dt><dd>{line.activeRevision} · {line.revisionId || "Unavailable"}</dd></div><div><dt>Deadline</dt><dd>{line.dueAt ? eastern(line.dueAt) : "Not started"}</dd></div><div><dt>Submission rule</dt><dd>{line.submissionRuleId || "Missing"}</dd></div><div><dt>Rule evidence</dt><dd>{line.ruleSha256 || "Missing"}</dd></div><div><dt>Pre-generation check</dt><dd>{line.generationCheckAt ? eastern(line.generationCheckAt) : "Required"}</dd></div><div><dt>Pre-release check</dt><dd>{line.releaseCheckAt ? eastern(line.releaseCheckAt) : "Required"}</dd></div></dl>
        {line.openProposalKind ? <p className="match-warning">An open {humanize(line.openProposalKind)} proposal awaits customer action.</p> : null}
        {line.openSupportCases ? <p className="match-warning">{line.openSupportCases} private factual-support case{line.openSupportCases === 1 ? "" : "s"} requires protected review.</p> : null}
        <div className="admin-buttons"><button disabled={busy === line.lineId || !line.submissionRuleId || !line.ruleSha256} onClick={() => action(line.lineId, { action: "LISTING_CHECK", phase: "BEFORE_GENERATION", result: "ACTIVE", submissionRuleId: line.submissionRuleId, evidenceSha256: line.ruleSha256 })}>Record active pre-generation check</button><button disabled={busy === line.lineId || !line.submissionRuleId || !line.ruleSha256} onClick={() => action(line.lineId, { action: "LISTING_CHECK", phase: "BEFORE_GENERATION", result: "CLOSED", submissionRuleId: line.submissionRuleId, evidenceSha256: line.ruleSha256 })}>Record closed listing</button><button disabled={busy === line.lineId || !line.submissionRuleId || !line.ruleSha256} onClick={() => action(line.lineId, { action: "LISTING_CHECK", phase: "BEFORE_GENERATION", result: "INSTRUCTION_BLOCKED", submissionRuleId: line.submissionRuleId, evidenceSha256: line.ruleSha256 })}>Record blocking instruction</button></div>
        <details className="staff-review-evidence"><summary>Evidence-bound generation input</summary><p>Paste only reviewed content plus candidate-fact and job-evidence IDs. Contact and permitted reference details are injected server-side.</p><textarea rows={16} spellCheck="false" value={generationJson[line.lineId] || ""} onChange={(event) => setGenerationJson((current) => ({ ...current, [line.lineId]: event.target.value }))} /><button disabled={busy === line.lineId || !line.generationCheckAt} onClick={() => generate(line)}>Generate, scan, and locally render</button></details>
        {line.regeneration ? <div className="deadline-note"><strong>Reference regeneration:</strong> {humanize(line.regeneration.state)}{line.regeneration.dueAt ? ` · ${eastern(line.regeneration.dueAt)}` : ""}. <button disabled={busy === line.lineId || line.regeneration.state !== "ACTIVE"} onClick={() => generate(line, true)}>Generate deterministic replacement</button><button disabled={busy === line.lineId || line.regeneration.state !== "HUMAN_REVIEW"} onClick={() => action(line.lineId, { action: "COMMIT_REFERENCE_REGENERATION", regenerationId: line.regeneration!.id })}>Release approved replacement</button></div> : null}
        {line.files.length ? <div className="material-staff-files">{line.files.map((file) => <article key={file.fileVersionId}><h4>{humanize(file.artifactType)} · version {file.version}</h4><p>{file.filename}</p><p>Automated: {file.automatedPassed ? "passed" : "blocked"} · Arial: {file.arialResolved ? "resolved" : "blocked"}</p>{file.rendererIdentity ? <p>Renderer: {file.rendererIdentity}</p> : null}<a href={`/api/admin/material-files/${file.fileVersionId}/render-preview`} target="_blank" rel="noreferrer">Open private rendered pages</a><div className="admin-buttons"><button disabled={busy === line.lineId || !file.automatedPassed || file.contentApproved || attestation.trim().length < 20} onClick={() => action(line.lineId, { action: "APPROVE", fileVersionId: file.fileVersionId, approvalKind: "CONTENT", attestation })}>Record content approval</button><button disabled={busy === line.lineId || !file.automatedPassed || file.visualApproved || attestation.trim().length < 20} onClick={() => action(line.lineId, { action: "APPROVE", fileVersionId: file.fileVersionId, approvalKind: "VISUAL", attestation })}>Record visual approval</button></div></article>)}</div> : null}
        <label>Approval or release attestation <span>(minimum 20 characters)</span><textarea maxLength={2_000} value={attestation} onChange={(event) => setAttestations((current) => ({ ...current, [line.lineId]: event.target.value }))} /></label>
        <div className="admin-buttons"><button disabled={busy === line.lineId || !line.submissionRuleId || !line.ruleSha256} onClick={() => action(line.lineId, { action: "LISTING_CHECK", phase: "BEFORE_RELEASE", result: "ACTIVE", submissionRuleId: line.submissionRuleId, evidenceSha256: line.ruleSha256 })}>Record final active check</button><button disabled={busy === line.lineId || line.fulfillment !== "READY_TO_RELEASE" || attestation.trim().length < 20} onClick={() => action(line.lineId, { action: "RELEASE", rationale: attestation })}>Commit atomic customer release</button><button disabled={busy === line.lineId || line.fulfillment === "DELIVERED"} onClick={() => action(line.lineId, { action: "REFUND_LINE", reasonCode: "STAFF_CONFIRMED_LINE_REFUND" })}>Start full $8 line refund</button></div>
        <details className="staff-review-evidence"><summary>Substitution, fact correction, or reference-scope action</summary><p>Use a reviewed action object. The server adds a fresh idempotency key and all database locks and capacity gates still apply.</p><textarea rows={8} spellCheck="false" value={proposalJson[line.lineId] || ""} onChange={(event) => setProposalJson((current) => ({ ...current, [line.lineId]: event.target.value }))} /><button disabled={busy === line.lineId} onClick={() => submitProposal(line)}>Submit guarded action</button></details>
        <p className={messages[line.lineId] ? "form-message" : "sr-only"} role="status" aria-live="polite">{messages[line.lineId] || "No action submitted."}</p>
      </article>;
    })}</div>
  </section>;
}

function humanize(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
}

function eastern(value: string) {
  return new Date(value).toLocaleString("en-US", { timeZone: "America/New_York" }) + " ET";
}

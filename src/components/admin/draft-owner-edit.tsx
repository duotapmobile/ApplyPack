"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { DraftOwnerEditModel } from "@/lib/documents/draft-owner-edit";
import type { DraftProseClaim } from "@/lib/documents/draft-output";

type Props = { jobId: string; versionId: string; sourceSha256: string; packetSha256: string; validUntil: string;
  model: DraftOwnerEditModel; disabled: boolean; onLockChange: (locked: boolean) => void };
const emptyClaim = (): DraftProseClaim => ({ text: "", sourceAtomIds: [], jobEvidenceIds: [], questionIds: [], relation: "DIRECT" });
const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const uuid = (value: unknown) => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);

export function DraftOwnerEdit({ model, ...props }: Props) {
  const router = useRouter(), [open, setOpen] = useState(false), [output, setOutput] = useState(() => structuredClone(model.output));
  const [attempted, setAttempted] = useState(false), [message, setMessage] = useState(""), [confirmed, setConfirmed] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const controller = useRef<AbortController | null>(null), latch = useRef(false);
  const pending = useRef<{ requestId: string; body: string } | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const expired = () => Date.now() >= Date.parse(props.validUntil);
  const update = (change: (next: typeof output) => void) => { setOutput((prior) => { const next = structuredClone(prior); change(next); return next; }); setConfirmed(false); };
  function begin() { if (props.disabled || expired()) return; setOutput(structuredClone(model.output)); setOpen(true); props.onLockChange(true); }
  function cancel() { if (attempted) return; setOpen(false); setConfirmed(false); setOutput(structuredClone(model.output)); props.onLockChange(false); }
  async function save(reconcile = false) {
    if (latch.current || props.disabled || expired() || (reconcile ? !uncertain || !pending.current : attempted || !confirmed)) return;
    if (!reconcile) { const requestId = crypto.randomUUID(); pending.current = { requestId, body: JSON.stringify({ action: "SAVE_OWNER_EDIT",
      expectedVersionId: props.versionId, expectedSourceSha256: props.sourceSha256, requestId, output }) }; }
    const request = pending.current!;
    latch.current = true; setAttempted(true); setUncertain(false); setMessage(reconcile ? "Checking the same saved edit request…" : "Saving a new review version…");
    const abort = new AbortController(); controller.current = abort; const timer = setTimeout(() => abort.abort(), 65_000);
    try {
      const response = await fetch(`/api/admin/material-draft-jobs/${props.jobId}`, { method: "POST", cache: "no-store", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, signal: abort.signal,
        body: request.body });
      const result: unknown = await response.json();
      if ((response.status === 400 && result && typeof result === "object" && "error" in result && result.error === "The document action is incomplete. Review the current version and try again.")
        || (response.status === 422 && result && typeof result === "object" && "editRejected" in result && result.editRejected === true)) {
        pending.current = null; setAttempted(false); setConfirmed(false);
        setMessage("This edit was rejected before a new version was saved. Review the wording, required source selections, and recorded limitations, then confirm the corrected edit."); return;
      }
      if (!response.ok || !result || typeof result !== "object" || !("action" in result) || result.action !== "SAVE_OWNER_EDIT" || !("result" in result)
        || !result.result || typeof result.result !== "object") throw new Error("unconfirmed");
      const receipt = result.result as Record<string, unknown>;
      if (receipt.jobId !== props.jobId || receipt.requestId !== request.requestId || !uuid(receipt.versionId) || receipt.versionId === props.versionId
        || receipt.packetSha256 !== props.packetSha256 || !hash(receipt.sourceSha256) || receipt.sourceSha256 === props.sourceSha256
        || receipt.state !== "OWNER_REVIEW_REQUIRED" || receipt.deliveryAuthorized !== false) throw new Error("unconfirmed");
      setMessage("New version saved. Previous wording review, rendered files and approval no longer authorize delivery. Reload to review the new version."); router.refresh();
      pending.current = null;
    } catch { setUncertain(true); setMessage("The save result could not be confirmed. Your edits remain visible here. Reconcile the same saved edit request or reload the current version; no automatic retry, approval or send was started."); }
    finally { clearTimeout(timer); controller.current = null; latch.current = false; }
  }
  function claimEditor(claim: DraftProseClaim, title: string, change: (claim: DraftProseClaim) => void, remove: (() => void) | null, anchor?: string) {
    const options = model.sources.filter((item) => item.disposition !== "NEGATIVE_DO_NOT_ASSERT" && (!anchor || item.factId === anchor || item.parentFactId === anchor));
    return <fieldset key={title}><legend>{title}</legend>
      <label>{title} wording<textarea value={claim.text} maxLength={1200} onChange={(event) => change({ ...claim, text: event.target.value })} /></label>
      <label>{title} evidence relationship<select value={claim.relation} onChange={(event) => change({ ...claim, relation: event.target.value as DraftProseClaim["relation"] })}>
        <option value="DIRECT">Directly supported</option><option value="TRANSFERABLE">Related experience; preserve the distinction</option><option value="QUALIFIED">Limited, uncertain or still in progress</option></select></label>
      <details><summary>Confirmed sources for {title.toLowerCase()}</summary><p>Select the actual supporting facts. A source selection does not establish that the new wording is true.</p>
        {options.map((option) => <label key={option.id}><input type="checkbox" checked={claim.sourceAtomIds.includes(option.id)} onChange={(event) => change({ ...claim,
          sourceAtomIds: event.target.checked ? [...claim.sourceAtomIds, option.id] : claim.sourceAtomIds.filter((id) => id !== option.id) })} />{option.label}: {option.value}{option.localOnly ? " (identity or date context; not enough by itself)" : ""}{option.disposition === "LIMITED_OR_UNKNOWN_DO_NOT_UPGRADE" ? " — keep the recorded limit" : ""}</label>)}
      </details>
      {claim.jobEvidenceIds.length ? <p>Existing employer-evidence links stay attached and will be rechecked against the selected facts.</p> : null}
      {claim.questionIds.length ? <p>Existing employer-question context stays attached as tailoring context only.</p> : null}
      {remove ? <button type="button" onClick={remove}>Remove {title.toLowerCase()}</button> : null}
    </fieldset>;
  }
  if (!open) return <section aria-label="Edit document wording"><h3>Edit document wording</h3><p>You can edit the summary, skills, experience bullets and letter body, including after viewing rendered previews. Identity, employer and role names, dates, education and reference details remain tied to confirmed records.</p><button type="button" disabled={props.disabled} onClick={begin}>Edit wording</button></section>;
  return <section aria-label="Edit document wording"><h3>Edit wording for a new version</h3>
    <p>Contact details, factual headings, dates, education and references are read-only in the saved document above. Correct underlying facts through the confirmed-intake process. Editing does not approve or send anything.</p>
    <fieldset disabled={attempted || props.disabled}><legend>Resume and cover-letter wording</legend>
      <h4>Resume summary</h4>{output.resume.summary.map((claim, index) => claimEditor(claim, `Summary ${index + 1}`, (value) => update((next) => { next.resume.summary[index] = value; }), () => update((next) => { next.resume.summary.splice(index, 1); })))}
      <button type="button" disabled={output.resume.summary.length >= 3} onClick={() => update((next) => { next.resume.summary.push(emptyClaim()); })}>Add summary statement</button>
      <h4>Skills</h4>{output.resume.skills.map((claim, index) => claimEditor(claim, `Skill ${index + 1}`, (value) => update((next) => { next.resume.skills[index] = value; }), () => update((next) => { next.resume.skills.splice(index, 1); })))}
      <button type="button" disabled={output.resume.skills.length >= 20} onClick={() => update((next) => { next.resume.skills.push(emptyClaim()); })}>Add skill</button>
      {output.resume.sections.map((section, index) => <section key={section.anchorFactId}><h4>{model.sections[index]?.label || "Confirmed experience"}</h4>
        {section.bullets.map((claim, item) => claimEditor(claim, `Experience ${index + 1} bullet ${item + 1}`, (value) => update((next) => { next.resume.sections[index].bullets[item] = value; }), section.bullets.length > 1 ? () => update((next) => { next.resume.sections[index].bullets.splice(item, 1); }) : null, section.anchorFactId))}
        <button type="button" disabled={section.bullets.length >= 10} onClick={() => update((next) => { next.resume.sections[index].bullets.push(emptyClaim()); })}>Add bullet to experience {index + 1}</button></section>)}
      <h4>Cover-letter body</h4>{output.coverLetter.body.map((paragraph, index) => <section key={index}><h5>Paragraph {index + 1}</h5>
        {paragraph.sentences.map((claim, item) => claimEditor(claim, `Letter paragraph ${index + 1} sentence ${item + 1}`, (value) => update((next) => { next.coverLetter.body[index].sentences[item] = value; }), paragraph.sentences.length > 1 ? () => update((next) => { next.coverLetter.body[index].sentences.splice(item, 1); }) : null))}
        <button type="button" disabled={paragraph.sentences.length >= 4} onClick={() => update((next) => { next.coverLetter.body[index].sentences.push(emptyClaim()); })}>Add sentence to paragraph {index + 1}</button>
        {output.coverLetter.body.length > 1 ? <button type="button" onClick={() => update((next) => { next.coverLetter.body.splice(index, 1); })}>Remove paragraph {index + 1}</button> : null}</section>)}
      <button type="button" disabled={output.coverLetter.body.length >= 3} onClick={() => update((next) => { next.coverLetter.body.push({ sentences: [emptyClaim()] }); })}>Add letter paragraph</button>
      <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I want to save these edits as a new version and repeat wording, rendered-file and approval checks before a separate Send action.</label>
      <button type="button" disabled={!confirmed || JSON.stringify(output) === JSON.stringify(model.output)} onClick={() => void save()}>Save new review version</button><button type="button" onClick={cancel}>Cancel edits</button>
    </fieldset>{uncertain ? <button type="button" disabled={props.disabled} onClick={() => void save(true)}>Reconcile saved edit</button> : null}<p role="status" aria-live="polite">{message}</p>
  </section>;
}

"use client";

import { useEffect, useRef, useState } from "react";
import type { DraftOutput, DraftProseClaim } from "@/lib/documents/draft-output";
import { buildRepairAuthoringRequest, readRepairAuthoringJson, readRepairAuthoringReceipt, readRepairAuthoringView, RepairAuthoringSizeError,
  type RepairAuthoringChoice, type RepairAuthoringRequest, type RepairAuthoringView } from "@/lib/materials/service-repair-authoring-client";
import styles from "./draft-owner-workspace.module.css";

type Props = { caseId: string; materialLineId: string; versionId: string; onSaved?: () => void };
type Pending = { request: RepairAuthoringRequest; body: string; uncertain: boolean; sourceSha256?: string };
const emptyClaim = (): DraftProseClaim => ({ text: "", sourceAtomIds: [], jobEvidenceIds: [], questionIds: [], relation: "DIRECT" });
const artifactName = (type: string) => type === "RESUME" ? "Resume" : type === "COVER_LETTER" ? "Cover letter" : "Reference sheet";
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }

export function ServiceRepairAuthoring(props: Props) {
  return <RepairAuthoringForm key={`${props.caseId}:${props.materialLineId}:${props.versionId}`} {...props} />;
}
function RepairAuthoringForm({ caseId, materialLineId, versionId, onSaved }: Props) {
  const [view, setView] = useState<RepairAuthoringView | null>(null), [choices, setChoices] = useState<RepairAuthoringChoice[]>([]);
  const [message, setMessage] = useState("Loading the original confirmed repair evidence…"), [confirmed, setConfirmed] = useState(false);
  const [phase, setPhase] = useState<"EDIT" | "BUSY" | "UNKNOWN" | "RETRY" | "REJECTED" | "SAVED">("EDIT");
  const lifetime = useRef<AbortController | null>(null), latch = useRef(false), pending = useRef<Pending | null>(null), notice = useRef<HTMLParagraphElement | null>(null);
  const endpoint = `/api/admin/service-errors/${caseId}/repairs/${materialLineId}/source`;
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    const timer = setTimeout(() => { setMessage("Loading the original repair evidence timed out. Reload to try again."); controller.abort(); }, 65_000);
    fetch(`${endpoint}?versionId=${versionId}`, { cache: "no-store", credentials: "same-origin", signal: controller.signal }).then(async response => {
      const data = record(await readRepairAuthoringJson(response, controller.signal)); if (!response.ok || !data) throw new Error("unavailable");
      const current = readRepairAuthoringView(data.view, { caseId, materialLineId, versionId });
      if (!controller.signal.aborted) { setView(current); setChoices(current.members.map(member => ({ repairMode: "", output: member.model ? structuredClone(member.model.output) : null })));
        setMessage(current.sourceSaved ? "Source content is already saved for this version. Continue with its separate wording review." : ""); }
    }).catch(() => { if (!controller.signal.aborted) setMessage("The original repair evidence could not be loaded. Reload after checking administrator access."); })
      .finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); controller.abort(); };
  }, [caseId, materialLineId, versionId, endpoint]);
  const locked = phase !== "EDIT" || Boolean(view?.sourceSaved);
  function update(index: number, change: (choice: RepairAuthoringChoice) => void) {
    if (locked) return; setChoices(previous => { const next = structuredClone(previous); change(next[index]); return next; }); setConfirmed(false);
  }
  function outputChange(index: number, change: (output: DraftOutput) => void) { update(index, choice => { if (choice.output) change(choice.output); }); }
  function say(text: string) { setMessage(text); queueMicrotask(() => notice.current?.focus()); }
  async function act(action: "SAVE" | "CHECK", retry = false) {
    if (latch.current || !view || !lifetime.current || lifetime.current.signal.aborted || view.sourceSaved || phase === "SAVED") return;
    if (action === "SAVE" && !retry) {
      if (phase !== "EDIT" || !confirmed) return;
      try { const request = buildRepairAuthoringRequest(view, choices, crypto.randomUUID()); pending.current = { request, body: JSON.stringify(request), uncertain: false }; }
      catch (error) { setConfirmed(false); say(error instanceof RepairAuthoringSizeError ? error.message : "Check each repair choice, wording and supporting source selection. Only affected prose can change; choose an unchanged-source rerender when the content is already correct."); return; }
    } else if (!pending.current || (action === "CHECK" ? !["UNKNOWN", "RETRY"].includes(phase) : phase !== "RETRY")) return;
    const attempt = pending.current!; latch.current = true; setPhase("BUSY");
    setMessage(action === "CHECK" ? "Checking this exact saved request…" : "Saving the selected repair source…");
    const controller = new AbortController(), cancel = () => controller.abort(), active = lifetime.current;
    active.signal.addEventListener("abort", cancel, { once: true }); const timer = setTimeout(cancel, 65_000);
    try {
      const response = await fetch(endpoint, { method: "POST", cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        signal: controller.signal, body: `{"action":"${action}","request":${attempt.body}}` });
      const data = record(await readRepairAuthoringJson(response, controller.signal)); if (controller.signal.aborted) throw new Error("unconfirmed");
      if (response.status === 422 && data?.code === "WORDING_INVALID" && action === "SAVE" && !attempt.uncertain && !retry) {
        setConfirmed(false); setPhase("REJECTED"); say("The wording was rejected before this request saved content. Your wording remains below. Revise it explicitly, then confirm it again before saving."); return;
      }
      if (!response.ok || !data) throw new Error("unconfirmed");
      const receipt = readRepairAuthoringReceipt(data.receipt, attempt.request, attempt.sourceSha256);
      if (receipt.state !== "WORDING_REVIEW_REQUIRED") {
        if (action !== "CHECK" || !receipt.retryAllowed) throw new Error("unconfirmed");
        // A not-yet-stored source gets its timestamp on the explicit retry. Once
        // bytes exist, every later receipt must retain their exact source hash.
        if (receipt.state === "SOURCE_STORED") attempt.sourceSha256 = receipt.sourceSha256;
        setPhase("RETRY"); say(receipt.state === "SOURCE_STORED" ? "The exact private source is stored but not attached. You may retry this same request."
          : "No content is saved for this request. You may explicitly retry the identical request."); return;
      }
      pending.current = null; setConfirmed(false); setPhase("SAVED");
      say("Repair source saved. Every affected file still needs fresh wording review, rendering, visual approval and a separate Send action.");
      // A parent refresh failure cannot turn a verified saved receipt into an
      // uncertain write or make the original request eligible for another save.
      try { onSaved?.(); } catch { /* The verified result remains visible here. */ }
    } catch {
      attempt.uncertain = true;
      if (!active.signal.aborted) { setPhase("UNKNOWN"); say("The save result is not confirmed. Your exact request is held in memory. Check its saved result before any retry; no approval or delivery was started."); }
    } finally { clearTimeout(timer); active.signal.removeEventListener("abort", cancel); latch.current = false; }
  }
  function cardName(index: number) {
    const member = view!.members[index], name = artifactName(member.artifactType);
    return view!.members.filter(item => item.artifactType === member.artifactType).length > 1 ? `${name} affected file ${index + 1}` : name;
  }
  function fieldLabel(index: number, label: string) { return cardName(index) === artifactName(view!.members[index].artifactType) ? label : `${cardName(index)} · ${label}`; }
  function claimEditor(index: number, entry: DraftProseClaim, baseLabel: string, change: (value: DraftProseClaim) => void, remove?: () => void, anchor?: string) {
    const label = fieldLabel(index, baseLabel);
    const options = view!.members[index].model!.sources.filter(source => source.disposition !== "NEGATIVE_DO_NOT_ASSERT" && (!anchor || source.factId === anchor || source.parentFactId === anchor));
    return <fieldset key={label}><legend>{label}</legend><label>{label} wording<textarea value={entry.text} maxLength={1200} onChange={event => change({ ...entry, text: event.target.value })} /></label>
      <label>{label} evidence relationship<select value={entry.relation} onChange={event => change({ ...entry, relation: event.target.value as DraftProseClaim["relation"] })}>
        <option value="DIRECT">Directly supported</option><option value="TRANSFERABLE">Related experience; preserve the distinction</option><option value="QUALIFIED">Limited, uncertain or still in progress</option></select></label>
      <details><summary>Confirmed sources for {label.toLowerCase()}</summary><p>Choose actual support. A checked source does not establish that the new wording is true.</p>
        {options.map(source => <label key={source.id}><input type="checkbox" checked={entry.sourceAtomIds.includes(source.id)} onChange={event => change({ ...entry,
          sourceAtomIds: event.target.checked ? [...entry.sourceAtomIds, source.id] : entry.sourceAtomIds.filter(id => id !== source.id) })} />{source.label}: {source.value}
          {source.localOnly ? " (identity or date context; insufficient by itself)" : ""}{source.disposition === "LIMITED_OR_UNKNOWN_DO_NOT_UPGRADE" ? " — preserve this limit" : ""}</label>)}</details>
      {entry.jobEvidenceIds.length > 0 && <p>Existing employer-evidence links remain and will be checked again.</p>}
      {entry.questionIds.length > 0 && <p>Employer questions remain tailoring context, not candidate facts.</p>}
      {remove && <button type="button" onClick={remove}>Remove {label.toLowerCase()}</button>}</fieldset>;
  }
  return <section className={`${styles.content} ${styles.section}`} aria-label="Prepare accepted repair content"><h3>Prepare accepted repair content</h3>
    <p ref={notice} tabIndex={-1} role="status" aria-live="polite">{message}</p>
    <p>Only accepted affected files are included. Contact details, names, headings, dates, qualifications and reference details stay tied to the original confirmed evidence. Saving does not approve or send files.</p>
    {view && !view.sourceSaved && <><fieldset disabled={locked}><legend>Choose the repair for each affected file</legend>
      {view.members.map((member, index) => { const name = cardName(index), choice = choices[index], current = choice?.output;
        return <section key={member.originalFileVersionId} aria-label={name}><h4>{name} · {member.title}</h4>
          <fieldset><legend>{name} repair method</legend>
            {member.model && <label><input type="radio" name={`repair-mode-${member.originalFileVersionId}`} checked={choice?.repairMode === "SOURCE_CORRECTION"}
              onChange={() => update(index, next => { next.repairMode = "SOURCE_CORRECTION"; })} />{name}: correct affected prose using the original confirmed facts</label>}
            <label><input type="radio" name={`repair-mode-${member.originalFileVersionId}`} checked={choice?.repairMode === "SOURCE_PRESERVING_RERENDER"}
              onChange={() => update(index, next => { next.repairMode = "SOURCE_PRESERVING_RERENDER"; })} />{name}: keep the exact original content and rebuild the defective file</label>
          </fieldset>
          {member.artifactType === "REFERENCE_SHEET" && <p>Reference details are not editable here. This option rebuilds the exact original content only; changed consent or details need separate investigation.</p>}
          {choice?.repairMode === "SOURCE_PRESERVING_RERENDER" && <p>The saved source bytes and original dates will remain unchanged. This still requires fresh review of the rebuilt file.</p>}
          {choice?.repairMode === "SOURCE_CORRECTION" && current && member.model && <>
            {member.artifactType === "RESUME" ? <><h5>Summary</h5>{current.resume.summary.map((entry, item) => claimEditor(index, entry, `Resume summary ${item + 1}`,
              value => outputChange(index, next => { next.resume.summary[item] = value; }), () => outputChange(index, next => { next.resume.summary.splice(item, 1); })))}
              <button type="button" aria-label={fieldLabel(index, "Add summary statement")} disabled={current.resume.summary.length >= 3} onClick={() => outputChange(index, next => { next.resume.summary.push(emptyClaim()); })}>Add summary statement</button>
              <h5>Skills</h5>{current.resume.skills.map((entry, item) => claimEditor(index, entry, `Resume skill ${item + 1}`, value => outputChange(index, next => { next.resume.skills[item] = value; }), () => outputChange(index, next => { next.resume.skills.splice(item, 1); })))}
              <button type="button" aria-label={fieldLabel(index, "Add skill")} disabled={current.resume.skills.length >= 20} onClick={() => outputChange(index, next => { next.resume.skills.push(emptyClaim()); })}>Add skill</button>
              {current.resume.sections.map((section, position) => <section key={section.anchorFactId}><h5>{member.model!.sections[position]?.label || "Confirmed experience"}</h5>
                {section.bullets.map((entry, item) => claimEditor(index, entry, `Experience ${position + 1} bullet ${item + 1}`, value => outputChange(index, next => { next.resume.sections[position].bullets[item] = value; }),
                  section.bullets.length > 1 ? () => outputChange(index, next => { next.resume.sections[position].bullets.splice(item, 1); }) : undefined, section.anchorFactId))}
                <button type="button" aria-label={fieldLabel(index, `Add bullet to experience ${position + 1}`)} disabled={section.bullets.length >= 10} onClick={() => outputChange(index, next => { next.resume.sections[position].bullets.push(emptyClaim()); })}>Add bullet to experience {position + 1}</button></section>)}</>
              : <>{current.coverLetter.body.map((paragraph, position) => <section key={position}><h5>Letter paragraph {position + 1}</h5>
                {paragraph.sentences.map((entry, item) => claimEditor(index, entry, `Letter paragraph ${position + 1} sentence ${item + 1}`, value => outputChange(index, next => { next.coverLetter.body[position].sentences[item] = value; }),
                  paragraph.sentences.length > 1 ? () => outputChange(index, next => { next.coverLetter.body[position].sentences.splice(item, 1); }) : undefined))}
                <button type="button" aria-label={fieldLabel(index, `Add sentence to paragraph ${position + 1}`)} disabled={paragraph.sentences.length >= 4} onClick={() => outputChange(index, next => { next.coverLetter.body[position].sentences.push(emptyClaim()); })}>Add sentence to paragraph {position + 1}</button>
                {current.coverLetter.body.length > 1 && <button type="button" aria-label={fieldLabel(index, `Remove paragraph ${position + 1}`)} onClick={() => outputChange(index, next => { next.coverLetter.body.splice(position, 1); })}>Remove paragraph {position + 1}</button>}</section>)}
                <button type="button" aria-label={fieldLabel(index, "Add letter paragraph")} disabled={current.coverLetter.body.length >= 3} onClick={() => outputChange(index, next => { next.coverLetter.body.push({ sentences: [emptyClaim()] }); })}>Add letter paragraph</button></>}
          </>}
        </section>;
      })}
      <label><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I reviewed these repair choices against the original confirmed information. Saving still requires fresh wording, file and approval checks before separate Send.</label>
      <button type="button" disabled={!confirmed} onClick={() => void act("SAVE")}>Save repair source for review</button>
    </fieldset>
      {["UNKNOWN", "RETRY"].includes(phase) && <div><button type="button" onClick={() => void act("CHECK")}>Check saved source request</button>{" "}
        <button type="button" disabled={phase !== "RETRY"} onClick={() => void act("SAVE", true)}>Retry identical source request</button></div>}
      {phase === "REJECTED" && <button type="button" onClick={() => { pending.current = null; setPhase("EDIT"); setConfirmed(false); say("Your wording is editable again. Correct it and review the sources before confirming a new save."); }}>Revise rejected wording</button>}
    </>}
  </section>;
}

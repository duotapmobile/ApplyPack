"use client";

import { useEffect, useRef, useState } from "react";
import { matchesRepairWordingResult, readRepairWordingView, repairWordingRequestSchema,
  type RepairWordingRequest, type RepairWordingView } from "@/lib/materials/service-repair-wording";
import { readRepairAuthoringJson } from "@/lib/materials/service-repair-authoring-client";
import styles from "./draft-owner-workspace.module.css";

type Props = { caseId: string; materialLineId: string; versionId: string; refreshKey?: string | number; onRecorded?: () => void };
type Pending = { request: RepairWordingRequest; body: string; uncertain: boolean };
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const artifactName = (value: string) => value === "RESUME" ? "Resume" : value === "COVER_LETTER" ? "Cover letter" : "Reference sheet";
const claimKey = (file: string, claim: string) => `${file}:${claim}`;
export function ServiceRepairWording(props: Props) {
  return <WordingForm key={`${props.caseId}:${props.materialLineId}:${props.versionId}:${props.refreshKey ?? ""}`} {...props} />;
}
function WordingForm({ caseId, materialLineId, versionId, onRecorded }: Props) {
  const [view, setView] = useState<RepairWordingView | null>(null), [checked, setChecked] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<"REVIEW" | "BUSY" | "UNKNOWN" | "ABSENT" | "RECORDED">("REVIEW");
  const [message, setMessage] = useState("Loading the saved repair wording and its confirmed sources…");
  const active = useRef<AbortController | null>(null), pending = useRef<Pending | null>(null), latch = useRef(false), notice = useRef<HTMLParagraphElement | null>(null);
  const endpoint = `/api/admin/service-errors/${caseId}/repairs/${materialLineId}/wording`;
  useEffect(() => {
    const controller = new AbortController(); active.current = controller;
    const timer = setTimeout(() => { setMessage("Loading the wording review timed out. Reload to check administrator access and the current repair."); controller.abort(); }, 70_000);
    void fetch(`${endpoint}?versionId=${versionId}`, { cache: "no-store", credentials: "same-origin", signal: controller.signal }).then(async response => {
      const data = object(await readRepairAuthoringJson(response, controller.signal));
      if (!response.ok || !data || controller.signal.aborted) throw new Error("unavailable");
      const current = readRepairWordingView(data.view, { caseId, materialLineId, versionId });
      if (controller.signal.aborted) return;
      setView(current); setMessage(current.reviewed ? "The exact saved wording already has a recorded review. File rendering, visual approval and Send remain separate." : "");
    }).catch(() => { if (!controller.signal.aborted) setMessage("The saved wording could not be loaded. Reload the current repair before reviewing it."); })
      .finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); controller.abort(); };
  }, [caseId, materialLineId, versionId, endpoint]);
  const locked = phase !== "REVIEW" || Boolean(view?.reviewed);
  const total = view?.members.reduce((count, member) => count + member.claims.length, 0) ?? 0;
  function say(value: string) { setMessage(value); queueMicrotask(() => notice.current?.focus()); }
  async function send(operation: "SUBMIT" | "CHECK", retry = false) {
    if (latch.current || !view || !active.current || active.current.signal.aborted || view.reviewed || phase === "RECORDED") return;
    if (operation === "SUBMIT" && !retry) {
      if (phase !== "REVIEW" || checked.size !== total || total === 0) return;
      const request = repairWordingRequestSchema.parse({ requestId: crypto.randomUUID(), expected: view.expected,
        decisions: view.members.flatMap(member => member.claims.map(claim => ({ originalFileVersionId: member.originalFileVersionId,
          claimId: claim.claimId, wordingSha256: claim.wordingSha256, decision: "APPROVED" }))) });
      const body = JSON.stringify(request);
      if (new TextEncoder().encode(`{"operation":"SUBMIT","request":${body}}`).byteLength > 1024 * 1024) {
        say("This complete review exceeds the safe request limit. Nothing was sent. Reload the repair and ask for an operational review; do not omit affected statements."); return;
      }
      pending.current = { request, body, uncertain: false };
    } else if (!pending.current || (operation === "CHECK" ? !["UNKNOWN", "ABSENT"].includes(phase) : phase !== "ABSENT")) return;
    const attempt = pending.current!, parent = active.current, controller = new AbortController(), abort = () => controller.abort();
    latch.current = true; setPhase("BUSY"); setMessage(operation === "CHECK" ? "Checking this exact wording-review request…" : "Recording the explicitly checked wording…");
    parent.signal.addEventListener("abort", abort, { once: true }); const timer = setTimeout(abort, 70_000);
    try {
      const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" },
        signal: controller.signal, body: `{"operation":"${operation}","request":${attempt.body}}` });
      const data = object(await readRepairAuthoringJson(response, controller.signal));
      if (!controller.signal.aborted && response.status === 422 && data?.code === "REVIEW_TOO_LARGE"
        && operation === "SUBMIT" && !retry && !attempt.uncertain) {
        pending.current = null; setChecked(new Set()); setPhase("REVIEW");
        say("The complete wording review exceeds the safe storage limit. This action saved nothing. Ask for an operational source review; do not omit affected statements to fit the limit."); return;
      }
      if (controller.signal.aborted || !response.ok || !data || !matchesRepairWordingResult(data.result, attempt.request)) throw new Error("unconfirmed");
      if (data.result.status === "ABSENT") {
        if (operation !== "CHECK") throw new Error("unconfirmed");
        setPhase("ABSENT"); say("No review was recorded for this exact request. You may explicitly retry the identical review."); return;
      }
      pending.current = null; setChecked(new Set()); setPhase("RECORDED");
      say("Wording review recorded. The files still need rendering, visual approval and a separate Send action.");
      try { onRecorded?.(); } catch { /* Keep the verified review result if its parent refresh fails. */ }
    } catch {
      attempt.uncertain = true;
      if (!parent.signal.aborted) { setPhase("UNKNOWN"); say("The review result is not confirmed. Your exact selections are held in memory. Check this request before retrying; no files were approved or sent."); }
    } finally { clearTimeout(timer); parent.signal.removeEventListener("abort", abort); latch.current = false; }
  }
  return <section className={`${styles.content} ${styles.section}`} aria-label="Review accepted repair wording"><h3>Review accepted repair wording</h3>
    <p role="status" aria-live="polite" tabIndex={-1} ref={notice}>{message}</p>
    <p>Read every affected statement beside its original confirmed evidence. Source links alone do not prove the wording is true. Leave a statement unchecked if it adds, changes or overstates a fact.</p>
    {view && <><fieldset disabled={locked}><legend>Explicit review of every affected statement</legend>
      {view.members.map((member, index) => { const label = `${artifactName(member.artifactType)} · affected file ${index + 1}`;
        return <section key={member.originalFileVersionId} aria-label={label}><h4>{label}</h4>
          {member.claims.map((claim, position) => { const labelId = `${label} · statement ${position + 1}`, key = claimKey(member.originalFileVersionId, claim.claimId);
            return <article key={claim.claimId}><h5>Statement {position + 1}</h5><p>{claim.text}</p>
              <p>Recorded wording classification: {claim.qualification === "EXACT" ? "Exact wording; verify it against the evidence below" : claim.qualification === "QUALIFIED_TRANSFER" ? "Keep the stated limits or uncertainty" : claim.qualification.replaceAll("_", " ").toLowerCase()}</p>
              <h6>Original confirmed evidence</h6>
              {claim.sources.length ? <dl>{claim.sources.map((source, sourceIndex) => <div key={sourceIndex}><dt>{source.label}</dt><dd>{source.value}</dd></div>)}</dl>
                : <p>No candidate-source field is displayed for this fixed text. Check its purpose and wording; do not treat it as a new qualification.</p>}
              {claim.jobEvidence.length > 0 && <><h6>Employer evidence</h6><ul>{claim.jobEvidence.map((text, evidenceIndex) => <li key={evidenceIndex}>{text}</li>)}</ul></>}
              {claim.questions.length > 0 && <><h6>Employer questions used as context</h6><p>These are employer priorities, not evidence of the candidate&apos;s qualifications or a promise to submit answers.</p>
                <ul>{claim.questions.map((question, questionIndex) => <li key={`${question.id}:${questionIndex}`}>{question.prompt}</li>)}</ul></>}
              {!view.reviewed && phase !== "RECORDED" && <label><input type="checkbox" checked={checked.has(key)}
                onChange={event => { if (locked) return; setChecked(previous => { const next = new Set(previous); if (event.target.checked) next.add(key); else next.delete(key); return next; }); }} />
                I checked {labelId} against the confirmed evidence, including its attribution and any limits.</label>}
            </article>;
          })}
        </section>;
      })}
      {!view.reviewed && phase !== "RECORDED" && <><p>{checked.size} of {total} statements checked. This does not approve the final files for delivery.</p>
        <button type="button" disabled={checked.size !== total || total === 0} onClick={() => void send("SUBMIT")}>Record checked repair wording</button></>}
    </fieldset>
      {["UNKNOWN", "ABSENT"].includes(phase) && <div><button type="button" onClick={() => void send("CHECK")}>Check wording-review request</button>{" "}
        <button type="button" disabled={phase !== "ABSENT"} onClick={() => void send("SUBMIT", true)}>Retry identical wording review</button></div>}
    </>}
  </section>;
}

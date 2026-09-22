"use client";
import { useState } from "react";
import type { FactSuggestion } from "@/lib/intake/four-step";

export function SourceAnnotation({ facts, onSaved }: { facts: FactSuggestion[]; onSaved: () => Promise<void> }) {
  const sources = facts.filter(f => f.semanticKey.startsWith("document.excerpt."));
  const [selected, setSelected] = useState<string[]>([]);
  const [kind, setKind] = useState("EMPLOYMENT");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  if (!sources.length) return null;
  const field = (key: string, label: string, multiline = false) => <label key={key}>{label}{multiline
    ? <textarea value={fields[key] || ""} onChange={e => setFields({ ...fields, [key]: e.target.value })} />
    : <input value={fields[key] || ""} onChange={e => setFields({ ...fields, [key]: e.target.value })} />}</label>;
  const lines = (key: string) => (fields[key] || "").split("\n").map(s => s.trim()).filter(Boolean);
  async function save() {
    setBusy(true);
    try {
      const annotation = kind === "EMPLOYMENT" ? { kind, historicalTitle: fields.historicalTitle, employer: fields.employer, dates: fields.dates, bullets: lines("bullets"), coverLetterEvidence: lines("coverLetterEvidence") }
        : kind === "RESPONSIBILITY" ? { kind, activity: fields.activity, ...(fields.employmentFactId ? { employmentFactId: fields.employmentFactId } : {}), coverLetterEvidence: lines("coverLetterEvidence") }
        : kind === "EDUCATION" ? { kind, educationLevel: fields.educationLevel, educationField: fields.educationField, completionStatus: fields.completionStatus }
        : { kind, taskOrTool: fields.taskOrTool, capabilityStatus: fields.capabilityStatus || "UNSURE" };
      const response = await fetch("/api/intake/anonymous-draft/annotations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceFactIds: selected, annotation }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The fact could not be saved.");
      setFields({}); setSelected([]); await onSaved();
      setStatus("Added for review above. Read the full statement and explicitly confirm or reject it before continuing.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Save failed. Your entries remain here."); }
    finally { setBusy(false); }
  }
  return <fieldset><legend>Structure facts from your resume</legend>
    <p>Select the original lines supporting this record, then type the facts as they actually occurred. Dates can retain the precision in your resume. Leave uncertain facts unconfirmed. This does not certify qualifications.</p>
    <details><summary>Select supporting source lines ({selected.length})</summary>{sources.map(f => <label key={f.id}><input type="checkbox" checked={selected.includes(f.id)} onChange={e => setSelected(e.target.checked ? [...selected, f.id] : selected.filter(id => id !== f.id))} />{f.sourceLocator}: {f.displayValue}</label>)}</details>
    <label>Record type<select value={kind} onChange={e => { setKind(e.target.value); setFields({}); }}><option value="EMPLOYMENT">Employment, title and dates</option><option value="RESPONSIBILITY">Responsibility</option><option value="EDUCATION">Education</option><option value="TOOL_CAPABILITY">Tool or capability</option></select></label>
    {kind === "EMPLOYMENT" && <>{field("historicalTitle", "Actual historical title")}{field("employer", "Employer")}{field("dates", "Dates as documented")}{field("bullets", "Responsibilities and outcomes — one factual statement per line", true)}</>}
    {kind === "RESPONSIBILITY" && <>{field("activity", "Responsibility you performed")}<label>Associated employment (optional)<select value={fields.employmentFactId || ""} onChange={e => setFields({ ...fields, employmentFactId: e.target.value })}><option value="">No associated employment</option>{facts.filter(f => f.semanticKey.startsWith("annotated:EMPLOYMENT:")).map(f => <option key={f.id} value={f.id}>{f.displayValue.slice(0, 100)}</option>)}</select></label></>}
    {["EMPLOYMENT", "RESPONSIBILITY"].includes(kind) && field("coverLetterEvidence", "Optional supporting passages for a cover letter — separate paragraphs with new lines; use only truthful detail", true)}
    {kind === "EDUCATION" && <>{field("educationLevel", "Degree or qualification")}{field("educationField", "Field of study")}{field("completionStatus", "Completion status as documented")}</>}
    {kind === "TOOL_CAPABILITY" && <>{field("taskOrTool", "Tool and actual task")}<label>Current capability<select value={fields.capabilityStatus || "UNSURE"} onChange={e => setFields({ ...fields, capabilityStatus: e.target.value })}><option value="UNSURE">Unsure</option><option value="CAN_DO_NOW">Can do now</option><option value="DONE_BEFORE_NEEDS_REFRESHER">Done before; need refresher</option><option value="BASIC_EXPOSURE">Basic exposure</option><option value="NOT_DONE">Have not done</option></select></label></>}
    <button type="button" disabled={busy || !selected.length || selected.length > 20} onClick={() => void save()}>Add for explicit review</button><p role="status">{status}</p>
  </fieldset>;
}

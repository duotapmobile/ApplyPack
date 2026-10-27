"use client";
import { useId, useState } from "react";
import { initialRuleChoices, matchesSavedRule, ruleReviewChecklistLabels, submissionRuleConfirmationSchema, submissionRulePreparationSchema, submissionRuleReviewViewSchema,
  type RuleChoiceField, type RuleFieldEvidence, type SubmissionRuleChoices, type SubmissionRuleConfirmation, type SubmissionRuleReviewView } from "@/lib/documents/submission-rule-proposal";

const labels: Record<RuleChoiceField, string> = {
  resumeRequirement: "Resume", coverLetterRequirement: "Cover letter", allowedFormats: "Accepted document formats", submissionChannel: "How documents are submitted",
  resumePageLimit: "Resume page limit", coverLetterPageLimit: "Cover letter page limit", resumeFilenameInstruction: "Resume filename instruction",
  coverLetterFilenameInstruction: "Cover letter filename instruction", referenceFilenameInstruction: "References filename instruction",
  referenceTiming: "When references are requested", referenceCount: "Number of references", portfolioInstruction: "Portfolio instruction", workSampleInstruction: "Work sample instruction",
};
type ChecklistKey = keyof typeof ruleReviewChecklistLabels;
const emptyChecklist = () => Object.fromEntries(Object.keys(ruleReviewChecklistLabels).map((key) => [key, false])) as Record<ChecklistKey, boolean>;
const requirementOptions = [["REQUIRED", "Required"], ["OPTIONAL", "Optional"], ["PROHIBITED", "Do not submit"]] as const;
const questionStatus = { NOT_INSPECTED: "Not inspected", OBSERVED: "Questions captured", NONE_OBSERVED: "No questions observed in the inspected public response",
  PARTIAL: "Only part of the application was inspected", INACCESSIBLE: "Application questions were inaccessible", FAILED: "Application question capture failed" } as const;

export function SubmissionRuleReview({ jobSnapshotId }: { jobSnapshotId: string }) {
  return <RuleReview key={jobSnapshotId} jobSnapshotId={jobSnapshotId} />;
}
function RuleReview({ jobSnapshotId }: { jobSnapshotId: string }) {
  const heading = useId(), path = `/api/admin/job-snapshots/${jobSnapshotId}/submission-rules`;
  const [view, setView] = useState<SubmissionRuleReviewView | null>(null), [choices, setChoices] = useState<ReturnType<typeof initialRuleChoices> | null>(null);
  const [quotes, setQuotes] = useState<Partial<RuleFieldEvidence>>({}), [checks, setChecks] = useState(emptyChecklist);
  const [preparation, setPreparation] = useState<{ title: string; company: string } | null>(null);
  const [pending, setPending] = useState<SubmissionRuleConfirmation | null>(null), [retry, setRetry] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  async function load() {
    if (pending || busy) return;
    setBusy(true); setView(null); setChoices(null); setPreparation(null); setChecks(emptyChecklist()); setMessage("");
    try {
      const response = await fetch(path, { cache: "no-store", signal: AbortSignal.timeout(50_000) });
      if (!response.ok) throw new Error();
      const raw = await response.json(), needsPreparation = submissionRulePreparationSchema.safeParse(raw);
      if (needsPreparation.success) {
        if (needsPreparation.data.jobSnapshotId !== jobSnapshotId) throw new Error();
        setPreparation(needsPreparation.data); return;
      }
      const value = submissionRuleReviewViewSchema.parse(raw);
      if (value.jobSnapshotId !== jobSnapshotId) throw new Error();
      setView(value); setChoices(initialRuleChoices(value.suggestions));
      setQuotes(Object.fromEntries(Object.entries(value.suggestions).map(([field, suggestion]) => [field, suggestion.state === "SUGGESTED" ? suggestion.sources[0].text.trim() : null])));
    } catch { setMessage("This job’s current source review is unavailable. Check your staff sign-in and reload."); }
    finally { setBusy(false); }
  }
  async function prepare() {
    if (!preparation || busy || pending) return; setBusy(true); setMessage("");
    try {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "PREPARE_SOURCE" }), signal: AbortSignal.timeout(50_000) });
      const value = await response.json(); if (!response.ok || value.prepared !== true || Object.keys(value).length !== 1) throw new Error();
      setPreparation(null); setMessage("Captured source prepared. Load the current employer instructions for a fresh review.");
    } catch { setMessage("Source preparation is unconfirmed. Load the current instructions to check it before trying again."); }
    finally { setBusy(false); }
  }
  function change<K extends RuleChoiceField>(key: K, value: SubmissionRuleChoices[K] | null) {
    if (!choices || pending) return;
    setChoices({ ...choices, [key]: value }); setChecks(emptyChecklist());
    const suggestion = view?.suggestions[key];
    setQuotes({ ...quotes, [key]: suggestion?.state === "SUGGESTED" && JSON.stringify(value) === JSON.stringify(suggestion.value) ? suggestion.sources[0].text.trim() : null });
  }
  async function finish(raw: unknown, request: SubmissionRuleConfirmation) {
    const saved = await matchesSavedRule(raw, request);
    if (!saved) throw new Error();
    setPending(null); setView(null); setChoices(null); setChecks(emptyChecklist()); setRetry(false);
    setMessage(saved.current ? "Employer instructions confirmed for a new checkout. This did not draft, approve or send documents."
      : "The original confirmation was saved, but its source or freshness has changed. Reload and review before a new checkout.");
  }
  async function save(request: SubmissionRuleConfirmation) {
    setPending(request); setBusy(true); setRetry(false); setMessage("");
    try {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal: AbortSignal.timeout(50_000) });
      const value = await response.json();
      if (response.status === 409 && value.code === "REVIEW_CHANGED" && value.saved === null) {
        setPending(null); setView(null); setChoices(null); setChecks(emptyChecklist());
        setMessage("The job, source or saved instructions changed. Reload and review the current evidence before confirming."); return;
      }
      if (!response.ok) throw new Error(); await finish(value.saved, request);
    } catch { setMessage("The save result is unconfirmed. Keep this review open and check the saved confirmation before retrying."); }
    finally { setBusy(false); }
  }
  async function reconcile() {
    if (!pending || busy) return; setBusy(true); setRetry(false);
    try {
      const response = await fetch(`${path}?requestId=${pending.requestId}`, { cache: "no-store", signal: AbortSignal.timeout(50_000) });
      const value = await response.json();
      if (!response.ok || !Object.hasOwn(value, "saved")) throw new Error();
      if (value.saved === null) { setRetry(true); setMessage("No saved confirmation was found. Retry the same reviewed request; current source checks still apply."); }
      else await finish(value.saved, pending);
    } catch { setMessage("The saved confirmation is still unconfirmed. Keep this review open and check again."); }
    finally { setBusy(false); }
  }
  const candidate = view && choices ? submissionRuleConfirmationSchema.safeParse({ requestId: "00000000-0000-4000-8000-000000000000", jobSnapshotId,
    expectedBasis: view.basis, choices, fieldEvidence: quotes, checklist: checks }) : null;
  function submit() {
    if (!candidate?.success || busy || pending || view?.blockers.length) return;
    void save({ ...candidate.data, requestId: crypto.randomUUID() });
  }
  function sourceChoice(field: RuleChoiceField) {
    const suggestion = view!.suggestions[field];
    return <details><summary>Source wording for {labels[field].toLowerCase()}</summary>
      {suggestion.state === "CONFLICT" && <p>Conflicting source instructions need resolution.</p>}
      {suggestion.state === "UNKNOWN" && <p>No automatic suggestion. Missing information is not permission or a requirement.</p>}
      {suggestion.sources.map((source) => <blockquote key={source.line}><p>{source.text}</p><small>Captured source, line {source.line}</small></blockquote>)}
      <label>Exact captured wording for {labels[field].toLowerCase()}<textarea maxLength={2000} value={quotes[field] ?? ""} onChange={(event) => {
        setQuotes({ ...quotes, [field]: event.target.value || null }); setChecks(emptyChecklist());
      }} /></label><p>Choose wording already shown in the saved source. New observations must be captured and verified before this review.</p>
      <p>Copy complete captured lines, including any conditions or exceptions.</p>
    </details>;
  }
  return <section className="material-support" aria-labelledby={heading}>
    <h2 id={heading}>Review employer submission instructions</h2>
    <p>Check the saved listing and application instructions. Suggestions remain unconfirmed until you review the exact source.</p>
    <button onClick={load} disabled={busy || Boolean(pending)}>Load current employer instructions</button><p role="status">{message}</p>
    {preparation && <div><h3>{preparation.title} — {preparation.company}</h3><p>The existing captured instructions need a source record before review. Preparing it copies only the saved employer text; it does not confirm requirements or renew a review.</p>
      <button disabled={busy} onClick={prepare}>Prepare captured source for review</button></div>}
    {view && choices && <>
      <h3>{view.title} — {view.company}</h3><p><a href={view.listingUrl} target="_blank" rel="noopener noreferrer">Open employer listing</a> · <a href={view.applicationUrl} target="_blank" rel="noopener noreferrer">Open application page</a></p>
      <p>Captured <time dateTime={view.observedAt}>{new Date(view.observedAt).toLocaleString()}</time>. A newer web page may require a new permitted capture.</p>
      <details><summary>Read captured source</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{view.sourceText}</pre></details>
      {view.previous && <details><summary>Previously confirmed instructions</summary><p>Confirmed {new Date(view.previous.checkedAt).toLocaleString()}. Existing paid documents keep their own review requirements.</p>
        <dl>{Object.entries(view.previous.choices).map(([field, value]) => <div key={field}><dt>{labels[field as RuleChoiceField]}</dt><dd>{value === null ? "Not specified" : Array.isArray(value) ? value.join(", ") : String(value)}</dd></div>)}</dl></details>}
      <section aria-label="Captured application questions"><h3>What the employer asks</h3><p>{questionStatus[view.questions.status]}.</p>
        <p>This covers only the inspected public source. Later or conditional steps may ask more. Questions guide emphasis; they do not establish customer qualifications.</p>
        {view.questions.questions.map((question) => <div key={question.id}><p>{question.prompt}</p><p>{question.required === null ? "Required status not established" : question.required ? "Required form question" : "Optional form question"}; {question.wordLimit ? `${question.wordLimit} words maximum` : "word limit not established"}; {question.characterLimit ? `${question.characterLimit} characters maximum` : "character limit not established"}.</p></div>)}
        {view.questions.issues.length > 0 && <p>Some question evidence needs review. No missing answers or qualifications will be invented.</p>}
      </section>
      {view.blockers.length > 0 && <div role="alert"><p>This review cannot be confirmed yet.</p><ul>{view.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></div>}
      <fieldset disabled={busy || Boolean(pending)}><legend>Confirm what the captured instructions say</legend>
        {(["resumeRequirement", "coverLetterRequirement"] as const).map((field) => <div key={field}><label>{labels[field]}<select value={choices[field] ?? ""} onChange={(event) => change(field, (event.target.value || null) as SubmissionRuleChoices[typeof field] | null)}>
          <option value="">Unknown — review the source</option>{requirementOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{sourceChoice(field)}</div>)}
        <div><fieldset><legend>Accepted document formats</legend>{(["DOCX", "PDF"] as const).map((format) => <label key={format}><input type="checkbox" checked={choices.allowedFormats?.includes(format) ?? false} onChange={(event) => change("allowedFormats", event.target.checked ? [...(choices.allowedFormats ?? []), format].sort() : (choices.allowedFormats ?? []).filter((item) => item !== format))} />{format}</label>)}</fieldset>{sourceChoice("allowedFormats")}</div>
        <label>How documents are submitted<select value={choices.submissionChannel ?? ""} onChange={(event) => change("submissionChannel", (event.target.value || null) as SubmissionRuleChoices["submissionChannel"] | null)}>
          <option value="">Unknown — review the source</option><option value="HTTPS_UPLOAD">Secure document upload</option><option value="EMAIL">Email</option><option value="OTHER_SUPPORTED">Another reviewed supported method</option><option value="UNSUPPORTED">Unsupported method — block purchase</option></select></label>{sourceChoice("submissionChannel")}
        {(["resumePageLimit", "coverLetterPageLimit"] as const).map((field) => <div key={field}><label>{labels[field]}<select value={choices[field] ?? ""} onChange={(event) => change(field, (event.target.value ? Number(event.target.value) : null) as SubmissionRuleChoices[typeof field])}><option value="">No specific limit verified</option><option value="1">One page</option>{field === "resumePageLimit" && <option value="2">Two pages</option>}</select></label>{sourceChoice(field)}</div>)}
        <label>When references are requested<select value={choices.referenceTiming ?? "LATER_OR_UNKNOWN"} onChange={(event) => change("referenceTiming", event.target.value as SubmissionRuleChoices["referenceTiming"])}>
          <option value="LATER_OR_UNKNOWN">Later, or not established</option><option value="OPTIONAL_NOW">Optional with this application</option><option value="REQUIRED_NOW">Required with this application</option><option value="PROHIBITED_NOW">Do not include now</option></select></label>{sourceChoice("referenceTiming")}
        <label>Number of references<input type="number" min={1} max={99} value={choices.referenceCount ?? ""} onChange={(event) => change("referenceCount", event.target.value ? Number(event.target.value) : null)} /></label>{sourceChoice("referenceCount")}
        {(["resumeFilenameInstruction", "coverLetterFilenameInstruction", "referenceFilenameInstruction", "portfolioInstruction", "workSampleInstruction"] as const).map((field) => <div key={field}><label>{labels[field]}<textarea maxLength={field.endsWith("FilenameInstruction") ? 180 : 1000} value={choices[field] ?? ""} onChange={(event) => change(field, event.target.value || null)} /></label>{sourceChoice(field)}</div>)}
        {Object.entries(ruleReviewChecklistLabels).map(([key, label]) => <label key={key}><input type="checkbox" checked={checks[key as ChecklistKey]} onChange={(event) => setChecks({ ...checks, [key]: event.target.checked })} />{label}</label>)}
        <button disabled={!candidate?.success || view.blockers.length > 0} onClick={submit}>Confirm reviewed employer instructions</button>
      </fieldset>
    </>}
    {pending && <div><button disabled={busy} onClick={reconcile}>Check saved confirmation</button> <button disabled={busy || !retry} onClick={() => save(pending)}>Retry the same confirmation</button></div>}
  </section>;
}

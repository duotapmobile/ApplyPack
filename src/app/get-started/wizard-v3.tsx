"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, LockKeyhole, Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  activityCatalog, breadthChoices, businessSystemTasks, capabilityChoices, clearInapplicableCommute,
  dealbreakerCatalog, emptyFourStepDraft, employmentTypes, excelTasks, experienceKindLabels, factTiers,
  formatCompensation, industryCatalog, parseCompensationInput, relevantToolFamilies, stateOrDcOptions,
  validateFourStep, type ExperienceAddition, type FactSuggestion, type FourStepDraft, type IntakeDocument, type StepError,
} from "@/lib/intake/four-step";

type ServerDraft = { id: string; version: number; state: string; currentStep: number; answers: FourStepDraft;
  documents: IntakeDocument[]; facts: FactSuggestion[]; presentedFactIds: string[] };
type SaveState = "LOADING" | "SAVING" | "SAVED" | "ERROR" | "CONFLICT" | "READY";
const labels = Object.fromEntries([...activityCatalog, ...industryCatalog.map(([id, label]) => [id, label] as const), ...breadthChoices]);
const draftSignature = (value: FourStepDraft, currentStep: number) => JSON.stringify([currentStep, value]);

export function IntakeWizard({ fixtureMode = false }: { fixtureMode?: boolean }) {
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);
  const [draft, setDraft] = useState<FourStepDraft>(emptyFourStepDraft);
  const [serverDraft, setServerDraft] = useState<ServerDraft | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("LOADING");
  const [notice, setNotice] = useState("");
  const [errors, setErrors] = useState<StepError[]>([]);
  const [busyDocument, setBusyDocument] = useState<"RESUME" | "PRIOR_COVER_LETTER" | null>(null);
  const [presented, setPresented] = useState<Set<string>>(new Set());
  const [finalized, setFinalized] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const readyRef = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const lastPersisted = useRef("");
  const presentingFacts = useRef<Set<string>>(new Set());

  const hydrate = useCallback((value: ServerDraft, restored = false) => {
    const nextDraft = { ...emptyFourStepDraft, ...value.answers };
    const nextStep = Math.max(0, Math.min(3, value.currentStep)) as 0 | 1 | 2 | 3;
    setServerDraft(value); setDraft(nextDraft); setStep(nextStep);
    setPresented(new Set(value.presentedFactIds || [])); setSaveState("READY");
    lastPersisted.current = draftSignature(nextDraft, nextStep);
    if (restored) setNotice("Your saved intake was restored on this device session.");
    readyRef.current = true;
  }, []);

  const load = useCallback(async () => {
    setSaveState("LOADING");
    if (fixtureMode) { hydrate({ id: "23000000-0000-0000-0000-000000000099", version: 1, state: "IN_PROGRESS", currentStep: 0,
      answers: emptyFourStepDraft, documents: [], facts: [], presentedFactIds: [] }); return; }
    try {
      let response = await fetch("/api/intake/anonymous-draft", { cache: "no-store" });
      let result = await response.json();
      if (response.ok && !result.draft) { response = await fetch("/api/intake/anonymous-draft", { method: "POST" }); result = await response.json(); }
      if (!response.ok || !result.draft) throw new Error(result.error || "Your secure intake could not be opened.");
      hydrate(result.draft, result.draft.version > 1);
    } catch (error) { setSaveState("ERROR"); setNotice(error instanceof Error ? error.message : "Your secure intake could not be opened."); }
  }, [fixtureMode, hydrate]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => { headingRef.current?.focus(); }, [step]);
  useEffect(() => { void fetch("/api/intake/event", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ event: "STEP_VIEWED", step: step + 1 }) }).catch(() => undefined); }, [step]);

  const save = useCallback(async (nextDraft = draft, nextStep = step) => {
    if (!serverDraft || finalized) return serverDraft;
    if (fixtureMode) { const value = { ...serverDraft, answers: nextDraft, currentStep: nextStep, version: serverDraft.version + 1 };
      lastPersisted.current = draftSignature(nextDraft, nextStep); setServerDraft(value); setSaveState("SAVED"); return value; }
    setSaveState("SAVING");
    const response = await fetch("/api/intake/anonymous-draft", { method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: serverDraft.version, currentStep: nextStep, answers: nextDraft }) });
    const result = await response.json();
    if (response.status === 409) { setSaveState("CONFLICT"); setNotice(result.error); return null; }
    if (!response.ok) { setSaveState("ERROR"); setNotice(result.error || "Your changes could not be saved."); return null; }
    lastPersisted.current = draftSignature(nextDraft, nextStep);
    setServerDraft(result.draft); setSaveState("SAVED"); return result.draft as ServerDraft;
  }, [draft, finalized, fixtureMode, serverDraft, step]);

  useEffect(() => {
    if (!readyRef.current || !serverDraft || finalized || lastPersisted.current === draftSignature(draft, step)) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void save(draft, step), 900);
    return () => { if (saveTimer.current) window.clearTimeout(saveTimer.current); };
  }, [draft, finalized, save, serverDraft, step]);

  const resume = serverDraft?.documents.find((item) => item.kind === "RESUME") ?? null;
  const cover = serverDraft?.documents.find((item) => item.kind === "PRIOR_COVER_LETTER") ?? null;
  const facts = useMemo(() => serverDraft?.facts ?? [], [serverDraft?.facts]);
  const toolFamilies = useMemo(() => relevantToolFamilies(draft, facts.map((fact) => fact.semanticKey)), [draft, facts]);
  const activityOptions = useMemo(() => { const extras = facts.filter((fact) => fact.semanticKey.startsWith("activity:")).map((fact) => [fact.semanticKey.slice(9), fact.displayValue, "Suggested from your document; still unconfirmed."] as const); return [...activityCatalog, ...extras.filter(([id]) => !activityCatalog.some(([known]) => known === id))]; }, [facts]);
  const titleSuggestions = useMemo(() => facts.filter((fact) => /title|role/i.test(fact.semanticKey)).map((fact) => fact.displayValue), [facts]);

  function update<K extends keyof FourStepDraft>(key: K, value: FourStepDraft[K]) {
    setDraft((current) => clearInapplicableCommute({ ...current, [key]: value })); setErrors([]); setNotice("");
  }
  function toggle<K extends "desiredActivities" | "avoidedActivities" | "targetTitles" | "industryInterests" | "blockedIndustries" | "workModes" | "employmentTypes" | "schedules" | "dealbreakers">(key: K, value: FourStepDraft[K][number]) {
    const values = draft[key] as string[]; update(key, (values.includes(value) ? values.filter((item) => item !== value) : [...values, value]) as FourStepDraft[K]);
  }
  function list(key: "targetTitles", value: string) { update(key, value.split(",").map((item) => item.trim()).filter(Boolean)); }

  function showErrors(next: StepError[]) {
    setErrors(next); setNotice(""); requestAnimationFrame(() => { errorRef.current?.focus(); document.getElementById(next[0]?.fieldId || "")?.focus(); });
  }
  async function move(next: 0 | 1 | 2 | 3) {
    const nextErrors = next > step ? validateFourStep(step, draft, { resume, facts, presentedFactIds: presented }) : [];
    if (nextErrors.length) return showErrors(nextErrors);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    const saved = await save(draft, next);
    if (saved) { setStep(next); setErrors([]); setNotice("Progress saved securely."); }
  }

  async function upload(kind: "resume" | "prior_cover_letter", file: File | null) {
    if (!file || !serverDraft) return;
    if (kind === "prior_cover_letter") setDraft((current) => ({ ...current, priorCoverLetterUse: "FACT_EXTRACTION_ONLY" }));
    setBusyDocument(kind === "resume" ? "RESUME" : "PRIOR_COVER_LETTER"); setNotice(`${file.name} is uploading to private storage.`);
    if (fixtureMode) { const document: IntakeDocument = { id: crypto.randomUUID(), version: 1, kind: kind === "resume" ? "RESUME" : "PRIOR_COVER_LETTER",
      name: file.name, size: file.size, mimeType: file.type, processingState: "QUARANTINED", failureCode: null };
      setServerDraft({ ...serverDraft, version: serverDraft.version + 1, documents: [...serverDraft.documents.filter((item) => item.kind !== document.kind), document] });
      setNotice(`${file.name} was saved privately and is quarantined for safety checks.`); setBusyDocument(null); return; }
    const form = new FormData(); form.set("kind", kind); form.set("file", file); form.set("expectedVersion", String(serverDraft.version));
    try { const response = await fetch("/api/intake/anonymous-draft/document", { method: "POST", body: form }); const result = await response.json();
      if (!response.ok) { if (response.status === 409) setSaveState("CONFLICT"); throw new Error(result.error); }
      setServerDraft((current) => current && ({ ...current, version: result.draftVersion,
        documents: [...current.documents.filter((item) => item.kind !== result.document.kind), result.document] }));
      setNotice(`${result.document.name} was saved privately and is quarantined for safety checks.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "The document could not be uploaded."); }
    finally { setBusyDocument(null); }
  }

  async function remove(kind: "resume" | "prior_cover_letter") {
    if (!serverDraft) return; setBusyDocument(kind === "resume" ? "RESUME" : "PRIOR_COVER_LETTER");
    if (kind === "prior_cover_letter") setDraft((current) => ({ ...current, priorCoverLetterUse: "NEITHER" }));
    if (fixtureMode) { setServerDraft({ ...serverDraft, version: serverDraft.version + 1, documents: serverDraft.documents.filter((item) => item.kind !== (kind === "resume" ? "RESUME" : "PRIOR_COVER_LETTER")) }); setBusyDocument(null); return; }
    const response = await fetch(`/api/intake/anonymous-draft/document?kind=${kind}&expectedVersion=${serverDraft.version}`, { method: "DELETE" });
    const result = await response.json();
    if (response.ok) { setServerDraft({ ...serverDraft, version: result.draftVersion, documents: serverDraft.documents.filter((item) => item.id !== result.documentId) }); setNotice("The document was removed. Its superseded history follows the configured retention policy."); }
    else { setNotice(result.error || "The document could not be removed."); if (response.status === 409) setSaveState("CONFLICT"); }
    setBusyDocument(null);
  }

  async function retryDocument(kind: "resume" | "prior_cover_letter") {
    if (!serverDraft) return;
    if (fixtureMode) { setServerDraft({ ...serverDraft, version: serverDraft.version + 1, documents: serverDraft.documents.map((item) => item.kind === (kind === "resume" ? "RESUME" : "PRIOR_COVER_LETTER") ? { ...item, processingState: "QUARANTINED", failureCode: null } : item) }); return; }
    const response = await fetch("/api/intake/anonymous-draft/document/retry", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: serverDraft.version, kind }) });
    const result = await response.json();
    if (!response.ok) { setNotice(result.error || "The safety checks could not be retried."); if (response.status === 409) setSaveState("CONFLICT"); return; }
    setServerDraft({ ...serverDraft, version: result.draftVersion, documents: serverDraft.documents.map((item) => item.kind === (kind === "resume" ? "RESUME" : "PRIOR_COVER_LETTER") ? { ...item, processingState: "QUARANTINED", failureCode: null } : item) });
    setNotice("The document was returned to quarantine for another safety-check attempt.");
  }
  useEffect(() => {
    if (step !== 2 || !serverDraft) return;
    facts.forEach((fact) => {
      if (presented.has(fact.id) || presentingFacts.current.has(fact.id)) return;
      if (fixtureMode) { setPresented((current) => new Set(current).add(fact.id)); return; }
      presentingFacts.current.add(fact.id);
      void fetch("/api/intake/anonymous-draft/fact-presentation", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: serverDraft.version, factId: fact.id, controlId: `fact-${fact.id}` }) })
        .then(async (response) => {
          if (response.ok) { setPresented((current) => new Set(current).add(fact.id)); return; }
          const result = await response.json().catch(() => ({}));
          if (response.status === 409) setSaveState("CONFLICT");
          setNotice(result.error || "A resume suggestion could not be prepared for review.");
        })
        .catch(() => setNotice("A resume suggestion could not be prepared for review."))
        .finally(() => presentingFacts.current.delete(fact.id));
    });
  }, [facts, fixtureMode, presented, serverDraft, step]);

  async function finalize() {
    const nextErrors = validateFourStep(3, draft, { resume, facts, presentedFactIds: presented });
    if (nextErrors.length) return showErrors(nextErrors);
    if (!serverDraft) return;
    setSaveState("SAVING");
    if (fixtureMode) { setFinalized(true); setSaveState("SAVED"); setNotice("Your intake is saved. Feasibility review is pending. No payment was started."); return; }
    const saved = await save(draft, 3); if (!saved) return;
    const response = await fetch("/api/intake/anonymous-draft/finalize", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedVersion: saved.version, answers: draft }) });
    const result = await response.json();
    if (!response.ok) { setSaveState(response.status === 409 ? "CONFLICT" : "ERROR"); setNotice(result.error || "The intake could not be finalized."); return; }
    setFinalized(true); setSaveState("SAVED"); setNotice(result.feasibility.message + " No payment was started.");
  }

  if (saveState === "LOADING") return <main id="main-content" className="wizard-page"><section className="wizard-loading" aria-live="polite"><p className="eyebrow">SECURE INTAKE</p><h1>Loading your saved intake…</h1></section></main>;

  return <main id="main-content" className="wizard-page"><div className="page-frame wizard-layout">
    <aside className="wizard-aside"><p className="eyebrow eyebrow--light">YOUR JOB SEARCH</p><h1>Find work that fits.</h1>
      <p>Complete four short steps. You will review everything before feasibility.</p><div className="wizard-price"><strong>$20</strong><span>once<br />no subscription</span></div>
      <p className="wizard-security"><LockKeyhole aria-hidden="true" /> Private documents. 10 researched matches. No account or payment before review.</p></aside>
    <section className="wizard-panel" aria-labelledby="wizard-title">
      <div className="wizard-progress" role="progressbar" aria-label="Intake progress" aria-valuemin={1} aria-valuemax={4} aria-valuenow={step + 1} aria-valuetext={`Step ${step + 1} of 4`}><span>STEP {step + 1} OF 4</span><div><i style={{ width: `${(step + 1) * 25}%` }} /></div></div>
      <SaveNotice state={saveState} notice={notice} onReload={load} />
      {errors.length > 0 && <div className="intake-errors" ref={errorRef} tabIndex={-1} role="alert" aria-labelledby="error-title"><strong id="error-title">Please fix {errors.length === 1 ? "this item" : "these items"}:</strong><ul>{errors.map((error) => <li key={error.fieldId}><a href={`#${error.fieldId}`}>{error.message}</a></li>)}</ul></div>}

      {step === 0 && <Step headingRef={headingRef} title="Start with your documents" help="See the offer and privacy boundary before sharing anything.">
        <div className="intake-offer"><strong>$20 once for 10 researched job matches.</strong><span>No subscription. No account or payment in this intake.</span></div>
        <p className="privacy-note"><LockKeyhole aria-hidden="true" /> Your files use private storage and a separate secure browser session. Document bytes never go into browser local storage. Remove unnecessary sensitive information before upload.</p>
        <div className="field-grid"><Field id="full-name" label="Full name" required><input id="full-name" autoComplete="name" value={draft.fullName} onChange={(e) => update("fullName", e.target.value)} /></Field>
        <Field id="email" label="Email address" required help="Used to resume and, after payment, access your order."><input id="email" type="email" autoComplete="email" value={draft.email} aria-describedby="email-help" onChange={(e) => update("email", e.target.value)} /></Field></div><ErrorFor errors={errors} fieldId="full-name" /><ErrorFor errors={errors} fieldId="email" />
        <UploadField id="resume" label="Current resume" required document={resume} busy={busyDocument === "RESUME"} onUpload={(file) => upload("resume", file)} onRemove={() => remove("resume")} onRetry={() => retryDocument("resume")} /><ErrorFor errors={errors} fieldId="resume" />
        <UploadField id="prior-cover-letter" label="Previous cover letter" document={cover} busy={busyDocument === "PRIOR_COVER_LETTER"} onUpload={(file) => upload("prior_cover_letter", file)} onRemove={() => remove("prior_cover_letter")} onRetry={() => retryDocument("prior_cover_letter")} />
        {cover && <fieldset><legend>How may we use the previous cover letter?</legend><Radio name="cover-use" value="FACT_EXTRACTION_ONLY" checked={draft.priorCoverLetterUse} onChange={(value) => update("priorCoverLetterUse", value)} label="Facts only (recommended)" />
          <Radio name="cover-use" value="FACT_EXTRACTION_AND_VOICE" checked={draft.priorCoverLetterUse} onChange={(value) => update("priorCoverLetterUse", value)} label="Facts and writing voice" />
          <Radio name="cover-use" value="NEITHER" checked={draft.priorCoverLetterUse} onChange={(value) => update("priorCoverLetterUse", value)} label="Do not use it" /></fieldset>}
      </Step>}

      {step === 1 && <Step headingRef={headingRef} title="Choose the work you want" help="Activities guide matching. Avoided activities are preferences unless you mark them as dealbreakers in Step 4.">
        <CheckCatalog id="desired-activities" legend="What would you like to do?" options={activityOptions} values={draft.desiredActivities} onToggle={(value) => toggle("desiredActivities", value)} /><ErrorFor errors={errors} fieldId="desired-activities" />
        <label className="confirm"><input type="checkbox" checked={draft.guidanceRequested} onChange={(e) => update("guidanceRequested", e.target.checked)} /><span><strong>Help me decide from my experience.</strong> We will use the editable adjacent-opportunities starting point; this does not confirm any resume fact.</span></label>
        <CheckCatalog id="avoided-activities" legend="What would you rather avoid?" options={activityOptions} values={draft.avoidedActivities} onToggle={(value) => toggle("avoidedActivities", value)} />{draft.avoidedActivities.length > 0 && <PreferenceSelects items={draft.avoidedActivities.map((value) => [`activity:${value}`, labels[value] || value])} values={draft.workConditionPreferences} onChange={(key, value) => update("workConditionPreferences", { ...draft.workConditionPreferences, [key]: value })} intro="Avoided activities are ranking preferences unless you explicitly choose Do not show me or Dealbreaker." />}
        <Field id="target-titles" label="Titles you have in mind" help="Optional retrieval hints, not proof that you qualify."><input id="target-titles" value={draft.targetTitles.join(", ")} onChange={(e) => list("targetTitles", e.target.value)} placeholder="Operations coordinator, project assistant" /></Field>{titleSuggestions.length > 0 && <div className="suggestion-chips" aria-label="Resume-suggested titles">{titleSuggestions.map((title) => <button type="button" key={title} onClick={() => update("targetTitles", [...new Set([...draft.targetTitles, title])])}>Add {title}</button>)}</div>}{draft.targetTitles.length > 0 && <div className="suggestion-chips" aria-label="Selected title hints">{draft.targetTitles.map((title) => <button type="button" key={title} onClick={() => update("targetTitles", draft.targetTitles.filter((item) => item !== title))}>{title} ×</button>)}</div>}
        {draft.searchBreadth === "CLOSE_TO_PREVIOUS_WORK" && draft.targetTitles.length > 0 && <label className="confirm"><input type="checkbox" checked={draft.titleRestrictionConfirmed} onChange={(e) => update("titleRestrictionConfirmed", e.target.checked)} /><span>Limit this narrow search to the title families I entered.</span></label>}
        <CheckCatalog id="industry-interests" legend="Industries you are interested in (optional)" options={industryCatalog.map(([id, name, description]) => [id, name, description] as const)} values={draft.industryInterests} onToggle={(value) => toggle("industryInterests", value)} />
        <CheckCatalog id="blocked-industries" legend="Industries not to show (optional)" options={industryCatalog.map(([id, name, description]) => [id, name, description] as const)} values={draft.blockedIndustries} onToggle={(value) => toggle("blockedIndustries", value)} />
        <fieldset><legend>How broad should the search be?</legend><p className="field-help">Related roles that use the same abilities are the visible recommended starting point.</p>{breadthChoices.map(([value, label]) => <Radio key={value} name="breadth" value={value} checked={draft.searchBreadth} onChange={(next) => update("searchBreadth", next)} label={`${label}${value === "ADJACENT_OPPORTUNITIES" ? " — recommended" : ""}`} />)}</fieldset>
      </Step>}

      {step === 2 && <Step headingRef={headingRef} title="Confirm experience and skills" help="Resume text is a suggestion, not a verified claim. Confirm only what is accurate; skip and reject are different.">
        {facts.length === 0 ? <div className="processing-card"><strong>{resume?.processingState === "FAILED" ? "Extraction needs attention." : "Resume extraction is not ready yet."}</strong><p>We will not invent facts or send reference details to a model. You can add truthful structured experience below and return later.</p></div> : factTiers.map((tier) => <FactGroup key={tier} tier={tier} facts={facts} draft={draft} update={update} errors={errors} />)}
        <ExperienceEditor value={draft.experienceAdditions} errors={errors} onChange={(value) => update("experienceAdditions", value)} />
        {(toolFamilies.excel || toolFamilies.systems) && <div className="adaptive-skills"><h3>Task-based tool check</h3><p>Choose what you can actually do. Using a CRM never implies SQL or administration.</p>{toolFamilies.excel && <CapabilityGroup legend="Excel and spreadsheet tasks" options={excelTasks} values={draft.capabilities} onChange={(key, value) => update("capabilities", { ...draft.capabilities, [key]: value })} />}{toolFamilies.systems && <CapabilityGroup legend="Business-system tasks" options={businessSystemTasks} values={draft.capabilities} onChange={(key, value) => update("capabilities", { ...draft.capabilities, [key]: value })} />}</div>}
      </Step>}

      {step === 3 && <Step headingRef={headingRef} title="Set requirements and review" help="The launch search covers the 50 United States and District of Columbia. Nothing required below is silently selected.">
        <CheckCatalog id="work-modes" legend="Accepted work modes" options={[["REMOTE","Remote"],["HYBRID","Hybrid"],["ONSITE","On-site"]] as const} values={draft.workModes} onToggle={(value) => toggle("workModes", value)} /><ErrorFor errors={errors} fieldId="work-modes" />
        {draft.workModes.length > 1 && <Field id="preferred-work-mode" label="Preferred work mode"><select id="preferred-work-mode" value={draft.preferredWorkMode} onChange={(e) => update("preferredWorkMode", e.target.value as FourStepDraft["preferredWorkMode"])}><option value="">No preference</option>{draft.workModes.map((value) => <option key={value} value={value}>{value === "ONSITE" ? "On-site" : titleCase(value)}</option>)}</select></Field>}
        <Field id="state-or-dc" label="U.S. state or District of Columbia" required help="Some remote employers limit hiring by state."><select id="state-or-dc" value={draft.stateOrDc} onChange={(e) => update("stateOrDc", e.target.value)}><option value="">Choose one</option>{stateOrDcOptions.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></Field><ErrorFor errors={errors} fieldId="state-or-dc" />
        {(draft.workModes.includes("HYBRID") || draft.workModes.includes("ONSITE")) && <div className="field-grid"><Field id="zip-code" label="ZIP code for commute checks" required><input id="zip-code" inputMode="numeric" autoComplete="postal-code" value={draft.zipCode} onChange={(e) => update("zipCode", e.target.value)} /></Field><ErrorFor errors={errors} fieldId="zip-code" /><Field id="commute-distance" label="Maximum commute distance" required><input id="commute-distance" type="number" min="1" max="250" value={draft.commuteDistanceMiles ?? ""} onChange={(e) => update("commuteDistanceMiles", e.target.value ? Number(e.target.value) : null)} /></Field><ErrorFor errors={errors} fieldId="commute-distance" /></div>}
        <CheckCatalog id="employment-types" legend="Accepted employment types" options={employmentTypes.map((value) => [value, titleCase(value)] as const)} values={draft.employmentTypes} onToggle={(value) => toggle("employmentTypes", value)} /><ErrorFor errors={errors} fieldId="employment-types" />
        {draft.employmentTypes.length > 1 && <Field id="preferred-employment-type" label="Preferred employment type"><select id="preferred-employment-type" value={draft.preferredEmploymentType} onChange={(e) => update("preferredEmploymentType", e.target.value as FourStepDraft["preferredEmploymentType"])}><option value="">No preference</option>{draft.employmentTypes.map((value) => <option key={value}>{value}</option>)}</select></Field>}
        <Field id="schedule" label="Schedule preferences" help="Optional, comma-separated."><input id="schedule" value={draft.schedules.join(", ")} onChange={(e) => update("schedules", e.target.value.split(",").map((item) => item.trim()).filter(Boolean))} /></Field><BenefitPreferences value={draft.benefits} onChange={(value) => update("benefits", value)} /><PreferenceSelects items={[["TRAVEL","Travel"],["PHONE_INTENSITY","Phone intensity"],["SALES","Sales"],["PHYSICAL_DEMANDS","Physical demands"],["FLEXIBILITY","Schedule flexibility"]]} values={draft.workConditionPreferences} onChange={(key, value) => update("workConditionPreferences", { ...draft.workConditionPreferences, [key]: value })} intro="Optional: set only the conditions that affect matching." />
        <Compensation draft={draft} update={update} /><ErrorFor errors={errors} fieldId="salary-target" /><ErrorFor errors={errors} fieldId="salary-period" /><ErrorFor errors={errors} fieldId="salary-basis" />
        <fieldset id="leave-out"><legend>What should we leave out of your search?</legend><div className="choice-grid">{dealbreakerCatalog.map(([value, label]) => <label className="choice" key={value}><input type="checkbox" checked={draft.dealbreakers.includes(value)} onChange={() => toggle("dealbreakers", value)} /><span><Check aria-hidden="true" />{label}</span></label>)}</div></fieldset>
        {draft.dealbreakers.includes("SOMETHING_ELSE") && <><Field id="custom-dealbreaker" label="What else should we leave out?" required><textarea id="custom-dealbreaker" value={draft.customDealbreaker} onChange={(e) => update("customDealbreaker", e.target.value)} /></Field><ErrorFor errors={errors} fieldId="custom-dealbreaker" /></>}
        {draft.dealbreakers.filter((value) => value !== "SOMETHING_ELSE").map((value) => <fieldset key={value} id={`unknown-${value.toLowerCase()}`} tabIndex={-1}><legend>If an employer does not state whether the job includes {labels[value]?.toLowerCase() || value.toLowerCase()}, what should we do?</legend><Radio name={`unknown-${value}`} value="EXCLUDE_IF_UNKNOWN" checked={draft.employerUnknownPolicies[value] || ""} onChange={(next) => update("employerUnknownPolicies", { ...draft.employerUnknownPolicies, [value]: next })} label="Exclude it if unknown" /><Radio name={`unknown-${value}`} value="ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING" checked={draft.employerUnknownPolicies[value] || ""} onChange={(next) => update("employerUnknownPolicies", { ...draft.employerUnknownPolicies, [value]: next })} label="Include it with an unknown warning" /><ErrorFor errors={errors} fieldId={`unknown-${value.toLowerCase()}`} /></fieldset>)}
        <Review draft={draft} resume={resume} cover={cover} onEdit={setStep} />
        <div className="deadline-note"><strong>Service boundary</strong><p>ApplyPack researches public listings and provides 10 matches after feasibility, capacity, and payment. We do not contact employers, submit applications, or guarantee interviews, offers, salary, employment, or continued listing availability.</p></div>
        <ErrorFor errors={errors} fieldId="terms-accepted" /><label className="confirm legal-agreement"><input id="terms-accepted" type="checkbox" checked={draft.termsAccepted} onChange={(e) => update("termsAccepted", e.target.checked)} /><span>I agree to the <Link href="/terms" target="_blank">Terms</Link> and <Link href="/privacy" target="_blank">Privacy Policy</Link>.</span></label>
      </Step>}

      <div className="wizard-actions"><button className="wizard-back" type="button" disabled={step === 0 || saveState === "SAVING"} onClick={() => void move((step - 1) as 0 | 1 | 2)}><ArrowLeft aria-hidden="true" />Back</button>
        {step < 3 ? <button className="wizard-next" type="button" disabled={saveState === "SAVING"} onClick={() => void move((step + 1) as 1 | 2 | 3)}>{saveState === "SAVING" ? "Saving…" : "Save and continue"}<ArrowRight aria-hidden="true" /></button>
          : <button className="wizard-next" type="button" disabled={saveState === "SAVING" || finalized} onClick={() => void finalize()}>{finalized ? "Feasibility pending" : saveState === "SAVING" ? "Saving…" : "Finish intake"}<ArrowRight aria-hidden="true" /></button>}</div>
    </section></div></main>;
}

function Step({ headingRef, title, help, children }: { headingRef: React.RefObject<HTMLHeadingElement | null>; title: string; help: string; children: React.ReactNode }) { return <div className="wizard-step"><h2 ref={headingRef} id="wizard-title" tabIndex={-1}>{title}</h2><p id="step-help">{help}</p><div className="wizard-fields">{children}</div></div>; }
function Field({ id, label, required, help, children }: { id: string; label: string; required?: boolean; help?: string; children: React.ReactNode }) { return <label htmlFor={id}>{label} {required && <Required />}{help && <span id={`${id}-help`} className="field-help">{help}</span>}{children}</label>; }
function Required() { return <span className="required-hint">required</span>; }
function Radio<T extends string>({ name, value, checked, onChange, label }: { name: string; value: T; checked: string; onChange: (value: T) => void; label: string }) { return <label className="radio-row"><input type="radio" name={name} value={value} checked={checked === value} onChange={() => onChange(value)} /><span>{label}</span></label>; }

function CheckCatalog<T extends string>({ id, legend, options, values, onToggle }: { id: string; legend: string; options: readonly (readonly [T, string, ...string[]])[]; values: readonly string[]; onToggle: (value: T) => void }) { return <fieldset id={id} tabIndex={-1}><legend>{legend}</legend><div className="choice-grid">{options.map(([value, label, description]) => <label className="choice" key={value}><input type="checkbox" checked={values.includes(value)} onChange={() => onToggle(value)} /><span><Check aria-hidden="true" /><b>{label}</b>{description && <small>{description}</small>}</span></label>)}</div></fieldset>; }
function UploadField({ id, label, required, document, busy, onUpload, onRemove, onRetry }: { id: string; label: string; required?: boolean; document: IntakeDocument | null; busy: boolean; onUpload: (file: File | null) => void; onRemove: () => void; onRetry: () => void }) { return <div className="upload-control"><label className="file-drop" htmlFor={id}>{label} {required && <Required />}<span>Text-based PDF or DOCX, no macros or encryption, maximum 10 MiB.</span><input id={id} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={busy} onChange={(event) => onUpload(event.target.files?.[0] || null)} /><b>{busy ? "Uploading…" : document ? `${document.name} — ${document.processingState.toLowerCase().replaceAll("_", " ")}` : `Choose ${label.toLowerCase()}`}</b></label>{document?.processingState === "FAILED" && <button type="button" className="text-button" disabled={busy} onClick={onRetry}><RefreshCw aria-hidden="true" /> Retry safety checks</button>}{document && <button type="button" className="text-button" disabled={busy} onClick={onRemove}><Trash2 aria-hidden="true" /> Remove or replace</button>}</div>; }

function ErrorFor({ errors, fieldId }: { errors: StepError[]; fieldId: string }) { const error = errors.find((item) => item.fieldId === fieldId); return error ? <p className="field-error" role="alert">{error.message}</p> : null; }
function SaveNotice({ state, notice, onReload }: { state: SaveState; notice: string; onReload: () => void }) { return <div className={`save-notice save-notice--${state.toLowerCase()}`} aria-live={state === "ERROR" || state === "CONFLICT" ? "assertive" : "polite"}>{state === "SAVING" ? "Saving securely…" : state === "CONFLICT" ? "Another tab changed this intake." : notice || (state === "SAVED" ? "Saved" : "")}{state === "CONFLICT" && <button type="button" onClick={onReload}><RefreshCw aria-hidden="true" /> Reload saved version</button>}</div>; }

function FactGroup({ tier, facts, draft, update, errors }: { tier: typeof factTiers[number]; facts: FactSuggestion[]; draft: FourStepDraft; errors: StepError[]; update: <K extends keyof FourStepDraft>(key: K, value: FourStepDraft[K]) => void }) { const selected = facts.filter((fact) => fact.tier === tier); if (!selected.length) return null; const heading = tier === "SEARCH_CRITICAL" ? "Search-critical facts — review now" : tier === "MATCH_ENHANCING" ? "Match-enhancing facts — optional" : "Document-only facts — deferred"; return <section className="fact-tier"><h3>{heading}</h3>{selected.map((fact) => <fieldset id={`fact-${fact.id}`} key={fact.id} tabIndex={-1}><legend>{fact.displayLabel}: <strong>{fact.displayValue}</strong></legend><p className="field-help">Resume suggestion · {fact.sourceLocator} · unconfirmed until you choose Confirm.</p>{tier === "DOCUMENT_ONLY" ? <p>Deferred to materials setup.</p> : <><Radio name={`fact-${fact.id}`} value="CONFIRM" checked={draft.factReviews[fact.id] || ""} onChange={(value) => update("factReviews", { ...draft.factReviews, [fact.id]: value })} label="Confirm accurate" /><Radio name={`fact-${fact.id}`} value="REJECT" checked={draft.factReviews[fact.id] || ""} onChange={(value) => update("factReviews", { ...draft.factReviews, [fact.id]: value })} label="Not accurate" /><Radio name={`fact-${fact.id}`} value="SKIP" checked={draft.factReviews[fact.id] || ""} onChange={(value) => update("factReviews", { ...draft.factReviews, [fact.id]: value })} label="Skip for now" /><Radio name={`fact-${fact.id}`} value="CORRECT" checked={draft.factReviews[fact.id] || ""} onChange={(value) => update("factReviews", { ...draft.factReviews, [fact.id]: value })} label="Correct it" />{draft.factReviews[fact.id] === "CORRECT" && <label htmlFor={`fact-correction-${fact.id}`}>Correct value <input id={`fact-correction-${fact.id}`} value={draft.factCorrections[fact.id]?.value || ""} onChange={(e) => update("factCorrections", { ...draft.factCorrections, [fact.id]: { value: e.target.value, category: "OTHER" } })} /></label>}</>}<ErrorFor errors={errors} fieldId={`fact-${fact.id}`} /><ErrorFor errors={errors} fieldId={`fact-correction-${fact.id}`} /></fieldset>)}</section>; }

function ExperienceEditor({ value, errors, onChange }: { value: ExperienceAddition[]; errors: StepError[]; onChange: (value: ExperienceAddition[]) => void }) {
  function add() { onChange([...value, { clientId: crypto.randomUUID(), kind: "PAID_EMPLOYMENT", organizationOrProject: "", roleOrRelationship: "", startsOn: "", endsOn: "", datePrecision: "MONTH", responsibilities: [], tools: [], scope: "", outcome: "", intensityPercent: null, educationLevel: "", educationField: "", completionStatus: "", certifications: [], relevantCoursework: [], optionalDetail: "" }]); }
  function change(index: number, next: Partial<ExperienceAddition>) { onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, ...next } : item)); }
  return <section className="experience-editor"><h3>Add experience the documents missed</h3><p>Use its real identity. Caregiving is never converted into occupational experience, and no disclosure or metric is required.</p>{value.map((item, index) => <fieldset key={item.clientId}><legend>Experience {index + 1}</legend>
    <div className="field-grid"><label>Type<select value={item.kind} onChange={(e) => change(index, { kind: e.target.value as ExperienceAddition["kind"] })}>{Object.entries(experienceKindLabels).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>
    <label id={`experience-${item.clientId}-organization`} tabIndex={-1}>Real employer, organization, business, or project<input value={item.organizationOrProject} onChange={(e) => change(index, { organizationOrProject: e.target.value })} /></label><ErrorFor errors={errors} fieldId={`experience-${item.clientId}-organization`} />
    <label>Real role or relationship<input value={item.roleOrRelationship} onChange={(e) => change(index, { roleOrRelationship: e.target.value })} /></label>
    <label>Date precision<select value={item.datePrecision} onChange={(e) => change(index, { datePrecision: e.target.value as ExperienceAddition["datePrecision"] })}><option value="EXACT_DAY">Exact day</option><option value="MONTH">Month</option><option value="YEAR">Year</option><option value="UNKNOWN">Unknown</option></select></label>
    <label>Start date<input type="date" value={item.startsOn} onChange={(e) => change(index, { startsOn: e.target.value })} /></label><label id={`experience-${item.clientId}-end`} tabIndex={-1}>End date<input type="date" value={item.endsOn} onChange={(e) => change(index, { endsOn: e.target.value })} /></label><ErrorFor errors={errors} fieldId={`experience-${item.clientId}-end`} />
    <label>Intensity, if material (%)<input type="number" min="0" max="100" value={item.intensityPercent ?? ""} onChange={(e) => change(index, { intensityPercent: e.target.value ? Number(e.target.value) : null })} /></label></div>
    <label>Responsibilities (comma-separated)<input value={item.responsibilities.join(", ")} onChange={(e) => change(index, { responsibilities: split(e.target.value) })} /></label><label>Tools actually used (comma-separated)<input value={item.tools.join(", ")} onChange={(e) => change(index, { tools: split(e.target.value) })} /></label>
    <label>Scope, if known<textarea value={item.scope} onChange={(e) => change(index, { scope: e.target.value })} /></label><label>Outcome, if known<textarea value={item.outcome} onChange={(e) => change(index, { outcome: e.target.value })} /></label>
    {item.kind === "EDUCATION_CERTIFICATION" && <div id={`experience-${item.clientId}-education`} className="field-grid" tabIndex={-1}><label>Actual degree or education level<input value={item.educationLevel} onChange={(e) => change(index, { educationLevel: e.target.value })} /></label><label>Actual field<input value={item.educationField} onChange={(e) => change(index, { educationField: e.target.value })} /></label><label>Completion status<input value={item.completionStatus} onChange={(e) => change(index, { completionStatus: e.target.value })} /></label><label>Certifications (comma-separated)<input value={item.certifications.join(", ")} onChange={(e) => change(index, { certifications: split(e.target.value) })} /></label><label>Relevant coursework actually supplied<input value={item.relevantCoursework.join(", ")} onChange={(e) => change(index, { relevantCoursework: split(e.target.value) })} /></label></div>}<ErrorFor errors={errors} fieldId={`experience-${item.clientId}-education`} />
    {["CAREGIVING","OTHER_RELEVANT_LIFE_CONTEXT"].includes(item.kind) && <label>Optional context; no disclosure required<textarea value={item.optionalDetail} onChange={(e) => change(index, { optionalDetail: e.target.value })} /></label>}
    <button type="button" className="text-button" onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}><Trash2 aria-hidden="true" /> Remove</button></fieldset>)}<button type="button" className="secondary-button" onClick={add}><Plus aria-hidden="true" /> Add experience</button></section>;
}
function CapabilityGroup({ legend, options, values, onChange }: { legend: string; options: readonly (readonly [string,string])[]; values: Record<string,string>; onChange: (key: string, value: FourStepDraft["capabilities"][string]) => void }) { return <fieldset><legend>{legend}</legend>{options.map(([key, label]) => <label key={key}>{label}<select value={values[key] || ""} onChange={(e) => onChange(key, e.target.value as FourStepDraft["capabilities"][string])}><option value="">Choose if relevant</option>{capabilityChoices.map(([value, text]) => <option value={value} key={value}>{text}</option>)}</select></label>)}</fieldset>; }

function PreferenceSelects({ items, values, onChange, intro }: { items: readonly (readonly [string,string])[]; values: Record<string,string>; onChange: (key: string, value: FourStepDraft["workConditionPreferences"][string]) => void; intro: string }) { return <fieldset><legend>Preference strength</legend><p className="field-help">{intro}</p>{items.map(([key,label]) => <label key={key}>{label}<select value={values[key] || ""} onChange={(e) => onChange(key, e.target.value as FourStepDraft["workConditionPreferences"][string])}><option value="">No selection</option><option value="MUST_HAVE">Must have</option><option value="WOULD_PREFER">Would prefer</option><option value="OPEN_TO">Open to</option><option value="DO_NOT_SHOW">Do not show me</option><option value="DEALBREAKER">Dealbreaker</option></select></label>)}</fieldset>; }
function BenefitPreferences({ value, onChange }: { value: FourStepDraft["benefits"]; onChange: (value: FourStepDraft["benefits"]) => void }) { const options=["Health insurance","Paid time off","Retirement benefits"]; const groups=[["mustHave","Must have"],["wouldPrefer","Would prefer"],["openTo","Open to"]] as const; return <fieldset><legend>Benefits that affect matching (optional)</legend>{groups.map(([key,label]) => <fieldset key={key}><legend>{label}</legend>{options.map((option) => <label className="confirm" key={option}><input type="checkbox" checked={value[key].includes(option)} onChange={() => onChange({ ...value, [key]: value[key].includes(option) ? value[key].filter((item) => item !== option) : [...value[key],option] })} /><span>{option}</span></label>)}</fieldset>)}</fieldset>; }
function Compensation({ draft, update }: { draft: FourStepDraft; update: <K extends keyof FourStepDraft>(key: K, value: FourStepDraft[K]) => void }) { const hasPay = draft.salaryTargetCents !== null || draft.salaryHardMinimumCents !== null; return <fieldset><legend>Compensation (optional)</legend><p className="field-help">Your target is a preference. A firm hard minimum is a gate and is never silently lowered.</p><div className="field-grid"><label htmlFor="salary-target">Target compensation<input id="salary-target" inputMode="decimal" defaultValue={draft.salaryTargetCents === null ? "" : String(draft.salaryTargetCents / 100)} onBlur={(e) => { const value = parseCompensationInput(e.target.value); if (!Number.isNaN(value)) update("salaryTargetCents", value); }} /></label><label htmlFor="salary-minimum">Hard minimum<input id="salary-minimum" inputMode="decimal" defaultValue={draft.salaryHardMinimumCents === null ? "" : String(draft.salaryHardMinimumCents / 100)} onBlur={(e) => { const value = parseCompensationInput(e.target.value); if (!Number.isNaN(value)) update("salaryHardMinimumCents", value); }} /></label></div>{hasPay && <div className="field-grid"><label htmlFor="salary-period">Pay period <Required /><select id="salary-period" value={draft.salaryPeriod} onChange={(e) => update("salaryPeriod", e.target.value as FourStepDraft["salaryPeriod"])}><option value="">Choose one</option><option value="YEAR">Annual</option><option value="HOUR">Hourly</option></select></label><label htmlFor="salary-basis">Pay meaning <Required /><select id="salary-basis" value={draft.salaryBasis} onChange={(e) => update("salaryBasis", e.target.value as FourStepDraft["salaryBasis"])}><option value="">Choose one</option><option value="BASE">Base pay</option><option value="GUARANTEED_TOTAL">Guaranteed total pay</option></select></label></div>}<label className="confirm"><input type="checkbox" checked={draft.salaryMinimumFlexible} onChange={(e) => update("salaryMinimumFlexible", e.target.checked)} /><span>Pay is flexible.</span></label><Policy name="unpublished" label="Jobs with unpublished pay" value={draft.salaryUnpublishedPolicy} onChange={(value) => update("salaryUnpublishedPolicy", value)} /><Policy name="overlap" label="Ranges that start below but reach my minimum" value={draft.salaryOverlapPolicy} onChange={(value) => update("salaryOverlapPolicy", value)} />{hasPay && <><Policy name="noncomparable" label="Published pay that cannot be compared directly" value={draft.salaryNoncomparablePolicy} onChange={(value) => update("salaryNoncomparablePolicy", value)} /><Policy name="variable" label="Materially variable compensation" value={draft.salaryVariablePayPolicy} onChange={(value) => update("salaryVariablePayPolicy", value)} /></>}</fieldset>; }
function Policy({ name, label, value, onChange }: { name: string; label: string; value: "EXCLUDE" | "INCLUDE_WITH_WARNING"; onChange: (value: "EXCLUDE" | "INCLUDE_WITH_WARNING") => void }) { return <fieldset><legend>{label}</legend><Radio name={name} value="EXCLUDE" checked={value} onChange={onChange} label="Do not show me" /><Radio name={name} value="INCLUDE_WITH_WARNING" checked={value} onChange={onChange} label="Open to, with a clear warning" /></fieldset>; }
function Review({ draft, resume, cover, onEdit }: { draft: FourStepDraft; resume: IntakeDocument | null; cover: IntakeDocument | null; onEdit: (step: 0 | 1 | 2 | 3) => void }) { const rows: [string,string,0|1|2|3][] = [["Contact and documents", `${draft.fullName || "Not set"}; ${draft.email || "not set"}; ${resume?.name || "resume missing"}${cover ? `; ${cover.name}` : ""}`,0],["Search direction", `${draft.desiredActivities.map((value) => labels[value] || value).join(", ") || "Guidance requested"}; ${labels[draft.searchBreadth]}`,1],["Experience review", `${Object.values(draft.factReviews).filter((value) => value === "CONFIRM").length} resume suggestions confirmed; ${draft.experienceAdditions.length} additions`,2],["Requirements", `${draft.workModes.map(titleCase).join(", ") || "work mode missing"}; ${draft.stateOrDc || "state missing"}; ${formatCompensation(draft.salaryHardMinimumCents, draft.salaryPeriod)}`,3]]; return <section className="review-list" aria-labelledby="review-title"><div className="review-heading"><h3 id="review-title">Review your search</h3><button type="button" onClick={() => onEdit(0)}>Edit all answers</button></div>{rows.map(([title, text, target]) => <div key={title}><p><strong>{title}</strong><span>{text}</span></p><button type="button" onClick={() => onEdit(target)}>Edit</button></div>)}</section>; }
function split(value: string) { return value.split(",").map((item) => item.trim()).filter(Boolean); }
function titleCase(value: string) { return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }

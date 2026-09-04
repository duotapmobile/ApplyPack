"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, LockKeyhole } from "lucide-react";

type Draft = {
  email: string;
  fullName: string;
  city: string;
  state: string;
  timezone: string;
  linkedin: string;
  resumeFormat: string;
  coverLetterPreference: string;
  backgroundTypes: string[];
  backgroundDetails: string;
  tools: string;
  credentials: string;
  resumeCorrections: string;
  remoteRequirement: string;
  hybridPolicy: string;
  onSitePolicy: string;
  remoteDetail: string;
  minimumSalary: string;
  preferredSalary: string;
  minimumHourly: string;
  preferredHourly: string;
  unknownSalaryPolicy: string;
  employmentTypes: string[];
  schedulePreferences: string[];
  requiredBenefits: string[];
  preferredBenefits: string[];
  unknownBenefitsPolicy: string;
  neverInclude: string[];
  tryAvoid: string[];
  previousDislikes: string;
  excludedIndustries: string;
  directionChoice: string;
  targetTitles: string;
  searchDistance: string;
  oldCareerExclusion: string;
  workAuthorization: string;
  needsSponsorship: string;
  travelPreference: string;
  commuteDistance: string;
  eligibilityRestrictions: string;
  criteriaApproved: boolean;
  researchAcknowledged: boolean;
  noGuaranteeAcknowledged: boolean;
  listingChangesAcknowledged: boolean;
  termsAccepted: boolean;
  accuracyConfirmed: boolean;
};

type SavedDocument = { name: string; size: number; mimeType: string; scanStatus: string };

const emptyDraft: Draft = {
  email: "", fullName: "", city: "", state: "", timezone: "",
  linkedin: "", resumeFormat: "", coverLetterPreference: "not_uploaded",
  backgroundTypes: [], backgroundDetails: "", tools: "", credentials: "", resumeCorrections: "",
  remoteRequirement: "", hybridPolicy: "", onSitePolicy: "", remoteDetail: "",
  minimumSalary: "", preferredSalary: "", minimumHourly: "", preferredHourly: "",
  unknownSalaryPolicy: "", employmentTypes: [], schedulePreferences: [],
  requiredBenefits: [], preferredBenefits: [], unknownBenefitsPolicy: "",
  neverInclude: [], tryAvoid: [], previousDislikes: "", excludedIndustries: "",
  directionChoice: "", targetTitles: "", searchDistance: "", oldCareerExclusion: "",
  workAuthorization: "", needsSponsorship: "", travelPreference: "", commuteDistance: "",
  eligibilityRestrictions: "", criteriaApproved: false, researchAcknowledged: false,
  noGuaranteeAcknowledged: false, listingChangesAcknowledged: false,
  termsAccepted: false, accuracyConfirmed: false,
};

const groups = {
  background: ["Paid work", "Business ownership", "Freelance or contract", "Education", "Volunteer work", "Caregiving or life experience"],
  employment: ["Full-time", "Part-time", "Contract", "Temporary"],
  schedule: ["Weekdays", "Evenings", "Weekends", "Flexible hours", "No weekends"],
  benefits: ["Health insurance", "Paid time off", "Retirement benefits"],
  exclusions: ["Sales", "Cold calling", "Commission-only pay", "Heavy phone work", "People management", "Travel", "On-call work", "Physical labor"],
};

const STORAGE_KEY = "applypack-intake-draft-v2";
const DRAFT_TTL_MS = 2 * 60 * 60 * 1000;

export function IntakeWizard({ authenticatedEmail }: { authenticatedEmail: string }) {
  const guestCustomer = !authenticatedEmail;
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>({ ...emptyDraft, email: authenticatedEmail });
  const [resume, setResume] = useState<File | null>(null);
  const [coverLetter, setCoverLetter] = useState<File | null>(null);
  const [savedResume, setSavedResume] = useState<SavedDocument | null>(null);
  const [savedCoverLetter, setSavedCoverLetter] = useState<SavedDocument | null>(null);
  const [draftId, setDraftId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const previousStep = useRef(step);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/intake/draft", { signal: controller.signal });
        const result = response.ok ? await response.json() : null;
        if (result?.draft) {
          setDraft({ ...emptyDraft, ...result.draft.answers, email: authenticatedEmail || String(result.draft.answers?.email || "") });
          setStep(Number(result.draft.currentStep || 0));
          setDraftId(String(result.draft.id || ""));
          setSavedResume(result.draft.resumeDocument || null);
          setSavedCoverLetter(result.draft.coverLetterDocument || null);
        } else {
          const saved = window.sessionStorage.getItem(STORAGE_KEY);
          if (saved) {
            const parsed = JSON.parse(saved) as { savedAt?: number; draft?: Partial<Draft> };
            if (parsed.savedAt && Date.now() - parsed.savedAt < DRAFT_TTL_MS && parsed.draft) {
              setDraft({ ...emptyDraft, ...parsed.draft, email: authenticatedEmail || String(parsed.draft.email || "") });
            }
          }
        }
      } catch {
        if (!controller.signal.aborted) setMessage("Saved progress could not be loaded. You can continue and try saving again.");
      } finally {
        setReady(true);
      }
    }, 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [authenticatedEmail]);

  useEffect(() => {
    if (ready) {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), draft }));
    }
  }, [draft, ready]);

  useEffect(() => {
    if (previousStep.current !== step) {
      panelRef.current?.querySelector<HTMLHeadingElement>("h2")?.focus();
      previousStep.current = step;
    }
  }, [step]);

  const validSteps = useMemo(() => [
    draft.email.includes("@") && draft.fullName.trim().length >= 2 && draft.city.trim().length >= 2 && draft.state.trim().length >= 2 && draft.timezone.length >= 2,
    Boolean(resume || savedResume) && Boolean(draft.resumeFormat) && Boolean(draft.coverLetterPreference),
    draft.backgroundTypes.length > 0 && draft.backgroundDetails.trim().length >= 20,
    Boolean(draft.remoteRequirement) && Boolean(draft.hybridPolicy) && Boolean(draft.onSitePolicy) && Boolean(draft.unknownSalaryPolicy) && draft.employmentTypes.length > 0 && Boolean(draft.unknownBenefitsPolicy),
    draft.neverInclude.length > 0,
    Boolean(draft.directionChoice) && Boolean(draft.searchDistance) && draft.workAuthorization.trim().length >= 2 && Boolean(draft.needsSponsorship) && draft.travelPreference.trim().length >= 2,
    draft.criteriaApproved && draft.researchAcknowledged && draft.noGuaranteeAcknowledged && draft.listingChangesAcknowledged && draft.termsAccepted && draft.accuracyConfirmed,
  ], [draft, resume, savedResume]);

  const validationMessages = [
    "Add your name, email, city, state, and time zone before continuing.",
    "Attach your resume and choose how we should handle its format.",
    "Choose at least one background type and give us at least a few sentences about your experience.",
    "Complete the work-setting, employment-type, salary, and benefits choices.",
    "Choose at least one thing that must never appear in your matches.",
    "Complete the direction, search distance, work authorization, sponsorship, and travel fields.",
    "Review the service limits and check the agreement before checkout.",
  ];


  function field<K extends keyof Draft>(name: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [name]: value }));
    setMessage("");
  }

  function showError(value: string) {
    setMessage(value);
    window.requestAnimationFrame(() => messageRef.current?.focus());
  }

  function toggle(name: "backgroundTypes" | "employmentTypes" | "schedulePreferences" | "requiredBenefits" | "preferredBenefits" | "neverInclude" | "tryAvoid", value: string) {
    const current = draft[name];
    field(name, (current.includes(value) ? current.filter((item) => item !== value) : [...current, value]) as Draft[typeof name]);
  }

  async function saveDraft(nextStep: number) {
    const response = await fetch("/api/intake/draft", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ currentStep: nextStep, answers: { ...draft, email: draft.email } }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Your progress could not be saved.");
    setDraftId(String(result.draft.id));
  }

  async function saveDocument(kind: "resume" | "cover_letter", file: File) {
    const form = new FormData();
    form.set("kind", kind);
    form.set("file", file);
    const response = await fetch("/api/intake/draft/document", { method: "POST", body: form });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The document could not be saved.");
    setDraftId(String(result.draftId));
    if (kind === "resume") setSavedResume(result.document);
    else setSavedCoverLetter(result.document);
  }

  async function removeDocument(kind: "resume" | "cover_letter") {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/intake/draft/document?kind=" + kind, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The saved document could not be removed.");
      if (kind === "resume") { setSavedResume(null); setResume(null); }
      else { setSavedCoverLetter(null); setCoverLetter(null); field("coverLetterPreference", "not_uploaded"); }
      setMessage("The saved document was removed.");
    } catch (error) {
      showError(error instanceof Error ? error.message : "The saved document could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  async function advance() {
    if (!validSteps[step]) {
      showError(validationMessages[step]);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      if (step === 1) {
        if (resume) await saveDocument("resume", resume);
        if (coverLetter) await saveDocument("cover_letter", coverLetter);
      }
      const nextStep = Math.min(6, step + 1);
      await saveDraft(nextStep);
      setStep(nextStep);
      setMessage("Progress saved securely.");
    } catch (error) {
      showError(error instanceof Error ? error.message : "Your progress could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!validSteps[6] || !savedResume) {
      showError(validationMessages[6]);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const form = new FormData();
      Object.entries(draft).forEach(([key, value]) => {
        form.set(key, Array.isArray(value) ? JSON.stringify(value) : String(value));
      });
      form.set("email", draft.email);
      form.set("draftId", draftId);
      const response = await fetch("/api/intake", { method: "POST", body: form });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Your intake could not be saved.");
      if (result.sourceScanStatus !== "clean") {
        setMessage(result.message || "Your documents are held privately until the configured safety checks complete. No payment was started.");
        return;
      }
      const checkout = await fetch("/api/checkout/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ intakeId: result.intakeId }),
      });
      const checkoutResult = await checkout.json();
      if (!checkout.ok) throw new Error(checkoutResult.error || "Checkout could not be opened.");
      window.sessionStorage.removeItem(STORAGE_KEY);
      window.location.assign(checkoutResult.url);
    } catch (error) {
      showError(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const displayedStage = [1, 1, 2, 2, 3, 3, 4][step];

  if (!ready) return <main id="main-content" className="auth-page"><section className="auth-card"><p className="eyebrow">SECURE INTAKE</p><h1>Loading your intake.</h1></section></main>;

  return (
    <main id="main-content" className="wizard-page">
      <div className="page-frame wizard-layout">
        <aside className="wizard-aside">
          <p className="eyebrow eyebrow--light">YOUR 24-HOUR SEARCH</p>
          <h1>Let&apos;s find what fits next.</h1>
          <p>10 researched job matches for $20. Your firm 24-hour deadline appears after both intake and payment are complete.</p>
          <div className="wizard-price"><strong>$20</strong><span>one search<br />no subscription</span></div>
          <p className="wizard-security"><LockKeyhole aria-hidden="true" /> Files stay in private secure storage. Document contents are never stored in this browser draft.</p>
        </aside>
        <section ref={panelRef} className="wizard-panel" aria-labelledby="wizard-title">
          <div className="wizard-progress" role="progressbar" aria-label="Intake progress" aria-valuemin={1} aria-valuemax={4} aria-valuenow={displayedStage} aria-valuetext={"Stage " + displayedStage + " of 4"}>
            <span>STAGE {displayedStage} OF 4</span><div><i style={{ width: (displayedStage / 4 * 100) + "%" }} /></div>
          </div>

          {step === 0 && <WizardStep title="First, where are you?" help="These details help us evaluate location and schedule fit.">
            <div className="field-grid">
              <label>Full name <Required /><input autoComplete="name" value={draft.fullName} onChange={(e) => field("fullName", e.target.value)} /></label>
              <label>Email address <Required /><input autoComplete="email" inputMode="email" type="email" value={draft.email} onChange={(e) => field("email", e.target.value)} readOnly={!guestCustomer} aria-readonly={!guestCustomer} /></label>
              <label>City <Required /><input autoComplete="address-level2" value={draft.city} onChange={(e) => field("city", e.target.value)} /></label>
              <label>State or region <Required /><input autoComplete="address-level1" value={draft.state} onChange={(e) => field("state", e.target.value)} /></label>
            </div>
            <label>Time zone <Required /><select value={draft.timezone} onChange={(e) => field("timezone", e.target.value)}><option value="">Choose one</option><option>Eastern Time</option><option>Central Time</option><option>Mountain Time</option><option>Pacific Time</option><option>Alaska Time</option><option>Hawaii Time</option><option>Outside the United States</option></select></label>
          </WizardStep>}

          {step === 1 && <WizardStep title="Share the documents we should work from." help="PDF or DOCX, up to 10 MB each. Please remove Social Security numbers, birth dates, and other unnecessary sensitive details.">
            <label className="file-drop">Current resume <Required /><input required={!savedResume} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => setResume(e.target.files?.[0] || null)} /><span>{resume ? `${resume.name} (${formatBytes(resume.size)}) ; will replace saved file` : savedResume ? `${savedResume.name} (${formatBytes(savedResume.size)}) ; saved privately` : "Choose your resume"}</span></label>
            {savedResume ? <button type="button" className="text-button" disabled={busy} onClick={() => removeDocument("resume")}>Remove saved resume</button> : null}
            <label className="file-drop">Existing cover letter <span>(optional)</span><input type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => { const file = e.target.files?.[0] || null; setCoverLetter(file); field("coverLetterPreference", file ? "voice" : "not_uploaded"); }} /><span>{coverLetter ? `${coverLetter.name} (${formatBytes(coverLetter.size)}) ; will replace saved file` : savedCoverLetter ? `${savedCoverLetter.name} (${formatBytes(savedCoverLetter.size)}) ; saved privately` : "No cover letter selected"}</span></label>
            {savedCoverLetter ? <button type="button" className="text-button" disabled={busy} onClick={() => removeDocument("cover_letter")}>Remove saved cover letter</button> : null}
            <label>LinkedIn profile <span>(optional)</span><input type="url" placeholder="https://www.linkedin.com/in/..." value={draft.linkedin} onChange={(e) => field("linkedin", e.target.value)} /></label>
            <label>Resume formatting <Required /><select value={draft.resumeFormat} onChange={(e) => field("resumeFormat", e.target.value)}><option value="">Choose one</option><option value="keep">Keep my current format where practical</option><option value="applypack">Use ApplyPack&apos;s clean format</option><option value="decide">Use your judgment</option></select></label>
            {coverLetter && <label>How should we use it? <Required /><select value={draft.coverLetterPreference} onChange={(e) => field("coverLetterPreference", e.target.value)}><option value="voice">Preserve its voice where useful</option><option value="facts">Use it only as a fact source</option><option value="fresh">Start fresh</option></select></label>}
          </WizardStep>}

          {step === 2 && <WizardStep title="Help us understand your full background." help="We only use claims you provide. We do not invent credentials, results, employers, or skills.">
            <CheckGroup legend="Which experiences should count?" required options={groups.background} values={draft.backgroundTypes} onToggle={(value) => toggle("backgroundTypes", value)} />
            <label>Experience, accomplishments, and responsibilities <Required /><textarea className="textarea-large" value={draft.backgroundDetails} onChange={(e) => field("backgroundDetails", e.target.value)} placeholder="Tell us what you did, who it helped, and any results you can support." /></label>
            <label>Tools and systems <span>(optional)</span><textarea value={draft.tools} onChange={(e) => field("tools", e.target.value)} /></label>
            <label>Credentials or training <span>(optional)</span><textarea value={draft.credentials} onChange={(e) => field("credentials", e.target.value)} /></label>
            <label>Anything on the resume that needs correction? <span>(optional)</span><textarea value={draft.resumeCorrections} onChange={(e) => field("resumeCorrections", e.target.value)} /></label>
          </WizardStep>}

          {step === 3 && <WizardStep title="What needs to fit your life?" help="Required choices are hard constraints. Preferences guide ranking when a listing provides enough information.">
            <div className="field-grid">
              <label>Remote work <Required /><select value={draft.remoteRequirement} onChange={(e) => field("remoteRequirement", e.target.value)}><option value="">Choose one</option><option value="required">Required</option><option value="preferred">Preferred</option><option value="not_important">Not important</option></select></label>
              <label>Hybrid roles <Required /><select value={draft.hybridPolicy} onChange={(e) => field("hybridPolicy", e.target.value)}><option value="">Choose one</option><option value="open">Include</option><option value="exclude">Exclude</option></select></label>
              <label>On-site roles <Required /><select value={draft.onSitePolicy} onChange={(e) => field("onSitePolicy", e.target.value)}><option value="">Choose one</option><option value="open">Include</option><option value="exclude">Exclude</option></select></label>
              <label>Listings without salary <Required /><select value={draft.unknownSalaryPolicy} onChange={(e) => field("unknownSalaryPolicy", e.target.value)}><option value="">Choose one</option><option value="exclude">Exclude</option><option value="include_mark_unknown">Include and mark unknown</option></select></label>
            </div>
            <label>Location details <span>(optional)</span><input value={draft.remoteDetail} onChange={(e) => field("remoteDetail", e.target.value)} placeholder="Remote in the U.S. or within 25 miles of..." /></label>
            <div className="field-grid">
              <label>Minimum annual salary <span>(optional)</span><input value={draft.minimumSalary} onChange={(e) => field("minimumSalary", e.target.value)} placeholder="$70,000" /></label>
              <label>Preferred annual salary <span>(optional)</span><input value={draft.preferredSalary} onChange={(e) => field("preferredSalary", e.target.value)} placeholder="$85,000" /></label>
              <label>Minimum hourly rate <span>(optional)</span><input value={draft.minimumHourly} onChange={(e) => field("minimumHourly", e.target.value)} placeholder="$30" /></label>
              <label>Preferred hourly rate <span>(optional)</span><input value={draft.preferredHourly} onChange={(e) => field("preferredHourly", e.target.value)} placeholder="$40" /></label>
            </div>
            <CheckGroup legend="Employment types" required options={groups.employment} values={draft.employmentTypes} onToggle={(value) => toggle("employmentTypes", value)} />
            <CheckGroup legend="Schedule preferences" options={groups.schedule} values={draft.schedulePreferences} onToggle={(value) => toggle("schedulePreferences", value)} />
            <CheckGroup legend="Required benefits" options={groups.benefits} values={draft.requiredBenefits} onToggle={(value) => toggle("requiredBenefits", value)} />
            <CheckGroup legend="Preferred benefits" options={groups.benefits} values={draft.preferredBenefits} onToggle={(value) => toggle("preferredBenefits", value)} />
            <label>Listings without benefit details <Required /><select value={draft.unknownBenefitsPolicy} onChange={(e) => field("unknownBenefitsPolicy", e.target.value)}><option value="">Choose one</option><option value="exclude">Exclude</option><option value="include_mark_unknown">Include and mark unknown</option></select></label>
          </WizardStep>}

          {step === 4 && <WizardStep title="What should never show up again?" help="We use this to filter out roles that may look relevant on paper but are wrong for you.">
            <CheckGroup legend="Never include" required options={groups.exclusions} values={draft.neverInclude} onToggle={(value) => toggle("neverInclude", value)} />
            <CheckGroup legend="Try to avoid" options={groups.exclusions} values={draft.tryAvoid} onToggle={(value) => toggle("tryAvoid", value)} />
            <label>What did you dislike in previous work? <span>(optional)</span><textarea value={draft.previousDislikes} onChange={(e) => field("previousDislikes", e.target.value)} /></label>
            <label>Industries or employers to exclude <span>(optional)</span><textarea value={draft.excludedIndustries} onChange={(e) => field("excludedIndustries", e.target.value)} /></label>
          </WizardStep>}

          {step === 5 && <WizardStep title="How far should this search stretch?" help="We will explain why each delivered job connects to your background and flag unknowns.">
            <div className="field-grid">
              <label>Search direction <Required /><select value={draft.directionChoice} onChange={(e) => field("directionChoice", e.target.value)}><option value="">Choose one</option><option value="exact">Stay close to my current work</option><option value="ideas">Show me adjacent ideas</option><option value="different">Help me make a bigger change</option><option value="unknown">I am not sure yet</option></select></label>
              <label>How far from your background? <Required /><select value={draft.searchDistance} onChange={(e) => field("searchDistance", e.target.value)}><option value="">Choose one</option><option value="close">Close match</option><option value="adjacent">Adjacent skills</option><option value="bigger_change">Bigger change</option></select></label>
            </div>
            <label>Target titles or directions <span>(optional)</span><textarea value={draft.targetTitles} onChange={(e) => field("targetTitles", e.target.value)} /></label>
            <label>Old-career work to exclude <span>(optional)</span><textarea value={draft.oldCareerExclusion} onChange={(e) => field("oldCareerExclusion", e.target.value)} /></label>
            <label>Work authorization <Required /><input value={draft.workAuthorization} onChange={(e) => field("workAuthorization", e.target.value)} placeholder="Authorized to work in the U.S." /></label>
            <div className="field-grid">
              <label>Need sponsorship? <Required /><select value={draft.needsSponsorship} onChange={(e) => field("needsSponsorship", e.target.value)}><option value="">Choose one</option><option value="no">No</option><option value="yes">Yes</option><option value="unsure">Unsure</option></select></label>
              <label>Travel preference <Required /><input value={draft.travelPreference} onChange={(e) => field("travelPreference", e.target.value)} placeholder="No travel, or up to 10%" /></label>
              <label>Maximum commute <span>(optional)</span><input value={draft.commuteDistance} onChange={(e) => field("commuteDistance", e.target.value)} /></label>
            </div>
            <label>Other eligibility restrictions <span>(optional)</span><textarea value={draft.eligibilityRestrictions} onChange={(e) => field("eligibilityRestrictions", e.target.value)} /></label>
          </WizardStep>}

          {step === 6 && <WizardStep title="Review the boundary before payment." help="Your exact contractual deadline will be recorded after successful Stripe payment.">
            <div className="review-list">
              <p><strong>Identity and location</strong>{[draft.fullName, draft.city, draft.state, draft.timezone].filter(Boolean).join(", ")} <button type="button" onClick={() => setStep(0)}>Change</button></p>
              <p><strong>Documents</strong>{savedResume?.name || resume?.name}{savedCoverLetter ? `; ${savedCoverLetter.name}` : ""} · {draft.resumeFormat} <button type="button" onClick={() => setStep(1)}>Change</button></p>
              <p><strong>Confirmed experience</strong>{[...draft.backgroundTypes, draft.backgroundDetails, draft.tools, draft.credentials].filter(Boolean).join("; ")} <button type="button" onClick={() => setStep(2)}>Change</button></p>
              <p><strong>Location, schedule, compensation, and benefits</strong>{[draft.remoteRequirement, draft.hybridPolicy, draft.onSitePolicy, draft.minimumSalary, draft.preferredSalary, draft.minimumHourly, draft.preferredHourly, draft.unknownSalaryPolicy, ...draft.employmentTypes, ...draft.schedulePreferences, ...draft.requiredBenefits, ...draft.preferredBenefits, draft.unknownBenefitsPolicy].filter(Boolean).join("; ")} <button type="button" onClick={() => setStep(3)}>Change</button></p>
              <p><strong>Dealbreakers and preferences</strong>{[...draft.neverInclude, ...draft.tryAvoid, draft.previousDislikes, draft.excludedIndustries].filter(Boolean).join("; ") || "None selected"} <button type="button" onClick={() => setStep(4)}>Change</button></p>
              <p><strong>Direction and eligibility</strong>{[draft.directionChoice, draft.searchDistance, draft.targetTitles, draft.oldCareerExclusion, draft.workAuthorization, draft.needsSponsorship, draft.travelPreference, draft.commuteDistance, draft.eligibilityRestrictions].filter(Boolean).join("; ")} <button type="button" onClick={() => setStep(5)}>Change</button></p>
            </div>
            <div className="deadline-note"><strong>Contractual deadline:</strong> the exact 24-hour deadline begins only after this completed intake, your approved criteria, available capacity, and successful payment are verified. My ApplyPack will show the controlling Eastern timestamp.</div>
            <div className="deadline-note"><strong>Before you continue:</strong><ul><li>ApplyPack researches public listings but does not contact employers or submit applications.</li><li>Listings can change or close after they are checked.</li><li>ApplyPack cannot guarantee interviews, offers, or hiring outcomes.</li></ul></div>
            <label className="confirm"><input type="checkbox" checked={draft.termsAccepted && draft.criteriaApproved && draft.accuracyConfirmed} onChange={(e) => { const checked = e.target.checked; setDraft((current) => ({ ...current, criteriaApproved: checked, researchAcknowledged: checked, noGuaranteeAcknowledged: checked, listingChangesAcknowledged: checked, termsAccepted: checked, accuracyConfirmed: checked })); setMessage(""); }} /><span>I confirm my information and criteria are accurate, understand the service limits above, agree to the <Link href="/terms">Terms</Link>, and acknowledge the <Link href="/privacy">Privacy Policy</Link>.</span></label>
          </WizardStep>}

          <div className="wizard-actions">
            <button className="wizard-back" type="button" onClick={() => { setMessage(""); setStep((value) => Math.max(0, value - 1)); }} disabled={step === 0 || busy}><ArrowLeft aria-hidden="true" />Back</button>
            {step < 6
              ? <button className="wizard-next" type="button" aria-describedby="step-help form-message" disabled={busy} onClick={advance}>{busy ? "Saving..." : "Save and Continue"}<ArrowRight aria-hidden="true" /></button>
              : <button className="wizard-next" type="button" aria-describedby="step-help form-message" disabled={busy} onClick={submit}>{busy ? "Preparing..." : "Continue to Secure Checkout"}<ArrowRight aria-hidden="true" /></button>}
          </div>
          <p ref={messageRef} tabIndex={-1} id="form-message" className={message ? "form-message" : "sr-only"} role={message ? "alert" : "status"} aria-live={message ? "assertive" : "polite"}>{message || "Complete the required fields before continuing."}</p>
        </section>
      </div>
    </main>
  );
}

function WizardStep({ title, help, children }: { title: string; help: string; children: React.ReactNode }) {
  return <div className="wizard-step"><h2 id="wizard-title" tabIndex={-1}>{title}</h2><p id="step-help">{help}</p><div className="wizard-fields">{children}</div></div>;
}

function Required() {
  return <span className="required-hint">required</span>;
}

function CheckGroup({ legend, required = false, options, values, onToggle }: { legend: string; required?: boolean; options: string[]; values: string[]; onToggle: (value: string) => void }) {
  return <fieldset><legend>{legend} {required && <Required />}</legend><div className="choice-grid">{options.map((item) => <label className="choice" key={item}><input type="checkbox" checked={values.includes(item)} onChange={() => onToggle(item)} /><span><Check aria-hidden="true" />{item}</span></label>)}</div></fieldset>;
}

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

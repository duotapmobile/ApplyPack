"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight, Check, ShoppingBag } from "lucide-react";
import { careerBreakOptions, type CareerBreakChoice } from "@/lib/materials/contract";

export type MatchForSelection = {
  id: string;
  position: number;
  fit_summary: string;
  matching_experience: string[];
  primary_outcome: string;
  core_responsibilities: string[];
  requirements: string[];
  hidden_job_functions: string[];
  concerns: string[];
  ranking_reason_codes?: Array<{ code: string; points: number; explanation: string }>;
  release_explanation?: Record<string, unknown>;
  allowed_unknown_warnings?: string[];
  source_provenance?: Record<string, unknown>;
  compensation_status?: string | null;
  posted_on?: string | null;
  posted_date_unknown?: boolean;
  last_checked_at?: string | null;
  job_snapshot_id: string;
  submission_rule_id: string | null;
  reference_timing: "OPTIONAL_NOW" | "REQUIRED_NOW" | "PROHIBITED_NOW" | "LATER_OR_UNKNOWN";
  reference_count: number | null;
  job: {
    company: string;
    title: string;
    source_url: string;
    official_application_url?: string | null;
    source_name?: string | null;
    source_category?: string | null;
    location_text: string | null;
    salary_text: string | null;
    checked_at: string;
    listing_status: string;
    employment_type?: string;
    w2_or_contractor?: string;
    work_mode?: string;
    remote_scope?: string | null;
    eligible_states?: string[] | null;
    eligible_countries?: string[] | null;
    timezone_requirement?: string | null;
    schedule_type?: string | null;
    pay_model?: string;
    phone_intensity?: string;
    sales_flag?: boolean;
    commission_flag?: boolean;
    marketing_flag?: boolean;
    high_volume_contact_center_flag?: boolean;
    equipment_requirement?: string | null;
    equipment_cost_responsibility?: string;
    applicant_cost?: number | null;
    benefits_status?: string;
    experience_level?: string;
    is_active?: boolean;
    review_status?: string;
    rejection_reason?: string | null;
  };
};

type Notes = Record<string, { emphasisNotes: string; doNotMentionNotes: string }>;

type ReferenceSummary = {
  opaqueId: string;
  reference: { name: string };
  allowedApplications: Array<{
    permissionId: string;
    jobSnapshotId: string;
    employer: string;
    exactPosition: string;
  }>;
};

export function ApplyPackSelector({
  matches,
  evaluatedAt,
  deliveredOrderId,
  deliveredReleaseId,
  sourceSnapshotId,
  initialEmail,
}: {
  matches: MatchForSelection[];
  evaluatedAt: string;
  deliveredOrderId: string;
  deliveredReleaseId: string;
  sourceSnapshotId: string;
  initialEmail: string;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [notes, setNotes] = useState<Notes>({});
  const [contact, setContact] = useState({
    displayName: "",
    email: initialEmail,
    phone: "",
    cityState: "",
    linkedInOrPortfolio: "",
  });
  const [careerBreakChoice, setCareerBreakChoice] = useState<CareerBreakChoice>("KEEP_EXISTING_TIMELINE");
  const [careerBreakCustomLabel, setCareerBreakCustomLabel] = useState("");
  const [coverLetterBreakConsent, setCoverLetterBreakConsent] = useState(false);
  const [documentContactConfirmed, setDocumentContactConfirmed] = useState(false);
  const [documentFactsConfirmed, setDocumentFactsConfirmed] = useState(false);
  const [noAutoApplyAcknowledged, setNoAutoApplyAcknowledged] = useState(false);
  const [outcomesAcknowledged, setOutcomesAcknowledged] = useState(false);
  const [references, setReferences] = useState<ReferenceSummary[]>([]);
  const [referenceSheetJobs, setReferenceSheetJobs] = useState<string[]>([]);
  const [referencePermissions, setReferencePermissions] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflictFor, setConflictFor] = useState("");
  const [explanation, setExplanation] = useState("");
  const [availableUnits, setAvailableUnits] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = () => Promise.all([
      fetch("/api/capacity/apply_pack", { signal: controller.signal }).then(async (response) => response.ok ? response.json() : null),
      fetch("/api/customer/references", { signal: controller.signal, cache: "no-store" }).then(async (response) => response.ok ? response.json() : null),
    ])
      .then(([capacity, referenceResult]) => {
        setAvailableUnits(capacity ? Number(capacity.availableUnits) : 0);
        setReferences(Array.isArray(referenceResult?.references) ? referenceResult.references : []);
      })
      .catch(() => {
        if (!controller.signal.aborted) setAvailableUnits(0);
      });
    const refreshReferences = () => { void load(); };
    void load();
    window.addEventListener("applypack:references-updated", refreshReferences);
    return () => {
      controller.abort();
      window.removeEventListener("applypack:references-updated", refreshReferences);
    };
  }, []);

  function toggle(id: string) {
    setMessage("");
    setSelected((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : current.length < Math.min(10, availableUnits ?? 0) ? [...current, id] : current);
  }

  function updateNotes(id: string, key: "emphasisNotes" | "doNotMentionNotes", value: string) {
    setNotes((current) => ({ ...current, [id]: { ...(current[id] || { emphasisNotes: "", doNotMentionNotes: "" }), [key]: value } }));
  }

  function updateContact(key: keyof typeof contact, value: string) {
    setContact((current) => ({ ...current, [key]: value }));
    setDocumentContactConfirmed(false);
  }

  function toggleReferenceSheet(matchId: string, enabled: boolean) {
    setReferenceSheetJobs((current) => enabled ? [...new Set([...current, matchId])] : current.filter((id) => id !== matchId));
    if (!enabled) setReferencePermissions((current) => ({ ...current, [matchId]: [] }));
  }

  function toggleReferencePermission(matchId: string, permissionId: string, maximum: number) {
    setReferencePermissions((current) => {
      const values = current[matchId] || [];
      const next = values.includes(permissionId)
        ? values.filter((id) => id !== permissionId)
        : values.length < maximum ? [...values, permissionId] : values;
      return { ...current, [matchId]: next };
    });
  }

  async function saveDecision(id: string, decision: "not_for_me" | "undecided") {
    setMessage("");
    const response = await fetch("/api/customer/job-matches/" + id + "/decision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    const result = await response.json();
    setMessage(response.ok ? "Your job decision was saved." : result.error);
  }

  async function submitConflict(id: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/customer/job-matches/" + id + "/conflict", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ explanation }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessage("Your criteria-conflict review was submitted. We will review it before any replacement.");
      setConflictFor("");
      setExplanation("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The request could not be submitted.");
    } finally {
      setBusy(false);
    }
  }

  async function checkout() {
    if (!selected.length) return setMessage("Select at least one available job first.");
    if (availableUnits === null || selected.length > availableUnits) return setMessage("Current capacity changed. Refresh availability before checkout.");
    if (!contact.displayName.trim() || !contact.email.trim() || !contact.phone.trim() || !contact.cityState.trim()) {
      return setMessage("Confirm the professional name, email, phone, and city/state that will appear on your documents.");
    }
    if (careerBreakChoice === "CUSTOM_WORDING" && careerBreakCustomLabel.trim().length < 2) {
      return setMessage("Enter truthful neutral wording for the career-break entry.");
    }
    if (!documentContactConfirmed || !documentFactsConfirmed || !noAutoApplyAcknowledged || !outcomesAcknowledged) {
      return setMessage("Confirm the document details, facts, no-auto-apply boundary, and outcomes notice.");
    }
    for (const matchId of selected) {
      const match = matches.find((candidate) => candidate.id === matchId);
      if (!match?.submission_rule_id) return setMessage("A selected job needs a current human-confirmed submission-rule check.");
      const permissions = referencePermissions[matchId] || [];
      const includesSheet = referenceSheetJobs.includes(matchId);
      if (match.reference_timing === "REQUIRED_NOW" && !includesSheet) {
        return setMessage(`References are required now for ${match.job.title}; select a permitted sheet before checkout.`);
      }
      if (includesSheet && (!permissions.length || permissions.length > Math.min(3, match.reference_count || 3))) {
        return setMessage(`Choose the permitted number of exact-job references for ${match.job.title}.`);
      }
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/checkout/apply-packs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deliveredOrderId,
          deliveredReleaseId,
          sourceSnapshotId,
          contact: {
            ...contact,
            linkedInOrPortfolio: contact.linkedInOrPortfolio.trim() || null,
          },
          items: selected.map((jobMatchId) => ({
            jobMatchId,
            ruleId: matches.find((match) => match.id === jobMatchId)!.submission_rule_id,
            selectedReferenceSheet: referenceSheetJobs.includes(jobMatchId),
            referencePermissionIds: referencePermissions[jobMatchId] || [],
            emphasisNote: notes[jobMatchId]?.emphasisNotes || "",
            doNotMentionNote: notes[jobMatchId]?.doNotMentionNotes || "",
          })),
          careerBreakChoice,
          careerBreakCustomLabel: careerBreakChoice === "CUSTOM_WORDING" ? careerBreakCustomLabel : null,
          coverLetterBreakConsent,
          documentContactConfirmed,
          documentFactsConfirmed,
          noAutoApplyAcknowledged,
          outcomesAcknowledged,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      window.location.assign(result.url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Checkout could not be opened.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="portal-section">
      <div className="portal-section__heading"><div><p className="eyebrow">YOUR COMPLETED SEARCH</p><h2>10 Researched Job Matches</h2><p>Choose Tailored Resume + Cover Letter sets for current listings.</p></div><p>Each selected job is a separate $8 order with one tailored resume and one tailored cover letter. {availableUnits === null ? "Checking current capacity..." : availableUnits > 0 ? `${availableUnits} can be accepted now; availability is reserved only when checkout opens.` : "No 24-hour production slots are currently available."}</p></div>
      <div className="match-grid">
        {matches.map((match) => {
          const checked = selected.includes(match.id);
          const lastCheckedAt = match.last_checked_at || match.job.checked_at;
          const fresh = new Date(evaluatedAt).getTime() - new Date(lastCheckedAt).getTime() <= 24 * 60 * 60 * 1000;
          const available = match.job.listing_status === "open" && match.job.is_active !== false
            && match.job.review_status === "approved" && !match.job.rejection_reason
            && Boolean(match.submission_rule_id) && fresh;
           const maxSelection = Math.min(10, availableUnits ?? 0);
           const release = releaseNarrative(match);
           const applicationUrl = match.job.official_application_url || match.job.source_url;
           const applicationHost = hostLabel(applicationUrl);
           const applicationHostType = stringValue(match.source_provenance?.applicationHostType) || "Reviewed application route";
           const eligibleReferences = references.flatMap((reference) =>
             reference.allowedApplications.filter((permission) => permission.jobSnapshotId === match.job_snapshot_id)
               .map((permission) => ({ ...permission, opaqueId: reference.opaqueId, name: reference.reference.name })));
           const referenceMaximum = Math.min(3, match.reference_count || 3);
           const includesReferenceSheet = referenceSheetJobs.includes(match.id);
          return (
            <article className={"match-card " + (checked ? "match-card--selected" : "")} key={match.id}>
              <div className="match-card__top"><span>#{match.position}</span><label><input aria-label={`${checked ? "Remove" : "Select"} Tailored Resume + Cover Letter for ${match.job.title} at ${match.job.company}`} type="checkbox" checked={checked} onChange={() => toggle(match.id)} disabled={!available || (!checked && selected.length >= maxSelection)} /><i><Check aria-hidden="true" /></i><b>{checked ? "Selected" : available ? "Select" : "Unavailable"}</b></label></div>
              <h3>{match.job.title}</h3>
              <p className="match-company">{match.job.company}</p>
              <div className="job-labels" aria-label="Job classification">
                <span>{label(match.job.w2_or_contractor || "unknown")}</span>
                <span>{label(match.job.work_mode || "unknown")}</span>
                <span>{label(match.job.phone_intensity || "none_or_unknown")} Phone</span>
                {match.job.sales_flag ? <strong>Sales Duties</strong> : null}
                {match.job.marketing_flag ? <strong>Marketing Duties</strong> : null}
                {match.job.commission_flag ? <strong>Commission</strong> : null}
              </div>
              <div className="match-evidence release-explanation">
                <section><h4>What this job actually involves</h4><p>{release.whatJobInvolves}</p></section>
                <section><h4>Why this job made the list</h4><p>{release.whyMadeList}</p></section>
                <section><h4>How your experience connects</h4><p>{release.howExperienceConnects}</p></section>
                <section><h4>What may be new</h4><p>{release.whatMayBeNew}</p></section>
                <section><h4>What to know</h4><p>{release.whatToKnow}</p></section>
              </div>
              <dl>
                <div><dt>Setting and location</dt><dd>{label(match.job.work_mode || "unknown")} · {match.job.location_text || "Location not stated"}{match.job.remote_scope ? ` · ${match.job.remote_scope}` : ""}{match.job.eligible_states?.length ? ` · Eligible states: ${match.job.eligible_states.join(", ")}` : ""}{match.job.timezone_requirement ? ` · ${match.job.timezone_requirement}` : ""}</dd></div>
                <div><dt>Employment</dt><dd>{label(match.job.employment_type || "unknown")} · {label(match.job.w2_or_contractor || "unknown")} · Benefits {label(match.job.benefits_status || "unknown")}</dd></div>
                <div><dt>Compensation</dt><dd>{match.job.salary_text || "Not published"}{match.job.pay_model && match.job.pay_model !== "unknown" ? ` · ${label(match.job.pay_model)}` : ""}{match.compensation_status ? ` · ${label(match.compensation_status)}` : ""}</dd></div>
                <div><dt>Application route</dt><dd>{applicationHost} · {label(applicationHostType)} · {match.job.official_application_url ? "Direct application destination verified" : "Reviewed source destination"}</dd></div>
                <div><dt>Posted</dt><dd>{match.posted_date_unknown || !match.posted_on ? "Employer did not publish a verified date" : new Date(`${match.posted_on}T00:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", dateStyle: "long" })}</dd></div>
                {match.job.equipment_requirement ? <div><dt>Equipment</dt><dd>{match.job.equipment_requirement} Responsibility: {label(match.job.equipment_cost_responsibility || "unknown")}.</dd></div> : null}
                <div><dt>Source</dt><dd>{match.job.source_name || "Reviewed source"} · {label(match.job.source_category || "unknown")}</dd></div>
              </dl>
              {match.allowed_unknown_warnings?.length ? <div className="match-warning"><strong>Allowed unknowns to verify before applying</strong><ul>{match.allowed_unknown_warnings.map((warning) => <li key={warning}>{readableWarning(warning)}</li>)}</ul></div> : null}
              {match.job.applicant_cost !== null && match.job.applicant_cost !== undefined ? <p className="match-warning"><strong>Applicant-paid cost disclosed:</strong> {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(match.job.applicant_cost)}. Review the official posting before proceeding.</p> : null}
              {["contractor", "staffing"].includes(match.job.w2_or_contractor || "") ? <p className="match-warning"><strong>Flexible-work listing:</strong> This is {label(match.job.w2_or_contractor || "unknown")} work, not presented as a normal W-2 employee role. Benefits are {label(match.job.benefits_status || "unknown")}.</p> : null}
              <p className="match-checked">Last checked {new Date(lastCheckedAt).toLocaleString("en-US", { timeZone: "America/New_York" })} ET</p>
              {!available ? <p className="match-warning"><strong>Historical delivery:</strong> This match remains in your record, but it is closed, stale, or awaiting a fresh review and cannot be purchased now.</p> : null}
              {match.concerns.length ? <p className="match-concern"><strong>Know before applying:</strong> {match.concerns.join(" ")}</p> : null}
              <a href={applicationUrl} target="_blank" rel="noreferrer">{match.job.official_application_url ? "View official application listing" : "View source listing"} on {applicationHost} <ArrowUpRight aria-hidden="true" /></a>
              {checked ? <div className="pack-notes">
                <label>Anything to emphasize? <span>(optional, 500 characters)</span><textarea maxLength={500} value={notes[match.id]?.emphasisNotes || ""} onChange={(e) => updateNotes(match.id, "emphasisNotes", e.target.value)} /></label>
                <label>Anything not to mention? <span>(optional, 500 characters)</span><textarea maxLength={500} value={notes[match.id]?.doNotMentionNotes || ""} onChange={(e) => updateNotes(match.id, "doNotMentionNotes", e.target.value)} /></label>
                {match.reference_timing === "PROHIBITED_NOW" ? (
                  <p className="match-warning"><strong>Reference sheet unavailable:</strong> The employer prohibits references at this stage.</p>
                ) : (
                  <fieldset className="reference-choice">
                    <legend>Application-specific reference sheet</legend>
                    <label className="confirm">
                      <input
                        type="checkbox"
                        checked={includesReferenceSheet}
                        onChange={(event) => toggleReferenceSheet(match.id, event.target.checked)}
                      />
                      Include one job-specific reference sheet at no extra charge
                      {match.reference_timing === "REQUIRED_NOW" ? " (required by the employer now)" : " (optional)"}
                    </label>
                    {includesReferenceSheet ? eligibleReferences.length ? (
                      <div className="reference-permission-list">
                        <p>Choose up to {referenceMaximum} people with fresh permission for this exact job.</p>
                        {eligibleReferences.map((reference) => (
                          <label className="confirm" key={reference.permissionId}>
                            <input
                              type="checkbox"
                              checked={(referencePermissions[match.id] || []).includes(reference.permissionId)}
                              onChange={() => toggleReferencePermission(match.id, reference.permissionId, referenceMaximum)}
                            />
                            {reference.name}: permission for {reference.exactPosition} at {reference.employer}
                          </label>
                        ))}
                      </div>
                    ) : <p className="match-warning">No confirmed exact-job permissions are ready. Use Reference options below before checkout.</p> : null}
                    {match.reference_count && match.reference_count > 3 ? (
                      <p className="match-warning">ApplyPack can include three; you must provide the remaining {match.reference_count - 3} yourself.</p>
                    ) : null}
                  </fieldset>
                )}
              </div> : null}
              <div className="match-actions">
                <button aria-label={`Mark ${match.job.title} at ${match.job.company} as not for me`} type="button" onClick={() => saveDecision(match.id, "not_for_me")}>Not for me</button>
                <button aria-expanded={conflictFor === match.id} aria-controls={"conflict-" + match.id} type="button" onClick={() => setConflictFor(conflictFor === match.id ? "" : match.id)}>Conflicts with my criteria</button>
              </div>
              {conflictFor === match.id ? <div className="conflict-form" id={"conflict-" + match.id}>
                <label>Which Dealbreaker does this conflict with?<textarea value={explanation} onChange={(event) => setExplanation(event.target.value)} minLength={10} /></label>
                <button className="wizard-next" disabled={busy || explanation.trim().length < 10} onClick={() => submitConflict(match.id)}>Submit for Review</button>
              </div> : null}
            </article>
          );
        })}
      </div>

      {selected.length ? <div className="cart-review">
        <div><p className="eyebrow">REVIEW SELECTED JOBS</p><h3>{selected.length} document set{selected.length === 1 ? "" : "s"} × $8 each · {"$" + selected.length * 8} total</h3><p>Tax is included. No added tax or fee.</p></div>
        <fieldset className="document-contact"><legend>Contact details printed on every selected document</legend>
          <label>Professional name <input required maxLength={120} autoComplete="name" value={contact.displayName} onChange={(event) => updateContact("displayName", event.target.value)} /></label>
          <label>Email <input required maxLength={254} type="email" autoComplete="email" value={contact.email} onChange={(event) => updateContact("email", event.target.value)} /></label>
          <label>Phone <input required maxLength={40} type="tel" autoComplete="tel" value={contact.phone} onChange={(event) => updateContact("phone", event.target.value)} /></label>
          <label>City and state <input required maxLength={120} autoComplete="address-level2" value={contact.cityState} onChange={(event) => updateContact("cityState", event.target.value)} /></label>
          <label>LinkedIn or portfolio <span>(optional)</span><input maxLength={400} type="url" value={contact.linkedInOrPortfolio} onChange={(event) => updateContact("linkedInOrPortfolio", event.target.value)} /></label>
        </fieldset>
        <fieldset><legend>Career-break presentation</legend>
          {careerBreakOptions.map((option) => <label className="confirm" key={option.value}><input type="radio" name="career-break" checked={careerBreakChoice === option.value} onChange={() => { setCareerBreakChoice(option.value); setDocumentFactsConfirmed(false); }} />{option.label}</label>)}
          {careerBreakChoice === "CUSTOM_WORDING" ? <label>Your truthful, neutral wording <input minLength={2} maxLength={80} value={careerBreakCustomLabel} onChange={(event) => { setCareerBreakCustomLabel(event.target.value); setDocumentFactsConfirmed(false); }} /></label> : null}
          <label className="confirm"><input type="checkbox" checked={coverLetterBreakConsent} onChange={(event) => { setCoverLetterBreakConsent(event.target.checked); setDocumentFactsConfirmed(false); }} />Mention this in a cover letter only if strategically useful and factually supported.</label>
        </fieldset>
        <div className="deadline-note"><strong>Contractual deadline:</strong> each selected job receives an exact 24-hour deadline after successful payment is verified. The confirmed Eastern timestamp appears in My ApplyPack.</div>
        <label className="confirm"><input type="checkbox" checked={documentContactConfirmed} onChange={(event) => setDocumentContactConfirmed(event.target.checked)} />I confirm the contact details above are exactly what I want printed on these documents.</label>
        <label className="confirm"><input type="checkbox" checked={documentFactsConfirmed} onChange={(event) => setDocumentFactsConfirmed(event.target.checked)} />I confirm the selected presentation and all facts supplied for these documents are accurate.</label>
        <label className="confirm"><input type="checkbox" checked={noAutoApplyAcknowledged} onChange={(event) => setNoAutoApplyAcknowledged(event.target.checked)} />I understand ApplyPack prepares documents but does not submit applications for me.</label>
        <label className="confirm"><input type="checkbox" checked={outcomesAcknowledged} onChange={(event) => setOutcomesAcknowledged(event.target.checked)} />I understand ApplyPack cannot guarantee employer review, interviews, offers, or employment.</label>
      </div> : null}

      <div className="selection-bar"><div><ShoppingBag aria-hidden="true" /><span><strong>{selected.length}</strong> selected</span><b>{"$" + selected.length * 8}</b></div><button className="wizard-next" disabled={busy || selected.length === 0} onClick={checkout}>{busy ? "Preparing..." : "Review and Pay"}</button></div>
      <p className={message ? "form-message" : "sr-only"} role="status" aria-live="polite">{message || "Choose only currently available jobs."}</p>
    </section>
  );
}

function label(value: string) {
  const labels: Record<string, string> = {
    w2: "W-2 employee",
    contractor: "Independent contractor",
    staffing: "Staffing-agency placement",
    unknown: "Not confirmed",
    full_time: "Full time",
    part_time: "Part time",
    temporary: "Temporary",
    remote: "Remote",
    hybrid: "Hybrid",
    onsite: "On-site",
    none_or_unknown: "Not confirmed",
    low: "Low",
    medium: "Moderate",
    high: "High",
    employer: "Employer provided",
    employee: "Applicant provided",
    published: "published",
    not_published: "not confirmed",
    base_salary: "Base salary",
    hourly: "Hourly pay",
    employer_career_site: "Employer career site",
    approved_third_party: "Approved third-party listing",
    EMPLOYER_HOSTED: "Employer hosted",
    APPROVED_THIRD_PARTY: "Approved third-party",
  };
  return labels[value] || "Not confirmed";
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function hostLabel(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./i, "") || "reviewed application host";
  } catch {
    return "reviewed application host";
  }
}

const warningLabels: Record<string, string> = {
  UNPUBLISHED_PAY: "Compensation was not published. Verify pay before investing substantial application time.",
  OVERLAPPING_PAY: "The employer-published range overlaps your minimum; some possible offers may be below it.",
  BENEFITS_NOT_CONFIRMED: "Benefits were not confirmed in the employer listing. Verify them before applying.",
  TRAVEL_NOT_CONFIRMED: "Travel expectations were not confirmed in the employer listing. Verify them before applying.",
};

function readableWarning(value: string) {
  return warningLabels[value] || "An allowed detail remains unconfirmed. Verify it in the current employer listing before applying.";
}

function releaseNarrative(match: MatchForSelection) {
  const release = match.release_explanation || {};
  return {
    whatJobInvolves: stringValue(release.whatJobInvolves)
      || match.core_responsibilities.join("; ")
      || match.primary_outcome,
    whyMadeList: stringValue(release.whyMadeList) || match.fit_summary,
    howExperienceConnects: stringValue(release.howExperienceConnects)
      || match.matching_experience.join("; ")
      || "No unsupported experience claim was added.",
    whatMayBeNew: stringValue(release.whatMayBeNew)
      || match.hidden_job_functions.join("; ")
      || "No less-obvious function was confirmed beyond the responsibilities shown.",
    whatToKnow: stringValue(release.whatToKnow)
      || match.allowed_unknown_warnings?.map(readableWarning).join(" ")
      || match.concerns.join(" ")
      || "No additional allowed-unknown warning was recorded; review the current employer listing before applying.",
  };
}

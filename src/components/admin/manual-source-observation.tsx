"use client";

import { useRef, useState, type FormEvent } from "react";
import type { ManualSourceObservationInput } from "@/lib/jobs/manual-source-inventory";

export type ManualObservationSource = {
  id: string; name: string; isActive: boolean;
  policy?: { authorization?: { state: string; allowed_actions: string[] } | null } | null;
};

const verificationChecks = [
  ["employerIdentityConfirmed", "I verified that this listing belongs to the named employer."],
  ["applicationPathConfirmed", "I opened the official application page and confirmed it works."],
  ["listingActiveConfirmed", "I confirmed this job is currently open."],
  ["legitimacyConfirmed", "I reviewed the listing and confirmed it is a legitimate job opportunity."],
] as const;
type Check = typeof verificationChecks[number][0];
const emptyChecks = (): Record<Check, boolean> => ({ employerIdentityConfirmed: false,
  applicationPathConfirmed: false, listingActiveConfirmed: false, legitimacyConfirmed: false });
const initialFields = { sourceId: "", employerName: "", title: "", externalJobId: "", location: "",
  employmentType: "", salaryMin: "", salaryMax: "", salaryCurrency: "", payPeriod: "unknown",
  eligibleStates: "", eligibleCountries: "", officialListingUrl: "", officialApplicationUrl: "",
  capturedText: "", evidenceNotes: "", transitionReason: "", lifecycleAction: "UNCHANGED" };
type Field = keyof typeof initialFields;
const entries = (text: string) => text.split(",").map((value) => value.trim()).filter(Boolean);
function httpsUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch { return null; }
}

export function ManualSourceObservation({ sources, busy = false, onPrepare }: {
  sources: ManualObservationSource[];
  busy?: boolean;
  onPrepare: (payload: ManualSourceObservationInput, summary: string) => void;
}) {
  const [fields, setFields] = useState(initialFields);
  const [checks, setChecks] = useState(emptyChecks);
  const [reviewedAt, setReviewedAt] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const prepared = useRef<{ fingerprint: string; observationId: string } | null>(null);
  const permitted = sources.filter((source) => source.isActive && source.policy?.authorization?.state === "AUTHORIZED_MANUAL_ONLY"
    && source.policy.authorization.allowed_actions.includes("MANUAL_REVIEW"));
  const source = permitted.find((entry) => entry.id === fields.sourceId);

  function resetReview() {
    setChecks(emptyChecks()); setReviewedAt(null); prepared.current = null;
  }
  function change(field: Field, value: string) {
    setFields((current) => ({ ...current, [field]: value }));
    resetReview(); setMessage("");
  }
  function affirm(check: Check, checked: boolean) {
    const next = { ...checks, [check]: checked };
    setChecks(next);
    setReviewedAt(verificationChecks.every(([key]) => next[key]) ? new Date().toISOString() : null);
    prepared.current = null;
    setMessage("");
  }
  function observation(): Omit<ManualSourceObservationInput, "observationId"> | null {
    const listingUrl = httpsUrl(fields.officialListingUrl);
    const applicationUrl = httpsUrl(fields.officialApplicationUrl);
    const salaryMin = fields.salaryMin.trim() ? Number(fields.salaryMin) : null;
    const salaryMax = fields.salaryMax.trim() ? Number(fields.salaryMax) : null;
    const states = entries(fields.eligibleStates), countries = entries(fields.eligibleCountries);
    const currency = fields.salaryCurrency.trim().toUpperCase();
    if (!source || !listingUrl || !applicationUrl || !fields.employerName.trim() || fields.employerName.trim().length > 300
      || !fields.title.trim() || fields.title.trim().length > 500 || fields.externalJobId.trim().length > 300
      || fields.location.trim().length > 1000 || fields.employmentType.trim().length > 200
      || !fields.capturedText.trim() || fields.capturedText.length > 100_000
      || fields.evidenceNotes.trim().length < 20 || fields.evidenceNotes.trim().length > 3000
      || fields.transitionReason.trim().length < 20 || fields.transitionReason.trim().length > 3000
      || [salaryMin, salaryMax].some((value) => value !== null && (!Number.isFinite(value) || value < 0))
      || (salaryMin !== null && salaryMax !== null && salaryMin > salaryMax)
      || (currency && !/^[A-Z]{3}$/.test(currency)) || states.length > 60 || countries.length > 250
      || [...states, ...countries].some((value) => value.length > 100)
      || !["hour", "day", "week", "month", "year", "unknown"].includes(fields.payPeriod)
      || !["UNCHANGED", "CHANGED", "REOPENED"].includes(fields.lifecycleAction)
      || !reviewedAt || !verificationChecks.every(([key]) => checks[key])) return null;
    return {
      posting: { sourceId: source.id, employerName: fields.employerName.trim(), title: fields.title.trim(),
        externalJobId: fields.externalJobId.trim() || null, location: fields.location.trim() || null,
        employmentType: fields.employmentType.trim() || null, salaryMin, salaryMax, salaryCurrency: currency || null,
        payPeriod: fields.payPeriod as ManualSourceObservationInput["posting"]["payPeriod"], eligibleStates: states, eligibleCountries: countries },
      review: { checkedAt: reviewedAt, officialListingUrl: listingUrl, officialApplicationUrl: applicationUrl,
        capturedText: fields.capturedText, evidenceNotes: fields.evidenceNotes.trim(), transitionReason: fields.transitionReason.trim(),
        lifecycleAction: fields.lifecycleAction as "UNCHANGED" | "CHANGED" | "REOPENED",
        employerIdentityConfirmed: true, applicationPathConfirmed: true, listingActiveConfirmed: true, legitimacyConfirmed: true },
    };
  }
  function prepare(event: FormEvent<HTMLFormElement>, now: number) {
    event.preventDefault();
    if (busy) return;
    const input = observation();
    if (!input) { setMessage("Complete the listing details and all four review checks before continuing."); return; }
    if (now - Date.parse(input.review.checkedAt) > 15 * 60_000 || Date.parse(input.review.checkedAt) > now) {
      resetReview(); setMessage("The review is over 15 minutes old. Reopen both official pages and complete the checks again."); return;
    }
    const fingerprint = JSON.stringify(input);
    if (prepared.current?.fingerprint !== fingerprint) prepared.current = { fingerprint, observationId: crypto.randomUUID() };
    const details = [
      `Record ${input.posting.title} at ${input.posting.employerName} from ${source!.name}.`,
      `Official listing: ${input.review.officialListingUrl}`, `Application page: ${input.review.officialApplicationUrl}`,
      `Listing status: ${fields.lifecycleAction === "CHANGED" ? "The employer changed the listing" : fields.lifecycleAction === "REOPENED" ? "The employer reopened the listing" : "New or unchanged listing"}.`,
      `Employer reference: ${input.posting.externalJobId || "Not stated"}. Location: ${input.posting.location || "Not stated"}. Employment type: ${input.posting.employmentType || "Not stated"}.`,
      `Pay: ${salarySummary(input.posting)}. Eligible states: ${statesSummary(input.posting.eligibleStates)}. Eligible countries: ${statesSummary(input.posting.eligibleCountries)}.`,
      `Copied listing text:\n${input.review.capturedText}`, `Evidence notes: ${input.review.evidenceNotes}`,
      `Reason for recording: ${input.review.transitionReason}`,
      "All four live review checks were affirmed. Saving this observation still requires separate matching review before customer delivery.",
    ];
    onPrepare({ observationId: prepared.current.observationId, ...input }, details.join("\n\n"));
    setMessage("Listing review prepared. Read the confirmation below before recording it.");
  }
  if (!permitted.length) return <section aria-label="Record an official job listing"><h3>Record an official job listing</h3>
    <p role="status">No active source currently permits manual review. Refresh source permissions before recording a listing.</p></section>;
  return <form aria-label="Record an official job listing" onSubmit={(event) => prepare(event, new Date().getTime())}>
    <h3>Record an official job listing</h3>
    <p>Open the employer listing and application page, then copy the details you actually verified. Leave unstated details blank. The review must be recorded within 15 minutes.</p>
    <fieldset disabled={busy}>
      <legend>Listing details</legend>
      <label>Approved source<select required value={fields.sourceId} onChange={(event) => change("sourceId", event.target.value)}>
        <option value="">Choose a source with current manual permission</option>
        {permitted.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
      </select></label>
      <label>Employer name<input required maxLength={300} value={fields.employerName} onChange={(event) => change("employerName", event.target.value)} /></label>
      <label>Job title<input required maxLength={500} value={fields.title} onChange={(event) => change("title", event.target.value)} /></label>
      <label>Official listing address<input type="url" required value={fields.officialListingUrl} onChange={(event) => change("officialListingUrl", event.target.value)} /></label>
      {httpsUrl(fields.officialListingUrl) ? <a href={httpsUrl(fields.officialListingUrl)!} target="_blank" rel="noreferrer">Open official listing</a> : null}
      <label>Official application address<input type="url" required value={fields.officialApplicationUrl} onChange={(event) => change("officialApplicationUrl", event.target.value)} /></label>
      {httpsUrl(fields.officialApplicationUrl) ? <a href={httpsUrl(fields.officialApplicationUrl)!} target="_blank" rel="noreferrer">Open application page</a> : null}
      <label>Exact text copied from the listing<textarea required maxLength={100_000} rows={8} value={fields.capturedText} onChange={(event) => change("capturedText", event.target.value)} /></label>
      <details><summary>Optional details stated by the employer</summary>
        <label>Employer job reference<input maxLength={300} value={fields.externalJobId} onChange={(event) => change("externalJobId", event.target.value)} /></label>
        <label>Location<input maxLength={1000} value={fields.location} onChange={(event) => change("location", event.target.value)} /></label>
        <label>Employment type<input maxLength={200} value={fields.employmentType} onChange={(event) => change("employmentType", event.target.value)} /></label>
        <label>Minimum stated pay<input type="number" min="0" step="any" value={fields.salaryMin} onChange={(event) => change("salaryMin", event.target.value)} /></label>
        <label>Maximum stated pay<input type="number" min="0" step="any" value={fields.salaryMax} onChange={(event) => change("salaryMax", event.target.value)} /></label>
        <label>Currency, if stated (for example USD)<input maxLength={3} value={fields.salaryCurrency} onChange={(event) => change("salaryCurrency", event.target.value)} /></label>
        <label>Pay period<select value={fields.payPeriod} onChange={(event) => change("payPeriod", event.target.value)}>
          <option value="unknown">Not stated</option><option value="hour">Hour</option><option value="day">Day</option>
          <option value="week">Week</option><option value="month">Month</option><option value="year">Year</option>
        </select></label>
        <label>Eligible states, separated by commas<input value={fields.eligibleStates} onChange={(event) => change("eligibleStates", event.target.value)} /></label>
        <label>Eligible countries, separated by commas<input value={fields.eligibleCountries} onChange={(event) => change("eligibleCountries", event.target.value)} /></label>
      </details>
      <label>Listing change<select value={fields.lifecycleAction} onChange={(event) => change("lifecycleAction", event.target.value)}>
        <option value="UNCHANGED">New listing or no change to an existing listing</option>
        <option value="CHANGED">The employer changed this listing</option><option value="REOPENED">The employer reopened this listing</option>
      </select></label>
      <label>Evidence notes<textarea required minLength={20} maxLength={3000} value={fields.evidenceNotes} onChange={(event) => change("evidenceNotes", event.target.value)} /></label>
      <label>Why this observation is being recorded<textarea required minLength={20} maxLength={3000} value={fields.transitionReason} onChange={(event) => change("transitionReason", event.target.value)} /></label>
    </fieldset>
    <fieldset disabled={busy}><legend>Live listing review</legend>
      {verificationChecks.map(([key, label]) => <label key={key} className="confirm">
        <input type="checkbox" required checked={checks[key]} onChange={(event) => affirm(key, event.target.checked)} />{label}
      </label>)}
      <p>Changing a listing detail clears these checks so the final review covers the exact saved information.</p>
      <button type="button" onClick={() => { resetReview(); setMessage("Reopen both official pages, then complete all four checks again."); }}>Start a fresh listing check</button>
    </fieldset>
    <button type="submit" disabled={busy || !observation()}>Review observation before saving</button>
    <p role="status" aria-live="polite">{message}</p>
  </form>;
}

function statesSummary(values: string[] | undefined) { return values?.length ? values.join(", ") : "Not stated"; }
function salarySummary(posting: ManualSourceObservationInput["posting"]) {
  if (posting.salaryMin == null && posting.salaryMax == null) return "Not stated";
  return `${posting.salaryMin ?? "Minimum not stated"} to ${posting.salaryMax ?? "maximum not stated"} ${posting.salaryCurrency || "(currency not stated)"} per ${posting.payPeriod === "unknown" ? "unstated period" : posting.payPeriod}`;
}

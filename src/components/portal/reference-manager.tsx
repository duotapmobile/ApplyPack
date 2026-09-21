"use client";

import { useEffect, useMemo, useState } from "react";

type ReferenceDetails = {
  name: string;
  title: string;
  organization: string;
  relationship: string;
  email: string;
  phone: string;
  sharedWorkContext: string;
  capabilitiesCanVerify: string[];
  approvedContextLine?: string | null;
};

type StoredReference = {
  opaqueId: string;
  reference: ReferenceDetails;
  permissionStatus: string;
  permissionLastConfirmedAt: string | null;
  allowedApplications: Array<{
    permissionId: string;
    jobSnapshotId: string;
    employer: string;
    exactPosition: string;
    attestedAt: string;
  }>;
};

export type DeliveredReferenceJob = {
  deliveredReleaseId: string;
  jobSnapshotId: string;
  employer: string;
  exactPosition: string;
};

const optionLabels = [
  ["ADD", "Add references for a materials order"],
  ["SELF", "I'll provide references myself if an employer asks"],
  ["REVIEW", "Review references found in my uploaded resume"],
  ["HELP", "I need help choosing references"],
  ["SKIP", "Skip for now"],
] as const;

const emptyReference: ReferenceDetails = {
  name: "",
  title: "",
  organization: "",
  relationship: "",
  email: "",
  phone: "",
  sharedWorkContext: "",
  capabilitiesCanVerify: [],
  approvedContextLine: "",
};

async function fetchStoredReferences(signal?: AbortSignal): Promise<StoredReference[]> {
  const response = await fetch("/api/customer/references", { cache: "no-store", signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "References could not be loaded.");
  return Array.isArray(body.references) ? body.references : [];
}

export function ReferenceManager({
  deliveredJobs,
  detectedReferenceCount = 0,
}: {
  deliveredJobs: DeliveredReferenceJob[];
  detectedReferenceCount?: number;
}) {
  const [choice, setChoice] = useState<(typeof optionLabels)[number][0]>("SKIP");
  const [references, setReferences] = useState<StoredReference[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reference, setReference] = useState<ReferenceDetails>(emptyReference);
  const [capabilities, setCapabilities] = useState("");
  const [permissionContactConfirmed, setPermissionContactConfirmed] = useState(false);
  const [jobSelections, setJobSelections] = useState<Record<string, string>>( {} );
  const [jobConfirmations, setJobConfirmations] = useState<Record<string, boolean>>( {} );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function loadReferences(signal?: AbortSignal) {
    setReferences(await fetchStoredReferences(signal));
  }

  useEffect(() => {
    const controller = new AbortController();
    void fetchStoredReferences(controller.signal)
      .then((items) => setReferences(items))
      .catch((error) => {
        if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "References could not be loaded.");
      });
    return () => controller.abort();
  }, []);

  const uniqueJobs = useMemo(() => Array.from(new Map(deliveredJobs.map((job) => [job.jobSnapshotId, job])).values()), [deliveredJobs]);

  function change<K extends keyof ReferenceDetails>(key: K, value: ReferenceDetails[K]) {
    setReference((current) => ({ ...current, [key]: value }));
    setPermissionContactConfirmed(false);
  }

  function startEdit(item: StoredReference) {
    setEditingId(item.opaqueId);
    setReference(item.reference);
    setCapabilities(item.reference.capabilitiesCanVerify.join("\n"));
    setPermissionContactConfirmed(false);
    setChoice("ADD");
    setMessage("Editing this contact creates a new protected version and revokes its earlier job permissions.");
  }

  function clearForm() {
    setEditingId(null);
    setReference(emptyReference);
    setCapabilities("");
    setPermissionContactConfirmed(false);
  }

  async function saveReference(event: React.FormEvent) {
    event.preventDefault();
    const capabilityValues = capabilities.split(/[\n,]/).map((value) => value.trim()).filter(Boolean);
    if (!capabilityValues.length || !permissionContactConfirmed) {
      setMessage("List at least one capability and confirm current permission to store the contact details.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(editingId ? `/api/customer/references/${editingId}` : "/api/customer/references", {
        method: editingId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reference: {
            ...reference,
            capabilitiesCanVerify: capabilityValues,
            approvedContextLine: reference.approvedContextLine?.trim() || null,
          },
          permissionContactConfirmed,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The protected reference could not be saved.");
      await loadReferences();
      clearForm();
      window.dispatchEvent(new Event("applypack:references-updated"));
      setMessage(editingId ? "Reference updated. Confirm exact-job permission again before using it." : "Reference saved securely. It will not be contacted by ApplyPack.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The protected reference could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function removeReference(item: StoredReference) {
    if (!window.confirm(`Remove ${item.reference.name} and revoke every active job permission?`)) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/customer/references/${item.opaqueId}`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Reference not found.");
      await loadReferences();
      window.dispatchEvent(new Event("applypack:references-updated"));
      setMessage("Reference removed and active job permissions revoked.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The reference could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  async function grantPermission(item: StoredReference) {
    const job = uniqueJobs.find((candidate) => candidate.jobSnapshotId === jobSelections[item.opaqueId]);
    if (!job || !jobConfirmations[item.opaqueId]) {
      setMessage("Choose one delivered job and confirm its exact permission statement.");
      return;
    }
    const attestation = `I confirm that this person gave me permission to share their contact information for my application to ${job.exactPosition} at ${job.employer}.`;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/customer/references/${item.opaqueId}/permissions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deliveredReleaseId: job.deliveredReleaseId,
          jobSnapshotId: job.jobSnapshotId,
          attestation,
          permissionConfirmed: true,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Permission could not be saved.");
      await loadReferences();
      window.dispatchEvent(new Event("applypack:references-updated"));
      setJobConfirmations((current) => ({ ...current, [item.opaqueId]: false }));
      setMessage("Exact-job permission saved. It applies only to that employer and position.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Permission could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function revokePermission(item: StoredReference, permissionId: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/customer/references/${item.opaqueId}/permissions`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ permissionId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Permission not found.");
      await loadReferences();
      window.dispatchEvent(new Event("applypack:references-updated"));
      setMessage("Exact-job permission revoked. Linked reference-sheet downloads are revoked until a reviewed replacement is released.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Permission could not be revoked.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="portal-section reference-manager" aria-labelledby="reference-options-heading">
      <div className="portal-section__heading">
        <div><p className="eyebrow">REFERENCE OPTIONS</p><h2 id="reference-options-heading">Choose what you want to do about references.</h2></div>
        <p>ApplyPack never contacts a reference. A reference sheet is created only for a selected materials order and only with fresh permission for that exact job.</p>
      </div>
      <fieldset className="reference-option-list">
        <legend className="sr-only">Reference options</legend>
        {optionLabels.filter(([value]) => value !== "REVIEW" || detectedReferenceCount > 0).map(([value, text]) => <label className="confirm" key={value}><input type="radio" name="reference-option" checked={choice === value} onChange={() => setChoice(value)} />{text}</label>)}
      </fieldset>

      {choice === "ADD" ? <form className="reference-form" onSubmit={saveReference}>
        <h3>{editingId ? "Edit protected reference" : "Add a protected reference"}</h3>
        <div className="reference-form__grid">
          <label>Name<input required maxLength={120} autoComplete="name" value={reference.name} onChange={(event) => change("name", event.target.value)} /></label>
          <label>Current title<input required maxLength={120} value={reference.title} onChange={(event) => change("title", event.target.value)} /></label>
          <label>Organization<input required maxLength={160} value={reference.organization} onChange={(event) => change("organization", event.target.value)} /></label>
          <label>Relationship to you<input required maxLength={160} value={reference.relationship} onChange={(event) => change("relationship", event.target.value)} /></label>
          <label>Email<input required type="email" maxLength={254} autoComplete="email" value={reference.email} onChange={(event) => change("email", event.target.value)} /></label>
          <label>Phone<input required type="tel" maxLength={40} autoComplete="tel" value={reference.phone} onChange={(event) => change("phone", event.target.value)} /></label>
        </div>
        <label>Shared work context<textarea required maxLength={500} value={reference.sharedWorkContext} onChange={(event) => change("sharedWorkContext", event.target.value)} /></label>
        <label>Capabilities this person can truthfully verify <span>(one per line)</span><textarea required maxLength={1500} value={capabilities} onChange={(event) => { setCapabilities(event.target.value); setPermissionContactConfirmed(false); }} /></label>
        <label>Approved context line <span>(optional; never a testimonial)</span><input maxLength={240} value={reference.approvedContextLine || ""} onChange={(event) => change("approvedContextLine", event.target.value)} /></label>
        <label className="confirm"><input type="checkbox" checked={permissionContactConfirmed} onChange={(event) => setPermissionContactConfirmed(event.target.checked)} />I confirm this person currently permits me to store and share these contact details when I separately authorize a specific job application.</label>
        <div className="reference-form__actions"><button className="wizard-next" disabled={busy} type="submit">{busy ? "Saving..." : editingId ? "Save new version" : "Save reference"}</button>{editingId ? <button type="button" onClick={clearForm}>Cancel edit</button> : null}</div>
      </form> : null}

      {choice === "SELF" ? <div className="reference-guidance"><h3>You remain in control.</h3><p>No reference details or sheet are required. If an employer asks later, provide references directly under that employer&apos;s instructions.</p></div> : null}
      {choice === "REVIEW" ? <div className="reference-guidance"><h3>Review detected references</h3><p>{detectedReferenceCount ? `${detectedReferenceCount} possible reference contact${detectedReferenceCount === 1 ? " was" : "s were"} isolated from your upload. Nothing is usable until you review every field and confirm permission.` : "No reference contacts were safely isolated from your uploaded resume. Add one manually only if you have current permission."}</p></div> : null}
      {choice === "HELP" ? <div className="reference-guidance"><h3>Choose people who can verify real work.</h3><p>Consider a former manager, project lead, colleague, client, or community leader who directly observed the capabilities relevant to the selected job. Ask the person first; do not invent a title, relationship, quote, or testimonial.</p></div> : null}
      {choice === "SKIP" ? <div className="reference-guidance"><h3>Skipped for now.</h3><p>You can return before checkout. If a listing requires references now, that job cannot be purchased until enough exact-job permissions are ready.</p></div> : null}

      {references.length ? <div className="stored-references"><h3>Your protected reference records</h3>{references.map((item) => {
        const selectedJob = uniqueJobs.find((job) => job.jobSnapshotId === jobSelections[item.opaqueId]);
        const attestation = selectedJob ? `I confirm that this person gave me permission to share their contact information for my application to ${selectedJob.exactPosition} at ${selectedJob.employer}.` : "Choose a delivered job to see the exact statement.";
        return <article key={item.opaqueId}>
          <div><h4>{item.reference.name}</h4><p>{item.reference.title} · {item.reference.organization}</p><p>{item.reference.relationship}</p></div>
          <div className="reference-form__actions"><button type="button" disabled={busy} onClick={() => startEdit(item)}>Edit</button><button type="button" disabled={busy} onClick={() => removeReference(item)}>Remove</button></div>
          {item.allowedApplications.length ? <ul>{item.allowedApplications.map((permission) => <li key={permission.permissionId}>{permission.exactPosition} at {permission.employer} <button type="button" disabled={busy} onClick={() => revokePermission(item, permission.permissionId)}>Revoke</button></li>)}</ul> : <p>No exact-job permission is active.</p>}
          {uniqueJobs.length ? <div className="reference-permission">
            <label>Authorize one delivered job<select value={jobSelections[item.opaqueId] || ""} onChange={(event) => { setJobSelections((current) => ({ ...current, [item.opaqueId]: event.target.value })); setJobConfirmations((current) => ({ ...current, [item.opaqueId]: false })); }}><option value="">Choose a job</option>{uniqueJobs.map((job) => <option value={job.jobSnapshotId} key={job.jobSnapshotId}>{job.exactPosition}: {job.employer}</option>)}</select></label>
            <label className="confirm"><input type="checkbox" disabled={!selectedJob} checked={Boolean(jobConfirmations[item.opaqueId])} onChange={(event) => setJobConfirmations((current) => ({ ...current, [item.opaqueId]: event.target.checked }))} />{attestation}</label>
            <button type="button" className="wizard-next" disabled={busy || !selectedJob || !jobConfirmations[item.opaqueId]} onClick={() => grantPermission(item)}>Save exact-job permission</button>
          </div> : null}
        </article>;
      })}</div> : null}
      <p className={message ? "form-message" : "sr-only"} role="status" aria-live="polite">{message || "Reference controls ready."}</p>
    </section>
  );
}

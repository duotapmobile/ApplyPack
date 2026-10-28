"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Props = { jobId: string; versionId: string; sourceSha256: string; validUntil: string; disabled: boolean;
  onLockChange: (locked: boolean) => void };
const uuid = (value: unknown) => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function DraftOwnerRequestChanges(props: Props) {
  const router = useRouter(), [open, setOpen] = useState(false), [instructions, setInstructions] = useState("");
  const [confirmed, setConfirmed] = useState(false), [attempted, setAttempted] = useState(false), [uncertain, setUncertain] = useState(false), [message, setMessage] = useState("");
  const pending = useRef<{ requestId: string; body: string } | null>(null), active = useRef<AbortController | null>(null), latch = useRef(false);
  useEffect(() => () => active.current?.abort(), []);
  const expired = () => Date.now() >= Date.parse(props.validUntil);
  function begin() { if (props.disabled || expired()) return; setOpen(true); props.onLockChange(true); }
  function cancel() { if (attempted) return; setOpen(false); setInstructions(""); setConfirmed(false); props.onLockChange(false); }
  async function submit(reconcile = false) {
    // A completed receipt can be reconciled after evidence expiry. This never
    // renews that evidence or authorizes another model call.
    if (latch.current || props.disabled || (reconcile ? !uncertain || !pending.current : expired() || attempted || !confirmed || instructions.trim().length < 10)) return;
    if (!reconcile) { const requestId = crypto.randomUUID(); pending.current = { requestId, body: JSON.stringify({ action: "REQUEST_DRAFT_CHANGES",
      expectedVersionId: props.versionId, expectedSourceSha256: props.sourceSha256, requestId, instructions: instructions.trim() }) }; }
    const request = pending.current!; latch.current = true; setAttempted(true); setUncertain(false);
    setMessage(reconcile ? "Checking this same change request…" : "Recording your change request…");
    const controller = new AbortController(); active.current = controller; const timer = setTimeout(() => controller.abort(), 65_000);
    try {
      const response = await fetch(`/api/admin/material-draft-jobs/${props.jobId}`, { method: "POST", cache: "no-store", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, signal: controller.signal, body: request.body });
      const body: unknown = await response.json();
      if (response.status === 400 && body && typeof body === "object" && "error" in body && body.error === "The document action is incomplete. Review the current version and try again.") {
        pending.current = null; setAttempted(false); setConfirmed(false); setMessage("The request was rejected before saving. Review the instructions and confirm again."); return;
      }
      if (!response.ok || !body || typeof body !== "object" || !("action" in body) || body.action !== "REQUEST_DRAFT_CHANGES" || !("result" in body)
        || !body.result || typeof body.result !== "object") throw new Error("UNCONFIRMED");
      const result = body.result as Record<string, unknown>;
      if (result.jobId !== props.jobId || result.requestId !== request.requestId || result.parentVersionId !== props.versionId
        || !uuid(result.versionId) || result.versionId === props.versionId || !hash(result.requestSha256)
        || result.recorded !== true || typeof result.current !== "boolean" || result.state !== "CHANGES_REQUESTED" || result.deliveryAuthorized !== false) throw new Error("UNCONFIRMED");
      pending.current = null;
      setMessage(result.current ? "Request recorded. A new unapproved draft is queued subject to the existing provider, evidence and attempt limits. Review the new wording and rendered files before approval and a separate Send."
        : "The same request was already recorded. Its revision is no longer current; reload to review the current state. No new request was created.");
      router.refresh();
    } catch { setUncertain(true); setMessage("The result could not be confirmed. Keep this page open and reconcile the same request, or reload to inspect the queue. The saved request will not be repeated automatically."); }
    finally { clearTimeout(timer); active.current = null; latch.current = false; }
  }
  if (!open) return <section aria-label="Request another system draft"><h3>Request another system draft</h3><p>Ask for changes to wording, emphasis or organization before delivery. This keeps the same confirmed facts and paid deadline; it does not add customer revision rights or bypass provider limits.</p><button type="button" disabled={props.disabled} onClick={begin}>Request changes</button></section>;
  return <section aria-label="Request another system draft"><h3>Request changes to this draft</h3>
    <p>Describe what should change. Do not add contact details, new qualifications or unconfirmed facts. Correct facts through the intake process. Previous files and approval will no longer authorize delivery.</p>
    <fieldset disabled={attempted || props.disabled}><legend>Instructions for the new draft</legend>
      <label>Requested wording changes<textarea maxLength={2400} value={instructions} onChange={(event) => { setInstructions(event.target.value); setConfirmed(false); }} /></label>
      <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I want a new system draft using these instructions and the confirmed sources, with a fresh wording and visual review before approval and a separate Send.</label>
      <button type="button" disabled={!confirmed || instructions.trim().length < 10} onClick={() => void submit()}>Queue new draft</button><button type="button" onClick={cancel}>Cancel request</button>
    </fieldset>{uncertain ? <button type="button" disabled={props.disabled} onClick={() => void submit(true)}>Reconcile change request</button> : null}<p role="status" aria-live="polite">{message}</p>
  </section>;
}

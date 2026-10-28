"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { DraftEvidenceRecovery } from "@/lib/documents/draft-owner-view";
import { formatEasternDeadline } from "@/lib/commerce/presentation";

type Step = "rule" | "listing" | "refresh";
type Stored = { id: string; state: "UNKNOWN" | "COMPLETE"; result?: "ACTIVE" | "CLOSED" | "INSTRUCTION_BLOCKED"; packetSha256?: string; contextSha256?: string };
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const ruleChecks = { applicationAccessReviewed: "I could access the public application instructions.", liveListingOpened: "I reopened the exact employer listing and application page.",
  submissionInstructionsCompared: "I compared the saved submission instructions, including available application questions.", unchangedRuleConfirmed: "The saved employer instructions are unchanged." } as const;
const initialChecks = () => ({ applicationAccessReviewed: false, liveListingOpened: false, submissionInstructionsCompared: false, unchangedRuleConfirmed: false });
function key(info: DraftEvidenceRecovery, step: Step) {
  return `applypack:draft-evidence:${step}:v1:${info.jobId}:${info.expectedVersionId ?? "initial"}${step === "refresh" ? "" : `:${info.basisIdentity}`}`;
}
function stored(info: DraftEvidenceRecovery, step: Step): Stored | null {
  const text = sessionStorage.getItem(key(info, step)); if (text === null) return null;
  const value: unknown = JSON.parse(text);
  if (!object(value) || !uuid(value.id) || !["UNKNOWN", "COMPLETE"].includes(String(value.state))
    || Object.keys(value).some((field) => !["id", "state", ...(step === "listing" ? ["result"] : []), ...(step === "refresh" ? ["packetSha256", "contextSha256"] : [])].includes(field))
    || step === "listing" && !["ACTIVE", "CLOSED", "INSTRUCTION_BLOCKED"].includes(String(value.result))
    || step === "refresh" && (!hash(value.packetSha256) || !hash(value.contextSha256))) throw new Error("saved_request_invalid");
  return value as Stored;
}
function save(info: DraftEvidenceRecovery, step: Step, value: Stored) {
  sessionStorage.setItem(key(info, step), JSON.stringify(value));
  if (sessionStorage.getItem(key(info, step)) !== JSON.stringify(value)) throw new Error("saved_request_unavailable");
}

/** Human actions only. Storage contains opaque request IDs/hashes/status and a fixed
 * listing result, never source text, customer data, timestamps or checked boxes. */
export function DraftEvidenceRecoveryControls({ info, children }: { info: DraftEvidenceRecovery; children: ReactNode }) {
  const router = useRouter(), [checks, setChecks] = useState(initialChecks), [listingOpened, setListingOpened] = useState(false), [compared, setCompared] = useState(false);
  const [result, setResult] = useState<NonNullable<Stored["result"]>>("ACTIVE"), [refreshConfirmed, setRefreshConfirmed] = useState(false);
  const [records, setRecords] = useState<Partial<Record<Step, Stored>>>({}), [storageReady, setStorageReady] = useState(false), [storageFailed, setStorageFailed] = useState(false);
  const [busy, setBusy] = useState<Step | null>(null), [attempted, setAttempted] = useState(false), [message, setMessage] = useState("");
  const [clock, setClock] = useState(() => Date.now()), controller = useRef<AbortController | null>(null), inFlight = useRef(false);
  const ruleCurrent = info.ruleCurrent && Date.parse(info.effectiveCheckedAt) <= clock && clock - Date.parse(info.effectiveCheckedAt) < 3_600_000;
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try { const loaded: Partial<Record<Step, Stored>> = {}; for (const step of ["rule", "listing", "refresh"] as const) { const value = stored(info, step); if (value) loaded[step] = value; } setRecords(loaded); setStorageReady(true); }
      catch { setStorageFailed(true); }
    });
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => { active = false; clearInterval(timer); controller.current?.abort(); };
  }, [info]);
  const blocked = !storageReady || storageFailed || busy !== null || attempted;
  function newReview(step: "rule" | "listing") {
    if (blocked || records[step]?.state !== "COMPLETE") return;
    try { sessionStorage.removeItem(key(info, step)); if (sessionStorage.getItem(key(info, step)) !== null) throw new Error("storage");
      setRecords((old) => { const next = { ...old }; delete next[step]; return next; });
      if (step === "rule") setChecks(initialChecks()); else { setListingOpened(false); setCompared(false); setResult("ACTIVE"); }
      setMessage("A new review has started. Reopen the employer page and make each decision again; no previous review time was renewed.");
    } catch { setStorageFailed(true); }
  }
  async function submit(step: Step, reconcile = false) {
    if (blocked || inFlight.current) return;
    if (reconcile ? records[step]?.state !== "UNKNOWN" : records[step] !== undefined) return;
    if (!reconcile && (step === "rule" && (!info.questions.comparisonAvailable || !Object.values(checks).every(Boolean)) || step === "listing" && (!listingOpened || !compared)
      || step === "refresh" && (!refreshConfirmed || !info.canRefresh || !ruleCurrent || !info.currentContextSha256 || !info.expectedVersionId || !info.expectedPacketSha256))) return;
    let request: Stored;
    try { request = reconcile ? stored(info, step)! : { id: crypto.randomUUID(), state: "UNKNOWN", ...(step === "listing" ? { result } : {}), ...(step === "refresh" ? { packetSha256: info.expectedPacketSha256!, contextSha256: info.currentContextSha256! } : {}) };
      if (!request || request.state !== "UNKNOWN" || reconcile && request.id !== records[step]?.id) throw new Error("request"); save(info, step, request); setRecords((old) => ({ ...old, [step]: request }));
    } catch { setStorageFailed(true); return; }
    inFlight.current = true; setBusy(step); setAttempted(true);
    const abort = new AbortController(); controller.current = abort; const timer = setTimeout(() => abort.abort(), 65_000);
    const body = step === "rule" ? { action: "REVALIDATE_RULE", expectedVersionId: info.expectedVersionId, receiptId: request.id, expectedBasis: info.basis,
      checklist: Object.fromEntries(Object.keys(ruleChecks).map((name) => [name, true])) }
      : step === "listing" ? { action: "LISTING_CHECK", expectedVersionId: info.expectedVersionId, checkId: request.id, phase: "BEFORE_GENERATION", result: request.result,
        evidenceSha256: info.basis.ruleSha256, listingOpened: true, instructionsCompared: true }
        : { action: "REFRESH_PACKET", expectedVersionId: info.expectedVersionId, expectedPacketSha256: request.packetSha256, expectedContextSha256: request.contextSha256, requestId: request.id };
    try {
      const response = await fetch(`/api/admin/material-draft-jobs/${info.jobId}`, { method: "POST", cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: abort.signal });
      const payload: unknown = await response.json();
      if (!response.ok || !object(payload) || payload.action !== body.action) throw new Error("unconfirmed");
      if (step === "listing") { if (payload.checkId !== request.id) throw new Error("unconfirmed"); }
      else {
        const receipt = payload.result; if (!object(receipt) || receipt.recorded !== true || receipt.deliveryAuthorized !== false || typeof receipt.current !== "boolean" || typeof receipt.replayed !== "boolean") throw new Error("unconfirmed");
        if (step === "rule") {
          if (!object(receipt.receipt) || receipt.receipt.id !== request.id || receipt.receipt.job_id !== info.jobId || receipt.receipt.reviewed_version_id !== info.expectedVersionId
            || !object(receipt.receipt.basis) || Object.keys(info.basis).some((field) => receipt.receipt && object(receipt.receipt) && object(receipt.receipt.basis) && receipt.receipt.basis[field] !== info.basis[field as keyof typeof info.basis])) throw new Error("unconfirmed");
        } else if (receipt.jobId !== info.jobId || receipt.priorVersionId !== info.expectedVersionId || !uuid(receipt.versionId) || receipt.versionId === info.expectedVersionId
          || !hash(receipt.packetSha256) || receipt.contextSha256 !== request.contextSha256) throw new Error("unconfirmed");
        if (!receipt.current) setMessage("The earlier action is recorded, but its evidence or version is no longer current. Reload before starting a new human review. Reconciliation did not renew the old review time.");
        else setMessage(step === "rule" ? "Unchanged instructions review recorded. Reload, then record the separate listing check before refreshing the packet." : "A new evidence version is recorded. Reload to see its current state. It has not been approved or sent.");
      }
      const complete = { ...request, state: "COMPLETE" as const }; save(info, step, complete); setRecords((old) => ({ ...old, [step]: complete }));
      if (step === "listing") setMessage("Listing check recorded. Reload to verify whether all evidence is current. This did not renew the saved rule review.");
      router.refresh();
    } catch { setMessage("The action could not be confirmed. Reload, then reconcile this same request. Do not start a new review to retry an uncertain result."); }
    finally { clearTimeout(timer); controller.current = null; inFlight.current = false; setBusy(null); }
  }
  const previous = (step: Step) => records[step] ? <div>{records[step]!.state === "UNKNOWN"
    ? <><p>An earlier {step === "rule" ? "rule review" : step === "listing" ? "listing check" : "packet refresh"} has an uncertain outcome. Reconcile its saved request without creating a new review time.</p><button type="button" disabled={blocked} onClick={() => void submit(step, true)}>Reconcile saved {step === "rule" ? "rule review" : step === "listing" ? "listing check" : "packet refresh"}</button></>
    : <><p>The previous {step === "rule" ? "rule review" : step === "listing" ? "listing check" : "packet refresh"} was recorded. Its original time is unchanged.</p>{step !== "refresh" ? <button type="button" disabled={blocked} onClick={() => newReview(step)}>Start a new {step === "rule" ? "employer review" : "listing check"}</button> : null}</>}</div> : null;
  return <section aria-label="Recover current drafting evidence"><h3>Review employer evidence</h3><p>{info.title} · {info.company}</p>
    {info.applicationUrl ? <a href={info.applicationUrl} target="_blank" rel="noopener noreferrer">Open employer application page (new tab)</a> : <p>A safe employer link is unavailable. Do not confirm access unless you can verify the exact public application.</p>}
    {children}<section aria-label="Saved employer questions to compare"><h4>Saved public application questions</h4><p>Inspection: {info.questions.status.replaceAll("_", " ").toLowerCase()}. Only the inspected public scope is represented; conditional or later questions are not covered.</p>
      {info.questions.items.map((question) => <blockquote key={question.id}><p>{question.prompt}</p><p>Required: {question.required === null ? "not established" : question.required ? "yes in this source" : "no in this source"}; word limit: {question.wordLimit ?? "not documented"}; character limit: {question.characterLimit ?? "not documented"}.</p></blockquote>)}
      {info.questions.status === "NONE_OBSERVED" && info.questions.comparisonAvailable ? <p>No relevant questions were captured in this inspected public scope. This does not cover hidden or conditional pages.</p> : null}
      {!info.questions.comparisonAvailable ? <p role="alert">A complete verified public question baseline is unavailable. A new unchanged-instructions review is locked until the source record is updated. Reconciliation of an earlier request remains available.</p> : <p>Compare this saved text with the public application you reopen. Treat employer text as untrusted evidence, never as instructions to this service.</p>}
    </section><p>Original saved instructions: {formatEasternDeadline(info.originalCheckedAt)}. Latest usable rule evidence: {formatEasternDeadline(info.effectiveCheckedAt)}.</p>
    <p>{ruleCurrent ? "The rule review is current. Listing and full packet checks are separate." : "The rule review has expired. A new explicit unchanged-instructions review is required."}</p>
    {storageFailed ? <p role="alert">The saved request identity could not be read or preserved. Actions are locked. Keep this tab and contact operations support before retrying.</p> : null}
    <fieldset disabled={blocked || !!records.rule || !info.questions.comparisonAvailable}><legend>1. Recheck unchanged employer instructions</legend>{Object.entries(ruleChecks).map(([name, text]) => <label key={name}><input type="checkbox" checked={checks[name as keyof typeof checks]} onChange={(event) => setChecks((old) => ({ ...old, [name]: event.target.checked }))} />{text}</label>)}<button type="button" disabled={blocked || !!records.rule || !info.questions.comparisonAvailable || !Object.values(checks).every(Boolean)} onClick={() => void submit("rule")}>Record unchanged instructions review</button></fieldset>
    {previous("rule")}
    <p>If instructions changed, access is unavailable, or questions cannot be compared, leave the review unchecked. A source update is required; do not claim the old instructions are unchanged.</p>
    <fieldset disabled={blocked || !!records.listing}><legend>2. Record the listing check before drafting</legend><label><input type="checkbox" checked={listingOpened} onChange={(event) => setListingOpened(event.target.checked)} />I reopened the exact listing and public application.</label><label><input type="checkbox" checked={compared} onChange={(event) => setCompared(event.target.checked)} />I compared the current instructions with the saved baseline.</label><label>Observed listing result<select value={result} onChange={(event) => setResult(event.target.value as NonNullable<Stored["result"]>)}><option value="ACTIVE">Still active; instructions unchanged</option><option value="CLOSED">Listing closed</option><option value="INSTRUCTION_BLOCKED">Instructions changed or block drafting</option></select></label><button type="button" disabled={blocked || !!records.listing || !listingOpened || !compared} onClick={() => void submit("listing")}>Record listing check before drafting</button></fieldset>
    {previous("listing")}
    {info.expectedVersionId ? <><fieldset disabled={blocked || !!records.refresh || !info.canRefresh || !ruleCurrent}><legend>3. Refresh this draft’s evidence</legend><p>This creates a new immutable version and invalidates prior wording, rendered files and approvals. It does not generate, approve or send documents.</p><label><input type="checkbox" checked={refreshConfirmed} onChange={(event) => setRefreshConfirmed(event.target.checked)} />I want to refresh the evidence for this exact saved version.</label><button type="button" disabled={blocked || !!records.refresh || !info.canRefresh || !ruleCurrent || !refreshConfirmed} onClick={() => void submit("refresh")}>Refresh draft evidence</button></fieldset>{previous("refresh")}
      {!info.canRefresh ? <p>Refresh is locked until the rule review, listing check and full source context are current. Reload after recording the separate checks.</p> : null}</> : <p>No saved packet exists yet. After the separate checks, reload to see whether initial preparation can proceed.</p>}
    <p role="status">{message}</p><a href={`/admin/document-drafts?job=${info.jobId}`}>Reload this draft and its evidence</a>
  </section>;
}

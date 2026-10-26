"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { DraftOwnerDetail, DraftOwnerQueue, SavedDraftInstructions } from "@/lib/documents/draft-owner-view";
import { formatEasternDeadline } from "@/lib/commerce/presentation";
import styles from "./draft-owner-workspace.module.css";
import { DraftEvidenceRecoveryControls } from "./draft-evidence-recovery";
import { DraftOwnerEdit } from "./draft-owner-edit";
import { DraftOwnerRequestChanges } from "./draft-owner-request-changes";

type Available = Extract<DraftOwnerDetail, { status: "AVAILABLE" }>;
const checks = {
  contentReviewed: "The exact content is accurate and supported by the confirmed facts.",
  visualReviewed: "I opened and visually reviewed every rendered file in this pair.",
  listingRechecked: "I reopened the current employer listing and application page.",
  instructionsReparsed: "I compared the current submission instructions with this saved version.",
  linksRechecked: "I checked all links included in these documents.",
  provenanceReviewed: "I reviewed the source evidence for every claim.",
  secureFilesConfirmed: "I confirmed these are the exact private files intended for this customer.",
} as const;
const human = (value: string) => value.replaceAll("_", " ").toLowerCase();
function identity(detail: Available) { return [detail.jobId, detail.versionId, detail.packetSha256, detail.sourceSha256, detail.memberSetSha256, detail.approvalSha256, detail.state].join(":"); }
const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
function linkedQuestions(ids: string[], questions: Available["questions"]["items"]) {
  const entries = ids.map((id) => {
    const matches = questions.filter((question) => question.id === id);
    const question = matches.length === 1 ? matches[0] : null;
    return uuid(id) && question?.eligible === true && question.prompt.trim()
      && Number.isFinite(Date.parse(question.observedAt)) ? question : null;
  });
  return { complete: new Set(ids).size === ids.length && entries.every((question) => question !== null),
    items: entries.filter((question): question is Available["questions"]["items"][number] => question !== null) };
}

export function DraftOwnerWorkspace({ queue, detail, loadedAt }: { queue: DraftOwnerQueue; detail: DraftOwnerDetail | null; loadedAt: string }) {
  return <div className={styles.workspace}>
    <nav className={styles.queue} aria-label="Active document drafts"><h2>Active drafts</h2>
      {queue.status === "UNAVAILABLE" ? <p role="alert">The draft queue could not be loaded. This does not mean there are no paid orders. Verify administrator access and refresh.</p>
        : queue.jobs.length ? <ul>{queue.jobs.map((job) => <li key={job.id}><a href={`/admin/document-drafts?job=${job.id}`} aria-current={detail?.jobId === job.id ? "page" : undefined}>Draft {job.shortId}</a><p>{human(job.state)}{job.errorCode ? ` · ${human(job.errorCode)}` : ""}</p></li>)}</ul>
          : <p>No active jobs were returned on this page.</p>}
      {queue.nextCursor ? <a href={`/admin/document-drafts?cursor=${encodeURIComponent(queue.nextCursor)}`}>Older active drafts</a> : null}
      <p><Link href="/admin/document-drafts" prefetch={false}>First page of active drafts</Link></p>
    </nav>
    <div className={styles.content}>{!detail ? <p>Select a draft to review its saved content and evidence.</p> : detail.status !== "AVAILABLE" ? <section aria-labelledby="draft-status"><h2 id="draft-status">{detail.status === "REFRESH_REQUIRED" ? "Evidence refresh required" : detail.status === "RELEASED" ? "Pair sent" : detail.status === "PENDING" ? "Draft not ready" : "Draft unavailable"}</h2><p role="status">{detail.message}</p>{detail.recovery ? <DraftEvidenceRecoveryControls key={`${detail.jobId}:${detail.recovery.expectedVersionId}:${detail.recovery.basisIdentity}:${detail.recovery.currentContextSha256}:${loadedAt}`} info={detail.recovery}><SavedInstructions instructions={detail.recovery.instructions} /></DraftEvidenceRecoveryControls> : detail.status === "PENDING" && detail.initialListing ? <InitialListingCheck key={`${detail.jobId}:${detail.initialListing.revisionId}:${detail.initialListing.ruleSha256}:${loadedAt}`} jobId={detail.jobId} listing={detail.initialListing} /> : null}<a href={`/admin/document-drafts?job=${detail.jobId}`}>Reload this draft</a></section>
      : <DraftReview key={`${identity(detail)}:${loadedAt}`} detail={detail} />}</div>
  </div>;
}

function InitialListingCheck({ jobId, listing }: { jobId: string; listing: NonNullable<Exclude<DraftOwnerDetail, Available>["initialListing"]> }) {
  const router = useRouter(), [opened, setOpened] = useState(false), [compared, setCompared] = useState(false), [result, setResult] = useState("ACTIVE"), [attempted, setAttempted] = useState(false), [message, setMessage] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function record() {
    if (!opened || !compared || attempted) return;
    setAttempted(true); const checkId = crypto.randomUUID(), abort = new AbortController(); controller.current = abort;
    const timer = setTimeout(() => abort.abort(), 65_000);
    try {
      const response = await fetch(`/api/admin/material-draft-jobs/${jobId}`, { method: "POST", cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "application/json" }, signal: abort.signal,
        body: JSON.stringify({ action: "LISTING_CHECK", expectedVersionId: null, checkId, phase: "BEFORE_GENERATION", result, evidenceSha256: listing.ruleSha256, listingOpened: true, instructionsCompared: true }) });
      const receipt: unknown = await response.json();
      if (!response.ok || !receipt || typeof receipt !== "object" || !("checkId" in receipt) || receipt.checkId !== checkId || !("action" in receipt) || receipt.action !== "LISTING_CHECK") throw new Error("unconfirmed");
      setMessage("Initial listing check recorded. Reload to see the current preparation state."); router.refresh();
    } catch { setMessage("The initial check could not be confirmed. Reload before continuing; no automatic retry was made."); }
    finally { clearTimeout(timer); controller.current = null; }
  }
  return <section><h3>{listing.title} · {listing.company}</h3>{listing.applicationUrl ? <a href={listing.applicationUrl} target="_blank" rel="noopener noreferrer">Open employer application page (new tab)</a> : <p>A safe employer link is unavailable.</p>}<SavedInstructions instructions={listing.instructions} />
    <fieldset disabled={attempted}><legend>Initial listing check before drafting</legend><label><input type="checkbox" checked={opened} onChange={(event) => setOpened(event.target.checked)} />I reopened the employer listing and application page.</label><label><input type="checkbox" checked={compared} onChange={(event) => setCompared(event.target.checked)} />I compared the employer submission instructions.</label><label>Observed result<select value={result} onChange={(event) => setResult(event.target.value)}><option value="ACTIVE">Still active; instructions unchanged</option><option value="CLOSED">Listing closed</option><option value="INSTRUCTION_BLOCKED">Instructions changed or block drafting</option></select></label><button type="button" disabled={attempted || !opened || !compared} onClick={() => void record()}>Record initial listing check</button></fieldset><p role="status">{message}</p></section>;
}

function SavedInstructions({ instructions }: { instructions: SavedDraftInstructions }) {
  return <section aria-label="Saved employer submission instructions"><h4>Saved employer instructions to compare</h4><p>Recorded {formatEasternDeadline(instructions.checkedAt)}. This is the saved baseline; reopen the employer page to check whether it still applies.</p><dl>
    <dt>Resume requirement</dt><dd>{human(instructions.resumeRequirement)}</dd><dt>Cover letter requirement</dt><dd>{human(instructions.letterRequirement)}</dd>
    <dt>Allowed formats</dt><dd>{instructions.formats.join(", ")}</dd><dt>Page limits</dt><dd>Resume: {instructions.resumePageLimit ?? "not specified"}; cover letter: {instructions.letterPageLimit ?? "not specified"}.</dd>
    <dt>Resume filename instruction</dt><dd>{instructions.resumeFilename || "No filename instruction recorded."}</dd><dt>Cover letter filename instruction</dt><dd>{instructions.letterFilename || "No filename instruction recorded."}</dd>
    <dt>Reference timing</dt><dd>{human(instructions.referenceTiming)}</dd><dt>Reference count</dt><dd>{instructions.referenceCount ?? "Not specified"}</dd>
  </dl></section>;
}

function DraftReview({ detail }: { detail: Available }) {
  const router = useRouter(), [clock, setClock] = useState(() => Date.now());
  const [reviewed, setReviewed] = useState<Record<string, boolean>>({}), [pairChecks, setPairChecks] = useState<Record<string, boolean>>({});
  const [promote, setPromote] = useState(false), [listingOpened, setListingOpened] = useState(false), [instructionsCompared, setInstructionsCompared] = useState(false);
  const [listingResult, setListingResult] = useState("ACTIVE"), [attestation, setAttestation] = useState(""), [rationale, setRationale] = useState(""), [sendConfirmed, setSendConfirmed] = useState(false);
  const [attempted, setAttempted] = useState(false), [message, setMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [requestingChanges, setRequestingChanges] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => { clearInterval(timer); controller.current?.abort(); }; }, []);
  const questionContext = new Map(detail.claims.map((claim) => [claim.id, linkedQuestions(claim.questionIds, detail.questions.items)]));
  const questionContextComplete = [...questionContext.values()].every((context) => context.complete);
  const stale = clock >= Date.parse(detail.validUntil), disabled = attempted || stale || editing || requestingChanges || !questionContextComplete;
  const binding = { versionId: detail.versionId, packetSha256: detail.packetSha256, sourceSha256: detail.sourceSha256, memberSetSha256: detail.memberSetSha256 };
  async function action(body: Record<string, unknown>) {
    if (disabled) return;
    setAttempted(true); setMessage("Recording your action…");
    const abort = new AbortController(); controller.current = abort; const timer = setTimeout(() => abort.abort(), 65_000);
    try {
      const response = await fetch(`/api/admin/material-draft-jobs/${detail.jobId}`, { method: "POST", cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: abort.signal });
      const result: unknown = await response.json();
      if (!response.ok || !result || typeof result !== "object" || !("action" in result) || result.action !== body.action) throw new Error("unconfirmed");
      const receipt = result as Record<string, unknown>;
      if (body.action === "SEND_PAIR" && receipt.releaseId !== body.releaseId || body.action === "APPROVE_PAIR" && (!hash(receipt.approvalSha256) || receipt.sent !== false)
        || body.action === "LISTING_CHECK" && receipt.checkId !== body.checkId) throw new Error("unconfirmed");
      if (["PROMOTE_SOURCE", "REVIEW_WORDING"].includes(String(body.action))) {
        if (!receipt.result || typeof receipt.result !== "object" || !("deliveryAuthorized" in receipt.result) || receipt.result.deliveryAuthorized !== false) throw new Error("unconfirmed");
        const recorded = receipt.result as Record<string, unknown>;
        if (body.action === "PROMOTE_SOURCE" && (recorded.jobId !== detail.jobId || !uuid(recorded.versionId) || recorded.versionId === detail.versionId || recorded.packetSha256 !== detail.packetSha256 || !hash(recorded.sourceSha256) || recorded.state !== "OWNER_REVIEW_REQUIRED")
          || body.action === "REVIEW_WORDING" && (recorded.versionId !== detail.versionId || !hash(recorded.reviewSha256))) throw new Error("unconfirmed");
      }
      setMessage(body.action === "SEND_PAIR" ? "Pair sent. Reload to see the recorded delivery." : body.action === "APPROVE_PAIR" ? "Pair approved. It has not been sent. Reload before the separate Send step." : "Action recorded. Reload to review the current version before continuing.");
      router.refresh();
    } catch { setMessage("The result could not be confirmed. Reload before taking another action. If Send was attempted, this browser keeps the same request IDs for reconciliation; it will not send automatically."); }
    finally { clearTimeout(timer); controller.current = null; }
  }
  function send() {
    if (!detail.canSend || !sendConfirmed || rationale.trim().length < 20 || disabled) return;
    try {
      // Only opaque, exact-version IDs are persisted; no document text, contact
      // details, keys, reviewer comments or approval decisions enter storage.
      const key = `applypack:draft-send:v1:${identity(detail)}`, existing = sessionStorage.getItem(key);
      const saved: unknown = existing ? JSON.parse(existing) : { releaseId: crypto.randomUUID(), outboxId: crypto.randomUUID() };
      if (!saved || typeof saved !== "object" || Object.keys(saved).sort().join(",") !== "outboxId,releaseId" || !("releaseId" in saved) || !("outboxId" in saved) || !uuid(saved.releaseId) || !uuid(saved.outboxId) || saved.releaseId === saved.outboxId) throw new Error("request_unavailable");
      sessionStorage.setItem(key, JSON.stringify(saved));
      void action({ action: "SEND_PAIR", ...binding, approvalSha256: detail.approvalSha256, releaseId: saved.releaseId, outboxId: saved.outboxId, rationale: rationale.trim() });
    } catch { setMessage("A stable Send request could not be saved in this browser. Sending is unavailable; no request was submitted."); }
  }
  const allClaims = questionContextComplete && detail.claims.length > 0 && detail.claims.every((claim) => reviewed[claim.id] === true), allChecks = Object.keys(checks).every((key) => pairChecks[key] === true);
  return <article>
    <header><p className="eyebrow">Private document review · version {detail.version}</p><h2>{detail.title}</h2><p>{detail.company} · {human(detail.state)}</p>
      <p>Delivery due {formatEasternDeadline(detail.dueAt)}. Evidence valid until {formatEasternDeadline(detail.validUntil)}.</p>
      {detail.applicationUrl ? <a href={detail.applicationUrl} target="_blank" rel="noopener noreferrer">Open employer application page (new tab)</a> : <p>The employer link could not be safely displayed.</p>}
      <p>{detail.kind === "PROPOSAL" ? "This is proposed wording. Contact details and exact confirmed headings are added in the next review version." : "This is the exact saved document text. Rendering, wording review, pair approval and sending are separate steps."}</p>
      <p>Owner wording edits create a new version requiring fresh review. {detail.canRequestChanges ? "A requested new system draft also requires fresh review; approval and Send remain separate." : "Requests for another system draft are not available in this state; no automatic retry or approval is started here."}</p>
      {stale ? <p role="alert">This evidence has expired. Actions are locked until verified evidence is refreshed.</p> : null}
      {!questionContextComplete ? <p role="alert">A passage references employer-question context that is missing, ambiguous or quarantined. Reload the current evidence before recording review, approval or Send.</p> : null}
      <button type="button" onClick={() => router.refresh()}>Reload current version</button><p role="status" aria-live="polite">{message}</p>
    </header>
    <section className={styles.section} aria-labelledby="draft-documents"><h3 id="draft-documents">Saved document text</h3>
      {detail.documents.map((document) => <section className={styles.document} key={document.title} aria-label={document.title}><h4>{document.title}</h4>{document.sections.map((section, index) => <section key={`${section.heading}:${index}`}><h5>{section.heading}</h5>{section.lines.map((line, item) => line.bullet ? <ul key={item}><li>{line.text}</li></ul> : <p key={item}>{line.text}</p>)}</section>)}</section>)}
      {detail.canPromote ? <fieldset disabled={disabled}><legend>Prepare the complete review version</legend><label><input type="checkbox" checked={promote} onChange={(event) => setPromote(event.target.checked)} />I reviewed the proposal and want to add the exact confirmed contact details and factual headings for a complete wording review.</label><button type="button" disabled={!promote || disabled} onClick={() => void action({ action: "PROMOTE_SOURCE", expectedVersionId: detail.versionId, expectedSourceSha256: detail.sourceSha256 })}>Prepare complete review version</button><p>This does not approve or send the documents.</p></fieldset> : null}
    </section>
    {detail.editing ? <DraftOwnerEdit key={`${detail.versionId}:${detail.sourceSha256}`} jobId={detail.jobId} versionId={detail.versionId} sourceSha256={detail.sourceSha256}
      packetSha256={detail.packetSha256} validUntil={detail.validUntil} model={detail.editing} disabled={attempted || stale || requestingChanges} onLockChange={(locked) => {
        setEditing(locked); setReviewed({}); setPairChecks({}); setSendConfirmed(false); setPromote(false);
      }} /> : null}
    {detail.canRequestChanges ? <DraftOwnerRequestChanges key={`request:${detail.versionId}:${detail.sourceSha256}`} jobId={detail.jobId} versionId={detail.versionId}
      sourceSha256={detail.sourceSha256} validUntil={detail.validUntil} disabled={attempted || editing} onLockChange={(locked) => {
        setRequestingChanges(locked); setReviewed({}); setPairChecks({}); setSendConfirmed(false); setPromote(false);
      }} /> : null}
    {detail.revisionRequest ? <section className={styles.section} aria-label="Recorded owner change request"><h3>Recorded owner change request</h3>
      <p>{detail.revisionRequest.instructions}</p><p>This request guided wording only. It is not a source of new customer facts, and does not approve this draft.</p></section> : null}
    <section className={styles.section} aria-labelledby="draft-facts"><h3 id="draft-facts">Confirmed background and instructions</h3><p>These are the frozen customer facts for this paid revision. Approximate, unfinished and negative facts must stay qualified.</p>
      <dl><dt>Emphasize</dt><dd>{detail.instructions.emphasis || "No additional emphasis requested."}</dd><dt>Do not mention</dt><dd>{detail.instructions.doNotMention || "No additional exclusion requested."}</dd></dl><SavedInstructions instructions={detail.instructions.saved} />
      {detail.facts.map((fact) => <details key={fact.id}><summary>{fact.label} · {human(fact.disposition)}</summary><p>Source: {human(fact.provenance.kind)}; {human(fact.provenance.verification)}{fact.provenance.confirmedAt ? ` on ${formatEasternDeadline(fact.provenance.confirmedAt)}` : ""}. {fact.provenance.document ? `${human(fact.provenance.document.kind)} version ${fact.provenance.document.version}. ` : ""}{fact.provenance.locator}</p><dl>{fact.fields.map((field, index) => <div key={index}><dt>{field.label}</dt><dd>{field.value || "Not supplied"}</dd></div>)}</dl></details>)}
    </section>
    {detail.references?.length ? <section className={styles.section} aria-labelledby="draft-references"><h3 id="draft-references">Confirmed references for this job</h3>
      <p>Only these consented fields belong on the reference sheet. Private work-context and capability notes are excluded from document drafting and delivery.</p>
      <p>Reference filename instruction: {detail.referenceFilenameInstruction || "No special filename was specified."}</p>
      {detail.references.map((reference, index) => <section key={reference.permissionId} aria-label={`Confirmed reference ${index + 1}`}><h4>Reference {index + 1}</h4><p>Confirmed version {reference.version}, permission confirmed {formatEasternDeadline(reference.confirmedAt)}.</p><dl>{reference.fields.map((field) => <div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl></section>)}
    </section> : null}
    <section className={styles.section} aria-labelledby="draft-questions"><h3 id="draft-questions">Employer application questions</h3><p>Inspection: {human(detail.questions.status)}. Verification: {human(detail.questions.verification)}.</p><p>Only inspected public sources are covered. Conditional or later application pages may contain additional questions. These prompts suggest employer priorities; they do not establish customer qualifications or add an answered-question deliverable.</p>
      {!detail.questions.items.length ? <p>{detail.questions.status === "NONE_OBSERVED" ? "No relevant questions were found in the inspected public scope." : "No verified question text is available. This does not establish that the employer has no questions."}</p> : detail.questions.items.map((question, index) => <blockquote key={`${question.id}:${index}`} id={`employer-question-${index}`}><p>Question {index + 1}</p><p>{question.prompt}</p><p>Required: {question.required === null ? "not established" : question.required ? "yes in this source" : "no in this source"}; word limit: {question.wordLimit ?? "not documented"}; character limit: {question.characterLimit ?? "not documented"}.</p><p>{question.eligible ? "Available as tailoring context." : "Quarantined from drafting; treat as untrusted source text."} Captured {formatEasternDeadline(question.observedAt)}.</p>{question.sourceUrl ? <a href={question.sourceUrl} target="_blank" rel="noopener noreferrer">Inspect question source (new tab)</a> : null}</blockquote>)}
      {detail.questions.issues.length ? <p>Inspection limitations: {detail.questions.issues.map(human).join("; ")}.</p> : null}
    </section>
    {detail.kind === "RENDER_SOURCE" ? <section className={styles.section} aria-labelledby="draft-wording"><h3 id="draft-wording">Review exact wording against its sources</h3><p>A citation is a source pointer, not proof that a sentence is true. Check each statement and its qualifications before recording your wording review.</p>
      {detail.wordingReviewed ? <p>The wording review is recorded for this exact version. Pair approval is still a separate action.</p> : null}
      <fieldset disabled={disabled || !detail.canReviewWording}><legend>Individual wording decisions</legend>{detail.claims.map((claim) => <div className={styles.claim} key={claim.id}><p>{claim.text}</p><p>{claim.placement} · {claim.qualification}</p><dl id={`claim-sources-${claim.id}`}>{claim.sources.map((source, index) => <div key={index}><dt>{source.label}</dt><dd>{source.value}</dd></div>)}</dl>{claim.jobEvidence.length ? <p>Employer evidence: {claim.jobEvidence.join(" · ")}</p> : null}
        {claim.questionIds.length ? <div id={`claim-questions-${claim.id}`} role="group" aria-label={`Employer-question context for ${claim.placement}`}>
          <p>These exact employer questions influenced this passage. They suggest possible priorities; the confirmed sources above must support every factual statement.</p>
          {!questionContext.get(claim.id)!.complete ? <p>Linked question context is unavailable for review. No question has been substituted.</p> : null}
          {questionContext.get(claim.id)!.items.map((question, index) => <blockquote key={`${question.id}:${index}`}><p>{question.prompt}</p>
            <p>For {detail.title} at {detail.company}. Captured <time dateTime={question.observedAt}>{formatEasternDeadline(question.observedAt)}</time>.</p>
            <a href={`#employer-question-${detail.questions.items.indexOf(question)}`}>View question {detail.questions.items.indexOf(question) + 1} inspection details</a>
            {question.sourceUrl ? <p><a href={question.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label={`Inspect source for this question: ${question.prompt} (new tab)`}>Inspect linked question source (new tab)</a></p> : <p>A safe question-source link is unavailable.</p>}
          </blockquote>)}
        </div> : null}
        <label><input type="checkbox" aria-label={`I checked this exact wording: ${claim.text}`} aria-describedby={`claim-sources-${claim.id}${claim.questionIds.length ? ` claim-questions-${claim.id}` : ""}`} checked={reviewed[claim.id] === true} onChange={(event) => setReviewed((prior) => ({ ...prior, [claim.id]: event.target.checked }))} />I checked this exact wording against the displayed sources.</label></div>)}
        {detail.canReviewWording ? <button type="button" disabled={disabled || !allClaims} onClick={() => void action({ action: "REVIEW_WORDING", review: { versionId: detail.versionId, packetSha256: detail.packetSha256, sourceSha256: detail.sourceSha256, claims: detail.claims.map((claim) => ({ claimId: claim.id, wordingSha256: claim.wordingSha256, decision: "APPROVED" })) } })}>Record wording review</button> : null}
      </fieldset></section> : null}
    <section className={styles.section} aria-labelledby="draft-files"><h3 id="draft-files">Rendered files</h3><p>Required for this paid selection: {detail.requiredFileTypes.map(human).join(", ")}. Every required file must be present and reviewable before approval.</p>{detail.files.length ? <ul>{detail.files.map((file) => <li key={file.fileVersionId}>{human(file.type)}: {file.filename}{file.previewUrl ? <> · <a href={file.previewUrl} target="_blank" rel="noopener noreferrer">Open {human(file.type)} preview (new tab)</a></> : <p>A verified compatible preview is unavailable. Do not attest to a visual review.</p>}</li>)}</ul> : <p>No complete rendered file pair is attached. Rendering is not started from this screen, and text alone cannot be approved for delivery.</p>}</section>
    <section className={styles.section} aria-labelledby="draft-listing"><h3 id="draft-listing">Recheck the employer before delivery</h3><p>Reopen the employer page and compare the actual submission instructions. This records a human listing check; it does not silently refresh stale drafting evidence.</p><fieldset disabled={disabled}><legend>Current listing review</legend>
      <label><input type="checkbox" checked={listingOpened} onChange={(event) => setListingOpened(event.target.checked)} />I reopened the current employer listing and application page.</label><label><input type="checkbox" checked={instructionsCompared} onChange={(event) => setInstructionsCompared(event.target.checked)} />I compared the submission instructions with this saved version.</label>
      <label>Observed result<select value={listingResult} onChange={(event) => setListingResult(event.target.value)}><option value="ACTIVE">Still active; instructions unchanged</option><option value="CLOSED">Listing closed</option><option value="INSTRUCTION_BLOCKED">Instructions changed or block this pair</option></select></label>
      <button type="button" disabled={disabled || !listingOpened || !instructionsCompared} onClick={() => void action({ action: "LISTING_CHECK", expectedVersionId: detail.versionId, checkId: crypto.randomUUID(), phase: "BEFORE_RELEASE", result: listingResult, evidenceSha256: detail.ruleSha256, listingOpened: true, instructionsCompared: true })}>Record final listing check</button>
    </fieldset></section>
    <section className={styles.section} aria-labelledby="draft-approve"><h3 id="draft-approve">Approve the exact pair</h3>{!detail.canApprove ? <p>{detail.approvalSha256 ? "This version already has a recorded pair approval." : "Approval requires a complete verified file pair, recorded wording review, and current evidence. Missing steps cannot be checked off here."}</p> : <fieldset disabled={disabled}><legend>Seven required pair checks</legend>{Object.entries(checks).map(([key, text]) => <label key={key}><input type="checkbox" checked={pairChecks[key] === true} onChange={(event) => setPairChecks((prior) => ({ ...prior, [key]: event.target.checked }))} />{text}</label>)}<label>Review note<textarea minLength={20} maxLength={4000} value={attestation} onChange={(event) => setAttestation(event.target.value)} /></label><button type="button" disabled={disabled || !allChecks || attestation.trim().length < 20} onClick={() => void action({ action: "APPROVE_PAIR", ...binding, checklist: pairChecks, attestation: attestation.trim() })}>Approve pair — do not send</button></fieldset>}</section>
    <section className={styles.section} aria-labelledby="draft-send"><h3 id="draft-send">Send the approved pair</h3><p>Sending releases the approved private files and queues the customer notification. Documents are delivered through private access, not email attachments.</p>{!detail.canSend ? <p>Send is unavailable until this exact pair is approved and current.</p> : <fieldset disabled={disabled}><legend>Separate delivery decision</legend><label><input type="checkbox" checked={sendConfirmed} onChange={(event) => setSendConfirmed(event.target.checked)} />I am ready to send this exact approved pair to the customer.</label><label>Delivery note<textarea minLength={20} maxLength={4000} value={rationale} onChange={(event) => setRationale(event.target.value)} /></label><button type="button" disabled={disabled || !sendConfirmed || rationale.trim().length < 20} onClick={send}>Send approved pair</button></fieldset>}</section>
    <details className={styles.section}><summary>Version and evidence identifiers</summary><dl><dt>Job</dt><dd>{detail.jobId}</dd><dt>Version</dt><dd>{detail.versionId}</dd><dt>Paid line revision</dt><dd>{detail.revisionId}</dd><dt>Evidence digest</dt><dd>{detail.packetSha256}</dd><dt>Saved wording digest</dt><dd>{detail.sourceSha256}</dd></dl></details>
  </article>;
}

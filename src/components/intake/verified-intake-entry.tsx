"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { IntakeWizard } from "@/app/get-started/wizard-v3";
import { CandidateQuestions } from "./candidate-questions";
import { invitationFragment, invitationSignInHref, parseInvitationFragment, type CheckoutInvitation } from "@/lib/commerce/invitation-fragment";
import { verifiedIntakeAccessSchema, verifiedIntakeActionReceiptSchema, type VerifiedIntakeAccess, type VerifiedIntakeAction, type VerifiedIntakeSummary } from "@/lib/intake/verified-intake-contract";

export function VerifiedIntakeEntry() {
  const [access, setAccess] = useState<VerifiedIntakeAccess | null>(null);
  const [selected, setSelected] = useState<VerifiedIntakeSummary | null>(null);
  const [state, setState] = useState<"LOADING" | "SIGNED_OUT" | "CHOOSING" | "OPEN" | "UNAVAILABLE">("LOADING");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [replaceUnlinked, setReplaceUnlinked] = useState(false);
  const [signInHref, setSignInHref] = useState("/sign-in?next=%2Fget-started");
  const [invitation, setInvitation] = useState<CheckoutInvitation | null>(null);
  const createRequestId = useRef<string | null>(null);
  const load = useCallback(async (choose = false, expectedOpenedId?: string) => {
    setBusy(true);
    try {
      const response = await fetch("/api/intake/access", { cache: "no-store" });
      if (response.status === 401) { setAccess(null); setSelected(null); setState("SIGNED_OUT"); return null; }
      const parsed = verifiedIntakeAccessSchema.safeParse(await response.json());
      if (!response.ok || !parsed.success) throw new Error("unavailable");
      setAccess(parsed.data);
      setReplaceUnlinked(false);
      // An already selected, verified cookie may open. Reading a list never
      // chooses a different draft or replaces the browser's capability.
      if (!choose && parsed.data.current && parsed.data.current.draftId === parsed.data.browserDraftId && (!expectedOpenedId || expectedOpenedId === parsed.data.current.draftId)) {
        setSelected(parsed.data.current); setState("OPEN");
        return parsed.data.current;
      } else { setSelected(null); setState("CHOOSING");
        if (expectedOpenedId) setNotice("The selected intake changed or its access could not be confirmed. Choose the intake you want to open.");
        return null;
      }
    } catch { setState("UNAVAILABLE"); setNotice("Your saved intakes could not be checked. Please try again."); return null; }
    finally { setBusy(false); }
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => {
      const fragment = invitationFragment(window.location.hash);
      setInvitation(parseInvitationFragment(fragment));
      setSignInHref(invitationSignInHref(fragment));
      if (window.location.hash && !fragment) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      void load(new URLSearchParams(window.location.search).get("choose") === "1");
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function act(action: VerifiedIntakeAction) {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/intake/access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(action) });
      const body = await response.json();
      if (!response.ok) {
        setNotice(typeof body.error === "string" ? body.error : "This intake could not be opened. Check your saved intakes before trying again.");
        if (response.status === 401) { setSelected(null); setState("SIGNED_OUT"); }
        return;
      }
      const receipt = verifiedIntakeActionReceiptSchema.safeParse(body);
      if (!receipt.success) throw new Error("unconfirmed_access");
      if (receipt.data.state === "RESUME_REQUIRED") {
        createRequestId.current = null;
        setNotice("Your intake is saved. Choose it below to restore access in this browser.");
        await load(true);
      } else {
        // The browser has applied Set-Cookie before this authenticated re-read.
        const opened = await load(false, receipt.data.draftId);
        if (opened?.draftId === receipt.data.draftId) createRequestId.current = null;
      }
    } catch {
      setNotice("The result is uncertain. Check your saved intakes before starting or opening another one.");
    } finally { setBusy(false); }
  }
  function start() {
    if (!access || (access.claimAvailable && !replaceUnlinked)) return;
    createRequestId.current ??= crypto.randomUUID();
    void act({ action: "START", requestId: createRequestId.current, expectedBrowserDraftId: access.browserDraftId, replaceUnlinkedBrowserIntake: replaceUnlinked });
  }
  function resume(draft: VerifiedIntakeSummary) {
    if (!access || (access.claimAvailable && !replaceUnlinked)) return;
    void act({ action: "RESUME", rootDraftId: draft.rootDraftId, expectedDraftId: draft.draftId,
      expectedCapabilityVersion: draft.capabilityVersion, expectedBrowserDraftId: access.browserDraftId, replaceUnlinkedBrowserIntake: replaceUnlinked });
  }
  if (state === "OPEN" && selected && access) return <>
    <p className="form-message">Signed in as {access.verifiedEmail}.</p>
    <details><summary>Open a different intake</summary><p>Make sure your current changes show as saved before switching.</p><button type="button" disabled={busy} onClick={() => void load(true)}>Choose saved intakes or start a separate one</button></details>
    {(selected.questionPending || selected.reviewRequired) && <p role="status">Your intake needs your attention. <a href="#candidate-questions">Open your questions and saved review</a>.</p>}
    <IntakeWizard expectedDraftId={selected.draftId} accessEmail={selected.accessEmail} invitation={invitation} />
    <CandidateQuestions expectedDraftId={selected.draftId} autoLoad />
  </>;
  return <main id="main-content" className="auth-page"><section className="auth-card" aria-busy={busy}>
    <h1>{state === "SIGNED_OUT" ? "Save your intake securely." : "Open your ApplyPack intake."}</h1>
    {state === "LOADING" && <p role="status">Checking your saved intakes…</p>}
    {state === "SIGNED_OUT" && <><p>Verify your email before sharing your resume or personal information. You can use that account to return to your saved intake.</p><Link className="wizard-next" href={signInHref} prefetch={false}>Verify my email</Link></>}
    {state === "CHOOSING" && access && <>
      <p>Signed in as <strong>{access.verifiedEmail}</strong>.</p>
      {access.claimAvailable && access.browserDraftId && <div>
        <p>An intake was saved in this browser. Link it to this account using its original access email before opening its private information.</p>
        <button type="button" disabled={busy} onClick={() => void act({ action: "CLAIM", expectedBrowserDraftId: access.browserDraftId! })}>Link the intake saved in this browser</button>
        <p>Link this saved intake before switching, so you can return to it. If it cannot be linked, check that you used the correct account.</p>
        <label><input type="checkbox" checked={replaceUnlinked} disabled={busy} onChange={event => setReplaceUnlinked(event.target.checked)} />I understand that switching may remove this browser’s only access to an unlinked intake. I want to start or open a different intake anyway.</label>
      </div>}
      {access.drafts.length > 0 && <><h2>Your saved intakes</h2><p>Choose the intake you want to open. This browser will switch to your choice.</p><ul>
        {access.drafts.map(draft => <li key={draft.rootDraftId}>
          <p>Started {new Date(draft.createdAt).toLocaleString()} — {draft.questionPending ? "Questions waiting" : draft.reviewRequired ? "Complete review needed" : draft.state === "IN_PROGRESS" ? "In progress" : "Submitted"}.</p>
          <button type="button" disabled={busy || (access.claimAvailable && !replaceUnlinked)} onClick={() => resume(draft)}>Open this intake</button>
        </li>)}
      </ul><p>Up to 20 available intakes are shown. Paid orders and delivered documents remain in <Link href="/my-applypack">My ApplyPack</Link>.</p></>}
      <button type="button" className="wizard-next" disabled={busy || (access.claimAvailable && !replaceUnlinked)} onClick={start}>{access.browserDraftId || access.drafts.length ? "Start a separate intake" : "Start my intake"}</button>
    </>}
    {(state === "CHOOSING" || state === "UNAVAILABLE") && <button type="button" disabled={busy} onClick={() => void load(true)}>Check saved intakes</button>}
    {notice && <p role="status">{notice}</p>}
  </section></main>;
}

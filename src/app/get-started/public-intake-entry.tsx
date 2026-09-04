"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function PublicIntakeEntry() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function begin() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/guest-session", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Secure intake could not be started.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Secure intake could not be started.");
      setBusy(false);
    }
  }

  return (
    <main id="main-content" className="brief-intake-entry">
      <div className="page-frame brief-intake-shell">
        <div className="brief-intake-progress" role="progressbar" aria-label="Intake progress" aria-valuemin={1} aria-valuemax={4} aria-valuenow={1}>
          <span>STAGE 1 OF 4</span><i><b /></i>
        </div>
        <p className="eyebrow">TELL US WHAT FITS</p>
        <h1>Start with the life your next job needs to fit.</h1>
        <p className="brief-intake-lede">You do not need the perfect job title or a perfectly updated resume. Tell us about your experience, priorities, preferences, and dealbreakers.</p>
        <div className="brief-order-summary"><strong>10 researched job matches</strong><span>$20 one time</span><span>Delivered within 24 hours after intake and payment</span></div>
        <section className="brief-first-field" aria-labelledby="begin-heading">
          <h2 id="begin-heading">Begin your secure intake.</h2>
          <p>Your progress and documents stay connected to a private guest session. Email verification is not required before checkout.</p>
          <button className="button-link button-link--primary brief-intake-continue" type="button" onClick={begin} disabled={busy}>{busy ? "Starting Securely..." : "Begin My Intake"}</button>
          {message ? <p className="form-message" role="alert">{message}</p> : null}
        </section>
        <ol className="brief-intake-stages" aria-label="Four intake stages">
          <li aria-current="step"><span>1</span><div><strong>Your details</strong><p>Contact and location</p></div></li>
          <li><span>2</span><div><strong>Your experience</strong><p>Resume and verified background</p></div></li>
          <li><span>3</span><div><strong>Your fit</strong><p>Priorities, preferences, and dealbreakers</p></div></li>
          <li><span>4</span><div><strong>Review and payment</strong><p>Confirm the criteria and continue to checkout</p></div></li>
        </ol>
      </div>
    </main>
  );
}

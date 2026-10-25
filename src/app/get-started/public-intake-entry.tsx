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
        <p className="brief-intake-lede">You do not need a resume or the perfect job title. Use a current or older resume, or build your background with guided questions. Tell us about your experience, priorities, preferences, and dealbreakers.</p>
        <div className="brief-order-summary"><strong>One private intake</strong><span>Request the $18.99 human-reviewed Top 10</span><span>The 24-hour delivery clock starts after successful payment and complete required inputs</span></div>
        <section className="brief-first-field" aria-labelledby="begin-heading">
          <h2 id="begin-heading">Begin your secure intake.</h2>
          <p>Your progress and documents stay connected to a private guest session. Email verification is not required before checkout.</p>
          <button className="button-link button-link--primary brief-intake-continue" type="button" onClick={begin} disabled={busy}>{busy ? "Starting Securely..." : "Begin My Intake"}</button>
          {message ? <p className="form-message" role="alert">{message}</p> : null}
        </section>
        <ol className="brief-intake-stages" aria-label="Four intake stages">
          <li aria-current="step"><span>1</span><div><strong>Your starting point</strong><p>Contact and optional documents</p></div></li>
          <li><span>2</span><div><strong>Your direction</strong><p>Work you want and work to avoid</p></div></li>
          <li><span>3</span><div><strong>Your background</strong><p>Actual experience, education and tasks</p></div></li>
          <li><span>4</span><div><strong>Requirements and full review</strong><p>Edit and confirm before invitation review</p></div></li>
        </ol>
      </div>
    </main>
  );
}

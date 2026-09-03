"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { normalizeEmailCode, safeAuthDestination } from "@/lib/auth/email-code";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [destination, setDestination] = useState("/get-started");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      setDestination(safeAuthDestination(params.get("next")));
      const suppliedEmail = params.get("email");
      if (suppliedEmail) setEmail(suppliedEmail);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function requestCode(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/email-code/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setStep("code");
      setMessage("We sent a six-digit ApplyPack sign-in code. It expires shortly.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The code could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/email-code/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, code, next: destination }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      router.push(result.redirectTo || destination);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The code could not be verified.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main-content" className="auth-page">
      <section className="auth-card">
        <p className="eyebrow">MY APPLYPACK</p>
        <h1>{step === "email" ? "Sign in with a secure code." : "Enter your six-digit code."}</h1>
        <p>{step === "email" ? "We will email a one-time code to your account address." : <>We sent the code to <strong>{email}</strong>.</>}</p>
        {step === "email" ? (
          <form onSubmit={requestCode}>
            <label htmlFor="sign-in-email">Email address</label>
            <input id="sign-in-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
            <button className="wizard-next" disabled={busy}>{busy ? "Sending..." : "Send My Six-Digit Code"}</button>
          </form>
        ) : (
          <form onSubmit={verifyCode}>
            <label htmlFor="sign-in-code">Six-digit code</label>
            <input
              id="sign-in-code"
              className="email-code-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(normalizeEmailCode(event.target.value))}
              autoFocus
              required
            />
            <button className="wizard-next" disabled={busy || code.length !== 6}>{busy ? "Checking..." : "Continue Securely"}</button>
            <div className="auth-secondary-actions">
              <button type="button" className="text-button" disabled={busy} onClick={() => requestCode()}>Send a new code</button>
              <button type="button" className="text-button" disabled={busy} onClick={() => { setStep("email"); setCode(""); setMessage(""); }}>Use a different email</button>
            </div>
          </form>
        )}
        {message ? <p className="form-message" role="status" aria-live="polite">{message}</p> : null}
      </section>
    </main>
  );
}

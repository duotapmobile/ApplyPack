"use client";
import { FormEvent, useState } from "react";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessage("Check your email for your secure sign-in link.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The link could not be sent.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main id="main-content" className="auth-page">
      <section className="auth-card">
        <p className="eyebrow">MY APPLYPACK</p>
        <h1>Sign in without a password.</h1>
        <p>We will email a secure link to your account address.</p>
        <form onSubmit={submit}>
          <label>Email address<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <button className="wizard-next" disabled={busy}>{busy ? "Sending..." : "Email My Secure Link"}</button>
        </form>
        {message ? <p className="form-message" role="status">{message}</p> : null}
      </section>
    </main>
  );
}

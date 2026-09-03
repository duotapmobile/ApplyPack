"use client";

import { FormEvent, useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Enrollment = { factorId: string; qrCode: string; secret: string };

type BrowserClient = NonNullable<ReturnType<typeof createSupabaseBrowserClient>>;

async function createAdminMfaEnrollment(supabase: BrowserClient) {
  return supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "ApplyPack admin" });
}

type EnrollmentResponse = Awaited<ReturnType<typeof createAdminMfaEnrollment>>;

let pendingAdminMfaEnrollment: Promise<EnrollmentResponse> | null = null;

async function enrollAdminMfa(supabase: BrowserClient) {
  if (!pendingAdminMfaEnrollment) {
    pendingAdminMfaEnrollment = createAdminMfaEnrollment(supabase);
  }
  const result = await pendingAdminMfaEnrollment;
  if (result.error) pendingAdminMfaEnrollment = null;
  return result;
}

export function AdminMfa() {
  const [factorId, setFactorId] = useState("");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("Preparing secure MFA setup...");
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let active = true;
    async function prepare() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (active) { setMessage("Admin authentication is not configured."); setBusy(false); }
        return;
      }
      const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) {
        if (active) { setMessage("MFA factors could not be loaded."); setBusy(false); }
        return;
      }
      const verified = factors.totp.find((factor) => factor.status === "verified");
      if (verified) {
        if (active) { setFactorId(verified.id); setMessage("Enter the current code from your authenticator app."); setBusy(false); }
        return;
      }

      for (const factor of factors.totp.filter((item) => item.status !== "verified")) {
        await supabase.auth.mfa.unenroll({ factorId: factor.id });
      }
      const { data, error } = await enrollAdminMfa(supabase);
      if (!active) return;
      if (error || !data?.totp) {
        setMessage("MFA enrollment could not be started.");
        setBusy(false);
        return;
      }
      setFactorId(data.id);
      setEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
      setMessage("Scan the QR code with your authenticator app, then enter its six-digit code.");
      setBusy(false);
    }
    void prepare();
    return () => { active = false; };
  }, []);

  async function verify(event: FormEvent) {
    event.preventDefault();
    const supabase = createSupabaseBrowserClient();
    if (!supabase || !factorId || !/^\d{6}$/.test(code)) return;
    setBusy(true);
    setMessage("Verifying MFA...");
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    if (error) {
      setMessage("That authenticator code was not accepted. Wait for a new code and try again.");
      setBusy(false);
      return;
    }
    window.location.reload();
  }

  return (
    <main id="main-content" className="auth-page">
      <section className="auth-card">
        <p className="eyebrow">ADMIN SECURITY</p>
        <h1>{enrollment ? "Set up admin MFA." : "Verify admin MFA."}</h1>
        <p>{message}</p>
        {enrollment ? (
          <div className="mfa-enrollment">
            {/* Supabase returns a self-contained SVG data URL for this one-time enrollment view. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={enrollment.qrCode} alt="Authenticator enrollment QR code" width="220" height="220" />
            <details><summary>Enter a setup key instead</summary><code>{enrollment.secret}</code></details>
          </div>
        ) : null}
        <form onSubmit={verify}>
          <label htmlFor="admin-mfa-code">Six-digit authenticator code</label>
          <input
            id="admin-mfa-code"
            className="email-code-input"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            disabled={busy || !factorId}
            required
          />
          <button className="wizard-next" disabled={busy || code.length !== 6}>{busy ? "Please wait..." : "Verify and Open Operations"}</button>
        </form>
      </section>
    </main>
  );
}

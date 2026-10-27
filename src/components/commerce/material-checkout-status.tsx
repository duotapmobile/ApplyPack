"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { materialCheckoutStatusSchema, type MaterialCheckoutStatusResponse } from "@/lib/commerce/material-checkout-status";

export function MaterialCheckoutStatus({ checkoutIntentId, cancelled = false }: { checkoutIntentId: string; cancelled?: boolean }) {
  const [status, setStatus] = useState<MaterialCheckoutStatusResponse | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true, revision = 0, timer: number | undefined;
    async function load() {
      const requestRevision = ++revision;
      if (timer) window.clearTimeout(timer);
      try {
        const response = await fetch(`/api/checkout/apply-packs/${encodeURIComponent(checkoutIntentId)}/status`, { cache: "no-store", credentials: "same-origin" });
        const parsed = materialCheckoutStatusSchema.safeParse(await response.json());
        if (!active || requestRevision !== revision) return;
        if (!response.ok || !parsed.success || parsed.data.checkoutIntentId !== checkoutIntentId) throw new Error("status_unavailable");
        setStatus(parsed.data); setUnavailable(false);
        if (parsed.data.state === "CONFIRMING_PAYMENT") timer = window.setTimeout(() => void load(), 2_000);
      } catch {
        if (!active || requestRevision !== revision) return;
        setStatus(null); setUnavailable(true);
      }
    }
    function recheck() { setStatus(null); void load(); }
    window.addEventListener("focus", recheck); window.addEventListener("pageshow", recheck);
    void load();
    return () => { active = false; if (timer) window.clearTimeout(timer); window.removeEventListener("focus", recheck); window.removeEventListener("pageshow", recheck); };
  }, [checkoutIntentId, retry]);
  const current = status?.checkoutIntentId === checkoutIntentId ? status : null;
  const title = unavailable ? "Apply Pack status is unavailable" : current?.state === "PAYMENT_VERIFIED" ? "Apply Pack payment verified"
    : current?.state === "EXPIRED" ? "Apply Pack checkout expired" : current?.state === "FAILED" ? "Apply Pack checkout needs attention"
      : cancelled ? "You returned from Apply Pack checkout" : "Checking your Apply Pack payment";
  const message = unavailable ? "Sign in with the account that placed this order, then check again or open My ApplyPack."
    : current?.state === "PAYMENT_VERIFIED" ? "Your Apply Pack payment was verified. Open My ApplyPack for the current status and delivery details."
      : current?.state === "EXPIRED" ? "This checkout expired. Open My ApplyPack to check your order before starting another payment."
        : current?.state === "FAILED" ? "This checkout could not be completed. Open My ApplyPack or contact support before trying another payment."
          : "Payment has not yet been verified for this checkout. Returning here does not confirm cancellation or a refund. Do not submit a second payment while verification is pending.";
  return <main id="main-content" className="auth-page"><section className="auth-card" aria-live="polite">
    <p className="eyebrow">APPLY PACK CHECKOUT</p><h1>{title}</h1><p>{message}</p>
    <div className="admin-buttons"><Link className="button-link button-link--primary" href={current ? `/my-applypack?order=${encodeURIComponent(current.orderId)}` : "/my-applypack"}><span>Open My ApplyPack</span></Link>
      {unavailable ? <button type="button" onClick={() => { setStatus(null); setUnavailable(false); setRetry(value => value + 1); }}>Check again</button> : null}<Link href="/contact">Get help</Link></div>
  </section></main>;
}

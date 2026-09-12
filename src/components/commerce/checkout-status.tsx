"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { checkoutStatusPresentation, type CheckoutProjection } from "@/lib/commerce/presentation";

export type CheckoutStatusResponse = {
  state: CheckoutProjection;
  orderId?: string | null;
  deliveryDueAt?: string | null;
};

export function CheckoutStatus({ cancelled = false, fixtureStatus }: { cancelled?: boolean; fixtureStatus?: CheckoutStatusResponse }) {
  const [status, setStatus] = useState<CheckoutStatusResponse>(fixtureStatus || { state: cancelled ? "CANCELED" : "CONFIRMING_PAYMENT" });
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (fixtureStatus) return;
    let active = true;
    let timer: number | undefined;
    async function load() {
      const response = cancelled
        ? await fetch("/api/checkout/search/status", { method: "POST", headers: { "content-type": "application/json" } })
        : await fetch("/api/checkout/search/status", { cache: "no-store" });
      const value = await response.json().catch(() => ({}));
      if (!active) return;
      if (!response.ok) {
        setUnavailable(true);
        return;
      }
      setUnavailable(false);
      if (!cancelled) setStatus(value as CheckoutStatusResponse);
      if (!cancelled && value.state === "CONFIRMING_PAYMENT") timer = window.setTimeout(() => void load(), 2_000);
    }
    void load();
    return () => { active = false; if (timer) window.clearTimeout(timer); };
  }, [cancelled, fixtureStatus]);

  const presentation = checkoutStatusPresentation(status.state, status.deliveryDueAt);
  return <main id="main-content" className="auth-page">
    <section className="auth-card" aria-live="polite">
      <p className="eyebrow">SECURE CHECKOUT</p>
      <h1>{unavailable ? "Checkout status is unavailable" : presentation.title}</h1>
      <p>{unavailable ? "The private 15-minute status link expired or does not match this browser. Use the secure email link to open My ApplyPack." : presentation.message}</p>
      <div className="admin-buttons">
        {status.orderId && <Link className="button-link button-link--primary" href={`/my-applypack?order=${encodeURIComponent(status.orderId)}`}><span>Open My ApplyPack</span></Link>}
        {!status.orderId && cancelled && <Link className="button-link button-link--primary" href="/get-started"><span>Return to intake</span></Link>}
        <Link href="/contact">Get help</Link>
      </div>
    </section>
  </main>;
}

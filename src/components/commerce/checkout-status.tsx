"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { z } from "zod";
import { checkoutStatusPresentation, type CheckoutProjection } from "@/lib/commerce/presentation";

export type CheckoutStatusResponse = {
  state: CheckoutProjection;
  orderId?: string | null;
  deliveryDueAt?: string | null;
};

const responseSchema = z.object({
  state: z.enum(["CONFIRMING_PAYMENT", "SEARCH_ACTIVE", "CAPACITY_EXCEPTION", "ADJUSTMENT_REQUIRED", "REFUND_PROCESSING", "REFUNDED", "REFUND_PROBLEM", "DELIVERED", "CANCELED", "EXPIRED", "FAILED"]),
  orderId: z.uuid().nullable().optional(),
  deliveryDueAt: z.iso.datetime({ offset: true }).nullable().optional(),
});

export function CheckoutStatus({ cancelled = false, fixtureStatus }: { cancelled?: boolean; fixtureStatus?: CheckoutStatusResponse }) {
  const [status, setStatus] = useState<CheckoutStatusResponse>(fixtureStatus || { state: cancelled ? "CANCELED" : "CONFIRMING_PAYMENT" });
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (fixtureStatus) return;
    let active = true;
    let revision = 0;
    let timer: number | undefined;
    async function load() {
      const requestRevision = ++revision;
      if (timer) window.clearTimeout(timer);
      try {
        const response = cancelled
          ? await fetch("/api/checkout/search/status", { method: "POST", headers: { "content-type": "application/json" } })
          : await fetch("/api/checkout/search/status", { cache: "no-store" });
        const value = await response.json();
        if (!active || requestRevision !== revision) return;
        if (!response.ok) throw new Error("status_unavailable");
        const parsed = responseSchema.safeParse(cancelled ? { state: "CANCELED" } : value);
        if (!parsed.success) throw new Error("status_unavailable");
        setUnavailable(false);
        setStatus(parsed.data);
        if (!cancelled && parsed.data.state === "CONFIRMING_PAYMENT") timer = window.setTimeout(() => void load(), 2_000);
      } catch {
        if (!active || requestRevision !== revision) return;
        setStatus({ state: "CONFIRMING_PAYMENT" });
        setUnavailable(true);
      }
    }
    function recheck() {
      // Account sign-out or switching in another tab invalidates the old view.
      setStatus({ state: "CONFIRMING_PAYMENT" });
      void load();
    }
    window.addEventListener("focus", recheck);
    window.addEventListener("pageshow", recheck);
    void load();
    return () => { active = false; if (timer) window.clearTimeout(timer); window.removeEventListener("focus", recheck); window.removeEventListener("pageshow", recheck); };
  }, [cancelled, fixtureStatus]);

  const presentation = checkoutStatusPresentation(status.state, status.deliveryDueAt);
  return <main id="main-content" className="auth-page">
    <section className="auth-card" aria-live="polite">
      <p className="eyebrow">SECURE CHECKOUT</p>
      <h1>{unavailable ? "Checkout status is unavailable" : presentation.title}</h1>
      <p>{unavailable ? "This checkout cannot be checked in the current browser or account. Open My ApplyPack and sign in with the account that placed the order." : presentation.message}</p>
      <div className="admin-buttons">
        <Link className="button-link button-link--primary" href={status.orderId ? `/my-applypack?order=${encodeURIComponent(status.orderId)}` : "/my-applypack"}><span>Open My ApplyPack</span></Link>
        {!status.orderId && cancelled && <Link className="button-link button-link--primary" href="/get-started"><span>Return to intake</span></Link>}
        <Link href="/contact">Get help</Link>
      </div>
    </section>
  </main>;
}

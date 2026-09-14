"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { BoardPlanId } from "@/lib/job-board/plans";

export function BoardCheckoutButton({ planId }: { planId: BoardPlanId }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  async function begin() {
    setState("loading");
    try {
      const response = await fetch("/api/checkout/job-board", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ planId }) });
      const result = await response.json() as { url?: string; error?: string };
      if (response.status === 401) {
        router.push(`/sign-in?next=${encodeURIComponent("/job-board")}`);
        return;
      }
      if (response.status === 409 && result.error?.toLowerCase().includes("profile")) {
        router.push("/get-started");
        return;
      }
      if (!response.ok || !result.url) throw new Error("checkout_failed");
      window.location.assign(result.url);
    } catch { setState("error"); }
  }
  return <div><button className="button-link button-link--primary" disabled={state === "loading"} onClick={begin} type="button">{state === "loading" ? "Opening secure checkout…" : "Choose this plan"}</button>{state === "error" ? <p role="alert">Checkout is unavailable. No charge or access change was made.</p> : null}</div>;
}

export function BillingPortalButton() {
  const [error, setError] = useState(false);
  async function open() {
    setError(false);
    const response = await fetch("/api/customer/billing/portal", { method: "POST" });
    const result = await response.json() as { url?: string };
    if (response.ok && result.url) window.location.assign(result.url); else setError(true);
  }
  return <div><button className="button-link" onClick={open} type="button">Manage billing or cancel renewal</button>{error ? <p role="alert">Billing management is temporarily unavailable.</p> : null}</div>;
}

export function ApplyLinkButton({ jobId }: { jobId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  async function open() {
    setState("loading");
    try {
      const response = await fetch(`/api/customer/job-board/${encodeURIComponent(jobId)}/apply-link`, { cache: "no-store" });
      const result = await response.json() as { url?: string };
      if (!response.ok || !result.url) throw new Error("link_unavailable");
      window.location.assign(result.url);
      setState("idle");
    } catch { setState("error"); }
  }
  return <div><button className="button-link" disabled={state === "loading"} onClick={open} type="button">{state === "loading" ? "Verifying listing…" : "Verify and apply on source site"}</button>{state === "error" ? <p role="alert">This listing is expired or its application link is unavailable.</p> : null}</div>;
}

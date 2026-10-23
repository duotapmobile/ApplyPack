"use client";

import { useState } from "react";
import { formatEasternDeadline } from "@/lib/commerce/presentation";

type Version = { id: string; version: number; deliveredAt: string; available: boolean };

export function DeliveryActions({ itemId, deliveredAt, jobLabel }: { itemId: string; deliveredAt: string; jobLabel: string }) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const base = `/api/customer/deliveries/${encodeURIComponent(itemId)}`;
  async function loadVersions() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`${base}?history=1`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Historical versions could not be loaded.");
      setVersions(result.versions);
      if (!result.versions.length) setMessage("No historical version record is available. Contact support for review.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Historical versions could not be loaded."); }
    finally { setBusy(false); }
  }
  return <div className="delivery-actions" id={`historical-delivery-${itemId}`}>
    <p>Historical documents for {jobLabel}, delivered {formatEasternDeadline(deliveredAt)}. Sign in again if prompted; secure download links last 15 minutes.</p>
    <a className="button-link" href={`${base}?kind=resume`}>Download resume</a>{" "}
    <a className="button-link" href={`${base}?kind=cover_letter`}>Download cover letter</a>{" "}
    <button type="button" disabled={busy} onClick={() => void loadVersions()}>{busy ? "Loading versions…" : "Show document versions"}</button>
    <p><a href={`/sign-in?next=${encodeURIComponent(`/my-applypack#historical-delivery-${itemId}`)}`}>Sign in again and return to these documents</a></p>
    {versions?.length ? <ul>{versions.map((version) => <li key={version.id}>
      Version {version.version} · {formatEasternDeadline(version.deliveredAt)}: {version.available ? <>
        <a href={`${base}?kind=resume&revisionId=${encodeURIComponent(version.id)}`}>Resume version {version.version}</a>{" · "}
        <a href={`${base}?kind=cover_letter&revisionId=${encodeURIComponent(version.id)}`}>Cover letter version {version.version}</a>
      </> : "This version needs support review; its delivery record is preserved."}
    </li>)}</ul> : null}
    <p role="status" aria-live="polite">{message}</p>
  </div>;
}

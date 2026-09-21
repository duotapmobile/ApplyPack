"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatEasternDeadline } from "@/lib/commerce/presentation";

type JsonObject = Record<string, unknown>;

export type SearchAdjustmentView = {
  id: string;
  state: string;
  currentValidCount: number | null;
  reasonCodes: string[];
  blockingConstraints: JsonObject;
  criteriaDiff: JsonObject;
  proposedSnapshotPatch: JsonObject;
  proposalExpiresAt: string;
  estimatedDueAt: string | null;
  revisionDueAt: string | null;
};

export type SearchOrderProgressView = {
  orderId: string;
  stateLabel: string;
  stateMessage: string;
  dueAt: string | null;
  refundState: "NONE" | "PENDING" | "FAILED" | "SUCCEEDED";
  adjustment: SearchAdjustmentView | null;
};

export function SearchOrderProgress({ searches }: { searches: SearchOrderProgressView[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState("");
  const [messages, setMessages] = useState<Record<string, string>>({});

  async function decide(amendmentId: string, action: "accept" | "decline") {
    setBusyId(amendmentId);
    setMessages((current) => ({ ...current, [amendmentId]: "" }));
    try {
      const response = await fetch(`/api/customer/search-adjustments/${encodeURIComponent(amendmentId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "The response could not be recorded.");
      const message = result.outcome === "ACCEPTED" && typeof result.deliveryDueAt === "string"
        ? `Revised search accepted. The exact deadline is ${formatEasternDeadline(result.deliveryDueAt)}.`
        : result.outcome === "CAPACITY_EXCEPTION"
          ? "No revised production slot was available. A full refund is processing."
          : "The adjustment was declined. A full refund is processing.";
      setMessages((current) => ({ ...current, [amendmentId]: message }));
      router.refresh();
    } catch (error) {
      setMessages((current) => ({
        ...current,
        [amendmentId]: error instanceof Error ? error.message : "The response could not be recorded.",
      }));
    } finally {
      setBusyId("");
    }
  }

  if (!searches.length) return null;
  return (
    <section className="portal-section" aria-labelledby="search-progress-heading">
      <div className="portal-section__heading">
        <div><p className="eyebrow">SEARCH STATUS</p><h2 id="search-progress-heading">Your researched-job orders</h2></div>
        <p>Payment, research, review, adjustment, refund, and release are shown as separate verified states.</p>
      </div>
      <div className="search-progress-list">
        {searches.map((search) => (
          <article className="search-progress-card" key={search.orderId}>
            <div className="search-progress-card__heading">
              <div><span>ORDER {search.orderId.slice(0, 8).toUpperCase()}</span><h3>{search.stateLabel}</h3></div>
              {search.dueAt ? <time dateTime={search.dueAt}>{formatEasternDeadline(search.dueAt)}</time> : null}
            </div>
            <p>{search.stateMessage}</p>
            {search.refundState !== "NONE" ? <p className={`refund-state refund-state--${search.refundState.toLowerCase()}`}>
              <strong>Full refund:</strong> {refundLabel(search.refundState)}
            </p> : null}
            {search.adjustment ? <AdjustmentPanel
              adjustment={search.adjustment}
              busy={busyId === search.adjustment.id}
              message={messages[search.adjustment.id] || ""}
              onDecision={decide}
            /> : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function AdjustmentPanel({
  adjustment,
  busy,
  message,
  onDecision,
}: {
  adjustment: SearchAdjustmentView;
  busy: boolean;
  message: string;
  onDecision: (id: string, action: "accept" | "decline") => Promise<void>;
}) {
  const active = adjustment.state === "PROPOSED";
  return <div className="adjustment-panel">
    <div>
      <p className="eyebrow">CRITERIA DECISION</p>
      <h4>{active ? "We need your explicit choice" : `Adjustment ${humanize(adjustment.state)}`}</h4>
      {active ? <p>We currently have <strong>{adjustment.currentValidCount ?? "fewer than 10"}</strong> verified matches that satisfy the active criteria. We will never pad the list.</p> : null}
    </div>
    {adjustment.reasonCodes.length ? <div><strong>Why this is needed</strong><ul>{adjustment.reasonCodes.map((reason) => <li key={reason}>{humanize(reason)}</li>)}</ul></div> : null}
    {Object.keys(adjustment.blockingConstraints).length ? <div><strong>Blocking constraints</strong><DefinitionRows value={adjustment.blockingConstraints} /></div> : null}
    {Object.keys(adjustment.criteriaDiff).length ? <div><strong>Precise before-and-after changes</strong><DiffRows value={adjustment.criteriaDiff} /></div> : null}
    {!Object.keys(adjustment.criteriaDiff).length && Object.keys(adjustment.proposedSnapshotPatch).length
      ? <div><strong>Proposed criteria values</strong><DefinitionRows value={adjustment.proposedSnapshotPatch} /></div> : null}
    {active && adjustment.estimatedDueAt ? <p className="deadline-note"><strong>Estimated revised deadline if accepted now:</strong> {formatEasternDeadline(adjustment.estimatedDueAt)}. The binding timestamp is calculated only after acceptance and capacity confirmation.</p> : null}
    {!active && adjustment.revisionDueAt ? <p className="deadline-note"><strong>Exact revised deadline:</strong> {formatEasternDeadline(adjustment.revisionDueAt)}</p> : null}
    {active ? <>
      <p className="adjustment-expiry">This proposal expires {formatEasternDeadline(adjustment.proposalExpiresAt)}.</p>
      <div className="adjustment-actions">
        <button className="wizard-next" disabled={busy} type="button" onClick={() => void onDecision(adjustment.id, "accept")}>{busy ? "Recording..." : "Accept changes and restart 24-hour search"}</button>
        <button className="wizard-back" disabled={busy} type="button" onClick={() => void onDecision(adjustment.id, "decline")}>Decline changes and receive full refund</button>
      </div>
    </> : null}
    <p className={message ? "form-message" : "sr-only"} role="status" aria-live="polite">{message || "No adjustment response submitted."}</p>
  </div>;
}

function DiffRows({ value }: { value: JsonObject }) {
  return <dl className="criteria-diff">{Object.entries(value).map(([key, entry]) => {
    const change = asObject(entry);
    const hasPair = change && (Object.prototype.hasOwnProperty.call(change, "before") || Object.prototype.hasOwnProperty.call(change, "after"));
    return <div key={key}>
      <dt>{humanize(key)}</dt>
      {hasPair ? <dd><span>Before: {displayValue(change.before)}</span><span>After: {displayValue(change.after)}</span></dd> : <dd>{displayValue(entry)}</dd>}
    </div>;
  })}</dl>;
}

function DefinitionRows({ value }: { value: JsonObject }) {
  return <dl className="criteria-diff">{Object.entries(value).map(([key, entry]) => <div key={key}><dt>{humanize(key)}</dt><dd>{displayValue(entry)}</dd></div>)}</dl>;
}

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Not set";
  if (Array.isArray(value)) return value.length ? value.map(displayValue).join(", ") : "None";
  if (typeof value === "object") return Object.entries(value as JsonObject).map(([key, entry]) => `${humanize(key)}: ${displayValue(entry)}`).join("; ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
}

function refundLabel(state: SearchOrderProgressView["refundState"]) {
  if (state === "PENDING") return "processing with the payment provider";
  if (state === "FAILED") return "requires staff attention; the retry record is preserved";
  if (state === "SUCCEEDED") return "confirmed by the payment provider";
  return "not required";
}

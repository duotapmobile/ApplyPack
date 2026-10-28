"use client";

import { useEffect, useState, type FormEvent } from "react";
import { adminRetentionStatusSchema, retentionHoldReasons, type AdminRetentionStatus } from "@/lib/materials/retention-admin";
import { formatEasternDeadline } from "@/lib/commerce/presentation";

export function ServiceRetentionControls() {
  const [status, setStatus] = useState<AdminRetentionStatus | null>(null);
  const [message, setMessage] = useState("Loading retention status…");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/admin/service-retention", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json();
        const parsed = adminRetentionStatusSchema.safeParse(body);
        if (!response.ok || !parsed.success) throw new Error("Retention status is unavailable. Refresh after verifying administrator MFA.");
        setStatus(parsed.data); setMessage("");
      }).catch((error) => { if (!controller.signal.aborted) { setStatus(null); setMessage(error instanceof Error ? error.message : "Retention status is unavailable."); } });
    return () => controller.abort();
  }, [revision]);
  return <section className="admin-table-wrap" aria-labelledby="service-retention-title">
    <h2 id="service-retention-title">Private service access and retention holds</h2>
    <p>These dates apply only to new orders accepted under the 30-day policy. A hold preserves required records; it does not extend customer access or the purchase window. Historical and shared active records remain protected.</p>
    <p>Cleanup execution is not available from this screen. Status and hold changes do not prove that files have been removed.</p>
    <button type="button" onClick={() => { setStatus(null); setMessage("Refreshing retention status…"); setRevision((value) => value + 1); }}>Refresh retention status</button>
    <p role="status" aria-live="polite">{message}</p>
    {status?.orders.map((order) => <RetentionOrder key={`${revision}:${order.order_id}:${order.state}:${order.holds.map((hold) => `${hold.id}:${hold.released_at}`).join(",")}`} order={order} />)}
    {status && !status.orders.length ? <p>No orders are enrolled in the new retention policy.</p> : null}
    {status?.orders.length === 100 ? <p>Only the first 100 enrolled orders are shown. Additional orders require a separate review through approved operations tooling.</p> : null}
  </section>;
}

function RetentionOrder({ order }: { order: AdminRetentionStatus["orders"][number] }) {
  const [reason, setReason] = useState<keyof typeof retentionHoldReasons>("SUPPORT_REVIEW");
  const [reviewed, setReviewed] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [message, setMessage] = useState("");
  const terminal = order.state === "PURGING" || Boolean(order.purged_at);
  async function change(hold: AdminRetentionStatus["orders"][number]["holds"][number] | null) {
    if (!reviewed || attempted || terminal) return;
    setAttempted(true); setMessage("Recording the hold decision…");
    try {
      const response = await fetch("/api/admin/service-retention", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.order_id, reasonCode: hold?.reason_code ?? reason, holdId: hold?.id ?? null, release: Boolean(hold), reviewed: true }) });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "The hold change could not be confirmed.");
      setMessage("Hold decision recorded. Refresh retention status before making another change.");
    } catch (error) { setMessage(`${error instanceof Error ? error.message : "The result could not be confirmed."} Refresh retention status before retrying.`); }
  }
  return <article className="admin-control">
    <h3>Order {order.order_id.slice(0, 8).toUpperCase()}</h3>
    <p>State: {order.state.replaceAll("_", " ").toLowerCase()}. {order.protected ? "Required records are protected from cleanup." : "No blocking obligation is currently reported."}</p>
    <dl><div><dt>Start checkout or request a conflict review by</dt><dd>{date(order.action_expires_at)}</dd></div><div><dt>Private search access ends</dt><dd>{date(order.access_expires_at)}</dd></div><div><dt>Family retention deadline</dt><dd>{date(order.family_expires_at)}</dd></div></dl>
    <details><summary>Order identifiers</summary><p>Order: {order.order_id}<br />Customer: {order.customer_id}</p></details>
    {order.holds.filter((hold) => !hold.released_at).map((hold) => <div key={hold.id}><p>{retentionHoldReasons[hold.reason_code]} · added {formatEasternDeadline(hold.created_at)}</p><button type="button" disabled={!reviewed || attempted || terminal} onClick={() => void change(hold)}>Release this {retentionHoldReasons[hold.reason_code].toLowerCase()} hold</button></div>)}
    {!terminal ? <form onSubmit={(event: FormEvent) => { event.preventDefault(); void change(null); }}>
      <label>Reason for keeping required records<select value={reason} onChange={(event) => { setReason(event.target.value as keyof typeof retentionHoldReasons); setReviewed(false); }} disabled={attempted}>{Object.entries(retentionHoldReasons).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} disabled={attempted} />I reviewed the current paid work, corrections, disputes, and required records before this hold decision.</label>
      <button type="submit" disabled={!reviewed || attempted}>Add retention hold</button>
    </form> : <p>Cleanup has already been committed. A new hold cannot restore removed content.</p>}
    <p role="status" aria-live="polite">{message}</p>
  </article>;
}

function date(value: string | null) { return value ? formatEasternDeadline(value) : "Not yet established"; }

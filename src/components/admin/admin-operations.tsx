"use client";

import { useState } from "react";

type SearchOrder = { id: string; delivery_deadline: string | null; intake_id: string | null; source_scan_status: string; source_deleted: boolean; has_cover_letter: boolean; intake_details: Record<string, unknown> };
type ApplyItem = { id: string; order_id: string; company: string; title: string; emphasis_notes: string | null; do_not_mention_notes: string | null; customer_update_notes: string | null };
type Review = { id: string; explanation?: string; correction_text?: string; company: string; title: string };
type CapacityLimit = { kind: string; units_per_24h: number; enabled: boolean };

const matchTemplate = JSON.stringify({
  matches: Array.from({ length: 10 }, (_, index) => ({
    company: "Company " + (index + 1),
    title: "Job title",
    sourceUrl: "https://employer.example/jobs/role",
    location: "Remote",
    salary: "Not listed",
    fitSummary: "Explain the evidence-based connection to the customer's approved criteria.",
    requirements: ["Requirement confirmed from the employer listing"],
    concerns: ["Any unknown or concern, or leave this array empty"],
    checkedAt: "2026-09-01T12:00:00.000Z",
  })),
}, null, 2);

export function AdminOperations({ searchOrders, applyItems, conflicts, corrections, capacityLimits }: {
  searchOrders: SearchOrder[];
  applyItems: ApplyItem[];
  conflicts: Review[];
  corrections: Review[];
  capacityLimits: CapacityLimit[];
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [matchJson, setMatchJson] = useState<Record<string, string>>({});

  async function request(path: string, init: RequestInit, action: string) {
    setBusy(action);
    setMessage("");
    try {
      const response = await fetch(path, init);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The operation failed.");
      setMessage("Saved. Refreshing the queue.");
      window.setTimeout(() => window.location.reload(), 500);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The operation failed.");
    } finally {
      setBusy("");
    }
  }

  function deliverSearch(orderId: string) {
    const raw = matchJson[orderId];
    if (!raw) return setMessage("Load the 10-match template, replace every placeholder, and recheck every listing.");
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return setMessage("The match JSON is not valid."); }
    return request("/api/admin/search-orders/" + orderId + "/deliver", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }, "search-" + orderId);
  }

  function deliverPack(itemId: string, form: HTMLFormElement) {
    const data = new FormData(form);
    data.set("qualityConfirmed", String(data.get("qualityConfirmed") === "on"));
    return request("/api/admin/apply-pack-items/" + itemId + "/deliver", { method: "POST", body: data }, "pack-" + itemId);
  }

  function resolveCorrection(requestId: string, form: HTMLFormElement) {
    const data = new FormData(form);
    data.set("qualityConfirmed", String(data.get("qualityConfirmed") === "on"));
    return request("/api/admin/corrections/" + requestId + "/resolve", { method: "POST", body: data }, "correction-" + requestId);
  }

  return <div className="admin-operations">
    <section className="admin-control">
      <div className="admin-control__heading"><div><p className="eyebrow">SEARCH PRODUCTION</p><h2>Deliver 10 reviewed matches</h2></div><p>Use employer URLs only. Recheck every listing immediately before delivery.</p></div>
      {searchOrders.length ? searchOrders.map((order) => <article className="admin-work-card" key={order.id}>
        <div><strong>Search {order.id.slice(0, 8).toUpperCase()}</strong><span>Due {formatDeadline(order.delivery_deadline)}</span></div>
        <details>
          <summary>Approved intake and search criteria</summary>
          <pre className="admin-json">{JSON.stringify(order.intake_details, null, 2)}</pre>
        </details>
        {order.source_deleted ? <p>Source documents were deleted under the retention policy.</p> : order.source_scan_status === "clean" && order.intake_id ? <div className="admin-buttons">
          <a href={"/api/admin/intakes/" + order.intake_id + "/source?kind=resume"}>Download source resume</a>
          {order.has_cover_letter ? <a href={"/api/admin/intakes/" + order.intake_id + "/source?kind=cover_letter"}>Download source cover letter</a> : null}
        </div> : <p role="status">Source retrieval locked: malware scan status is {order.source_scan_status}.</p>}
        <label>Validated match payload
          <textarea className="admin-json" value={matchJson[order.id] || ""} onChange={(event) => setMatchJson((current) => ({ ...current, [order.id]: event.target.value }))} placeholder="Load the required template, then replace every placeholder." />
        </label>
        <div className="admin-buttons">
          <button type="button" onClick={() => setMatchJson((current) => ({ ...current, [order.id]: matchTemplate }))}>Load 10-match template</button>
          <button className="wizard-next" type="button" disabled={busy === "search-" + order.id} onClick={() => deliverSearch(order.id)}>Deliver reviewed matches</button>
        </div>
      </article>) : <p>No paid searches need match delivery.</p>}
    </section>

    <section className="admin-control">
      <div className="admin-control__heading"><div><p className="eyebrow">APPLY PACK PRODUCTION</p><h2>Upload reviewed DOCX files</h2></div><p>Each card is one separate $8 order.</p></div>
      {applyItems.length ? applyItems.map((item) => <article className="admin-work-card" key={item.id}>
        <div><strong>{item.title}</strong><span>{item.company} - Order {item.order_id.slice(0, 8).toUpperCase()}</span></div>
        {item.emphasis_notes ? <p><b>Emphasize:</b> {item.emphasis_notes}</p> : null}
        {item.do_not_mention_notes ? <p><b>Do not mention:</b> {item.do_not_mention_notes}</p> : null}
        {item.customer_update_notes ? <p><b>Changed facts:</b> {item.customer_update_notes}</p> : null}
        <form onSubmit={(event) => { event.preventDefault(); deliverPack(item.id, event.currentTarget); }}>
          <label>Tailored resume (.docx)<input name="resume" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required /></label>
          <label>Tailored cover letter (.docx)<input name="coverLetter" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required /></label>
          <label className="confirm"><input name="qualityConfirmed" type="checkbox" required />I completed the factual, job-specific, file, and link quality checks.</label>
          <button className="wizard-next" disabled={busy === "pack-" + item.id}>Deliver privately</button>
        </form>
      </article>) : <p>No paid Apply Packs need delivery.</p>}
    </section>

    <section className="admin-control">
      <div className="admin-control__heading"><div><p className="eyebrow">CRITERIA CONFLICTS</p><h2>Review replacement requests</h2></div><p>Approval records the conflict; a fresh replacement is delivered through the search production route.</p></div>
      {conflicts.length ? conflicts.map((review) => <article className="admin-work-card" key={review.id}>
        <div><strong>{review.title}</strong><span>{review.company}</span></div><p>{review.explanation}</p>
        <label>Operator resolution<textarea id={"resolution-" + review.id} minLength={10} /></label>
        <label>Fresh replacement job JSON<textarea id={"replacement-" + review.id} className="admin-json" placeholder={'{"company":"...","title":"...","sourceUrl":"https://...","location":"...","salary":"...","fitSummary":"At least 20 characters","requirements":[],"concerns":[],"checkedAt":"2026-09-01T12:00:00.000Z"}'} /></label>
        <div className="admin-buttons">
          {(["accepted", "rejected"] as const).map((status) => <button key={status} type="button" onClick={() => {
            const resolution = (document.getElementById("resolution-" + review.id) as HTMLTextAreaElement)?.value || "";
            let replacement: unknown;
            if (status === "accepted") {
              try { replacement = JSON.parse((document.getElementById("replacement-" + review.id) as HTMLTextAreaElement)?.value || ""); }
              catch { setMessage("Accepted conflicts require valid fresh replacement JSON."); return; }
            }
            request("/api/admin/conflicts/" + review.id + "/resolve", {
              method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status, resolution, replacement }),
            }, "conflict-" + review.id);
          }}>{status === "accepted" ? "Accept conflict" : "Reject conflict"}</button>)}
        </div>
      </article>) : <p>No conflict reviews are waiting.</p>}
    </section>

    <section className="admin-control">
      <div className="admin-control__heading"><div><p className="eyebrow">FACTUAL CORRECTIONS</p><h2>Deliver the included correction</h2></div><p>Corrected files are versioned; the previous delivery remains in the audit history.</p></div>
      {corrections.length ? corrections.map((review) => <article className="admin-work-card" key={review.id}>
        <div><strong>{review.title}</strong><span>{review.company}</span></div><p>{review.correction_text}</p>
        <form onSubmit={(event) => { event.preventDefault(); resolveCorrection(review.id, event.currentTarget); }}>
          <label>Corrected resume (.docx)<input name="resume" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required /></label>
          <label>Corrected cover letter (.docx)<input name="coverLetter" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required /></label>
          <label>Operator note<textarea name="resolution" minLength={10} required /></label>
          <label className="confirm"><input name="qualityConfirmed" type="checkbox" required />I verified the requested factual correction and both files.</label>
          <button className="wizard-next" disabled={busy === "correction-" + review.id}>Deliver corrected version</button>
        </form>
      </article>) : <p>No correction requests are waiting.</p>}
    </section>

    <section className="admin-control">
      <div className="admin-control__heading"><div><p className="eyebrow">CAPACITY</p><h2>Rolling 24-hour limits</h2></div><p>Lower or disable a service before accepting work you cannot deliver.</p></div>
      <div className="capacity-grid">{capacityLimits.map((limit) => <form className="admin-work-card" key={limit.kind} onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        request("/api/admin/capacity/" + limit.kind, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ unitsPer24h: Number(data.get("units")), enabled: data.get("enabled") === "on" }),
        }, "capacity-" + limit.kind);
      }}>
        <strong>{limit.kind.replaceAll("_", " ")}</strong>
        <label>Units per 24 hours<input name="units" type="number" min={1} max={100} defaultValue={limit.units_per_24h} /></label>
        <label className="confirm"><input name="enabled" type="checkbox" defaultChecked={limit.enabled} />Accept new orders</label>
        <button>Save capacity</button>
      </form>)}</div>
    </section>

    <section className="admin-control">
      <div className="admin-control__heading"><div><p className="eyebrow">REFUNDS</p><h2>Issue an order refund</h2></div><p>Use only after confirming the governing refund condition. Every request is recorded.</p></div>
      <form className="admin-work-card" onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        request("/api/admin/refunds/" + data.get("orderId"), {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: data.get("reason") }),
        }, "refund");
      }}>
        <label>Order UUID<input name="orderId" required /></label>
        <label>Customer-visible reason<textarea name="reason" minLength={10} maxLength={1000} required /></label>
        <label className="confirm"><input type="checkbox" required />I confirmed this refund is authorized under the published policy.</label>
        <button className="wizard-next" disabled={busy === "refund"}>Issue refund</button>
      </form>
    </section>

    <p className={message ? "form-message" : "sr-only"} role="status" aria-live="polite">{message || "Operator actions appear here."}</p>
  </div>;
}

function formatDeadline(value: string | null) {
  return value ? new Date(value).toLocaleString("en-US", { timeZone: "America/New_York" }) + " ET" : "not set";
}

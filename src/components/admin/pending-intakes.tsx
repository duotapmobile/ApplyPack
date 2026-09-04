type PendingRequest = { id: string; snapshot_id: string; state: string; created_at: string };
type Snapshot = { id: string; access_email_normalized: string; desired_activities: unknown; avoided_activities: unknown;
  search_breadth: string; guidance_requested: boolean; work_modes: unknown; us_state_or_dc: string | null;
  employment_types: unknown; dealbreakers: unknown; salary_hard_minimum_cents: number | null; salary_period: string | null; finalized_at: string };

const friendly = (value: string) => value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const values = (value: unknown) => Array.isArray(value) ? value.map((item) => friendly(String(item))).join(", ") || "None" : "None";

export function PendingIntakes({ requests, snapshots }: { requests: PendingRequest[]; snapshots: Snapshot[] }) {
  const byId = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
  return <section className="admin-table-wrap" aria-labelledby="pending-intakes-title"><h2 id="pending-intakes-title">Pending intake feasibility</h2>
    <p>These are immutable customer-reviewed snapshots. A pending request is not a feasibility result, quote, reservation, or payment.</p>
    {requests.length ? <div className="admin-table-scroll"><table className="admin-table"><caption className="sr-only">Anonymous four-step intakes awaiting real feasibility</caption><thead><tr><th scope="col">Intake</th><th scope="col">Direction</th><th scope="col">Requirements</th><th scope="col">State</th></tr></thead><tbody>{requests.map((request) => { const snapshot = byId.get(request.snapshot_id); return <tr key={request.id}><th scope="row"><strong>{snapshot?.access_email_normalized || "Protected contact"}</strong><span>{request.snapshot_id}</span></th><td>{snapshot ? `${values(snapshot.desired_activities)} · ${friendly(snapshot.search_breadth)}${snapshot.guidance_requested ? " · Guidance requested" : ""}` : "Snapshot unavailable"}</td><td>{snapshot ? `${values(snapshot.work_modes)} · ${snapshot.us_state_or_dc || "State missing"} · ${values(snapshot.employment_types)} · Exclude: ${values(snapshot.dealbreakers)}${snapshot.salary_hard_minimum_cents === null ? "" : ` · Minimum $${(snapshot.salary_hard_minimum_cents / 100).toLocaleString("en-US")} ${snapshot.salary_period === "HOUR" ? "hourly" : "annual"}`}` : "Protected"}</td><td>{friendly(request.state)}<br /><small>{new Date(request.created_at).toLocaleString("en-US", { timeZone: "America/New_York" })} ET</small></td></tr>; })}</tbody></table></div> : <p>No four-step intakes are waiting for feasibility.</p>}
  </section>;
}

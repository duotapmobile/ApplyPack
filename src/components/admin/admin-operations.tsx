"use client";

import { useState } from "react";

type SearchOrder = { id: string; delivery_deadline: string | null; intake_id: string | null; source_scan_status: string; source_deleted: boolean; has_cover_letter: boolean; intake_details: Record<string, unknown>; suggested_matches: Record<string, unknown>[] };
type RenderedPacketJob = { job_id: string; title: string; employer: string; unknown_warnings: { field: string; status: string }[] };
type PacketArtifact = { id: string; status: string; checksum_sha256: string | null; renderer_version: string; template_version: string; created_at: string; rendered_jobs: RenderedPacketJob[] };
type PacketOrder = { id: string; status: string; delivered_at: string | null; artifact: PacketArtifact | null };
type ApplyItem = { id: string; order_id: string; status: string; company: string; title: string; emphasis_notes: string | null; do_not_mention_notes: string | null; customer_update_notes: string | null; draft_resume_path: string | null; draft_cover_letter_path: string | null; draft_generated_at: string | null; draft_generator_version: string | null };
type Review = { id: string; explanation?: string; correction_text?: string; company: string; title: string };
type CapacityLimit = { kind: string; units_per_24h: number; enabled: boolean };

const reviewChecklistTemplate = {
  criteriaCompared: false,
  allListingsRechecked: false,
  exactlyTenApplicationWorthy: false,
  noPadding: false,
  humanReleaseApproved: false,
  reviewerNote: "Describe the final human review and any material judgment calls.",
};

const matchTemplate = JSON.stringify({
  reviewChecklist: reviewChecklistTemplate,
  matches: Array.from({ length: 10 }, (_, index) => ({
    company: "Company " + (index + 1),
    title: "Job title",
    sourceId: "manual-reviewed",
    sourceName: "Official employer careers page",
    sourceUrl: "https://employer.example/jobs/role",
    officialApplicationUrl: "https://employer.example/jobs/role",
    externalJobId: "employer-job-id",
    description: "Paste the posting text used for remote, phone, sales, marketing, and experience classification.",
    department: "Customer Operations",
    location: "Remote",
    employmentType: "Full-time",
    remoteScope: "Paste the exact remote eligibility language.",
    eligibleStates: [],
    eligibleCountries: ["US"],
    timezoneRequirement: "",
    scheduleType: "Full-time",
    salary: "Not listed",
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: "USD",
    payPeriod: "year",
    payModel: "unknown",
    applicantCost: null,
    benefitsStatus: "unknown",
    languageRequirements: [],
    fitSummary: "Explain the evidence-based connection to the customer's approved criteria.",
    matchingExperience: ["Name the confirmed customer duty or experience supporting this connection"],
    primaryOutcome: "State the employer's primary expected outcome for this role.",
    coreResponsibilities: ["A core responsibility verified from the employer listing"],
    requirements: ["Requirement confirmed from the employer listing"],
    hiddenJobFunctions: [],
    concerns: ["Any unknown or concern, or leave this array empty"],
    matchCategory: index % 2 === 0 ? "DIRECT_AND_TRANSFERABLE" : "TRANSFERABLE",
    packetStrongConnections: [{ kind: "TRANSFERABLE", statement: "Describe one approved factual connection without adding a qualification.", evidenceIds: ["candidate-fact:<approved-fact-uuid>", "job-field:description"] }],
    packetThingsToConsider: [{ kind: "GAP", statement: "State a material gap from the approved review.", evidenceIds: ["job-field:description"] }],
    packetUnknownWarnings: [
      { field: "Health benefits", status: "NOT_CONFIRMED", evidenceIds: ["job-field:benefits_status"] },
      { field: "Travel requirements", status: "NOT_STATED", evidenceIds: ["job-field:description"] },
      { field: "Compensation", status: "NOT_STATED", evidenceIds: ["job-field:salary_text"] },
    ],
    criteriaChecks: {
      dutiesAligned: false,
      experienceConfirmed: false,
      levelAcceptable: false,
      scheduleAcceptable: false,
      locationAcceptable: false,
      compensationAcceptable: false,
      nonNegotiablesSatisfied: false,
    },
    checkedAt: new Date().toISOString(),
  })),
}, null, 2);

const replacementTemplate = JSON.stringify({
  company: "Company name",
  title: "Job title",
  sourceId: "manual-reviewed",
  sourceName: "Official employer careers page",
  sourceUrl: "https://employer.example/jobs/role",
  officialApplicationUrl: "https://employer.example/jobs/role",
  externalJobId: "employer-job-id",
  description: "Paste the posting text used for remote, phone, sales, marketing, and experience classification.",
  department: "Customer Operations",
  location: "Remote",
  employmentType: "Full-time",
  remoteScope: "Paste the exact remote eligibility language.",
  eligibleStates: [],
  eligibleCountries: ["US"],
  timezoneRequirement: "",
  scheduleType: "Full-time",
  salary: "Not listed",
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: "USD",
  payPeriod: "year",
  payModel: "unknown",
  applicantCost: null,
  benefitsStatus: "unknown",
  languageRequirements: [],
  fitSummary: "Explain the evidence-based connection to the customer's approved criteria.",
  matchingExperience: ["Name the confirmed customer duty or experience supporting this connection"],
  primaryOutcome: "State the employer's primary expected outcome for this role.",
  coreResponsibilities: ["A core responsibility verified from the employer listing"],
  requirements: ["A requirement verified from the employer listing"],
  hiddenJobFunctions: [],
  concerns: ["Any unknown or concern, or leave this array empty"],
  matchCategory: "TRANSFERABLE",
  packetStrongConnections: [{ kind: "TRANSFERABLE", statement: "Describe one approved factual connection without adding a qualification.", evidenceIds: ["candidate-fact:<approved-fact-uuid>", "job-field:description"] }],
  packetThingsToConsider: [{ kind: "GAP", statement: "State a material gap from the approved review.", evidenceIds: ["job-field:description"] }],
  packetUnknownWarnings: [
    { field: "Health benefits", status: "NOT_CONFIRMED", evidenceIds: ["job-field:benefits_status"] },
    { field: "Travel requirements", status: "NOT_STATED", evidenceIds: ["job-field:description"] },
    { field: "Compensation", status: "NOT_STATED", evidenceIds: ["job-field:salary_text"] },
  ],
  criteriaChecks: {
    dutiesAligned: false,
    experienceConfirmed: false,
    levelAcceptable: false,
    scheduleAcceptable: false,
    locationAcceptable: false,
    compensationAcceptable: false,
    nonNegotiablesSatisfied: false,
  },
  checkedAt: new Date().toISOString(),
}, null, 2);

export function AdminOperations({ searchOrders, packetOrders, applyItems, conflicts, corrections, capacityLimits }: {
  searchOrders: SearchOrder[];
  packetOrders: PacketOrder[];
  applyItems: ApplyItem[];
  conflicts: Review[];
  corrections: Review[];
  capacityLimits: CapacityLimit[];
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [matchJson, setMatchJson] = useState<Record<string, string>>({});
  const [packetState, setPacketState] = useState<Record<string, PacketArtifact | null>>(() => Object.fromEntries(packetOrders.map((order) => [order.id, order.artifact])));

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

  async function packetAction(orderId: string, action: "generate" | "approve", current?: PacketArtifact | null) {
    setBusy(`packet-${orderId}-${action}`);
    setMessage("");
    try {
      const body = action === "generate" ? { action } : { action, artifactId: current?.id, checksumSha256: current?.checksum_sha256 };
      const response = await fetch(`/api/admin/search-orders/${orderId}/job-match-packet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "The packet operation failed.");
      setPacketState((state) => ({ ...state, [orderId]: {
        id: result.artifactId,
        status: result.status,
        checksum_sha256: result.checksumSha256,
        renderer_version: result.rendererVersion || current?.renderer_version || "",
        template_version: result.templateVersion || current?.template_version || "",
        created_at: current?.created_at || new Date().toISOString(),
        rendered_jobs: current?.rendered_jobs || [],
      } }));
      setMessage(action === "generate" ? "Private PDF preview generated. Inspect every page before approval." : "The exact inspected PDF artifact is approved for customer download.");
      if (action === "generate") window.setTimeout(() => window.location.reload(), 500);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The packet operation failed.");
    } finally {
      setBusy("");
    }
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
      <div className="admin-control__heading"><div><p className="eyebrow">SEARCH PRODUCTION</p><h2>Stage 10 reviewed matches</h2></div><p>Use official application URLs where verified. Include posting text and restrictions so classifications remain auditable. Recheck every listing immediately before packet review.</p></div>
      {searchOrders.length ? searchOrders.map((order) => <article className="admin-work-card" id={"order-" + order.id} key={order.id}>
        <div><strong>Search {order.id.slice(0, 8).toUpperCase()}</strong><span>Due {formatDeadline(order.delivery_deadline)} · {order.suggested_matches.length} pulled candidates</span></div>
        <details>
          <summary>Approved intake and search criteria</summary>
          <pre className="admin-json">{JSON.stringify(order.intake_details, null, 2)}</pre>
        </details>
        {order.source_deleted ? <p>Source documents were deleted under the retention policy.</p> : order.source_scan_status === "clean" && order.intake_id ? <div className="admin-buttons">
          <a href={"/api/admin/intakes/" + order.intake_id + "/source?kind=resume"}>Download source resume</a>
          {order.has_cover_letter ? <a href={"/api/admin/intakes/" + order.intake_id + "/source?kind=cover_letter"}>Download source cover letter</a> : null}
        </div> : <p role="status">Source retrieval locked: document safety status is {order.source_scan_status}.</p>}
        <label>Validated match payload
          <textarea className="admin-json" value={matchJson[order.id] || ""} onChange={(event) => setMatchJson((current) => ({ ...current, [order.id]: event.target.value }))} placeholder="Load the required template, then replace every placeholder." />
        </label>
        <div className="admin-buttons">
          {order.suggested_matches.length ? <button type="button" onClick={() => setMatchJson((current) => ({ ...current, [order.id]: JSON.stringify({ reviewChecklist: reviewChecklistTemplate, matches: order.suggested_matches }, null, 2) }))}>Load pulled candidates</button> : null}
          <button type="button" onClick={() => setMatchJson((current) => ({ ...current, [order.id]: matchTemplate }))}>Load 10-match template</button>
          <button className="wizard-next" type="button" disabled={busy === "search-" + order.id} onClick={() => deliverSearch(order.id)}>Stage for PDF review</button>
        </div>
      </article>) : <p>No paid searches need match staging.</p>}
    </section>

    <section className="admin-control">
      <div className="admin-control__heading"><div><p className="eyebrow">JOB MATCH PACKETS</p><h2>Preview and approve the PDF artifact</h2></div><p>Generation reads the ten human-approved staged records. It never changes job approval. Review the exact private artifact, checksum, template, and renderer before approval.</p></div>
      {packetOrders.length ? packetOrders.map((order) => {
        const artifact = packetState[order.id];
        return <article className="admin-work-card" key={order.id}>
          <div><strong>Search {order.id.slice(0, 8).toUpperCase()}</strong><span>{order.status === "delivered" ? `Delivered ${formatDeadline(order.delivered_at)}` : "Staged for packet review"}</span></div>
          <p>Status: <strong>{artifact?.status.replaceAll("_", " ") || "NOT GENERATED"}</strong></p>
          {artifact ? <>
            <p>Template {artifact.template_version} · Renderer {artifact.renderer_version}</p>
            <p>Checksum {artifact.checksum_sha256 || "Pending"}</p>
            {artifact.rendered_jobs.length ? <ol>
              {artifact.rendered_jobs.map((job) => <li key={job.job_id}>
                <strong>{job.title}</strong> — {job.employer} <span>({job.job_id})</span>
                {job.unknown_warnings.length ? <ul>{job.unknown_warnings.map((warning, index) => <li key={`${warning.field}-${index}`}><strong>{warning.field}:</strong> {warning.status.replaceAll("_", " ")}</li>)}</ul> : <p>No stored unknown warnings.</p>}
              </li>)}
            </ol> : <p>Rendered job summaries are unavailable; do not approve until the preview is inspected.</p>}
          </> : null}
          <div className="admin-buttons">
            <button type="button" disabled={busy.startsWith(`packet-${order.id}`)} onClick={() => packetAction(order.id, "generate", artifact)}>Generate current reviewed snapshot</button>
            {artifact && ["PREVIEW_READY", "APPROVED"].includes(artifact.status) ? <a href={`/api/admin/search-orders/${order.id}/job-match-packet?artifactId=${artifact.id}`} target="_blank" rel="noreferrer">Open exact PDF preview</a> : null}
            {artifact?.status === "PREVIEW_READY" ? <button className="wizard-next" type="button" disabled={busy.startsWith(`packet-${order.id}`)} onClick={() => packetAction(order.id, "approve", artifact)}>Approve this checksum for delivery</button> : null}
          </div>
        </article>;
      }) : <p>No reviewed 10-job searches are ready for a packet.</p>}
    </section>

    <section className="admin-control">
      <div className="admin-control__heading"><div><p className="eyebrow">APPLY PACK PRODUCTION</p><h2>Upload reviewed DOCX files</h2></div><p>Each card is one separate $8 order.</p></div>
      {applyItems.length ? applyItems.map((item) => <article className="admin-work-card" key={item.id}>
        <div><strong>{item.title}</strong><span>{item.company} - Order {item.order_id.slice(0, 8).toUpperCase()}</span></div>
        {item.emphasis_notes ? <p><b>Emphasize:</b> {item.emphasis_notes}</p> : null}
        {item.do_not_mention_notes ? <p><b>Do not mention:</b> {item.do_not_mention_notes}</p> : null}
        {item.customer_update_notes ? <p><b>Changed facts:</b> {item.customer_update_notes}</p> : null}
        {item.draft_resume_path && item.draft_cover_letter_path ? <div className="admin-buttons"><a href={"/api/admin/apply-pack-items/" + item.id + "/draft?kind=resume"}>Download generated resume draft</a><a href={"/api/admin/apply-pack-items/" + item.id + "/draft?kind=cover_letter"}>Download generated cover-letter draft</a></div> : <p role="status">Draft generation status: {item.status.replaceAll("_", " ")}.</p>}
        <form onSubmit={(event) => { event.preventDefault(); deliverPack(item.id, event.currentTarget); }}>
          <label>Tailored resume (.docx)<input name="resume" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required /></label>
          <label>Tailored cover letter (.docx)<input name="coverLetter" type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" required /></label>
          <label className="confirm"><input name="qualityConfirmed" type="checkbox" required />I completed the factual, job-specific, file, and link quality checks.</label>
          <label>Human review note<textarea name="reviewNote" minLength={20} maxLength={2000} required placeholder="Record the job-specific facts and checks completed before release." /></label>
          <button className="wizard-next" disabled={busy === "pack-" + item.id}>Deliver privately</button>
        </form>
      </article>) : <p>No paid document sets need delivery.</p>}
    </section>

    <section className="admin-control">
      <div className="admin-control__heading"><div><p className="eyebrow">CRITERIA CONFLICTS</p><h2>Review replacement requests</h2></div><p>Approval records the conflict; a fresh replacement is delivered through the search production route.</p></div>
      {conflicts.length ? conflicts.map((review) => <article className="admin-work-card" key={review.id}>
        <div><strong>{review.title}</strong><span>{review.company}</span></div><p>{review.explanation}</p>
        <label>Operator resolution<textarea id={"resolution-" + review.id} minLength={10} /></label>
        <label>Fresh replacement job JSON<textarea id={"replacement-" + review.id} className="admin-json" placeholder="Load the replacement template, replace every placeholder, and mark every verified criteria check true." /></label>
        <div className="admin-buttons">
          <button type="button" onClick={() => {
            const field = document.getElementById("replacement-" + review.id) as HTMLTextAreaElement | null;
            if (field) field.value = replacementTemplate;
          }}>Load replacement template</button>
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
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
            reasonCode: data.get("reasonCode"),
            reason: data.get("reason"),
          }),
        }, "refund");
      }}>
        <label>Order UUID<input name="orderId" required /></label>
        <label>Approved refund condition<select name="reasonCode" required>
          <option value="">Choose one</option>
          <option value="duplicate_or_incorrect_charge">Duplicate or incorrect charge</option>
          <option value="unfinished_item_policy">Eligible unfinished item</option>
          <option value="missed_deadline">ApplyPack-controlled missed deadline</option>
        </select></label>
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

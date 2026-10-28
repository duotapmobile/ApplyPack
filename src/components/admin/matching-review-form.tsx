"use client";

import { useState } from "react";

export type EvidenceRow = Record<string, unknown>;
export type PreparedResearchOperation = { endpoint: string; payload: EvidenceRow; summary: string };
export const evidenceRows = (value: unknown): EvidenceRow[] => Array.isArray(value) ? value.filter((item): item is EvidenceRow => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
export const evidenceRecord = (value: unknown): EvidenceRow => value && typeof value === "object" && !Array.isArray(value) ? value as EvidenceRow : {};
export const evidenceText = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "";
const human = (value: unknown) => evidenceText(value).toLowerCase().replaceAll("_", " ").replaceAll(":", " · ");
const lines = (value: FormDataEntryValue | null) => String(value || "").split("\n").map((line) => line.trim()).filter(Boolean);
export const researchActions = [
  ["BEGIN", "Start a research round"], ["QUESTION", "Ask the customer for a missing fact"],
  ["MATCH_EVIDENCE", "Compare an employer requirement with candidate evidence"],
  ["CATEGORICAL_USEFULNESS", "Review whether this job is worth applying to"],
  ["COMMUTE", "Check the route to an on-site or hybrid job"],
  ["CUSTOMER_CRITERION", "Review a customer requirement"], ["COMPENSATION_COMPARABILITY", "Review compensation comparability"],
  ["ADJACENT_EQUIVALENCE", "Review equivalent experience in another setting"],
  ["PARSER_CORRECTION", "Correct captured listing text"], ["EVALUATE", "Calculate the match from completed reviews"],
] as const;
const explanationSections = [
  ["whatJobInvolves", "What the job involves"], ["whyMadeList", "Why it belongs on this list"],
  ["howExperienceConnects", "How the candidate's experience connects"],
  ["whatMayBeNew", "What may be new for the candidate"], ["whatToKnow", "What the candidate should know"],
] as const;

export function MatchingReviewForm({ snapshotId, packet, action, member, onPrepare }: {
  snapshotId: string; packet: EvidenceRow; action: string; member?: EvidenceRow;
  onPrepare: (operation: PreparedResearchOperation) => void;
}) {
  const [error, setError] = useState("");
  const [nodeId, setNodeId] = useState("");
  const [relation, setRelation] = useState("DIRECT");
  const [disposition, setDisposition] = useState("REQUIRES_MORE_EVIDENCE");
  const [allowOmission, setAllowOmission] = useState(false);
  const jobId = evidenceText(member?.job_snapshot_id);
  const job = evidenceRecord(member?.job_snapshot);
  const nodes = evidenceRows(packet.requirementNodes).filter((node) => node.job_snapshot_id === jobId && node.node_kind === "CRITERION");
  const facts = evidenceRows(packet.ap_candidate_facts).filter((fact) => fact.snapshot_id === snapshotId && !fact.superseded_at
    && (fact.verification === "CUSTOMER_CONFIRMED" || fact.verification === "HUMAN_VERIFIED" && fact.source_kind === "HUMAN_VERIFICATION" && fact.supplied_source_id));
  const reviews = evidenceRows(packet.ap_human_review_records).filter((review) => review.snapshot_id === snapshotId && review.job_snapshot_id === jobId && !review.invalidated_at);
  const snapshot = evidenceRows(packet.ap_intake_snapshots).find((item) => item.id === snapshotId);
  const activeKeys = [...new Set(evidenceRows(packet.ap_match_evaluations).filter((item) => item.job_snapshot_id === jobId && !item.invalidated_at)
    .flatMap((evaluation) => Array.isArray(evaluation.active_root_keys) ? evaluation.active_root_keys : [])
    .filter((key): key is string => typeof key === "string" && key.startsWith("customer:") && !key.startsWith("customer:commute")))];
  const criterion = nodes.find((node) => node.id === nodeId);
  const sameCriterionNodes = nodes.filter((node) => criterion && node.stable_criterion_id === criterion.stable_criterion_id);
  const adjacentReviews = reviews.filter((review) => review.review_kind === "ADJACENT_EQUIVALENCE"
    && evidenceRecord(review.decision).stableCriterionId === criterion?.stable_criterion_id && evidenceRecord(review.decision).equivalentForCriterion === true);
  const reviewLabel = (review: EvidenceRow) => `${human(review.review_kind)} · ${human(evidenceRecord(review.decision).disposition)} · ${evidenceText(review.rationale).slice(0, 180)}`;

  function prepare(form: HTMLFormElement) {
    setError("");
    const values = new FormData(form);
    const selected = (name: string, allowed: EvidenceRow[]) => {
      const ids = values.getAll(name).map(String);
      if (new Set(ids).size !== ids.length || ids.some((id) => !allowed.some((item) => item.id === id))) throw new Error("Choose only the current evidence shown in this form.");
      return ids;
    };
    const choose = (name: string, allowed: EvidenceRow[], optional = false) => {
      const id = String(values.get(name) || "");
      if (optional && !id) return null;
      if (!allowed.some((item) => item.id === id)) throw new Error("Choose a current record from each required list.");
      return id;
    };
    try {
      if (!form.checkValidity()) { form.reportValidity(); return; }
      if (values.get("reviewed") !== "on") throw new Error("Confirm that you reviewed this operation before preparing it.");
      let payload: EvidenceRow;
      let endpoint = "matching-reviews";
      if (action === "BEGIN") {
        const configurations = selected("configurationIds", evidenceRows(packet.sourceConfigurations));
        if (!configurations.length) throw new Error("Select at least one approved source configuration.");
        payload = { action, snapshotId, configurationIds: configurations, round: Number(values.get("round")) };
        endpoint = "matching-research";
      } else if (action === "QUESTION") {
        payload = { action, snapshotId, jobSnapshotId: jobId, nodeId: choose("nodeId", nodes), prompt: String(values.get("prompt")).trim() };
        endpoint = "matching-research";
      } else if (action === "EVALUATE") {
        const evidenceReviewIds = selected("evidenceReviewIds", reviews.filter((review) => review.review_kind === "MATCH_EVIDENCE"));
        if (!evidenceReviewIds.length) throw new Error("Select the current requirement evidence reviews to evaluate.");
        payload = { snapshotId, inventoryMemberId: member?.id, jobSnapshotId: jobId, evidenceReviewIds,
          usefulnessReviewId: choose("usefulnessReviewId", reviews.filter((review) => review.review_kind === "CATEGORICAL_USEFULNESS")),
          compensationReviewId: choose("compensationReviewId", reviews.filter((review) => review.review_kind === "COMPENSATION_COMPARABILITY"), true) };
        endpoint = "matching-evaluations";
      } else {
        const sourceEvidenceNodeIds = selected("sourceEvidenceNodeIds", nodes);
        const candidateFactIds = selected("candidateFactIds", facts);
        if (!sourceEvidenceNodeIds.length) throw new Error("Select the employer evidence you actually reviewed.");
        const evidenceChanges = lines(values.get("evidenceChanges"));
        if (!evidenceChanges.length || evidenceChanges.some((change) => change.length < 3 || change.length > 500)) throw new Error("Describe at least one evidence finding, with 3–500 characters per line.");
        payload = { snapshotId, jobSnapshotId: jobId, reviewKind: action, disposition, sourceEvidenceNodeIds,
          candidateFactIds, evidenceChanges, rationale: String(values.get("rationale")).trim() };
        if (["MATCH_EVIDENCE", "ADJACENT_EQUIVALENCE"].includes(action)) {
          if (!criterion || !sourceEvidenceNodeIds.every((id) => sameCriterionNodes.some((node) => node.id === id)) || !candidateFactIds.length) throw new Error("Select one exact requirement and its supporting candidate facts.");
          payload.stableCriterionId = criterion.stable_criterion_id;
          payload.candidateFactVersionIds = candidateFactIds;
          if (action === "MATCH_EVIDENCE") {
            payload.evidenceRelation = relation;
            if (relation === "ADJACENT") payload.adjacentEquivalenceReviewId = choose("adjacentEquivalenceReviewId", adjacentReviews);
          } else {
            if (values.get("equivalentForCriterion") !== "on") throw new Error("Equivalent experience requires an explicit exact-requirement finding.");
            payload.comparedTasks = lines(values.get("comparedTasks")); payload.taskSimilarity = values.get("taskSimilarity");
            for (const name of ["complexity", "autonomy", "scope", "domainContext"]) payload[name] = String(values.get(name)).trim();
            payload.durationAndIntensity = { calendarMonths: Number(values.get("calendarMonths")), fteLowerMonths: Number(values.get("fteLowerMonths")), fteUpperMonths: Number(values.get("fteUpperMonths")), basis: values.get("durationBasis") };
            payload.essentialTools = lines(values.get("essentialTools")); payload.equivalentForCriterion = true;
          }
        } else if (action === "CATEGORICAL_USEFULNESS") {
          if (!candidateFactIds.length || values.get("certifiedNotQuotaFiller") !== "on") throw new Error("Select supporting candidate facts and make the no-padding finding explicitly.");
          const sections: EvidenceRow = {};
          for (const [key] of explanationSections) {
            const sourceIds = selected(`${key}Sources`, nodes.filter((node) => sourceEvidenceNodeIds.includes(evidenceText(node.id))));
            const factIds = selected(`${key}Facts`, facts.filter((fact) => candidateFactIds.includes(evidenceText(fact.id))));
            if (!sourceIds.length || ["whyMadeList", "howExperienceConnects"].includes(key) && !factIds.length) throw new Error("Each explanation needs cited employer evidence; fit and experience explanations also need confirmed candidate facts.");
            sections[key] = { sourceEvidenceNodeIds: sourceIds, candidateFactIds: factIds };
          }
          payload.explanationEvidence = sections;
          payload.applicationReadiness = values.get("applicationReadiness"); payload.presentationRisk = values.get("presentationRisk");
          payload.presentationRiskReasons = values.getAll("presentationRiskReasons");
          payload.reviewerWorthwhileReason = String(values.get("reviewerWorthwhileReason")).trim(); payload.certifiedNotQuotaFiller = true;
        } else if (action === "CUSTOMER_CRITERION") {
          const key = String(values.get("customerCriterionKey"));
          if (!activeKeys.includes(key)) throw new Error("Choose a customer requirement from the current calculated evidence.");
          payload.customerCriterionKey = key; payload.resolutionIssue = disposition === "REQUIRES_MORE_EVIDENCE" ? values.get("resolutionIssue") : "NONE";
          payload.unknownTreatment = allowOmission ? "ALLOW_EMPLOYER_UNKNOWN_WITH_WARNING" : "BLOCK";
          if (allowOmission) { payload.consentVersion = `${evidenceText(snapshot?.schema_version)}:${evidenceText(snapshot?.content_sha256)}`; payload.warning = String(values.get("warning")).trim(); }
        } else if (action === "COMPENSATION_COMPARABILITY") {
          const compensationNodeId = choose("compensationNodeId", nodes.filter((node) => node.criterion_type === "COMPENSATION"));
          if (!sourceEvidenceNodeIds.includes(compensationNodeId!)) throw new Error("Include the selected pay range in your cited employer evidence.");
          payload.selectedCompensationCriterionId = nodes.find((node) => node.id === compensationNodeId)?.stable_criterion_id;
          payload.correctLocationRange = values.get("correctLocationRange") === "yes"; payload.workerBasisComparable = values.get("workerBasisComparable") === "yes";
          if (values.get("conversionRequired") === "on") payload.conversion = { hoursPerWeek: Number(values.get("hoursPerWeek")), weeksPerYear: Number(values.get("weeksPerYear")), version: String(values.get("conversionVersion")).trim() };
        } else if (action === "PARSER_CORRECTION") { payload.inventoryMemberId = member?.id; payload.correctedListingText = String(values.get("correctedListingText")).trim(); }
      }
      onPrepare({ endpoint, payload, summary: `${researchActions.find(([key]) => key === action)?.[1]}${jobId ? `: ${evidenceText(job.exact_title)} at ${evidenceText(job.company)}` : ""}. ${evidenceText(payload.rationale || payload.prompt)}` });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Complete the current evidence review."); }
  }

  return <form onChange={(event) => {
    const changed = event.target;
    if (!(changed instanceof HTMLInputElement || changed instanceof HTMLSelectElement || changed instanceof HTMLTextAreaElement)) return;
    // A prior attestation cannot silently carry onto edited evidence.
    for (const name of ["reviewed", "certifiedNotQuotaFiller", "equivalentForCriterion"]) {
      const input = event.currentTarget.elements.namedItem(name);
      if (input instanceof HTMLInputElement && changed.name !== name
        && !["reviewed", "certifiedNotQuotaFiller", "equivalentForCriterion"].includes(changed.name)) input.checked = false;
    }
    if (changed.name !== "reviewed") {
      const input = event.currentTarget.elements.namedItem("reviewed");
      if (input instanceof HTMLInputElement) input.checked = false;
    }
  }} onSubmit={(event) => { event.preventDefault(); prepare(event.currentTarget); }}>
    {action === "BEGIN" ? <>
      <EvidenceChoices name="configurationIds" legend="Approved source configurations" items={evidenceRows(packet.sourceConfigurations)} label={(item) => `${evidenceText(item.config_version)} — maximum ${evidenceText(item.result_bound)} results`} />
      <label>Research round<select name="round" required defaultValue=""><option value="">Choose the next justified round</option>{[1, 2, 3].map((round) => <option key={round} value={round}>{round}</option>)}</select></label>
      <p>The server requires prior research evidence before a later round. Customer restrictions remain unchanged.</p>
    </> : action === "QUESTION" ? <>
      <EvidenceSelect name="nodeId" label="Employer requirement needing a candidate answer" items={nodes} itemLabel={(node) => evidenceText(node.source_excerpt)} />
      <ReviewText name="prompt" label="Question for the candidate" min={10} max={1000} />
    </> : action === "EVALUATE" ? <>
      <p>Choose completed reviews. The server calculates eligibility and scores; it does not approve or release a job. An initial evaluation can identify unresolved customer requirements for further review.</p>
      <EvidenceChoices name="evidenceReviewIds" legend="Current requirement evidence reviews" items={reviews.filter((review) => review.review_kind === "MATCH_EVIDENCE")} label={reviewLabel} />
      <EvidenceSelect name="usefulnessReviewId" label="Current suitability review" items={reviews.filter((review) => review.review_kind === "CATEGORICAL_USEFULNESS")} itemLabel={reviewLabel} />
      <EvidenceSelect name="compensationReviewId" label="Current compensation review, if needed" items={reviews.filter((review) => review.review_kind === "COMPENSATION_COMPARABILITY")} itemLabel={reviewLabel} optional />
    </> : <>
      <label>Review finding<select value={disposition} onChange={(event) => setDisposition(event.target.value)}><option value="REQUIRES_MORE_EVIDENCE">More evidence is needed</option><option value="RESOLVED_FAIL">Confirmed requirement not met</option><option value="RESOLVED_PASS">Confirmed requirement met</option></select></label>
      {["MATCH_EVIDENCE", "ADJACENT_EQUIVALENCE"].includes(action) ? <label>Exact employer requirement<select value={nodeId} required onChange={(event) => setNodeId(event.target.value)}><option value="">Choose the requirement</option>{nodes.map((node) => <option key={evidenceText(node.id)} value={evidenceText(node.id)}>{evidenceText(node.source_excerpt)}</option>)}</select></label> : null}
      <div key={nodeId}><EvidenceChoices name="sourceEvidenceNodeIds" legend="Employer evidence reviewed" items={["MATCH_EVIDENCE", "ADJACENT_EQUIVALENCE"].includes(action) ? sameCriterionNodes : nodes} label={(node) => evidenceText(node.source_excerpt)} />
      <EvidenceChoices name="candidateFactIds" legend="Confirmed candidate facts reviewed" items={facts} label={factLabel} /></div>
      {action === "MATCH_EVIDENCE" ? <>
        <label>How the evidence supports the requirement<select value={relation} onChange={(event) => setRelation(event.target.value)}><option value="DIRECT">Direct evidence of this requirement</option><option value="ADJACENT">Equivalent experience reviewed separately</option><option value="TRANSFERABLE">Transferable experience, without an equivalence claim</option><option value="UNSUPPORTED">No supporting evidence</option></select></label>
        {relation === "ADJACENT" ? <EvidenceSelect name="adjacentEquivalenceReviewId" label="Exact equivalent-experience review" items={adjacentReviews} itemLabel={reviewLabel} /> : null}
      </> : null}
      {action === "CATEGORICAL_USEFULNESS" ? <>
        <p>Each explanation must cite the exact employer evidence and candidate facts selected above. Nothing is preselected.</p>
        {explanationSections.map(([key, label]) => <details key={key}><summary>{label}</summary><EvidenceChoices name={`${key}Sources`} legend={`${label}: employer evidence`} items={nodes} label={(node) => evidenceText(node.source_excerpt)} /><EvidenceChoices name={`${key}Facts`} legend={`${label}: candidate facts`} items={facts} label={factLabel} /></details>)}
        <label>Application readiness<select name="applicationReadiness" required defaultValue=""><option value="">Choose after review</option><option value="READY">Ready to apply</option><option value="NEEDS_CUSTOMER_ACTION">Customer action needed</option><option value="BLOCKED">Application blocked</option></select></label>
        <label>Presentation risk<select name="presentationRisk" required defaultValue=""><option value="">Choose after review</option>{["LOW", "MEDIUM", "HIGH", "NOT_ASSESSED"].map((value) => <option key={value} value={value}>{human(value)}</option>)}</select></label>
        <fieldset><legend>Presentation issues found</legend>{["CONTACT_DETAIL_CONFIRMATION", "FORMAT_REPAIR", "CLAIM_WORDING_REVIEW", "APPLICATION_QUESTION_REVIEW"].map((value) => <label key={value}><input type="checkbox" name="presentationRiskReasons" value={value} />{human(value)}</label>)}</fieldset>
        <ReviewText name="reviewerWorthwhileReason" label="Why this opportunity is worth applying to" min={10} max={2000} />
        <label><input name="certifiedNotQuotaFiller" type="checkbox" required />I independently reviewed this opportunity and confirm it is not filler to reach ten jobs.</label>
      </> : null}
      {action === "CUSTOMER_CRITERION" ? <>
        <label>Customer requirement<select name="customerCriterionKey" required defaultValue=""><option value="">Choose a current calculated requirement</option>{activeKeys.map((key) => <option key={key} value={key}>{human(key.replace(/^customer:/, ""))}</option>)}</select></label>
        {!activeKeys.length ? <p>Calculate the match first to identify its active customer requirements, then refresh this review packet.</p> : null}
        {disposition === "REQUIRES_MORE_EVIDENCE" ? <label>Why the requirement is unresolved<select name="resolutionIssue" required defaultValue=""><option value="">Choose the actual evidence issue</option><option value="EMPLOYER_OMITTED">Employer omitted this information</option><option value="PARSER_UNCERTAIN">Captured text is unclear</option><option value="EVIDENCE_CONFLICT">Evidence conflicts</option></select></label> : null}
        <label><input type="checkbox" checked={allowOmission} onChange={(event) => setAllowOmission(event.target.checked)} />The customer&apos;s exact saved criteria permit this employer omission with a warning.</label>
        {allowOmission ? <ReviewText name="warning" label="Warning the customer must see" min={3} max={500} /> : null}
        <p>The server checks the exact saved consent. This cannot waive a customer restriction.</p>
      </> : null}
      {action === "COMPENSATION_COMPARABILITY" ? <>
        <EvidenceSelect name="compensationNodeId" label="Published compensation range being compared" items={nodes.filter((node) => node.criterion_type === "COMPENSATION")} itemLabel={(node) => evidenceText(node.source_excerpt)} />
        {[["correctLocationRange", "Is this the correct range for the candidate's location?"], ["workerBasisComparable", "Is the employment and pay basis comparable?"]].map(([name, label]) => <label key={name}>{label}<select name={name} required defaultValue=""><option value="">Choose a finding</option><option value="yes">Yes, supported by evidence</option><option value="no">No</option></select></label>)}
        <label><input name="conversionRequired" type="checkbox" />A documented hourly or annual conversion is required.</label>
        <label>Conversion hours per week<input name="hoursPerWeek" type="number" min="0.01" step="0.01" /></label><label>Conversion weeks per year<input name="weeksPerYear" type="number" min="0.01" step="0.01" /></label><label>Conversion basis or approved version<input name="conversionVersion" maxLength={100} /></label>
      </> : null}
      {action === "ADJACENT_EQUIVALENCE" ? <>
        <ReviewText name="comparedTasks" label="Tasks compared, one per line" min={1} max={4000} />
        <label>Task similarity<select name="taskSimilarity" required defaultValue=""><option value="">Choose only after comparison</option><option value="STRONG">Strong similarity supported by evidence</option></select></label>
        {[["complexity", "Complexity comparison"], ["autonomy", "Autonomy comparison"], ["scope", "Scope comparison"], ["domainContext", "Industry and work context comparison"]].map(([name, label]) => <ReviewText key={name} name={name} label={label} min={1} max={1000} />)}
        <label>Calendar months supported<input name="calendarMonths" type="number" min={0} step={1} required /></label><label>Equivalent full-time months, lower bound<input name="fteLowerMonths" type="number" min={0} step="0.01" required /></label><label>Equivalent full-time months, upper bound<input name="fteUpperMonths" type="number" min={0} step="0.01" required /></label>
        <label>Duration basis<select name="durationBasis" required defaultValue=""><option value="">Choose the supported basis</option><option value="CALENDAR">Calendar duration</option><option value="FTE">Full-time equivalent</option><option value="EMPLOYER_EXPLICIT_OTHER">Other basis expressly required by employer</option></select></label>
        <ReviewText name="essentialTools" label="Essential tools compared, one per line" min={1} max={4000} />
        <label><input type="checkbox" name="equivalentForCriterion" required />These exact candidate facts establish equivalence for this exact employer requirement.</label>
        <p>If equivalence is not established, record the requirement as unresolved or unsupported in an evidence review.</p>
      </> : null}
      {action === "PARSER_CORRECTION" ? <ReviewText name="correctedListingText" label="Corrected exact listing text" min={1} max={100000} /> : null}
      <ReviewText name="evidenceChanges" label="Evidence findings or changes, one per line" min={3} max={25000} />
      <ReviewText name="rationale" label="Your review rationale" min={10} max={4000} />
    </>}
    <label><input type="checkbox" name="reviewed" required />I reviewed these choices and supporting evidence. Nothing is approved automatically.</label>
    <button type="submit">Prepare reviewed operation</button>
    <p role="alert">{error}</p>
  </form>;
}

function ReviewText({ name, label, min, max }: { name: string; label: string; min: number; max: number }) {
  return <label>{label}<textarea name={name} required minLength={min} maxLength={max} /></label>;
}
function EvidenceSelect({ name, label, items, itemLabel, optional = false }: { name: string; label: string; items: EvidenceRow[]; itemLabel: (item: EvidenceRow) => string; optional?: boolean }) {
  return <label>{label}<select name={name} required={!optional} defaultValue=""><option value="">{optional ? "No review selected" : "Choose a current record"}</option>{items.map((item) => <option key={evidenceText(item.id)} value={evidenceText(item.id)}>{itemLabel(item)}</option>)}</select></label>;
}
function EvidenceChoices({ name, legend, items, label }: { name: string; legend: string; items: EvidenceRow[]; label: (item: EvidenceRow) => string }) {
  return <fieldset><legend>{legend}</legend>{items.length ? items.map((item) => <label key={evidenceText(item.id)}><input type="checkbox" name={name} value={evidenceText(item.id)} />{label(item)}</label>) : <p>No current evidence is available in this group.</p>}</fieldset>;
}
function factLabel(fact: EvidenceRow) {
  const value = fact.customer_display_value;
  return `${evidenceText(fact.customer_display_label) || human(fact.semantic_key)}${typeof value === "string" || typeof value === "number" ? `: ${value}` : evidenceText(evidenceRecord(value).summary) ? `: ${evidenceText(evidenceRecord(value).summary)}` : ""}`;
}

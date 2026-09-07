import { notFound } from "next/navigation";
import { Chunk5MaterialStaffQueue, type MaterialStaffLine } from "@/components/admin/chunk5-material-staff-queue";
import { CheckoutStatus } from "@/components/commerce/checkout-status";
import { ApplyPackSelector, type MatchForSelection } from "@/components/portal/apply-pack-selector-v2";
import { MaterialDeliveries, type MaterialDeliveryView } from "@/components/portal/material-deliveries";
import { ReferenceManager } from "@/components/portal/reference-manager";
import { SearchOrderProgress } from "@/components/portal/search-order-progress";

const orderId = "25000000-0000-4000-8000-000000000501";
const releaseId = "35000000-0000-4000-8000-000000000501";
const snapshotId = "45000000-0000-4000-8000-000000000501";
const lineId = "55000000-0000-4000-8000-000000000501";
const jobSnapshotId = "65000000-0000-4000-8000-000000000501";
const dueAt = "2026-09-08T18:30:00.000Z";

export default async function Chunk5EvidencePage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (process.env.NODE_ENV === "production" || process.env.APP_E2E_FIXTURE_MODE !== "true") notFound();
  const state = (await searchParams).state || "selection";
  if (state === "payment") return <CheckoutStatus fixtureStatus={{ state: "CONFIRMING_PAYMENT" }} />;

  return <main id="main-content" className="portal-page">
    <div className="page-frame">
      <section className="portal-hero">
        <div><p className="eyebrow eyebrow--light">CHUNK 5 SYNTHETIC EVIDENCE</p><h1>{titleFor(state)}</h1></div>
        <p>This isolated fixture renders production components with synthetic records. It makes no provider call and contains no customer data.</p>
      </section>
      {state === "selection" ? <ApplyPackSelector
        matches={deliveredMatches()}
        evaluatedAt="2026-09-07T16:00:00.000Z"
        deliveredOrderId={orderId}
        deliveredReleaseId={releaseId}
        sourceSnapshotId={snapshotId}
        initialEmail="synthetic@example.invalid"
      /> : null}
      {state === "pending" ? <SearchOrderProgress searches={[{
        orderId,
        stateLabel: "Researching",
        stateMessage: "Payment and capacity are verified. Current listings are being researched and checked before human review.",
        dueAt,
        refundState: "NONE",
        adjustment: null,
      }]} /> : null}
      {state === "references" ? <ReferenceManager
        detectedReferenceCount={2}
        deliveredJobs={[{
          deliveredReleaseId: releaseId,
          jobSnapshotId,
          employer: "Synthetic Employer 1",
          exactPosition: "Operations Coordinator",
        }]}
      /> : null}
      {state === "staff" ? <Chunk5MaterialStaffQueue lines={[staffLine()]} /> : null}
      {!["selection", "references", "staff", "pending"].includes(state)
        ? <MaterialDeliveries lines={[materialLine(state)]} /> : null}
    </div>
  </main>;
}

function titleFor(state: string) {
  const titles: Record<string, string> = {
    selection: "Choose tailored document sets",
    pending: "Your search is in progress",
    payment: "Confirm payment before work starts",
    generating: "Generate and review every selected file",
    "expired-download": "Sign in again for a fresh download",
    delivered: "Review and download your files",
    substitution: "Choose a substitute or refund",
    correction: "Confirm a factual correction or refund",
    refund: "Track the required line refund",
    references: "Control exact-job reference permission",
    staff: "Review the guarded materials queue",
  };
  return titles[state] || "Tailored document status";
}

function deliveredMatches(): MatchForSelection[] {
  const roles = [
    "Operations Coordinator", "Customer Success Specialist", "Implementation Coordinator",
    "Quality Analyst", "Project Coordinator", "Support Operations Associate",
    "Reporting Specialist", "Knowledge Base Coordinator", "Client Onboarding Specialist", "Workflow Analyst",
  ];
  return roles.map((title, index) => ({
    id: `75000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    position: index + 1,
    fit_summary: "Every confirmed hard gate passed, and the reviewed responsibilities align with the requested work.",
    matching_experience: ["Prepared accurate reports", "Coordinated cross-team follow-up"],
    primary_outcome: "Keep customer-facing operations accurate and on schedule.",
    core_responsibilities: ["Maintain workflow records", "Resolve operational questions", "Report service trends"],
    requirements: ["Two years of related experience", "Spreadsheet proficiency"],
    hidden_job_functions: ["Document recurring issues for process improvement"],
    concerns: [],
    release_explanation: {
      whatJobInvolves: "Maintain workflow records, answer operational questions, and report service trends.",
      whyMadeList: "Every confirmed hard gate passed and the role overlaps the requested work activities.",
      howExperienceConnects: "Confirmed reporting and coordination facts support the listed responsibilities.",
      whatMayBeNew: "The employer's internal ticketing system may require onboarding.",
      whatToKnow: index === 2
        ? "Compensation was not published; the intake expressly allows that unknown with this warning."
        : "Use the verified employer-hosted application path shown below.",
    },
    allowed_unknown_warnings: index === 2 ? ["UNPUBLISHED_PAY"] : [],
    source_provenance: { applicationHostType: "EMPLOYER_HOSTED" },
    compensation_status: index === 2 ? "UNPUBLISHED_ALLOWED" : "PUBLISHED_MEETS_MINIMUM",
    posted_on: index % 3 === 0 ? null : "2026-09-05",
    posted_date_unknown: index % 3 === 0,
    last_checked_at: "2026-09-07T15:45:00.000Z",
    job_snapshot_id: index === 0 ? jobSnapshotId : `76000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    submission_rule_id: `77000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    reference_timing: index === 4 ? "PROHIBITED_NOW" : index === 5 ? "REQUIRED_NOW" : "OPTIONAL_NOW",
    reference_count: index === 5 ? 5 : 3,
    job: {
      company: `Synthetic Employer ${index + 1}`,
      title,
      source_url: `https://example.invalid/jobs/${index + 1}`,
      official_application_url: `https://careers.example.invalid/apply/${index + 1}`,
      source_name: "Reviewed employer source",
      source_category: "employer_career_site",
      location_text: index % 2 ? "United States" : "Richmond, VA",
      salary_text: index === 2 ? null : "$72,000–$84,000 annual base pay",
      checked_at: "2026-09-07T15:45:00.000Z",
      listing_status: index === 9 ? "closed" : "open",
      employment_type: "full_time",
      w2_or_contractor: index === 7 ? "contractor" : "w2",
      work_mode: index % 2 ? "remote" : "hybrid",
      remote_scope: index % 2 ? "United States" : null,
      eligible_states: index % 2 ? ["VA", "MD", "DC"] : null,
      eligible_countries: ["US"],
      timezone_requirement: "Eastern or Central business hours",
      schedule_type: "standard_business_hours",
      pay_model: "base_salary",
      phone_intensity: index === 6 ? "medium" : "low",
      equipment_cost_responsibility: "employer",
      benefits_status: index === 7 ? "not_published" : "published",
      experience_level: "associate",
      is_active: index !== 9,
      review_status: "approved",
      rejection_reason: null,
    },
  }));
}

function materialLine(state: string): MaterialDeliveryView {
  const base: MaterialDeliveryView = {
    lineId,
    company: "Synthetic Employer 1",
    title: "Operations Coordinator",
    jobSnapshotId,
    stateLabel: "Delivered",
    stateMessage: "The resume and cover letter passed automated checks plus separate content and visual approval.",
    dueAt,
    refundState: "NONE",
    proposal: null,
    regeneration: null,
    artifacts: [
      artifact("85000000-0000-4000-8000-000000000501", "RESUME", "Jamie_Rivera_Resume_Synthetic_Employer_1_Operations_Coordinator_Richmond_VA.docx", "a"),
      artifact("85000000-0000-4000-8000-000000000502", "COVER_LETTER", "Jamie_Rivera_Cover_Letter_Synthetic_Employer_1_Operations_Coordinator_Richmond_VA.docx", "b"),
      artifact("85000000-0000-4000-8000-000000000503", "REFERENCE_SHEET", "Jamie_Rivera_References_Synthetic_Employer_1_Operations_Coordinator_Richmond_VA.docx", "c"),
    ],
  };
  if (state === "generating") return {
    ...base,
    stateLabel: "Generating and reviewing",
    stateMessage: "No file is visible until structural, provenance, malware, render, content, and visual checks all pass.",
    artifacts: [],
  };
  if (state === "expired-download") return {
    ...base,
    stateLabel: "Delivered: fresh sign-in required",
    stateMessage: "The prior 15-minute link expired. The purchased files remain available after fresh reauthentication and ownership checks.",
  };
  if (state === "substitution") return {
    ...base,
    stateLabel: "Your choice is needed",
    stateMessage: "The original listing closed before generation. No replacement was made silently.",
    artifacts: [],
    proposal: {
      id: "95000000-0000-4000-8000-000000000501",
      kind: "SUBSTITUTION",
      reasonCode: "LISTING_CLOSED_BEFORE_GENERATION",
      expiresAt: "2026-09-08T15:00:00.000Z",
      targetJobSnapshotId: "65000000-0000-4000-8000-000000000502",
      targetCompany: "Synthetic Replacement Employer",
      targetTitle: "Client Operations Coordinator",
      factDiff: null,
    },
  };
  if (state === "correction") return {
    ...base,
    stateLabel: "Confirm your corrected facts",
    stateMessage: "A customer-supplied fact changed before release; the original snapshot remains immutable.",
    artifacts: [],
    proposal: {
      id: "95000000-0000-4000-8000-000000000502",
      kind: "FACT_CORRECTION",
      reasonCode: "CUSTOMER_FACT_CORRECTION",
      expiresAt: "2026-09-08T15:00:00.000Z",
      targetJobSnapshotId: null,
      targetCompany: null,
      targetTitle: null,
      factDiff: { employment_dates: "Updated from protected customer confirmation", city_and_state: "Richmond, VA" },
    },
  };
  if (state === "refund") return {
    ...base,
    stateLabel: "Refund processing",
    stateMessage: "Work stopped. The required full $8 line refund is being confirmed.",
    dueAt: null,
    refundState: "PENDING",
    artifacts: [],
  };
  return base;
}

function artifact(id: string, type: "RESUME" | "COVER_LETTER" | "REFERENCE_SHEET", filename: string, hash: string) {
  return {
    id, type, version: 1, filename, checksum: hash.repeat(64),
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    createdAt: "2026-09-07T17:30:00.000Z", downloadsRevokedAt: null, supersededAt: null,
  };
}

function staffLine(): MaterialStaffLine {
  return {
    lineId,
    fulfillment: "HUMAN_REVIEW",
    substitution: "NONE",
    dueAt,
    activeRevision: 1,
    revisionId: "c5000000-0000-4000-8000-000000000501",
    jobSnapshotId,
    sourceSnapshotId: snapshotId,
    company: "Synthetic Employer 1",
    title: "Operations Coordinator",
    submissionRuleId: "d5000000-0000-4000-8000-000000000501",
    ruleSha256: "d".repeat(64),
    generationCheckAt: "2026-09-07T17:00:00.000Z",
    releaseCheckAt: null,
    files: [{
      artifactType: "RESUME",
      fileVersionId: "f5000000-0000-4000-8000-000000000501",
      version: 1,
      filename: "Jamie_Rivera_Resume_Synthetic_Employer_1_Operations_Coordinator_Richmond_VA.docx",
      automatedPassed: true,
      contentApproved: false,
      visualApproved: false,
      rendererIdentity: "fixture-renderer-v1",
      arialResolved: true,
    }],
    openProposalKind: null,
    openSupportCases: 0,
    regeneration: null,
  };
}

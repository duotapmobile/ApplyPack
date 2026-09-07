import { notFound } from "next/navigation";
import { CheckoutStatus, type CheckoutStatusResponse } from "@/components/commerce/checkout-status";
import { ApplyPackSelector, type MatchForSelection } from "@/components/portal/apply-pack-selector-v2";
import { SearchOrderProgress, type SearchOrderProgressView } from "@/components/portal/search-order-progress";

const orderId = "94000000-0000-4000-8000-000000000401";
const dueAt = "2026-11-02T18:00:00.000Z";

export default async function Chunk4EvidencePage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (process.env.NODE_ENV === "production" || process.env.APP_E2E_FIXTURE_MODE !== "true") notFound();
  const state = (await searchParams).state || "confirming";
  const checkoutStates: Record<string, CheckoutStatusResponse> = {
    confirming: { state: "CONFIRMING_PAYMENT" },
    "capacity-exception": { state: "CAPACITY_EXCEPTION" },
    started: { state: "SEARCH_ACTIVE", orderId, deliveryDueAt: dueAt },
  };
  if (checkoutStates[state]) return <CheckoutStatus fixtureStatus={checkoutStates[state]} />;

  const searches: SearchOrderProgressView[] = state === "adjustment" ? [adjustmentSearch()]
    : state === "refund-processing" ? [refundSearch()]
      : [deliveredSearch()];
  return <main id="main-content" className="portal-page">
    <div className="page-frame">
      <section className="portal-hero">
        <div><p className="eyebrow eyebrow--light">MY APPLYPACK</p><h1>{state === "delivered" ? "Your 10 verified matches" : "Your search status"}</h1></div>
        <p>This isolated synthetic fixture renders the production components without customer data, credentials, or provider calls.</p>
      </section>
      <SearchOrderProgress searches={searches} />
      {state === "delivered" ? <ApplyPackSelector matches={deliveredMatches()} evaluatedAt="2026-11-02T17:45:00.000Z" /> : null}
    </div>
  </main>;
}

function adjustmentSearch(): SearchOrderProgressView {
  return {
    orderId,
    stateLabel: "Your input is needed",
    stateMessage: "Seven current listings satisfy every active gate. No partial list has been delivered.",
    dueAt,
    refundState: "NONE",
    adjustment: {
      id: "95000000-0000-4000-8000-000000000401",
      state: "PROPOSED",
      currentValidCount: 7,
      reasonCodes: ["INVENTORY_SHORTAGE", "COMPENSATION_UNCONFIRMED"],
      blockingConstraints: { salaryHardMinimum: "$70,000 annual", workMode: "Remote only", unpublishedPay: "Excluded" },
      criteriaDiff: {
        salaryUnpublishedPolicy: { before: "Exclude", after: "Include with a clear warning" },
        workModes: { before: ["Remote"], after: ["Remote", "Hybrid"] },
      },
      proposedSnapshotPatch: {},
      proposalExpiresAt: "2026-11-02T16:30:00.000Z",
      estimatedDueAt: "2026-11-03T15:00:00.000Z",
      revisionDueAt: null,
    },
  };
}

function refundSearch(): SearchOrderProgressView {
  return {
    orderId,
    stateLabel: "Refund processing",
    stateMessage: "No exact-ten release was made before the active deadline. Work is stopped while the required full refund is confirmed.",
    dueAt,
    refundState: "PENDING",
    adjustment: null,
  };
}

function deliveredSearch(): SearchOrderProgressView {
  return {
    orderId,
    stateLabel: "Delivered",
    stateMessage: "The immutable exact-ten release passed current listing verification and human review.",
    dueAt,
    refundState: "NONE",
    adjustment: null,
  };
}

function deliveredMatches(): MatchForSelection[] {
  const roles = ["Operations Analyst", "Customer Success Specialist", "Implementation Coordinator", "Quality Analyst", "Project Coordinator", "Support Operations Associate", "Reporting Specialist", "Knowledge Base Coordinator", "Client Onboarding Specialist", "Workflow Analyst"];
  return roles.map((title, index) => ({
    id: `96000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    position: index + 1,
    fit_summary: "The verified responsibilities align with the candidate's confirmed reporting, coordination, and customer-support experience.",
    matching_experience: ["Prepared operational reports", "Coordinated cross-team follow-up"],
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
      whatToKnow: index === 2 ? "Compensation was not published; the intake expressly allows that unknown with this warning." : "Use the verified employer-hosted application path shown below.",
    },
    allowed_unknown_warnings: index === 2 ? ["Compensation was not published. Verify pay before investing substantial application time."] : [],
    source_provenance: { applicationHostType: "Employer hosted", sourceAuthorizationVersion: "source-auth-v1" },
    compensation_status: index === 2 ? "Unpublished allowed with warning" : "Published range meets minimum",
    posted_on: index % 3 === 0 ? null : "2026-10-29",
    posted_date_unknown: index % 3 === 0,
    last_checked_at: "2026-11-02T17:45:00.000Z",
    job: {
      company: `Synthetic Employer ${index + 1}`,
      title,
      source_url: `https://example.invalid/jobs/${index + 1}`,
      official_application_url: `https://careers.example.invalid/apply/${index + 1}`,
      source_name: "Manual reviewed source",
      source_category: "Employer career site",
      location_text: index % 2 ? "United States" : "New York, NY",
      salary_text: index === 2 ? null : "$72,000–$84,000 annual base pay",
      checked_at: "2026-11-02T17:45:00.000Z",
      listing_status: "open",
      employment_type: "full_time",
      w2_or_contractor: "w2",
      work_mode: index % 2 ? "remote" : "hybrid",
      remote_scope: index % 2 ? "United States, excluding Alaska and Hawaii" : null,
      eligible_states: index % 2 ? ["NY", "NJ", "PA"] : null,
      eligible_countries: ["US"],
      timezone_requirement: "Eastern or Central business hours",
      schedule_type: "standard_business_hours",
      pay_model: "base_salary",
      phone_intensity: "low",
      equipment_cost_responsibility: "employer",
      benefits_status: "published",
      experience_level: "associate",
      is_active: true,
      review_status: "approved",
      rejection_reason: null,
    },
  }));
}

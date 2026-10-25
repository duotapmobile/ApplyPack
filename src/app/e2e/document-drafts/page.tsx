import { notFound } from "next/navigation";
import { DraftOwnerWorkspace } from "@/components/admin/draft-owner-workspace";
import type { DraftEvidenceRecovery, DraftOwnerDetail } from "@/lib/documents/draft-owner-view";

const id = (n: number) => `78000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = (letter: string) => letter.repeat(64);

/** Development-only, synthetic component acceptance. No private reader, staff
 * authentication bypass, provider client, or production fixture route exists. */
export default async function DocumentDraftEvidencePage({ searchParams }: { searchParams: Promise<{ state?: string; at?: string }> }) {
  if (process.env.NODE_ENV === "production" || process.env.APP_E2E_FIXTURE_MODE !== "true") notFound();
  const params = await searchParams, state = params.state ?? "wording";
  const now = params.at && /^\d{13}$/.test(params.at) ? Number(params.at) : Date.parse("2026-10-25T12:00:00Z"), loadedAt = new Date(now).toISOString();
  const fresh = new Date(now - 5 * 60_000).toISOString(), old = new Date(now - 2 * 3_600_000).toISOString();
  const instructions = { checkedAt: fresh, resumeRequirement: "REQUIRED", letterRequirement: "OPTIONAL", resumeFilename: "Resume.pdf", letterFilename: null,
    referenceTiming: "LATER_OR_UNKNOWN", referenceCount: null, formats: ["PDF"], resumePageLimit: 1, letterPageLimit: 1 };
  const question = { id: id(70), prompt: "Describe how you prioritize competing requests.", required: true, wordLimit: null, characterLimit: null };
  let detail: DraftOwnerDetail;
  if (state === "recovery") {
    const recovery: DraftEvidenceRecovery = { jobId: id(1), expectedVersionId: id(2), expectedPacketSha256: sha("a"), basisIdentity: sha("b"), company: "Synthetic employer", title: "Office assistant", applicationUrl: "https://example.invalid/apply",
      basis: { lineRevisionId: id(4), sourceSnapshotId: id(5), jobSnapshotId: id(8), jobContentSha256: sha("c"), ruleId: id(9), ruleSha256: sha("d"), ruleRecordSha256: sha("e"), sourceAuthoritySha256: sha("f") },
      instructions: { ...instructions, checkedAt: old }, originalCheckedAt: old, effectiveCheckedAt: old, ruleCurrent: false, currentContextSha256: null, latestReceiptId: null, canRefresh: false,
      questions: { status: "OBSERVED", verification: "BOUND_SOURCE_EVIDENCE", comparisonAvailable: true, items: [question] } };
    detail = { status: "REFRESH_REQUIRED", jobId: id(1), message: "Review the saved employer evidence before any explicit recovery action.", recovery };
  } else {
    const complete = state === "approve" || state === "send";
    detail = { status: "AVAILABLE", jobId: id(1), state: state === "send" ? "APPROVED" : complete ? "REVIEW_READY" : "SOURCE_READY", versionId: id(2), version: 2, lineId: id(3), revisionId: id(4),
      packetSha256: sha("a"), sourceSha256: sha("b"), ruleSha256: sha("d"), memberSetSha256: complete ? sha("c") : null, approvalSha256: state === "send" ? sha("e") : null,
      dueAt: new Date(now + 86_400_000).toISOString(), validUntil: new Date(now + 3_000_000).toISOString(), kind: "RENDER_SOURCE", company: "Synthetic employer", title: "Office assistant", applicationUrl: "https://example.invalid/apply",
      documents: [{ title: "Resume", sections: [{ heading: "Community experience", lines: [{ text: "Organized schedules for community activities.", claimId: id(20), bullet: true }] }] },
        { title: "Cover letter", sections: [{ heading: "Relevant experience", lines: [{ text: "I gained experience organizing community event schedules.", claimId: id(21), bullet: false }] }] }],
      claims: [{ id: id(20), wordingSha256: sha("1"), text: "Organized schedules for community activities.", placement: "Resume experience", qualification: "Confirmed volunteer experience", sources: [{ label: "Confirmed responsibilities", value: "Organized event schedules" }], jobEvidence: ["Organize office records"], questionIds: [id(70)] },
        { id: id(21), wordingSha256: sha("2"), text: "I gained experience organizing community event schedules.", placement: "Cover letter", qualification: "Volunteer work; no employment invented", sources: [{ label: "Confirmed role", value: "Volunteer coordinator" }], jobEvidence: [], questionIds: [] }],
      facts: [{ id: id(30), label: "Volunteer coordinator", disposition: "CONFIRMED_SOURCE_NOT_APPROVED_PROSE", fields: [{ label: "Organization", value: "Synthetic community center" }, { label: "Dates", value: "2024–2025 (year precision)" }], provenance: { kind: "CUSTOMER_ASSERTION", verification: "CUSTOMER_CONFIRMED", locator: "Guided background", confirmedAt: fresh, document: null } }],
      instructions: { emphasis: "Organization and helpful communication", doNotMention: "", saved: instructions },
      questions: { status: "OBSERVED", verification: "BOUND_SOURCE_EVIDENCE", issues: [], items: [{ ...question, sourceUrl: "https://example.invalid/apply", observedAt: fresh, eligible: true }] },
      requiredFileTypes: ["RESUME", "COVER_LETTER"], files: complete ? ["RESUME", "COVER_LETTER"].map((type, index) => ({ type, filename: `${type}.pdf`, fileVersionId: id(40 + index), checksumSha256: sha(String(index + 3)), previewUrl: `https://example.invalid/preview/${index}` })) : [],
      wordingReviewed: complete, canPromote: false, canReviewWording: !complete, canApprove: state === "approve", canSend: state === "send" };
  }
  return <main id="main-content" className="portal-page"><div className="page-frame"><header><p className="eyebrow">Synthetic component evidence</p><h1>Owner document review</h1>
    <p>This development fixture uses synthetic records only. Browser tests intercept action requests; it is not hosted payment, delivery or administrator-access proof.</p></header>
    <DraftOwnerWorkspace loadedAt={loadedAt} detail={detail} queue={{ status: "AVAILABLE", nextCursor: null, jobs: [{ id: id(1), shortId: "SYNTHETIC", state: detail.status === "AVAILABLE" ? detail.state : "OWNER_EXCEPTION", errorCode: null, updatedAt: loadedAt, versionId: id(2) }] }} />
  </div></main>;
}

// Explicit native-only LOCAL_DOC journey with fictional external inputs and actual local rendering.
// New-scenario ceilings: 600s test/660s child/690s outer; no AWS, approval, Send or hosted proof.
import { isAbsolute } from "node:path";
import { afterEach, expect, it } from "vitest";
import { z } from "zod";
import { cleanupVerifiedPaidSearch, setupVerifiedPaidSearch } from "./verified-paid-search-setup";
import { employerQuestionSourceFixture } from "./employer-question-source-fixture";
import { verifyEmployerRuleOwnerJourney } from "./verified-employer-rule-owner-setup";
import { setupVerifiedPaidPack } from "./verified-paid-pack-setup";
import { setupVerifiedPaidPackPacket } from "./verified-paid-pack-packet-setup";
import { setupVerifiedPaidPackSource } from "./verified-paid-pack-source-setup";
import { setupVerifiedPaidPackLocalDocuments } from "./verified-paid-pack-local-doc-setup";

afterEach(cleanupVerifiedPaidSearch);

it("continues the same paid question-informed proposal through simulated owner wording review and actual local documents", async () => {
  const durationsMs: Record<string, number> = {};
  let completed = false, activePhase: string | null = null;
  const journeyStarted = performance.now();
  const timed = async <T>(name: string, work: () => Promise<T>) => {
    const started = performance.now(); activePhase = name;
    let phaseCompleted = false;
    try { const result = await work(); phaseCompleted = true; return result; }
    finally {
      durationsMs[name] = Math.round(performance.now() - started);
      process.stdout.write("PACK_LOCAL_DOC_PARENT_PHASE_TIMING " + JSON.stringify({ phase: name, completed: phaseCompleted, elapsedMs: durationsMs[name] }) + "\n");
    }
  };
  try {
    const evidenceDirectory = z.string().min(1).refine(isAbsolute).parse(process.env.AP_RESEARCH_LOCAL_DOC_EVIDENCE_DIRECTORY);
    const localRendererIdentity = z.string().regex(/^[A-Za-z0-9._-]*local-qa[A-Za-z0-9._-]*$/).parse(process.env.AP_RESEARCH_LOCAL_DOC_RENDERER_IDENTITY);
    const fixture = employerQuestionSourceFixture();
    const graph = await timed("search", () => setupVerifiedPaidSearch({ sourceFixture: fixture.sourceFixture }));
    const owner = await timed("owner", () => verifyEmployerRuleOwnerJourney(graph, fixture));
    expect(graph.intake.answers.noPriorEmployment).toBe(true);
    const contact = { displayName: graph.intake.answers.fullName, email: z.email().parse(graph.intake.answers.documentContactEmail),
      phone: "+1 202-555-0142", cityState: "Richmond, VA" }; // Explicit fictional customer entries.
    const pack = await timed("pack", () => setupVerifiedPaidPack(graph, owner, {
      contact, keepExistingTimeline: true, omitCareerBreakFromCoverLetter: true, noReferencesSelected: true,
      documentContactConfirmed: true, documentFactsConfirmed: true, noAutoApplyAcknowledged: true, outcomesAcknowledged: true,
    }));
    const originalDueAt = z.iso.datetime({ offset: true }).parse(pack.revision.due_at);
    const prepared = await timed("packet", () => setupVerifiedPaidPackPacket(pack));
    expect(pack.line.allocated_amount_cents).toBe(799); expect(pack.state.lines).toHaveLength(1);
    expect(prepared.packet.binding).toMatchObject({ snapshotId: graph.intake.snapshotId,
      jobSnapshotId: owner.jobSnapshotId, ruleId: owner.ruleId, dueAt: originalDueAt });
    expect(prepared.packet.employerQuestionInsights.questions.map(question => question.id)).toEqual(owner.insights.questions.map(question => question.id));
    expect(prepared.packet.employerQuestionInsights.questions.map(question => question.prompt)).toEqual(fixture.questions.map(question => question.label));
    expect(prepared.packet.approvalState).toBe("UNREVIEWED"); expect(prepared.packet.providerTransferAuthorized).toBe(false);
    const source = await timed("sourceAndOwnerViewWithTeardown", () => setupVerifiedPaidPackSource(prepared));
    expect(source.generated).toMatchObject({ status: "SOURCE_READY", versionId: prepared.version.id, reconciled: false });
    expect(source.source.state).toBe("OWNER_REVIEW_REQUIRED");
    expect(source.source.output.resume.sections).toEqual([]); expect(source.source.output.resume.educationFactIds).toEqual([]);
    expect(source.detail).toMatchObject({ status: "AVAILABLE", kind: "PROPOSAL", state: "SOURCE_READY",
      dueAt: originalDueAt, files: [], wordingReviewed: false, canReviewWording: false, canApprove: false, canSend: false });
    expect(source.fixture.requests).toHaveLength(2);

    const documents = await timed("ownerWordingAndActualLocalDocuments", () => setupVerifiedPaidPackLocalDocuments(source, {
      evidenceDirectory, localRendererIdentity,
    }));
    expect(documents).toMatchObject({ jobId: pack.job.id, lineId: pack.line.id, revisionId: pack.revision.id,
      packetSha256: prepared.packet.packetSha256, proposalSourceSha256: source.generated.sourceSha256,
      originalDueAt, rendererIdentity: localRendererIdentity, renderingBoundary: "LOCAL_QA",
      simulatedOwnerDecisions: true, humanAcceptance: false, registeredFiles: 0, approvedPairs: 0,
      customerDeliveries: 0, realProviderCalls: 0, hostedProof: false });
    expect(documents.versionId).not.toBe(prepared.version.id);
    expect(documents.renderSourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(documents.reviewSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(documents.files.map(file => ({ type: file.type, format: file.format, filename: file.filename }))).toEqual([
      { type: "resume", format: "docx", filename: "resume.docx" },
      { type: "resume", format: "pdf", filename: "resume.pdf" },
      { type: "coverLetter", format: "docx", filename: "coverLetter.docx" },
      { type: "coverLetter", format: "pdf", filename: "coverLetter.pdf" },
    ]);
    for (const file of documents.files) expect(file.sha256).toMatch(/^[a-f0-9]{64}$/);
    completed = true;
    process.stdout.write("EMPLOYER_QUESTION_LOCAL_DOC_NATIVE_JOURNEY_OK " + JSON.stringify({
      orderId: graph.orderId, releaseId: graph.releaseId, snapshotId: graph.intake.snapshotId,
      purchaseId: pack.purchaseId, lineId: pack.line.id, revisionId: pack.revision.id, draftJobId: pack.job.id,
      proposalVersionId: prepared.version.id, versionId: documents.versionId, packetSha256: prepared.packet.packetSha256,
      proposalSourceSha256: source.generated.sourceSha256, renderSourceSha256: documents.renderSourceSha256,
      reviewSha256: documents.reviewSha256, amountCents: 799, originalDueAt,
      noPriorEmployment: true, questionsAreCandidateFacts: false,
      questionIds: prepared.packet.employerQuestionInsights.questions.map(question => question.id),
      providerBoundary: "DETERMINISTIC_FICTIONAL_NO_NETWORK", providerFixtureRequests: 2,
      renderingBoundary: "LOCAL_QA_ACTUAL_LIBREOFFICE_POPPLER", rendererIdentity: localRendererIdentity,
      simulatedOwnerDecisions: true, humanAcceptance: false, localDocumentFiles: documents.files,
      registeredFiles: 0, approvedPairs: 0, customerDeliveries: 0, realProviderCalls: 0, hostedProof: false, durationsMs,
    }) + "\n");
  } finally {
    process.stdout.write("PACK_LOCAL_DOC_PARENT_TIMING_RECEIPT " + JSON.stringify({ completed, activePhase, durationsMs,
      elapsedMs: Math.round(performance.now() - journeyStarted), testCeilingMs: 600000, childCeilingMs: 660000, harnessCeilingMs: 690000 }) + "\n");
  }
}, 600000);

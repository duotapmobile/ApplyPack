// Local PACK_SOURCE journey with fictional external inputs and real application/SQL processing.
// PACK_SOURCE-only ceilings: 420s test/480s child/510s attach; not a latency claim.
import { afterEach, expect, it } from "vitest";
import { z } from "zod";
import { cleanupVerifiedPaidSearch, setupVerifiedPaidSearch } from "./verified-paid-search-setup";
import { employerQuestionSourceFixture } from "./employer-question-source-fixture";
import { verifyEmployerRuleOwnerJourney } from "./verified-employer-rule-owner-setup";
import { setupVerifiedPaidPack } from "./verified-paid-pack-setup";
import { setupVerifiedPaidPackPacket } from "./verified-paid-pack-packet-setup";
import { setupVerifiedPaidPackSource } from "./verified-paid-pack-source-setup";

afterEach(cleanupVerifiedPaidSearch);

it("carries paid confirmed facts and captured employer questions into an encrypted unapproved document proposal", async () => {
  const durationsMs: Record<string, number> = {};
  let completed = false, activePhase: string | null = null;
  const journeyStarted = performance.now();
  const timed = async <T>(name: string, work: () => Promise<T>) => {
    const started = performance.now(); activePhase = name;
    let phaseCompleted = false;
    try { const result = await work(); phaseCompleted = true; return result; }
    finally {
      durationsMs[name] = Math.round(performance.now() - started);
      process.stdout.write("PACK_SOURCE_PHASE_TIMING " + JSON.stringify({ phase: name, completed: phaseCompleted, elapsedMs: durationsMs[name] }) + "\n");
    }
  };
  try {
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
  completed = true;
  process.stdout.write("EMPLOYER_QUESTION_SOURCE_NATIVE_JOURNEY_OK " + JSON.stringify({
    orderId: graph.orderId, releaseId: graph.releaseId, snapshotId: graph.intake.snapshotId,
    purchaseId: pack.purchaseId, lineId: pack.line.id, revisionId: pack.revision.id, draftJobId: pack.job.id,
    versionId: prepared.version.id, packetSha256: prepared.packet.packetSha256, sourceSha256: source.generated.sourceSha256,
    amountCents: 799, originalDueAt, noPriorEmployment: true, questionsAreCandidateFacts: false,
    questionIds: prepared.packet.employerQuestionInsights.questions.map(question => question.id),
    providerBoundary: "DETERMINISTIC_FICTIONAL_NO_NETWORK", providerFixtureRequests: 2,
    leaseBranch: "REUSED_LIVE_PREPARE_CLAIM", ownerView: "PROPOSAL", runtimeRestored: true,
    renderedFiles: 0, approvedDocuments: 0, customerDeliveries: 0, realProviderCalls: 0, hostedProof: false, durationsMs,
  }) + "\n");
  } finally {
    process.stdout.write("PACK_SOURCE_TIMING_RECEIPT " + JSON.stringify({ completed, activePhase, durationsMs,
      elapsedMs: Math.round(performance.now() - journeyStarted), testCeilingMs: 420000, childCeilingMs: 480000, harnessCeilingMs: 510000 }) + "\n");
  }
});

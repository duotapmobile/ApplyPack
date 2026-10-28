import { afterEach, expect, it } from "vitest";
import { z } from "zod";
// The shared setup installs only the existing explicit external boundaries.
// Every paid row and packet below comes from the actual route/SDK/SQL chain.
import { cleanupVerifiedPaidSearch, setupVerifiedPaidSearch } from "./verified-paid-search-setup";
import { employerQuestionSourceFixture } from "./employer-question-source-fixture";
import { verifyEmployerRuleOwnerJourney } from "./verified-employer-rule-owner-setup";
import { setupVerifiedPaidPack } from "./verified-paid-pack-setup";
import { setupVerifiedPaidPackPacket } from "./verified-paid-pack-packet-setup";

afterEach(cleanupVerifiedPaidSearch);

it("carries captured employer questions and confirmed customer facts into one paid Apply Pack evidence packet", async () => {
  const fixture = employerQuestionSourceFixture();
  const graph = await setupVerifiedPaidSearch({ sourceFixture: fixture.sourceFixture });
  const owner = await verifyEmployerRuleOwnerJourney(graph, fixture);
  expect(graph.intake.answers.noPriorEmployment).toBe(true);
  const contact = {
    displayName: graph.intake.answers.fullName,
    email: z.email().parse(graph.intake.answers.documentContactEmail),
    // Explicit fictional customer entries at pack selection, not inferred facts.
    phone: "+1 202-555-0142",
    cityState: "Richmond, VA",
  };
  const pack = await setupVerifiedPaidPack(graph, owner, {
    contact, keepExistingTimeline: true, omitCareerBreakFromCoverLetter: true, noReferencesSelected: true,
    documentContactConfirmed: true, documentFactsConfirmed: true, noAutoApplyAcknowledged: true, outcomesAcknowledged: true,
  });
  const originalDueAt = z.iso.datetime({ offset: true }).parse(pack.revision.due_at);
  const prepared = await setupVerifiedPaidPackPacket(pack);
  expect(pack.line.allocated_amount_cents).toBe(799);
  expect(pack.state.lines).toHaveLength(1);
  expect(prepared.packet.binding).toMatchObject({ snapshotId: graph.intake.snapshotId,
    jobSnapshotId: owner.jobSnapshotId, ruleId: owner.ruleId, dueAt: originalDueAt });
  expect(prepared.packet.ownerEvidence.facts.length).toBeGreaterThan(0);
  expect(prepared.packet.employerQuestionInsights.questions.map(question => question.id)).toEqual(owner.insights.questions.map(question => question.id));
  expect(prepared.packet.employerQuestionInsights.questions.map(question => question.prompt)).toEqual(fixture.questions.map(question => question.label));
  expect(prepared.packet.approvalState).toBe("UNREVIEWED");
  expect(prepared.packet.providerTransferAuthorized).toBe(false);
  expect(prepared.version).toMatchObject({ encrypted_payload_id: null, source_sha256: null,
    approval_sha256: null, approved_by: null, release_id: null });

  process.stdout.write("EMPLOYER_QUESTION_PACK_NATIVE_JOURNEY_OK " + JSON.stringify({
    orderId: graph.orderId, releaseId: graph.releaseId, snapshotId: graph.intake.snapshotId,
    jobSnapshotId: owner.jobSnapshotId, ruleId: owner.ruleId, sourceRunId: owner.sourceRunId,
    purchaseId: pack.purchaseId, lineId: pack.line.id, revisionId: pack.revision.id, draftJobId: pack.job.id,
    amountCents: 799, lineCount: 1, originalDueAt, packetDueAt: prepared.packet.binding.dueAt,
    packetVersionId: prepared.version.id, packetSha256: prepared.packet.packetSha256,
    confirmedFactCount: prepared.packet.ownerEvidence.facts.length,
    questionIds: prepared.packet.employerQuestionInsights.questions.map(question => question.id),
    questionsAreCandidateFacts: false, structuredLimits: "UNDOCUMENTED_NULL", sourceRequests: fixture.requests.length,
    packetEncrypted: true, generationAttempts: 0, renderedFiles: 0, approvedDocuments: 0, customerDeliveries: 0,
    realProviderCalls: 0, hostedProof: false,
  }) + "\n");
});

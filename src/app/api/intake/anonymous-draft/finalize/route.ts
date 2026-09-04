import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { anonymousDraftContext, anonymousDraftError } from "@/lib/drafts/anonymous-server";
import { canonicalSha256, CANONICALIZATION_VERSION } from "@/lib/domain/foundation";
import { fourStepDraftSchema, validateFourStep, FOUR_STEP_SCHEMA_VERSION } from "@/lib/intake/four-step";
import { fourStepPrivateState } from "@/lib/intake/four-step-server";
import { remoteKmsAdapter } from "@/lib/security/remote-kms";
import { encryptSensitivePayload, sensitivePayloadConfiguration, sensitivePayloadEncryptionReady } from "@/lib/security/sensitive-payload";
import { isSameOriginRequest } from "@/lib/security/origin";

const inputSchema = z.object({ expectedVersion: z.number().int().positive(), answers: fourStepDraftSchema }).strict();
const bytea = (value: Uint8Array) => `\\x${Buffer.from(value).toString("hex")}`;

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return NextResponse.json({ error: "This intake request was rejected." }, { status: 403 });
  const context = await anonymousDraftContext();
  if (!context) return NextResponse.json({ error: "The saved draft is unavailable." }, { status: 404 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "The intake is invalid." }, { status: 400 });
  const privateState = await fourStepPrivateState(context.admin, context.capability.draftId).catch(() => null);
  if (!privateState) return NextResponse.json({ error: "The intake cannot be reviewed right now." }, { status: 503 });
  const resume = privateState.documents.find((item: import("@/lib/intake/four-step").IntakeDocument) => item.kind === "RESUME") ?? null;
  const errors = [0, 1, 2, 3].flatMap((step) => validateFourStep(step as 0 | 1 | 2 | 3, parsed.data.answers, {
    resume, facts: privateState.facts, presentedFactIds: new Set(privateState.presentedFactIds),
  }));
  if (errors.length) return NextResponse.json({ error: "Review the highlighted intake fields.", errors }, { status: 400 });

  const configuration = sensitivePayloadConfiguration();
  if (!sensitivePayloadEncryptionReady(configuration)) {
    return NextResponse.json({ error: "Secure intake finalization is unavailable until the approved production KMS is configured.", code: "KMS_NOT_CONFIGURED" }, { status: 503 });
  }
  const snapshotId = randomUUID();
  const sensitivePlaintext = Buffer.from(JSON.stringify({
    schemaVersion: FOUR_STEP_SCHEMA_VERSION, fullName: parsed.data.answers.fullName,
    customDealbreaker: parsed.data.answers.customDealbreaker || null,
  }), "utf8");
  let envelope;
  try {
    envelope = await encryptSensitivePayload({ plaintext: sensitivePlaintext,
      context: { draftId: context.capability.draftId, snapshotId, purpose: "FOUR_STEP_INTAKE" },
      configuration, kms: remoteKmsAdapter() });
  } catch {
    return NextResponse.json({ error: "Secure intake finalization is temporarily unavailable.", code: "KMS_UNAVAILABLE" }, { status: 503 });
  } finally { sensitivePlaintext.fill(0); }

  const sensitivePayloadId = randomUUID();
  const sensitiveInsert = await context.admin.from("ap_sensitive_payloads").insert({
    id: sensitivePayloadId, draft_id: context.capability.draftId, ciphertext: bytea(envelope.ciphertext),
    encryption_algorithm: envelope.algorithm, encrypted_data_key: bytea(envelope.encryptedDataKey), nonce: bytea(envelope.nonce),
    authentication_tag: bytea(envelope.authenticationTag), content_sha256: envelope.contentSha256,
    kms_key_identity: envelope.keyIdentity, kms_key_version: envelope.keyVersion, encryption_context_hash: envelope.encryptionContextHash,
  });
  if (sensitiveInsert.error) return NextResponse.json({ error: "The encrypted intake could not be stored." }, { status: 502 });

  const answers = parsed.data.answers;
  const snapshot = {
    accessEmailNormalized: answers.email.trim().normalize("NFC").toLocaleLowerCase("en-US"),
    documentContactEmail: answers.email.trim(), desiredActivities: answers.desiredActivities, avoidedActivities: answers.avoidedActivities,
    optionalTitles: answers.targetTitles, confirmedTitleRestriction: answers.titleRestrictionConfirmed ? { titles: answers.targetTitles } : null,
    optionalIndustries: answers.industryInterests, blockedIndustries: answers.blockedIndustries, searchBreadth: answers.searchBreadth,
    guidanceRequested: answers.guidanceRequested, workModes: answers.workModes, stateOrDc: answers.stateOrDc,
    employmentTypes: answers.employmentTypes, schedules: answers.schedules,
    travel: { preference: answers.workConditionPreferences.TRAVEL ?? null }, benefits: answers.benefits,
    dealbreakers: answers.dealbreakers, salaryTargetCents: answers.salaryTargetCents, salaryHardMinimumCents: answers.salaryHardMinimumCents,
    salaryMinimumFlexible: answers.salaryMinimumFlexible, salaryPeriod: answers.salaryPeriod || null, salaryBasis: answers.salaryBasis || null,
    salaryOverlapPolicy: answers.salaryOverlapPolicy, salaryUnpublishedPolicy: answers.salaryUnpublishedPolicy,
    salaryNoncomparablePolicy: answers.salaryNoncomparablePolicy, salaryVariablePayPolicy: answers.salaryVariablePayPolicy,
    employerUnknownPolicies: answers.employerUnknownPolicies, priorCoverLetterUse: answers.priorCoverLetterUse,
    experienceAdditions: answers.experienceAdditions, capabilities: answers.capabilities,
    sensitivePayloadSha256: envelope.contentSha256, canonicalizationVersion: CANONICALIZATION_VERSION, schemaVersion: FOUR_STEP_SCHEMA_VERSION,
  };
  const reviews = Object.fromEntries(Object.entries(answers.factReviews).map(([factId, decision]) => [factId, {
    decision, correction: answers.factCorrections[factId] ?? null,
  }]));
  const { data, error } = await context.admin.rpc("ap_finalize_four_step_intake", {
    p_draft_id: context.capability.draftId, p_secret_hash: context.secretHash, p_expected_version: parsed.data.expectedVersion,
    p_snapshot_id: snapshotId, p_snapshot: snapshot, p_content_sha256: canonicalSha256(snapshot),
    p_sensitive_payload_id: sensitivePayloadId, p_fact_reviews: reviews,
  });
  if (error || !Array.isArray(data) || !data[0]) {
    const mapped = anonymousDraftError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
  const row = data[0] as Record<string, unknown>;
  return NextResponse.json({ snapshotId: row.snapshot_id, feasibilityRequestId: row.feasibility_request_id,
    draftVersion: row.draft_version, feasibility: { state: "PENDING", message: "Your intake is saved. Feasibility review is pending." } },
    { status: 201, headers: { "cache-control": "no-store" } });
}

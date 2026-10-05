import { NextResponse } from "next/server";
import { z } from "zod";
import { deterministicUuid } from "@/lib/commerce/server";
import { anonymousDraftContext, anonymousDraftError } from "@/lib/drafts/anonymous-server";
import { canonicalSha256, CANONICALIZATION_VERSION } from "@/lib/domain/foundation";
import { buildFourStepSnapshot, fourStepDraftSchema, normalizedFourStepDraft, validateFourStep, FOUR_STEP_SCHEMA_VERSION } from "@/lib/intake/four-step";
import { fourStepPrivateState } from "@/lib/intake/four-step-server";
import { currentLegalContentBinding } from "@/lib/legal/content.server";
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
  const answers = normalizedFourStepDraft(parsed.data.answers);
  const privateState = await fourStepPrivateState(context.admin, context.capability.draftId).catch(() => null);
  if (!privateState) return NextResponse.json({ error: "The intake cannot be reviewed right now." }, { status: 503 });
  const resume = privateState.documents.find((item: import("@/lib/intake/four-step").IntakeDocument) => item.kind === "RESUME") ?? null;
  if (!resume || !["READY", "REVIEW_READY"].includes(resume.processingState)) return NextResponse.json({ error: "Your resume must finish safe extraction and be ready for factual review before finalizing." }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
  const errors = [0, 1, 2, 3].flatMap((step) => validateFourStep(step as 0 | 1 | 2 | 3, answers, {
    resume, facts: privateState.facts, presentedFactIds: new Set(privateState.presentedFactIds),
  }));
  if (errors.length) return NextResponse.json({ error: "Review the highlighted intake fields.", errors }, { status: 400 });

  const { data: commerce, error: commerceError } = await context.admin.from("ap_commerce_configuration")
    .select("terms_version,terms_content_sha256,privacy_version,privacy_content_sha256,legal_acceptance_copy_version,legal_acceptance_copy_sha256,legal_content_canonicalization_version,legal_receipt_schema_version")
    .eq("singleton", true).maybeSingle();
  const legalContent = currentLegalContentBinding();
  if (commerceError || !commerce?.terms_version || !commerce.privacy_version) {
    return NextResponse.json({
      error: "The current Terms and Privacy versions are unavailable. No intake was finalized and no payment was started.",
      code: "LEGAL_CONFIGURATION_UNAVAILABLE",
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  if (commerce.terms_version !== legalContent.termsVersion
    || commerce.terms_content_sha256 !== legalContent.termsContentSha256
    || commerce.privacy_version !== legalContent.privacyVersion
    || commerce.privacy_content_sha256 !== legalContent.privacyContentSha256
    || commerce.legal_acceptance_copy_version !== legalContent.acceptanceCopyVersion
    || commerce.legal_acceptance_copy_sha256 !== legalContent.acceptanceCopySha256
    || commerce.legal_content_canonicalization_version !== legalContent.contentCanonicalizationVersion
    || commerce.legal_receipt_schema_version !== legalContent.receiptSchemaVersion) {
    return NextResponse.json({
      error: "The published legal content does not match the immutable acceptance configuration. No intake was finalized and no payment was started.",
      code: "LEGAL_CONTENT_CONFIGURATION_MISMATCH",
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }

  const configuration = sensitivePayloadConfiguration();
  if (!sensitivePayloadEncryptionReady(configuration)) {
    return NextResponse.json({ error: "Secure intake finalization is unavailable until the approved production KMS is configured.", code: "KMS_NOT_CONFIGURED" }, { status: 503 });
  }
  const finalizationKey = canonicalSha256({
    draftId: context.capability.draftId,
    expectedVersion: parsed.data.expectedVersion,
    answers,
    termsVersion: commerce.terms_version,
    privacyVersion: commerce.privacy_version,
    schemaVersion: FOUR_STEP_SCHEMA_VERSION,
  });
  const snapshotId = deterministicUuid(`intake-snapshot:${finalizationKey}`);
  const sensitivePayloadId = deterministicUuid(`intake-sensitive:${finalizationKey}`);
  const sensitivePlaintext = Buffer.from(JSON.stringify({
    schemaVersion: FOUR_STEP_SCHEMA_VERSION, fullName: answers.fullName,
    customDealbreaker: answers.customDealbreaker || null,
  }), "utf8");
  let envelope;
  try {
    envelope = await encryptSensitivePayload({ plaintext: sensitivePlaintext,
      context: { draftId: context.capability.draftId, snapshotId, purpose: "FOUR_STEP_INTAKE" },
      configuration, kms: remoteKmsAdapter() });
  } catch {
    return NextResponse.json({ error: "Secure intake finalization is temporarily unavailable.", code: "KMS_UNAVAILABLE" }, { status: 503 });
  } finally { sensitivePlaintext.fill(0); }

  const snapshot = buildFourStepSnapshot(answers, envelope.contentSha256, CANONICALIZATION_VERSION);
  const reviews = Object.fromEntries(Object.entries(answers.factReviews).map(([factId, decision]) => [factId, {
    decision, correction: answers.factCorrections[factId] ?? null,
  }]));
  const acceptanceSha256 = canonicalSha256({
    accepted: true,
    draftId: context.capability.draftId,
    snapshotId,
    termsVersion: commerce.terms_version,
    termsContentSha256: legalContent.termsContentSha256,
    privacyVersion: commerce.privacy_version,
    privacyContentSha256: legalContent.privacyContentSha256,
    acceptanceCopyVersion: legalContent.acceptanceCopyVersion,
    acceptanceCopySha256: legalContent.acceptanceCopySha256,
    contentCanonicalizationVersion: legalContent.contentCanonicalizationVersion,
    receiptSchemaVersion: legalContent.receiptSchemaVersion,
  });
  const { data, error } = await context.admin.rpc("ap_finalize_four_step_intake_with_legal_acceptance_v3", {
    p_draft_id: context.capability.draftId, p_secret_hash: context.secretHash, p_expected_version: parsed.data.expectedVersion,
    p_snapshot_id: snapshotId, p_snapshot: snapshot, p_content_sha256: canonicalSha256(snapshot),
    p_sensitive_payload_id: sensitivePayloadId, p_fact_reviews: reviews,
    p_sensitive_ciphertext: bytea(envelope.ciphertext), p_sensitive_encryption_algorithm: envelope.algorithm,
    p_sensitive_encrypted_data_key: bytea(envelope.encryptedDataKey), p_sensitive_nonce: bytea(envelope.nonce),
    p_sensitive_authentication_tag: bytea(envelope.authenticationTag), p_sensitive_content_sha256: envelope.contentSha256,
    p_kms_key_identity: envelope.keyIdentity, p_kms_key_version: envelope.keyVersion,
    p_encryption_context_hash: envelope.encryptionContextHash,
    p_terms_version: commerce.terms_version, p_terms_content_sha256: legalContent.termsContentSha256,
    p_privacy_version: commerce.privacy_version, p_privacy_content_sha256: legalContent.privacyContentSha256,
    p_acceptance_copy_version: legalContent.acceptanceCopyVersion,
    p_acceptance_copy_sha256: legalContent.acceptanceCopySha256,
    p_content_canonicalization_version: legalContent.contentCanonicalizationVersion,
    p_receipt_schema_version: legalContent.receiptSchemaVersion,
    p_acceptance_sha256: acceptanceSha256,
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

import { NextResponse } from "next/server";
import { z } from "zod";
import { anonymousDraftContext, anonymousDraftError } from "@/lib/drafts/anonymous-server";
import { canonicalSha256 } from "@/lib/domain/foundation";
import { currentLegalContentBinding } from "@/lib/legal/content.server";
import { isSameOriginRequest } from "@/lib/security/origin";

const inputSchema = z.object({ accepted: z.literal(true) }).strict();

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "This legal acceptance request was rejected." }, { status: 403 });
  }
  const context = await anonymousDraftContext();
  if (!context) return NextResponse.json({ error: "The saved draft is unavailable." }, { status: 404 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Confirm the current Terms and Privacy Policy." }, { status: 400 });

  const [{ data: commerce, error: commerceError }, { data: draftRows, error: draftError }] = await Promise.all([
    context.admin.from("ap_commerce_configuration")
      .select("terms_version,terms_content_sha256,privacy_version,privacy_content_sha256,legal_acceptance_copy_version,legal_acceptance_copy_sha256,legal_content_canonicalization_version,legal_receipt_schema_version")
      .eq("singleton", true).maybeSingle(),
    context.admin.rpc("ap_read_four_step_draft", {
      p_draft_id: context.capability.draftId,
      p_secret_hash: context.secretHash,
    }),
  ]);
  const legalContent = currentLegalContentBinding();
  const draft = Array.isArray(draftRows) ? draftRows[0] as Record<string, unknown> | undefined : undefined;
  const snapshotId = typeof draft?.finalized_snapshot_id === "string" ? draft.finalized_snapshot_id : null;
  if (draftError || !snapshotId || !["COMPLETE", "LOCKED_TO_CHECKOUT"].includes(String(draft?.state))) {
    return NextResponse.json({ error: "The completed intake is unavailable for legal confirmation." }, { status: 409 });
  }
  if (commerceError || commerce?.terms_version !== legalContent.termsVersion
    || commerce.terms_content_sha256 !== legalContent.termsContentSha256
    || commerce.privacy_version !== legalContent.privacyVersion
    || commerce.privacy_content_sha256 !== legalContent.privacyContentSha256
    || commerce.legal_acceptance_copy_version !== legalContent.acceptanceCopyVersion
    || commerce.legal_acceptance_copy_sha256 !== legalContent.acceptanceCopySha256
    || commerce.legal_content_canonicalization_version !== legalContent.contentCanonicalizationVersion
    || commerce.legal_receipt_schema_version !== legalContent.receiptSchemaVersion) {
    return NextResponse.json({
      error: "The published legal content does not match the immutable acceptance configuration.",
      code: "LEGAL_CONTENT_CONFIGURATION_MISMATCH",
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  const acceptanceSha256 = canonicalSha256({
    accepted: true,
    draftId: context.capability.draftId,
    snapshotId,
    termsVersion: legalContent.termsVersion,
    termsContentSha256: legalContent.termsContentSha256,
    privacyVersion: legalContent.privacyVersion,
    privacyContentSha256: legalContent.privacyContentSha256,
    acceptanceCopyVersion: legalContent.acceptanceCopyVersion,
    acceptanceCopySha256: legalContent.acceptanceCopySha256,
    contentCanonicalizationVersion: legalContent.contentCanonicalizationVersion,
    receiptSchemaVersion: legalContent.receiptSchemaVersion,
  });
  const { data, error } = await context.admin.rpc("ap_upgrade_completed_intake_legal_acceptance", {
    p_draft_id: context.capability.draftId,
    p_secret_hash: context.secretHash,
    p_terms_version: legalContent.termsVersion,
    p_terms_content_sha256: legalContent.termsContentSha256,
    p_privacy_version: legalContent.privacyVersion,
    p_privacy_content_sha256: legalContent.privacyContentSha256,
    p_acceptance_copy_version: legalContent.acceptanceCopyVersion,
    p_acceptance_copy_sha256: legalContent.acceptanceCopySha256,
    p_content_canonicalization_version: legalContent.contentCanonicalizationVersion,
    p_receipt_schema_version: legalContent.receiptSchemaVersion,
    p_acceptance_sha256: acceptanceSha256,
  });
  if (error || !data) {
    const mapped = anonymousDraftError(error);
    return NextResponse.json(mapped.body, { status: mapped.status, headers: { "cache-control": "no-store" } });
  }
  return NextResponse.json({ accepted: true, snapshotId }, { headers: { "cache-control": "no-store" } });
}

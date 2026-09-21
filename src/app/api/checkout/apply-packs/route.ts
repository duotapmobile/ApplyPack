import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { z } from "zod";
import { canonicalApplicationOrigin, deterministicUuid, postgresBytea } from "@/lib/commerce/server";
import { documentRendererConfiguration } from "@/lib/documents/renderer";
import { fileScanConfiguration } from "@/lib/files/scanner";
import { careerBreakPresentation, MATERIAL_LINE_PRICE_CENTS, materialTotalCents } from "@/lib/materials/contract";
import { materialCheckoutRequestKey, materialSelectionSha256 } from "@/lib/materials/server";
import { isSameOriginRequest } from "@/lib/security/origin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { remoteKmsAdapter } from "@/lib/security/remote-kms";
import {
  encryptSensitivePayload,
  sensitivePayloadConfiguration,
  sensitivePayloadEncryptionReady,
} from "@/lib/security/sensitive-payload";
import { assertConfiguredPrice, createStripeMaterialsClient } from "@/lib/stripe/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const selectionSchema = z.object({
  jobMatchId: z.uuid(),
  ruleId: z.uuid(),
  selectedReferenceSheet: z.boolean().default(false),
  referencePermissionIds: z.array(z.uuid()).max(3).default([]),
  emphasisNote: z.string().trim().max(500).default(""),
  doNotMentionNote: z.string().trim().max(500).default(""),
}).strict().superRefine((value, context) => {
  if (new Set(value.referencePermissionIds).size !== value.referencePermissionIds.length) {
    context.addIssue({ code: "custom", message: "Duplicate reference permissions are not allowed." });
  }
  if (value.selectedReferenceSheet !== (value.referencePermissionIds.length > 0)) {
    context.addIssue({ code: "custom", message: "Reference permissions must match the selected sheet." });
  }
});

const schema = z.object({
  deliveredOrderId: z.uuid(),
  deliveredReleaseId: z.uuid(),
  sourceSnapshotId: z.uuid(),
  contact: z.object({
    displayName: z.string().trim().min(1).max(120),
    email: z.email().max(254),
    phone: z.string().trim().min(7).max(40),
    cityState: z.string().trim().min(2).max(120),
    linkedInOrPortfolio: z.url().max(500).nullable().optional(),
  }).strict(),
  items: z.array(selectionSchema).min(1).max(10),
  careerBreakChoice: z.enum([
    "KEEP_EXISTING_TIMELINE",
    "CAREER_BREAK",
    "FAMILY_CAREGIVING",
    "CUSTOM_WORDING",
    "OMIT_ENTRY",
  ]),
  careerBreakCustomLabel: z.string().trim().min(2).max(80).nullable().optional(),
  careerBreakStart: z.string().trim().max(40).nullable().optional(),
  careerBreakEnd: z.string().trim().max(40).nullable().optional(),
  coverLetterBreakConsent: z.boolean(),
  documentContactConfirmed: z.literal(true),
  documentFactsConfirmed: z.literal(true),
  noAutoApplyAcknowledged: z.literal(true),
  outcomesAcknowledged: z.literal(true),
}).strict();

type CommerceConfiguration = {
  canonical_site_url: string | null;
  tax_configuration_approved: boolean;
  tax_approval_reference: string | null;
  tax_treatment: string;
  material_line_price_cents: number;
  currency: string;
  tax_inclusive: boolean;
  pricing_version: string | null;
  tax_version: string | null;
  materials_rule_ttl_seconds: number | null;
  immediate_payment_methods: string[];
  checkout_enabled: boolean;
  materials_generation_approved: boolean;
  materials_generation_approval_reference: string | null;
  material_output_formats: string[];
  document_renderer_identity: string | null;
  arial_font_sha256: string | null;
  malware_scanner_identity: string | null;
};

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "This checkout request was rejected." }, { status: 403 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Review the selected jobs, contact details, references, and acknowledgments." }, { status: 400 });
  }
  const input = parsed.data;
  const matchIds = input.items.map((item) => item.jobMatchId);
  try {
    materialTotalCents(matchIds);
    careerBreakPresentation({
      choice: input.careerBreakChoice,
      customLabel: input.careerBreakCustomLabel,
      start: input.careerBreakStart,
      end: input.careerBreakEnd,
    });
  } catch {
    return NextResponse.json({ error: "The materials selection or career-break choice is invalid." }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  const stripe = createStripeMaterialsClient();
  if (!supabase || !admin || !stripe) {
    return NextResponse.json({ error: "Secure materials checkout is not connected yet." }, { status: 503 });
  }
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return NextResponse.json({ error: "Sign in again before payment." }, { status: 401 });
  const rate = await consumeRateLimit({
    request,
    scope: "chunk5_materials_checkout",
    identity: authData.user.id,
    limit: 5,
    windowSeconds: 60 * 60,
  });
  if (!rate.configured) return NextResponse.json({ error: "Secure checkout controls are unavailable." }, { status: 503 });
  if (!rate.allowed) return NextResponse.json({ error: "Too many checkout attempts. Try again later." }, { status: 429 });

  let applicationOrigin: string;
  try {
    applicationOrigin = canonicalApplicationOrigin();
  } catch {
    return NextResponse.json({ error: "The canonical secure site URL is not configured." }, { status: 503 });
  }
  const { data: configuration, error: configurationError } = await admin.from("ap_commerce_configuration")
    .select("canonical_site_url,tax_configuration_approved,tax_approval_reference,tax_treatment,material_line_price_cents,currency,tax_inclusive,pricing_version,tax_version,materials_rule_ttl_seconds,immediate_payment_methods,checkout_enabled,materials_generation_approved,materials_generation_approval_reference,material_output_formats,document_renderer_identity,arial_font_sha256,malware_scanner_identity")
    .eq("singleton", true).maybeSingle();
  const commerce = configuration as CommerceConfiguration | null;
  const renderer = documentRendererConfiguration();
  const scanner = fileScanConfiguration();
  if (configurationError || !commerce || !commerce.checkout_enabled
    || commerce.canonical_site_url !== applicationOrigin
    || !commerce.tax_configuration_approved || !commerce.tax_approval_reference
    || commerce.tax_treatment !== "TAX_INCLUSIVE_NO_ADDED_AMOUNT"
    || commerce.material_line_price_cents !== MATERIAL_LINE_PRICE_CENTS
    || commerce.currency !== "USD" || !commerce.tax_inclusive
    || !commerce.pricing_version || !commerce.tax_version
    || commerce.materials_rule_ttl_seconds !== 3_600
    || commerce.immediate_payment_methods.length !== 1 || commerce.immediate_payment_methods[0] !== "card"
    || !commerce.materials_generation_approved || !commerce.materials_generation_approval_reference
    || !commerce.material_output_formats.length
    || !renderer.ready || renderer.identity !== commerce.document_renderer_identity
    || renderer.arialFont.sha256 !== commerce.arial_font_sha256
    || !scanner.ready || scanner.identity !== commerce.malware_scanner_identity
    || (process.env.APP_PAYMENT_MODE === "live" && !scanner.liveReady)) {
    return NextResponse.json({
      error: "Checkout is disabled until the approved tax-inclusive price and production commerce controls are configured.",
    }, { status: 503 });
  }
  const priceId = process.env.STRIPE_APPLY_PACK_PRICE_ID;
  if (!priceId) return NextResponse.json({ error: "Materials pricing is not configured." }, { status: 503 });
  try {
    await assertConfiguredPrice(stripe, priceId, {
      unitAmount: MATERIAL_LINE_PRICE_CENTS,
      productName: "Tailored Resume + Cover Letter",
    });
  } catch {
    return NextResponse.json({ error: "Checkout pricing failed verification. No charge was made." }, { status: 503 });
  }

  const contactPlaintext = Buffer.from(JSON.stringify({
    schemaVersion: "chunk5-document-contact-v1",
    displayName: input.contact.displayName,
    email: input.contact.email.toLowerCase(),
    phone: input.contact.phone,
    cityState: input.contact.cityState,
    linkedInOrPortfolio: input.contact.linkedInOrPortfolio || null,
  }), "utf8");
  const contactPayloadSha256 = createHash("sha256").update(contactPlaintext).digest("hex");
  const selections = input.items.map((item) => ({
    jobMatchId: item.jobMatchId,
    ruleId: item.ruleId,
    selectedReferenceSheet: item.selectedReferenceSheet,
    referencePermissionIds: item.referencePermissionIds,
    emphasisNote: item.emphasisNote,
    doNotMentionNote: item.doNotMentionNote,
  }));
  const selectionSha256 = materialSelectionSha256({
    customerId: authData.user.id,
    deliveredOrderId: input.deliveredOrderId,
    deliveredReleaseId: input.deliveredReleaseId,
    sourceSnapshotId: input.sourceSnapshotId,
    contactPayloadSha256,
    selections,
    careerBreakChoice: input.careerBreakChoice,
    careerBreakCustomLabel: input.careerBreakCustomLabel,
    coverLetterBreakConsent: input.coverLetterBreakConsent,
  });
  const requestKey = materialCheckoutRequestKey(selectionSha256);
  const contactPayloadId = deterministicUuid(`material-contact:${requestKey}`);
  const providerSelections = selections.map((selection) => ({
    ...selection,
    matchId: selection.jobMatchId,
    lineId: deterministicUuid(`material-line:${requestKey}:${selection.jobMatchId}`),
    revisionId: deterministicUuid(`material-revision:${requestKey}:${selection.jobMatchId}:1`),
    entitlementId: deterministicUuid(`material-entitlement:${requestKey}:${selection.jobMatchId}:1`),
  }));

  try {
    const { data: existingPayload, error: payloadQueryError } = await admin
      .from("ap_sensitive_payloads").select("id,content_sha256").eq("id", contactPayloadId).maybeSingle();
    if (payloadQueryError) throw payloadQueryError;
    if (existingPayload && existingPayload.content_sha256 !== contactPayloadSha256) {
      throw new Error("material_contact_idempotency_conflict");
    }
    if (!existingPayload) {
      const kmsConfiguration = sensitivePayloadConfiguration();
      if (!sensitivePayloadEncryptionReady(kmsConfiguration)) {
        return NextResponse.json({ error: "Materials checkout is disabled until the approved KMS is configured." }, { status: 503 });
      }
      const envelope = await encryptSensitivePayload({
        plaintext: contactPlaintext,
        context: { customerId: authData.user.id, payloadId: contactPayloadId, purpose: "CHUNK5_DOCUMENT_CONTACT" },
        configuration: kmsConfiguration,
        kms: remoteKmsAdapter(),
      });
      const inserted = await admin.from("ap_sensitive_payloads").insert({
        id: contactPayloadId,
        customer_id: authData.user.id,
        ciphertext: postgresBytea(envelope.ciphertext),
        encryption_algorithm: envelope.algorithm,
        encrypted_data_key: postgresBytea(envelope.encryptedDataKey),
        nonce: postgresBytea(envelope.nonce),
        authentication_tag: postgresBytea(envelope.authenticationTag),
        content_sha256: envelope.contentSha256,
        kms_key_identity: envelope.keyIdentity,
        kms_key_version: envelope.keyVersion,
        encryption_context_hash: envelope.encryptionContextHash,
      });
      if (inserted.error && inserted.error.code !== "23505") throw inserted.error;
    }
  } catch {
    return NextResponse.json({ error: "Protected document contact details could not be prepared." }, { status: 503 });
  } finally {
    contactPlaintext.fill(0);
  }

  const { data: prepared, error: prepareError } = await admin.rpc("ap_begin_material_checkout", {
    p_customer_id: authData.user.id,
    p_delivered_order_id: input.deliveredOrderId,
    p_delivered_release_id: input.deliveredReleaseId,
    p_source_snapshot_id: input.sourceSnapshotId,
    p_contact_payload_id: contactPayloadId,
    p_request_key: requestKey,
    p_selection_sha256: selectionSha256,
    p_selections: providerSelections,
    p_career_break_choice: input.careerBreakChoice,
    p_career_break_custom_label: input.careerBreakCustomLabel || null,
    p_cover_letter_break_consent: input.coverLetterBreakConsent,
    p_document_contact_confirmed: true,
    p_document_facts_confirmed: true,
  });
  const checkout = prepared && typeof prepared === "object" && !Array.isArray(prepared)
    ? prepared as Record<string, unknown> : null;
  if (prepareError || !checkout?.checkoutIntentId || !checkout.expiresAt || !checkout.providerIdempotencyKey) {
    return NextResponse.json({
      error: "One or more jobs, instructions, references, entitlements, or capacity records are not checkout-ready. No charge was made.",
    }, { status: 409 });
  }

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: authData.user.email,
      expires_at: Math.floor(new Date(String(checkout.expiresAt)).getTime() / 1_000),
      success_url: `${applicationOrigin}/checkout/return`,
      cancel_url: `${applicationOrigin}/checkout/return?cancelled=1`,
      line_items: [{ quantity: providerSelections.length, price: priceId }],
      metadata: {
        checkout_intent_id: String(checkout.checkoutIntentId),
        product_kind: "apply_pack",
        contract_version: "chunk5-v1",
      },
    }, { idempotencyKey: String(checkout.providerIdempotencyKey) });
  } catch {
    return NextResponse.json({
      error: "Checkout creation has an ambiguous provider result. Retry safely; the same command will be reconciled.",
      retryable: true,
    }, { status: 502 });
  }
  if (!session.url) {
    return NextResponse.json({ error: "Checkout did not return a secure URL. No work was activated." }, { status: 502 });
  }
  const promoted = await admin.rpc("ap_promote_material_checkout", {
    p_checkout_intent_id: String(checkout.checkoutIntentId),
    p_provider_session_id: session.id,
    p_provider_session_expires_at: new Date(session.expires_at * 1_000).toISOString(),
  });
  if (promoted.error || !promoted.data) {
    let providerExpired = false;
    try {
      await stripe.checkout.sessions.expire(session.id);
      providerExpired = true;
    } catch {
      // The reconciliation worker retains the ambiguous command for review.
    }
    if (providerExpired) {
      await admin.rpc("ap_expire_material_checkout", {
        p_checkout_intent_id: String(checkout.checkoutIntentId),
        p_reason_code: "LOCAL_PROMOTION_FAILED_PROVIDER_EXPIRED",
      });
    }
    return NextResponse.json({ error: "Checkout could not be safely linked. No work was activated." }, { status: 502 });
  }
  return NextResponse.json({
    url: session.url,
    expiresAt: new Date(session.expires_at * 1_000).toISOString(),
    lineCount: providerSelections.length,
    amountCents: providerSelections.length * MATERIAL_LINE_PRICE_CENTS,
    currency: "USD",
    taxInclusive: true,
  });
}

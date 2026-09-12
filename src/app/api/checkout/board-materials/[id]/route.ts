import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { z } from "zod";
import { canonicalApplicationOrigin, deterministicUuid, postgresBytea } from "@/lib/commerce/server";
import { documentRendererConfiguration } from "@/lib/documents/renderer";
import { fileScanConfiguration } from "@/lib/files/scanner";
import { requireBoardAccess } from "@/lib/job-board/access";
import { careerBreakPresentation, MATERIAL_LINE_PRICE_CENTS } from "@/lib/materials/contract";
import { isSameOriginRequest } from "@/lib/security/origin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { remoteKmsAdapter } from "@/lib/security/remote-kms";
import { encryptSensitivePayload, sensitivePayloadConfiguration, sensitivePayloadEncryptionReady } from "@/lib/security/sensitive-payload";
import { assertConfiguredPrice, createStripeMaterialsClient } from "@/lib/stripe/server";

export const runtime = "nodejs";

const schema = z.object({
  contact: z.object({
    displayName: z.string().trim().min(2).max(120), email: z.email().max(254),
    phone: z.string().trim().min(7).max(40), cityState: z.string().trim().min(2).max(120),
    linkedInOrPortfolio: z.union([z.literal(""), z.url().max(500)]).optional(),
  }).strict(),
  emphasisNote: z.string().trim().max(500).default(""),
  doNotMentionNote: z.string().trim().max(500).default(""),
  careerBreakChoice: z.enum(["KEEP_EXISTING_TIMELINE","OMIT_ENTRY"]),
  careerBreakCustomLabel: z.null().optional(),
  coverLetterBreakConsent: z.boolean(), documentContactConfirmed: z.literal(true),
  documentFactsConfirmed: z.literal(true), noAutoApplyAcknowledged: z.literal(true), outcomesAcknowledged: z.literal(true),
}).strict();

type CommerceConfiguration = {
  canonical_site_url: string | null; tax_configuration_approved: boolean; tax_approval_reference: string | null;
  tax_treatment: string; material_line_price_cents: number; currency: string; tax_inclusive: boolean;
  pricing_version: string | null; tax_version: string | null; materials_rule_ttl_seconds: number | null;
  immediate_payment_methods: string[]; checkout_enabled: boolean; materials_generation_approved: boolean;
  materials_generation_approval_reference: string | null; material_output_formats: string[];
  document_renderer_identity: string | null; arial_font_sha256: string | null; malware_scanner_identity: string | null;
};

const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "private, no-store, max-age=0" } });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return response({ error: "This checkout request was rejected." }, 403);
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return response({ error: "Review the contact details and required acknowledgments." }, 400);
  try {
    careerBreakPresentation({ choice: input.data.careerBreakChoice, customLabel: input.data.careerBreakCustomLabel });
  } catch { return response({ error: "The career timeline choice is invalid." }, 400); }
  const access = await requireBoardAccess();
  if (!access.ok) return response({ error: access.error }, access.status);
  const stripe = createStripeMaterialsClient();
  if (!stripe) return response({ error: "Secure materials checkout is not connected yet." }, 503);
  const rate = await consumeRateLimit({ request, scope: "board_materials_checkout", identity: access.customerId, limit: 5, windowSeconds: 3_600 });
  if (!rate.configured) return response({ error: "Secure checkout controls are unavailable." }, 503);
  if (!rate.allowed) return response({ error: "Too many checkout attempts. Try again later." }, 429);
  const { id: jobId } = await context.params;
  const admissionResult = await access.admin.from("ap_board_admissions").select("id,job_id,profile_snapshot_id")
    .eq("customer_id", access.customerId).eq("profile_snapshot_id", access.profileId).eq("job_id", jobId)
    .eq("admission_version", access.admissionVersion).is("superseded_at", null).eq("decision", "ADMITTED").maybeSingle();
  if (admissionResult.error || !admissionResult.data) return response({ error: "This job is not available for materials." }, 404);
  const { data: jobSnapshot } = await access.admin.from("ap_job_snapshots").select("id")
    .eq("legacy_job_id", jobId).order("retrieved_at", { ascending: false }).limit(1).maybeSingle();
  if (!jobSnapshot) return response({ error: "This job still needs current human materials review." }, 409);
  const { data: rule } = await access.admin.from("ap_employer_submission_rules").select("id")
    .eq("job_snapshot_id", jobSnapshot.id).eq("is_current", true).is("superseded_at", null).order("checked_at", { ascending: false }).limit(1).maybeSingle();
  if (!rule) return response({ error: "Employer document instructions still need human review." }, 409);

  let origin: string;
  try { origin = canonicalApplicationOrigin(); } catch { return response({ error: "The canonical secure site URL is not configured." }, 503); }
  const configResult = await access.admin.from("ap_commerce_configuration")
    .select("canonical_site_url,tax_configuration_approved,tax_approval_reference,tax_treatment,material_line_price_cents,currency,tax_inclusive,pricing_version,tax_version,materials_rule_ttl_seconds,immediate_payment_methods,checkout_enabled,materials_generation_approved,materials_generation_approval_reference,material_output_formats,document_renderer_identity,arial_font_sha256,malware_scanner_identity")
    .eq("singleton", true).maybeSingle();
  const commerce = configResult.data as CommerceConfiguration | null;
  const renderer = documentRendererConfiguration();
  const scanner = fileScanConfiguration();
  if (configResult.error || !commerce || !commerce.checkout_enabled || commerce.canonical_site_url !== origin
    || !commerce.tax_configuration_approved || !commerce.tax_approval_reference
    || commerce.tax_treatment !== "TAX_INCLUSIVE_NO_ADDED_AMOUNT"
    || commerce.material_line_price_cents !== MATERIAL_LINE_PRICE_CENTS || commerce.currency !== "USD" || !commerce.tax_inclusive
    || !commerce.pricing_version || !commerce.tax_version || commerce.materials_rule_ttl_seconds !== 3_600
    || commerce.immediate_payment_methods.length !== 1 || commerce.immediate_payment_methods[0] !== "card"
    || !commerce.materials_generation_approved || !commerce.materials_generation_approval_reference
    || !commerce.material_output_formats.length || !renderer.ready || renderer.identity !== commerce.document_renderer_identity
    || renderer.arialFont.sha256 !== commerce.arial_font_sha256 || !scanner.ready
    || scanner.identity !== commerce.malware_scanner_identity || (process.env.APP_PAYMENT_MODE === "live" && !scanner.liveReady)) {
    return response({ error: "Materials checkout is disabled until approved rendering, scanning, tax, and fulfillment controls are configured." }, 503);
  }
  const priceId = process.env.STRIPE_APPLY_PACK_PRICE_ID;
  if (!priceId) return response({ error: "Materials pricing is not configured." }, 503);
  try { await assertConfiguredPrice(stripe, priceId, { unitAmount: MATERIAL_LINE_PRICE_CENTS, productName: "Tailored Resume + Cover Letter" }); }
  catch { return response({ error: "Checkout pricing failed verification. No charge was made." }, 503); }

  const contactPlaintext = Buffer.from(JSON.stringify({ schemaVersion: "chunk5-document-contact-v1",
    displayName: input.data.contact.displayName, email: input.data.contact.email.toLowerCase(), phone: input.data.contact.phone,
    cityState: input.data.contact.cityState, linkedInOrPortfolio: input.data.contact.linkedInOrPortfolio || null }), "utf8");
  const contactPayloadSha256 = createHash("sha256").update(contactPlaintext).digest("hex");
  const selectionSha256 = createHash("sha256").update(JSON.stringify({ contractVersion: "board-material-v1",
    customerId: access.customerId, profileSnapshotId: access.profileId, boardAdmissionId: admissionResult.data.id,
    jobId, ruleId: rule.id, contactPayloadSha256, emphasisNote: input.data.emphasisNote,
    doNotMentionNote: input.data.doNotMentionNote, careerBreakChoice: input.data.careerBreakChoice,
    careerBreakCustomLabel: input.data.careerBreakCustomLabel || null,
    coverLetterBreakConsent: input.data.coverLetterBreakConsent })).digest("hex");
  const requestKey = `board-materials:${selectionSha256}`;
  const contactPayloadId = deterministicUuid(`material-contact:${requestKey}`);
  try {
    const existing = await access.admin.from("ap_sensitive_payloads").select("id,content_sha256").eq("id", contactPayloadId).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data && existing.data.content_sha256 !== contactPayloadSha256) throw new Error("material_contact_idempotency_conflict");
    if (!existing.data) {
      const kms = sensitivePayloadConfiguration();
      if (!sensitivePayloadEncryptionReady(kms)) return response({ error: "Materials checkout is disabled until the approved KMS is configured." }, 503);
      const envelope = await encryptSensitivePayload({ plaintext: contactPlaintext,
        context: { customerId: access.customerId, payloadId: contactPayloadId, purpose: "CHUNK5_DOCUMENT_CONTACT" },
        configuration: kms, kms: remoteKmsAdapter() });
      const inserted = await access.admin.from("ap_sensitive_payloads").insert({ id: contactPayloadId,
        customer_id: access.customerId, ciphertext: postgresBytea(envelope.ciphertext), encryption_algorithm: envelope.algorithm,
        encrypted_data_key: postgresBytea(envelope.encryptedDataKey), nonce: postgresBytea(envelope.nonce),
        authentication_tag: postgresBytea(envelope.authenticationTag), content_sha256: envelope.contentSha256,
        kms_key_identity: envelope.keyIdentity, kms_key_version: envelope.keyVersion, encryption_context_hash: envelope.encryptionContextHash });
      if (inserted.error && inserted.error.code !== "23505") throw inserted.error;
    }
  } catch { return response({ error: "Protected document contact details could not be prepared." }, 503); }
  finally { contactPlaintext.fill(0); }

  const prepared = await access.admin.rpc("ap_begin_board_material_checkout", {
    p_customer_id: access.customerId, p_board_admission_id: admissionResult.data.id,
    p_source_snapshot_id: access.profileId, p_contact_payload_id: contactPayloadId,
    p_request_key: requestKey, p_selection_sha256: selectionSha256, p_submission_rule_id: rule.id,
    p_emphasis_note: input.data.emphasisNote, p_do_not_mention_note: input.data.doNotMentionNote,
    p_career_break_choice: input.data.careerBreakChoice,
    p_career_break_custom_label: input.data.careerBreakCustomLabel || null,
    p_cover_letter_break_consent: input.data.coverLetterBreakConsent,
    p_document_contact_confirmed: true, p_document_facts_confirmed: true,
  });
  const checkout = prepared.data && typeof prepared.data === "object" && !Array.isArray(prepared.data)
    ? prepared.data as Record<string, unknown> : null;
  if (prepared.error || !checkout?.checkoutIntentId || !checkout.expiresAt || !checkout.providerIdempotencyKey) {
    return response({ error: "This board job is not currently eligible for safe document checkout. No charge was made." }, 409);
  }
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({ mode: "payment", payment_method_types: ["card"],
      customer_email: input.data.contact.email.toLowerCase(), expires_at: Math.floor(new Date(String(checkout.expiresAt)).getTime() / 1_000),
      success_url: `${origin}/checkout/return`, cancel_url: `${origin}/my-applypack/job-board/${jobId}?checkout=cancelled`,
      line_items: [{ quantity: 1, price: priceId }], metadata: { checkout_intent_id: String(checkout.checkoutIntentId),
        product_kind: "apply_pack", contract_version: "chunk5-v1", material_source_kind: "BOARD" },
    }, { idempotencyKey: String(checkout.providerIdempotencyKey) });
  } catch { return response({ error: "Checkout creation has an ambiguous provider result. Retry safely; the same command will be reconciled.", retryable: true }, 502); }
  if (!session.url) return response({ error: "Checkout did not return a secure URL. No work was activated." }, 502);
  const promoted = await access.admin.rpc("ap_promote_material_checkout", { p_checkout_intent_id: String(checkout.checkoutIntentId),
    p_provider_session_id: session.id, p_provider_session_expires_at: new Date(session.expires_at * 1_000).toISOString() });
  if (promoted.error || !promoted.data) {
    let expired = false;
    try { await stripe.checkout.sessions.expire(session.id); expired = true; } catch { /* retained for reconciliation */ }
    if (expired) await access.admin.rpc("ap_expire_material_checkout", { p_checkout_intent_id: String(checkout.checkoutIntentId), p_reason: "LOCAL_PROMOTION_FAILED_PROVIDER_EXPIRED" });
    return response({ error: "Checkout could not be safely linked. No work was activated." }, 502);
  }
  return response({ url: session.url, expiresAt: new Date(session.expires_at * 1_000).toISOString(),
    lineCount: 1, amountCents: MATERIAL_LINE_PRICE_CENTS, currency: "USD" }, 201);
}

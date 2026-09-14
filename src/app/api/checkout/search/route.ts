import { NextResponse } from "next/server";
import { z } from "zod";
import { anonymousDraftContext, anonymousDraftError } from "@/lib/drafts/anonymous-server";
import { canonicalApplicationOrigin, checkoutCookieSettings, deriveCheckoutCapability, deterministicUuid,
  hashCapabilitySecret, postgresBytea, searchCheckoutRequestKey, searchQuoteSha256,
  serializeCheckoutCapability } from "@/lib/commerce/server";
import { sensitivePayloadConfiguration, sensitivePayloadEncryptionReady, encryptSensitivePayload } from "@/lib/security/sensitive-payload";
import { remoteKmsAdapter } from "@/lib/security/remote-kms";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { isSameOriginRequest } from "@/lib/security/origin";
import { assertConfiguredPrice, createStripeSearchClient } from "@/lib/stripe/server";

const schema = z.object({
  snapshotId: z.uuid(),
  assessmentId: z.uuid(),
}).strict();

type CommerceConfiguration = {
  canonical_site_url: string | null;
  access_callback_url: string | null;
  pricing_version: string | null;
  tax_version: string | null;
  terms_version: string | null;
  privacy_version: string | null;
  payment_provider: string | null;
  payment_api_version: string | null;
  immediate_payment_methods: string[];
  provider_idempotent_email_approved: boolean;
  provider_email_approval_reference: string | null;
  checkout_enabled: boolean;
};

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "This checkout request was rejected." }, { status: 403 });
  }
  const context = await anonymousDraftContext();
  if (!context) return NextResponse.json({ error: "The saved intake is unavailable." }, { status: 404 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "The current feasibility result is required." }, { status: 400 });
  }
  const rate = await consumeRateLimit({
    request,
    scope: "chunk4_search_checkout",
    identity: context.capability.draftId,
    limit: 5,
    windowSeconds: 60 * 60,
  });
  if (!rate.configured) return NextResponse.json({ error: "Secure checkout is not connected yet." }, { status: 503 });
  if (!rate.allowed) return NextResponse.json({ error: "Too many checkout attempts. Try again later." }, { status: 429 });

  const stripe = createStripeSearchClient();
  const priceId = process.env.STRIPE_JOB_SEARCH_PRICE_ID;
  if (!stripe || !priceId) {
    return NextResponse.json({ error: "Live checkout is not connected yet." }, { status: 503 });
  }
  let applicationOrigin: string;
  try {
    applicationOrigin = canonicalApplicationOrigin();
  } catch {
    return NextResponse.json({ error: "The canonical secure site URL is not configured." }, { status: 503 });
  }
  const { data: feasibility, error: feasibilityError } = await context.admin.rpc("ap_read_current_feasibility", {
    p_draft_id: context.capability.draftId,
    p_secret_hash: context.secretHash,
  });
  const view = feasibility && typeof feasibility === "object" && !Array.isArray(feasibility)
    ? feasibility as Record<string, unknown> : null;
  if (feasibilityError) {
    const mapped = anonymousDraftError(feasibilityError);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
  if (!view || view.snapshotId !== parsed.data.snapshotId || view.assessmentId !== parsed.data.assessmentId
    || view.state !== "COMPLETE" || view.outcome !== "LIKELY" || view.checkoutEligible !== true) {
    return NextResponse.json({ error: "This search is not currently eligible for Checkout. No payment was started." }, { status: 409 });
  }

  const { data: configuration, error: configurationError } = await context.admin.from("ap_commerce_configuration")
    .select("canonical_site_url,access_callback_url,pricing_version,tax_version,terms_version,privacy_version,payment_provider,payment_api_version,immediate_payment_methods,provider_idempotent_email_approved,provider_email_approval_reference,checkout_enabled")
    .eq("singleton", true).maybeSingle();
  const commerce = configuration as CommerceConfiguration | null;
  if (configurationError || !commerce || !commerce.checkout_enabled
    || commerce.canonical_site_url !== applicationOrigin || commerce.access_callback_url !== `${applicationOrigin}/auth/callback`
    || !commerce.pricing_version || !commerce.tax_version || !commerce.terms_version || !commerce.privacy_version
    || commerce.payment_provider !== "stripe" || !commerce.payment_api_version
    || commerce.immediate_payment_methods.length !== 1 || commerce.immediate_payment_methods[0] !== "card"
    || !commerce.provider_idempotent_email_approved || !commerce.provider_email_approval_reference) {
    return NextResponse.json({ error: "Checkout is disabled until the required tax, payment, access, and email settings are approved." }, { status: 503 });
  }
  try {
    await assertConfiguredPrice(stripe, priceId, { unitAmount: 2_000, productName: "Job Match Search" });
  } catch {
    return NextResponse.json({ error: "Checkout pricing failed verification. No charge was made." }, { status: 503 });
  }

  const requestKey = searchCheckoutRequestKey({
    draftId: context.capability.draftId,
    snapshotId: parsed.data.snapshotId,
    assessmentId: parsed.data.assessmentId,
  });
  const quoteId = deterministicUuid(`quote:${requestKey}`);
  const commandId = deterministicUuid(`checkout-command:${requestKey}`);
  const checkoutAttemptId = deterministicUuid(`checkout-attempt:${requestKey}`);
  const paymentAttemptId = deterministicUuid(`payment-attempt:${requestKey}`);
  const accessPayloadId = deterministicUuid(`access-payload:${requestKey}`);
  const browserSecret = deriveCheckoutCapability(context.capability.secret, requestKey, "browser");
  const emailSecret = deriveCheckoutCapability(context.capability.secret, requestKey, "email");
  const providerIdempotencyKey = `search-checkout/${commandId}`;
  const quoteSha256 = searchQuoteSha256({
    draftId: context.capability.draftId,
    snapshotId: parsed.data.snapshotId,
    assessmentId: parsed.data.assessmentId,
    requestKey,
    pricingVersion: commerce.pricing_version,
    taxVersion: commerce.tax_version,
    termsVersion: commerce.terms_version,
    privacyVersion: commerce.privacy_version,
  });

  const { data: existingPayload, error: payloadQueryError } = await context.admin
    .from("ap_sensitive_payloads").select("id").eq("id", accessPayloadId).maybeSingle();
  if (payloadQueryError) {
    return NextResponse.json({ error: "Secure order access could not be prepared." }, { status: 502 });
  }
  if (!existingPayload) {
    const kmsConfiguration = sensitivePayloadConfiguration();
    if (!sensitivePayloadEncryptionReady(kmsConfiguration)) {
      return NextResponse.json({ error: "Secure order access is disabled until the approved KMS is configured." }, { status: 503 });
    }
    const plaintext = Buffer.from(JSON.stringify({
      schemaVersion: "chunk4-order-access-v1",
      emailAccessSecret: emailSecret,
    }), "utf8");
    try {
      const envelope = await encryptSensitivePayload({
        plaintext,
        context: { draftId: context.capability.draftId, checkoutAttemptId, purpose: "CHUNK4_ORDER_ACCESS" },
        configuration: kmsConfiguration,
        kms: remoteKmsAdapter(),
      });
      const inserted = await context.admin.from("ap_sensitive_payloads").insert({
        id: accessPayloadId,
        draft_id: context.capability.draftId,
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
    } catch {
      return NextResponse.json({ error: "Secure order access could not be prepared." }, { status: 503 });
    } finally {
      plaintext.fill(0);
    }
  }

  const { data: prepared, error: prepareError } = await context.admin.rpc("ap_begin_search_checkout", {
    p_draft_id: context.capability.draftId,
    p_secret_hash: context.secretHash,
    p_snapshot_id: parsed.data.snapshotId,
    p_assessment_id: parsed.data.assessmentId,
    p_request_key: requestKey,
    p_quote_id: quoteId,
    p_quote_sha256: quoteSha256,
    p_command_id: commandId,
    p_provider_idempotency_key: providerIdempotencyKey,
    p_checkout_attempt_id: checkoutAttemptId,
    p_payment_attempt_id: paymentAttemptId,
    p_browser_secret_hash: hashCapabilitySecret(browserSecret),
    p_email_secret_hash: hashCapabilitySecret(emailSecret),
    p_access_payload_id: accessPayloadId,
  });
  const checkout = Array.isArray(prepared) ? prepared[0] : prepared;
  if (prepareError || !checkout?.checkout_attempt_id || !checkout.reservation_expires_at || !checkout.access_email) {
    return NextResponse.json({ error: "The current capacity reservation or immutable quote could not be created. No payment was started." }, { status: 409 });
  }

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: String(checkout.access_email),
      expires_at: Math.floor(new Date(String(checkout.reservation_expires_at)).getTime() / 1_000),
      success_url: `${applicationOrigin}/checkout/return`,
      cancel_url: `${applicationOrigin}/checkout/return?cancelled=1`,
      line_items: [{ quantity: 1, price: priceId }],
      metadata: {
        checkout_attempt_id: String(checkout.checkout_attempt_id),
        quote_id: String(checkout.quote_id),
        product_kind: "job_search",
        contract_version: "chunk4-v1",
      },
    }, { idempotencyKey: String(checkout.provider_idempotency_key) });
  } catch {
    return NextResponse.json({
      error: "Checkout creation has an ambiguous provider result. Retry safely; the same command key will be reconciled and no second quote is created.",
      retryable: true,
    }, { status: 502 });
  }
  if (!session.url) {
    return NextResponse.json({ error: "Checkout did not return a secure URL. No unverified order was activated." }, { status: 502 });
  }
  const promoted = await context.admin.rpc("ap_promote_search_checkout", {
    p_checkout_attempt_id: String(checkout.checkout_attempt_id),
    p_provider_session_id: session.id,
    p_provider_session_expires_at: new Date(session.expires_at * 1_000).toISOString(),
  });
  if (promoted.error || !promoted.data) {
    let expired = false;
    try {
      await stripe.checkout.sessions.expire(session.id);
      expired = true;
    } catch {
      // Reconciliation remains required; a worker must not assume provider cancellation.
    }
    if (expired) {
      await context.admin.rpc("ap_compensate_search_checkout", {
        p_checkout_attempt_id: String(checkout.checkout_attempt_id),
        p_failure_code: "LOCAL_PROMOTION_FAILED_PROVIDER_EXPIRED",
        p_provider_session_id: session.id,
      });
    }
    return NextResponse.json({ error: "Checkout could not be safely linked. No work was activated." }, { status: 502 });
  }

  const response = NextResponse.json({
    url: session.url,
    expiresAt: new Date(session.expires_at * 1_000).toISOString(),
    amountCents: 2_000,
    currency: "USD",
  });
  const cookie = checkoutCookieSettings();
  response.cookies.set(cookie.name, serializeCheckoutCapability({
    checkoutAttemptId: String(checkout.checkout_attempt_id),
    secret: browserSecret,
  }), cookie);
  return response;
}

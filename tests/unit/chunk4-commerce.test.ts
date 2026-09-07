import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { escapeEmailHtml, renderChunk4Email } from "@/lib/commerce/email";
import {
  ACCESS_LINK_MINUTES,
  CHECKOUT_RESERVATION_MINUTES,
  DISPLAY_TIME_ZONE,
  RELEASE_VERIFICATION_MINUTES,
  SEARCH_CHECKOUT_CTA,
  SEARCH_PRICE_CENTS,
  SEARCH_PRICE_LABEL,
  checkoutStatusPresentation,
  feasibilityPresentation,
  formatEasternDeadline,
  safeOrderDestination,
} from "@/lib/commerce/presentation";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const checkoutRoute = source("src/app/api/checkout/search/route.ts");
const checkoutEditRoute = source("src/app/api/checkout/search/edit/route.ts");
const checkoutStatusRoute = source("src/app/api/checkout/search/status/route.ts");
const checkoutReturnPage = source("src/app/checkout/return/page.tsx");
const webhookRoute = source("src/app/api/stripe/webhook/route.ts");
const accessRoute = source("src/app/auth/order-access/route.ts");
const accessResendRoute = source("src/app/api/auth/order-access/resend/route.ts");
const commerceServer = source("src/lib/commerce/server.ts");
const outbox = source("src/lib/commerce/outbox.ts");
const workers = source("src/lib/commerce/workers.ts");
const releaseRoute = source("src/app/api/admin/search-orders/[id]/deliver/route.ts");
const migration = source("supabase/migrations/202609060030_chunk4_commerce_release.sql");

describe("Chunk 4 commerce contract", () => {
  it("uses the exact governed price, clocks, CTA, and display time zone", () => {
    expect(SEARCH_PRICE_CENTS).toBe(2_000);
    expect(SEARCH_PRICE_LABEL).toBe("$20");
    expect(SEARCH_CHECKOUT_CTA).toBe("Pay $20 and Start My Search");
    expect(CHECKOUT_RESERVATION_MINUTES).toBe(30);
    expect(ACCESS_LINK_MINUTES).toBe(15);
    expect(RELEASE_VERIFICATION_MINUTES).toBe(60);
    expect(DISPLAY_TIME_ZONE).toBe("America/New_York");
  });

  it("keeps the persisted clock at 24 elapsed UTC hours across weekends and DST", () => {
    const springStart = new Date("2026-03-07T17:00:00.000Z");
    const springDue = new Date(springStart.getTime() + 24 * 60 * 60 * 1_000);
    expect(springDue.getTime() - springStart.getTime()).toBe(86_400_000);
    expect(formatEasternDeadline(springStart)).toContain("Saturday, March 7, 2026");
    expect(formatEasternDeadline(springStart)).toContain("EST");
    expect(formatEasternDeadline(springDue)).toContain("Sunday, March 8, 2026");
    expect(formatEasternDeadline(springDue)).toContain("EDT");

    const fallStart = new Date("2026-10-31T16:00:00.000Z");
    const fallDue = new Date(fallStart.getTime() + 24 * 60 * 60 * 1_000);
    expect(fallDue.getTime() - fallStart.getTime()).toBe(86_400_000);
    expect(formatEasternDeadline(fallStart)).toContain("EDT");
    expect(formatEasternDeadline(fallDue)).toContain("EST");
    expect(migration).toContain("due_at:=started_at+interval '24 hours'");
    expect(migration).toContain("revision_due_at_value:=revision_started_at_value+interval '24 hours'");
  });

  it("fails closed for stale, incomplete, infeasible, and capacity-unavailable feasibility", () => {
    for (const state of ["PENDING", "STALE", "ERROR"] as const) {
      expect(feasibilityPresentation({ state, outcome: null, checkoutEligible: false }).canCheckout).toBe(false);
    }
    expect(feasibilityPresentation({ state: "COMPLETE", outcome: "INFEASIBLE", checkoutEligible: false }).canCheckout).toBe(false);
    expect(feasibilityPresentation({ state: "COMPLETE", outcome: "LIKELY", checkoutEligible: true, capacityAvailable: false }).canCheckout).toBe(false);
    expect(feasibilityPresentation({ state: "COMPLETE", outcome: "LIKELY", checkoutEligible: true, capacityAvailable: true }).canCheckout).toBe(true);
  });

  it("never treats the browser return as payment proof", () => {
    const view = checkoutStatusPresentation("CONFIRMING_PAYMENT");
    expect(view.message).toContain("browser return is not proof of payment");
    expect(view.message).toContain("signed payment webhook");
  });

  it("keeps post-access navigation local", () => {
    expect(safeOrderDestination("/my-applypack?order=one")).toBe("/my-applypack?order=one");
    expect(safeOrderDestination("https://attacker.invalid", "order-1")).toBe("/my-applypack?order=order-1");
    expect(safeOrderDestination("//attacker.invalid", "order-1")).toBe("/my-applypack?order=order-1");
    expect(safeOrderDestination("/\\attacker.invalid", "order-1")).toBe("/my-applypack?order=order-1");
  });

  it("renders accessible multipart transactional email without unsafe markup or outcome promises", () => {
    expect(escapeEmailHtml('<script data-x="1">&')).toBe("&lt;script data-x=&quot;1&quot;&gt;&amp;");
    const rendered = renderChunk4Email({
      kind: "SEARCH_EXACT_TEN_DELIVERED",
      actionUrl: "https://applypack.work/my-applypack?order=one&from=email",
      orderId: "order-1",
    });
    expect(rendered.subject).toContain("10 ApplyPack job matches");
    expect(rendered.text).toContain("exactly 10 researched job matches");
    expect(rendered.text).toContain("does not submit applications or guarantee interviews");
    expect(rendered.html).toContain('<html lang="en">');
    expect(rendered.html).toContain("https://applypack.work/my-applypack?order=one&amp;from=email");
    expect(rendered.html).not.toContain("<script");
    expect(() => renderChunk4Email({ kind: "SECURE_ACCESS_RESEND", actionUrl: "ftp://localhost/order" })).toThrow("transactional_email_url_must_be_https");
  });

  it("renders every required lifecycle template without provider or signup language", () => {
    const kinds = [
      "PAYMENT_VERIFIED_SEARCH_STARTED",
      "CAPACITY_PAYMENT_EXCEPTION",
      "ADJUSTMENT_REQUIRED",
      "ADJUSTMENT_ACCEPTED",
      "REFUND_INITIATED",
      "REFUND_COMPLETED",
      "REFUND_PROBLEM",
      "SEARCH_EXACT_TEN_DELIVERED",
      "SECURE_ACCESS_RESEND",
    ] as const;
    for (const kind of kinds) {
      const rendered = renderChunk4Email({
        kind,
        actionUrl: "https://applypack.work/my-applypack?order=one",
        orderId: "order-1",
        deadline: "2026-09-08T12:00:00.000Z",
        currentValidCount: 7,
        criteriaDiff: { workModes: { before: ["REMOTE"], after: ["REMOTE", "HYBRID"] } },
      });
      const combined = `${rendered.subject}\n${rendered.text}\n${rendered.html}`;
      expect(rendered.text.length).toBeGreaterThan(40);
      expect(rendered.html).toContain('<meta name="viewport"');
      expect(combined).not.toMatch(/finish signing up|confirm your email|Supabase Auth|powered by Supabase/i);
    }
  });

  it("binds checkout to server-side facts, a card-only provider session, and a durable promotion", () => {
    expect(checkoutRoute).toContain('context.admin.rpc("ap_read_current_feasibility"');
    expect(checkoutRoute).toContain('view.outcome !== "LIKELY"');
    expect(checkoutRoute).toContain("unitAmount: 2_000");
    expect(checkoutRoute).toContain('payment_method_types: ["card"]');
    expect(checkoutRoute).toContain('line_items: [{ quantity: 1, price: priceId }]');
    expect(checkoutRoute).not.toContain("price_data");
    expect(checkoutRoute).toContain('context.admin.rpc("ap_promote_search_checkout"');
    expect(checkoutRoute).toContain("amountCents: 2_000");
    expect(migration).toContain("p_amount_cents<>2000 or upper(p_currency)<>'USD'");
    expect(checkoutEditRoute).toContain('rpc("ap_begin_pre_activation_edit"');
  });

  it("keeps checkout status on an HTTP-only narrow capability rather than a provider id", () => {
    expect(checkoutRoute).toContain('success_url: `${applicationOrigin}/checkout/return`');
    expect(checkoutRoute).not.toContain("{CHECKOUT_SESSION_ID}");
    expect(checkoutRoute).not.toContain("session_id=");
    expect(checkoutReturnPage).not.toContain('searchParams.get("session_id")');
    expect(checkoutStatusRoute).toContain("parseCheckoutCapability");
    expect(checkoutStatusRoute).toContain("p_checkout_attempt_id: current.capability.checkoutAttemptId");
    expect(checkoutStatusRoute).not.toContain("provider_checkout_session_id");
    expect(checkoutStatusRoute).not.toContain("searchParams");
    expect(commerceServer).toContain("httpOnly: true");
    expect(commerceServer).toContain('sameSite: "lax"');
    expect(commerceServer).toContain('__Host-applypack_checkout');
  });

  it("verifies the signed webhook exactly once and activates search atomically", () => {
    expect(webhookRoute.match(/request\.text\(\)/g)).toHaveLength(1);
    expect(webhookRoute).toContain("stripe.webhooks.constructEvent(rawBody, signature, secret)");
    expect(webhookRoute).toContain("stripe.checkout.sessions.retrieve");
    expect(webhookRoute).toContain("stripe.paymentIntents.retrieve");
    expect(webhookRoute).toContain("stripe.charges.retrieve");
    expect(webhookRoute).toContain('admin.rpc("ap_apply_verified_search_payment"');
    expect(webhookRoute).toContain("p_payer_receipt_email: payerEmail");
  });

  it("uses a durable idempotent outbox and bounded scheduled reconciliation", () => {
    expect(outbox).toContain("message.provider_idempotency_key");
    expect(outbox).toContain('admin.rpc("ap_align_access_capability_to_outbox"');
    expect(outbox).toContain("outboxShouldDeadLetter(message.first_submitted_at)");
    expect(workers).toContain('payment_method_types: ["card"]');
    expect(workers).toContain('admin.rpc("ap_claim_scheduled_jobs"');
    expect(workers).toContain('admin.rpc("ap_complete_external_scheduled_job"');
    expect(workers).toContain("stripe.refunds.retrieve");
    expect(workers).toContain("stripe.refunds.create");
    expect(workers).toContain("idempotencyKey: command.provider_idempotency_key");
    expect(workers).toContain("stripe.checkout.sessions.retrieve");
    expect(workers).toContain("stripe.checkout.sessions.expire");
    expect(outbox).toContain("email_provider_guarantee_unapproved");
    expect(outbox).toContain("{ idempotencyKey: message.provider_idempotency_key }");
  });

  it("consumes single-use access, removes token material, and resends without enumeration", () => {
    expect(accessRoute).toContain('admin.rpc("ap_consume_order_access"');
    expect(accessRoute).toContain("safeOrderDestination");
    expect(accessRoute).toContain("supabase.auth.verifyOtp");
    expect(accessRoute).toContain("token_hash: tokenHash");
    expect(accessRoute).toContain("NextResponse.redirect(clean");
    expect(accessRoute).not.toContain("NextResponse.redirect(request.url");
    expect(accessResendRoute).toContain('scope: "chunk4_access_resend"');
    expect(accessResendRoute).toContain("Deliberately indistinguishable");
    expect(accessResendRoute.match(/status: 202/g)?.length).toBeGreaterThanOrEqual(4);
    expect(accessResendRoute).toContain('rpc("ap_issue_order_access_capability"');
  });

  it("commits only a current, human-approved, immutable exact-ten release", () => {
    expect(releaseRoute).toContain('admin.rpc("ap_commit_exact_ten_release"');
    expect(migration).toContain("jsonb_array_length(p_members)<>10");
    expect(migration).toContain("evaluation.application_readiness<>'READY'");
    expect(migration).toContain("evaluation.legacy_compatibility or job.legacy_compatibility");
    expect(migration).toContain("service_row.fulfillment='ADJUSTMENT_REQUIRED' or service_row.adjustment='PROPOSED'");
    expect(migration).toContain("job.live_verified_at<now_at-make_interval(secs=>configured_ttl)");
    expect(migration).toContain("release_jobs_not_pairwise_unique");
    expect(migration).toContain("selection_row.selector_version<>'bounded-diversity-v2'");
    expect(migration).toContain("evaluation.calculation_version<>'matching-rules-v3'");
    expect(migration).toContain("evaluation.version_bundle->>'jobSnapshot'<>job.content_sha256");
    expect(migration).toContain("confirmed_hard_failure_not_approvable");
    expect(migration).toContain("now_at<=service_row.delivery_due_at");
    expect(migration).toContain("now_at>service_row.delivery_due_at");
    expect(migration).toContain("'EXACT_TEN_RELEASED'");
  });
});

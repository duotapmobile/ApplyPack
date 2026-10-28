import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const transport = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("resend", () => ({ Resend: class { emails = { send: transport.send }; } }));
import { intakeClarificationDelivery, intakeNotificationEnvelopeSha256 } from "@/lib/commerce/intake-notification";
import { processChunk4Outbox } from "@/lib/commerce/outbox";
import * as templates from "@/lib/commerce/email";

const id = (n: number) => `b1030000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.parse("2026-10-27T03:00:00Z");
function fixture() {
  const message = { id: id(1), customer_id: id(2), order_id: null, payload_ref: null,
    message_kind: "INTAKE_CLARIFICATION_REQUIRED", recipient_ref: id(3), provider_idempotency_key: `intake-question/${id(3)}`,
    first_submitted_at: new Date(now - 1000).toISOString() };
  const context = { messageId: message.id, customerId: message.customer_id, questionId: message.recipient_ref,
    rootDraftId: id(4), recipientEmail: "verified@example.invalid", providerIdempotencyKey: message.provider_idempotency_key,
    templateVersion: "intake-clarification-notice-v1" };
  return { message, context };
}
describe("private intake notification boundary", () => {
  it("renders byte-identical retries with no question, customer or capability content", () => {
    const f = fixture();
    const first = intakeClarificationDelivery(f.message, f.context, "https://applypack.work", now);
    const retry = intakeClarificationDelivery(f.message, f.context, "https://applypack.work", now + 60_000);
    expect(retry).toEqual(first); expect(first.recipient).toBe("verified@example.invalid");
    expect(first.idempotencyKey).toBe(f.message.provider_idempotency_key);
    const content = JSON.stringify(first.rendered);
    for (const privateValue of [id(1), id(2), id(3), id(4), f.context.recipientEmail]) expect(content).not.toContain(privateValue);
    expect(first.rendered.text).toContain("https://applypack.work/my-applypack");
  });
  it("pins every exact provider field with a stable field order", () => {
    const body = { from: "ApplyPack <orders@applypack.work>", to: "verified@example.invalid", replyTo: "help@applypack.work",
      subject: "An update", text: "Review your intake.", html: "<p>Review your intake.</p>" };
    const digest = intakeNotificationEnvelopeSha256(body);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(intakeNotificationEnvelopeSha256({ html: body.html, text: body.text, subject: body.subject, replyTo: body.replyTo, to: body.to, from: body.from })).toBe(digest);
    for (const field of ["from", "to", "replyTo", "subject", "text", "html"] as const) {
      expect(intakeNotificationEnvelopeSha256({ ...body, [field]: `${body[field]} changed` })).not.toBe(digest);
    }
  });
  it.each(["messageId", "customerId", "questionId", "providerIdempotencyKey"] as const)("rejects mismatched %s", (field) => {
    const f = fixture(); f.context[field] = id(99);
    expect(() => intakeClarificationDelivery(f.message, f.context, "https://applypack.work", now)).toThrow("intake_notice_context_mismatch");
  });
  it.each(["prompt", "answer", "capability", "document", "actionUrl"])("rejects a context carrying %s", (field) => {
    const f = fixture();
    expect(() => intakeClarificationDelivery(f.message, { ...f.context, [field]: "private-content" }, "https://applypack.work", now)).toThrow();
  });
  it("requires a bound owner and excludes paid/order payloads", () => {
    const f = fixture();
    for (const changed of [{ customer_id: null }, { order_id: id(5) }, { payload_ref: id(6) }, { message_kind: "MATERIALS_DELIVERED" }]) {
      expect(() => intakeClarificationDelivery({ ...f.message, ...changed }, f.context, "https://applypack.work", now)).toThrow();
    }
  });
  it("fails closed for a missing recipient, unknown template or missing first submission", () => {
    const f = fixture();
    for (const changed of [{ recipientEmail: "" }, { templateVersion: "future-v2" }, { providerIdempotencyKey: "bad\r\nheader" }]) {
      expect(() => intakeClarificationDelivery(f.message, { ...f.context, ...changed }, "https://applypack.work", now)).toThrow();
    }
    expect(() => intakeClarificationDelivery({ ...f.message, first_submitted_at: null }, f.context, "https://applypack.work", now)).toThrow();
  });
  it("does not dispatch after the provider retry window or before the first submission", () => {
    const f = fixture(), first = Date.parse(f.message.first_submitted_at);
    expect(() => intakeClarificationDelivery(f.message, f.context, "https://applypack.work", first + 24 * 60 * 60_000)).toThrow("intake_notice_retry_window_expired");
    expect(() => intakeClarificationDelivery(f.message, f.context, "https://applypack.work", first - 1)).toThrow("intake_notice_retry_window_expired");
  });
  it.each(["https://applypack.work/path", "https://applypack.work?access=secret", "https://user:secret@applypack.work", "ftp://applypack.work"])("rejects a noncanonical origin %s", (origin) => {
    const f = fixture(); expect(() => intakeClarificationDelivery(f.message, f.context, origin, now)).toThrow();
  });
});

describe("connected outbox dispatch with leased notification context", () => {
  const original = { ...process.env };
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(now); transport.send.mockReset();
    transport.send.mockResolvedValue({ data: { id: "fictional-provider-message" }, error: null });
    process.env.NEXT_PUBLIC_APP_URL = "https://applypack.work";
    process.env.RESEND_API_KEY = "fictional-test-only";
    process.env.EMAIL_FROM_ADDRESS = "orders@applypack.work";
    process.env.EMAIL_REPLY_TO = "help@applypack.work";
    process.env.APP_PAYMENT_MODE = "test";
    process.env.APP_SAFE_TEST_EMAILS = "verified@example.invalid,paid@example.invalid";
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); process.env = { ...original }; });
  function db(options: { sdkAdapters?: boolean; completeError?: boolean; submitLeaseError?: boolean; historical?: boolean; paidKind?: string; noOrder?: boolean; pinnedEnvelope?: { digest: string | null } } = {}) {
    const f = fixture(); let renewals = 0;
    const message = options.historical || options.paidKind ? { ...f.message, message_kind: options.paidKind ?? "MATERIALS_DELIVERED", order_id: options.noOrder ? null : id(8), payload_ref: id(10) } : f.message;
    const rpc = vi.fn(async (name: string, args?: Record<string, string>) => {
      if (options.sdkAdapters && name === "ap_prepare_intake_clarification_notification") return prepare();
      if (options.sdkAdapters && name === "ap_prepare_claimed_payment_notification") return preparePaid();
      if (options.sdkAdapters && ["ap_pin_intake_clarification_delivery", "ap_pin_claimed_payment_delivery"].includes(name)) {
        return pin(args!.p_message_id, args!.p_lease_owner, args!.p_payload_sha256);
      }
      if (name === "ap_claim_outbox_messages") return { data: [{ ...message, attempts: 1 }], error: null };
      if (name === "ap_renew_outbox_lease" && ++renewals === 2 && options.submitLeaseError) return { data: null, error: { message: "lease lost" } };
      if (name === "ap_complete_outbox_message" && options.completeError) return { data: null, error: { message: "completion lost" } };
      return { data: true, error: null };
    });
    const from = vi.fn((table: string) => {
      if (options.paidKind) {
        const details: Record<string, unknown> = {
          ap_criteria_amendments: { current_valid_count: 9, criteria_diff: { workModes: "changed" } },
          ap_refund_operations: { amount_cents: 1899 },
          ap_material_lines: message.message_kind === "MATERIALS_PAYMENT_VERIFIED" ? [{ materials_due_at: "2026-10-28T03:00:00Z" }] : { materials_due_at: "2026-10-28T03:00:00Z" },
          ap_reference_regenerations: { due_at: "2026-10-28T03:00:00Z" },
        };
        if (!(table in details)) throw new Error("Claimed message attempted private recipient/capability lookup");
        const result = { data: details[table], error: null };
        const query = { select: () => query, eq: () => query, limit: () => query, order: () => query, maybeSingle: async () => result,
          then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve) };
        return query;
      }
      if (!options.historical) throw new Error("Unexpected raw private read");
      const data = table === "ap_search_services" ? { original_snapshot_id: id(9), delivery_due_at: null } : { access_email_normalized: "paid@example.invalid" };
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data, error: null }) };
      return query;
    });
    const prepare = vi.fn(async () => ({ data: structuredClone(f.context) as unknown, error: null as unknown }));
    const paidContext = { claimed: true, messageId: message.id, customerId: message.customer_id, orderId: message.order_id,
      rootDraftId: id(4), deliveryDueAt: "2026-10-28T03:00:00Z", recipientEmail: "verified@example.invalid",
      providerIdempotencyKey: message.provider_idempotency_key, templateVersion: "claimed-payment-notice-v1" };
    const preparePaid = vi.fn(async () => ({ data: options.paidKind ? structuredClone(paidContext) as unknown : { claimed: false } as unknown, error: null as unknown }));
    const pinned = options.pinnedEnvelope ?? { digest: null };
    const pin = vi.fn(async (messageId: string, _owner: string, payloadSha256: string) => {
      if (pinned.digest !== null && pinned.digest !== payloadSha256) return { data: null, error: { message: "pinned envelope changed" } };
      pinned.digest = payloadSha256;
      return { data: { messageId, payloadSha256 } as unknown, error: null as unknown };
    });
    const admin = { rpc, from } as unknown as Parameters<typeof processChunk4Outbox>[0];
    return { ...f, message, rpc, from, prepare, preparePaid, paidContext, pin, pinned, admin };
  }
  it.each([undefined, "PAYMENT_VERIFIED_SEARCH_STARTED"])("connects default generated SDK prepare/pin calls for %s", async (paidKind) => {
    const f = db({ sdkAdapters: true, paidKind });
    expect(await processChunk4Outbox(f.admin, "fixture-worker")).toMatchObject({ sent: 1 });
    const prepare = paidKind ? "ap_prepare_claimed_payment_notification" : "ap_prepare_intake_clarification_notification";
    const pin = paidKind ? "ap_pin_claimed_payment_delivery" : "ap_pin_intake_clarification_delivery";
    expect(f.rpc).toHaveBeenCalledWith(prepare, { p_message_id: f.message.id, p_lease_owner: "fixture-worker" });
    expect(f.rpc).toHaveBeenCalledWith(pin, { p_message_id: f.message.id, p_lease_owner: "fixture-worker", p_payload_sha256: f.pinned.digest });
    expect(f.pinned.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(transport.send).toHaveBeenCalledTimes(1);
    expect(f.from).not.toHaveBeenCalled();
  });
  it("uses only the verified resolver, submits once and marks sent only after provider acceptance", async () => {
    const f = db();
    expect(await processChunk4Outbox(f.admin, "fixture-worker", 10, { prepareIntakeNotification: f.prepare, pinIntakeNotification: f.pin })).toMatchObject({ sent: 1 });
    expect(f.prepare).toHaveBeenCalledTimes(2); expect(f.prepare).toHaveBeenCalledWith(f.message.id, "fixture-worker");
    expect(f.from).not.toHaveBeenCalled(); expect(transport.send).toHaveBeenCalledTimes(1);
    expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ to: f.context.recipientEmail, text: expect.stringContaining("https://applypack.work/my-applypack") }), { idempotencyKey: f.message.provider_idempotency_key });
    expect(f.pin).toHaveBeenCalledWith(f.message.id, "fixture-worker", intakeNotificationEnvelopeSha256(transport.send.mock.calls[0][0]));
    expect(f.pin.mock.invocationCallOrder[0]).toBeLessThan(transport.send.mock.invocationCallOrder[0]);
    const completion = f.rpc.mock.calls.findIndex(([name]) => name === "ap_complete_outbox_message");
    expect(completion).toBeGreaterThan(0); expect(f.rpc.mock.invocationCallOrder[completion]).toBeGreaterThan(transport.send.mock.invocationCallOrder[0]);
  });
  it("fails closed with no resolver instead of reading an editable snapshot email", async () => {
    const f = db(); expect(await processChunk4Outbox(f.admin, "fixture-worker")).toMatchObject({ sent: 0 });
    expect(transport.send).not.toHaveBeenCalled(); expect(f.from).not.toHaveBeenCalled();
    expect(f.rpc).toHaveBeenCalledWith("ap_fail_outbox_message", expect.objectContaining({ p_dead_letter: false }));
  });
  it.each(["resolver", "mismatch", "recipient-change", "lease", "allowlist", "expired", "pin-error", "pin-response"])("does not send or mark SENT on %s failure", async (failure) => {
    const f = db({ submitLeaseError: failure === "lease" });
    if (failure === "resolver") f.prepare.mockResolvedValue({ data: null, error: { message: "unavailable" } });
    if (failure === "mismatch") f.context.questionId = id(99);
    if (failure === "recipient-change") f.prepare.mockResolvedValueOnce({ data: structuredClone(f.context), error: null }).mockResolvedValueOnce({ data: { ...f.context, recipientEmail: "changed@example.invalid" }, error: null });
    if (failure === "allowlist") process.env.APP_SAFE_TEST_EMAILS = "other@example.invalid";
    if (failure === "expired") vi.setSystemTime(now + 24 * 60 * 60_000);
    if (failure === "pin-error") f.pin.mockResolvedValue({ data: null, error: { message: "pin unavailable" } });
    if (failure === "pin-response") f.pin.mockResolvedValue({ data: { messageId: id(99), payloadSha256: "0".repeat(64) }, error: null });
    expect(await processChunk4Outbox(f.admin, "fixture-worker", 10, { prepareIntakeNotification: f.prepare, pinIntakeNotification: f.pin })).toMatchObject({ sent: 0 });
    expect(transport.send).not.toHaveBeenCalled(); expect(f.rpc.mock.calls.some(([name]) => name === "ap_complete_outbox_message")).toBe(false);
    expect(f.rpc).toHaveBeenCalledWith("ap_fail_outbox_message", expect.objectContaining({ p_dead_letter: failure === "expired" }));
  });
  it("retries an accepted send with lost completion using exactly the same provider key and body", async () => {
    const first = db({ completeError: true });
    expect(await processChunk4Outbox(first.admin, "fixture-worker", 10, { prepareIntakeNotification: first.prepare, pinIntakeNotification: first.pin })).toMatchObject({ sent: 0 });
    expect(first.rpc).toHaveBeenCalledWith("ap_fail_outbox_message", expect.objectContaining({ p_error_code: "OUTBOX_SEND_FAILED" }));
    const retry = db({ pinnedEnvelope: first.pinned }); expect(await processChunk4Outbox(retry.admin, "fixture-worker", 10, { prepareIntakeNotification: retry.prepare, pinIntakeNotification: retry.pin })).toMatchObject({ sent: 1 });
    expect(transport.send.mock.calls[1]).toEqual(transport.send.mock.calls[0]);
  });
  it.each(["origin", "from", "replyTo"])("refuses an accepted-send retry after %s changes", async (field) => {
    const first = db({ completeError: true });
    await processChunk4Outbox(first.admin, "fixture-worker", 10, { prepareIntakeNotification: first.prepare, pinIntakeNotification: first.pin });
    expect(transport.send).toHaveBeenCalledTimes(1);
    if (field === "origin") process.env.NEXT_PUBLIC_APP_URL = "https://staging.applypack.work";
    if (field === "from") process.env.EMAIL_FROM_ADDRESS = "admin@applypack.work";
    if (field === "replyTo") process.env.EMAIL_REPLY_TO = "orders@applypack.work";
    const retry = db({ pinnedEnvelope: first.pinned });
    expect(await processChunk4Outbox(retry.admin, "fixture-worker", 10, { prepareIntakeNotification: retry.prepare, pinIntakeNotification: retry.pin })).toMatchObject({ sent: 0 });
    expect(transport.send).toHaveBeenCalledTimes(1);
    expect(retry.rpc.mock.calls.some(([name]) => name === "ap_complete_outbox_message")).toBe(false);
  });
  it("refuses a retry whose earlier template body differs from the current deployment", async () => {
    const first = db({ completeError: true });
    await processChunk4Outbox(first.admin, "fixture-worker", 10, { prepareIntakeNotification: first.prepare, pinIntakeNotification: first.pin });
    expect(transport.send).toHaveBeenCalledTimes(1);
    const render = templates.renderChunk4Email;
    vi.spyOn(templates, "renderChunk4Email").mockImplementation((input) => {
      const current = render(input);
      return { ...current, text: `${current.text}\nUpdated generic footer.`, html: `${current.html}<p>Updated generic footer.</p>` };
    });
    const retry = db({ pinnedEnvelope: first.pinned });
    expect(await processChunk4Outbox(retry.admin, "fixture-worker", 10, { prepareIntakeNotification: retry.prepare, pinIntakeNotification: retry.pin })).toMatchObject({ sent: 0 });
    expect(transport.send).toHaveBeenCalledTimes(1);
    expect(retry.rpc.mock.calls.some(([name]) => name === "ap_complete_outbox_message")).toBe(false);
  });
  it("fails closed when the envelope pin adapter is missing", async () => {
    const f = db();
    expect(await processChunk4Outbox(f.admin, "fixture-worker", 10, { prepareIntakeNotification: f.prepare })).toMatchObject({ sent: 0 });
    expect(transport.send).not.toHaveBeenCalled();
    expect(f.rpc.mock.calls.some(([name]) => name === "ap_complete_outbox_message")).toBe(false);
  });
  it("never completes a provider error or a response without its message ID", async () => {
    for (const response of [{ data: null, error: { message: "failure" } }, { data: {}, error: null }]) {
      const f = db(); transport.send.mockResolvedValueOnce(response);
      expect(await processChunk4Outbox(f.admin, "fixture-worker", 10, { prepareIntakeNotification: f.prepare, pinIntakeNotification: f.pin })).toMatchObject({ sent: 0 });
      expect(f.rpc.mock.calls.some(([name]) => name === "ap_complete_outbox_message")).toBe(false);
    }
  });
  it("preserves historical paid delivery dispatch without using the new resolver", async () => {
    const f = db({ historical: true });
    expect(await processChunk4Outbox(f.admin, "fixture-worker", 10, { prepareIntakeNotification: f.prepare, prepareClaimedPaymentNotification: f.preparePaid })).toMatchObject({ sent: 1 });
    expect(f.prepare).not.toHaveBeenCalled(); expect(f.from).toHaveBeenCalledWith("ap_search_services");
    expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({ to: "paid@example.invalid", text: expect.stringContaining("human-reviewed resume and cover letter") }), { idempotencyKey: f.message.provider_idempotency_key });
  });
  it.each(["PAYMENT_VERIFIED_SEARCH_STARTED", "SECURE_ACCESS_RESEND", "SEARCH_EXACT_TEN_DELIVERED", "ADJUSTMENT_REQUIRED", "ADJUSTMENT_ACCEPTED",
    "REFUND_INITIATED", "REFUND_COMPLETED", "REFUND_PROBLEM", "REFUND_PROCESSING", "CAPACITY_EXCEPTION_REFUND", "DUPLICATE_PAYMENT_REFUND", "STALE_PAYMENT_REFUND",
    "PAYMENT_DISPUTE_OPEN", "MATERIALS_PAYMENT_VERIFIED", "MATERIAL_SUBSTITUTION_ACCEPTED", "MATERIAL_FACT_REVISION_ACCEPTED", "MATERIALS_DELIVERED",
    "REFERENCE_REGENERATION_STARTED", "REFERENCE_REGENERATION_DELIVERED", "REFERENCE_REGENERATION_FAILED"])("routes claimed %s to the verified account with no access capability", async (kind) => {
    const f = db({ paidKind: kind, noOrder: kind.includes("REFUND") });
    expect(await processChunk4Outbox(f.admin, "fixture-worker", 10, { prepareClaimedPaymentNotification: f.preparePaid, pinClaimedPaymentNotification: f.pin })).toMatchObject({ sent: 1 });
    const body = transport.send.mock.calls[0][0];
    expect(body.to).toBe("verified@example.invalid");
    expect(body.text).toContain("https://applypack.work/my-applypack");
    expect(body.text).not.toContain("/auth/order-access"); expect(body.html).not.toContain("access=");
    if (["PAYMENT_VERIFIED_SEARCH_STARTED", "SECURE_ACCESS_RESEND"].includes(kind)) {
      expect(body.text).toContain("Sign in with your verified account"); expect(body.text).not.toContain("single-use");
    }
    expect(f.preparePaid).toHaveBeenCalledTimes(2);
    expect(f.rpc.mock.calls.some(([name]) => name === "ap_align_access_capability_to_outbox")).toBe(false);
    for (const table of ["ap_sensitive_payloads", "ap_intake_snapshots", "ap_order_access_capabilities"]) expect(f.from).not.toHaveBeenCalledWith(table);
  });
  it.each(["missing-resolver", "resolver-error", "foreign-customer", "foreign-order", "changed-recipient", "missing-pin"])("never falls back to old snapshot email for claimed payment %s", async (failure) => {
    const f = db({ paidKind: "PAYMENT_VERIFIED_SEARCH_STARTED" });
    if (failure === "resolver-error") f.preparePaid.mockResolvedValue({ data: null, error: { message: "unavailable" } });
    if (failure === "foreign-customer") f.paidContext.customerId = id(99);
    if (failure === "foreign-order") f.paidContext.orderId = id(99);
    if (failure === "changed-recipient") f.preparePaid.mockResolvedValueOnce({ data: f.paidContext, error: null }).mockResolvedValueOnce({ data: { ...f.paidContext, recipientEmail: "reused-address@example.invalid" }, error: null });
    expect(await processChunk4Outbox(f.admin, "fixture-worker", 10, {
      prepareClaimedPaymentNotification: failure === "missing-resolver" ? undefined : f.preparePaid,
      pinClaimedPaymentNotification: failure === "missing-pin" ? undefined : f.pin,
    })).toMatchObject({ sent: 0 });
    expect(transport.send).not.toHaveBeenCalled(); expect(f.from).not.toHaveBeenCalled();
    expect(f.rpc.mock.calls.some(([name]) => name === "ap_complete_outbox_message")).toBe(false);
  });
  it("replays claimed payment exactly and refuses a changed verified recipient under the same key", async () => {
    const first = db({ paidKind: "PAYMENT_VERIFIED_SEARCH_STARTED", completeError: true });
    await processChunk4Outbox(first.admin, "fixture-worker", 10, { prepareClaimedPaymentNotification: first.preparePaid, pinClaimedPaymentNotification: first.pin });
    const retry = db({ paidKind: "PAYMENT_VERIFIED_SEARCH_STARTED", pinnedEnvelope: first.pinned });
    expect(await processChunk4Outbox(retry.admin, "fixture-worker", 10, { prepareClaimedPaymentNotification: retry.preparePaid, pinClaimedPaymentNotification: retry.pin })).toMatchObject({ sent: 1 });
    expect(transport.send.mock.calls[1]).toEqual(transport.send.mock.calls[0]);
    const changed = db({ paidKind: "PAYMENT_VERIFIED_SEARCH_STARTED", pinnedEnvelope: first.pinned });
    changed.paidContext.recipientEmail = "paid@example.invalid";
    expect(await processChunk4Outbox(changed.admin, "fixture-worker", 10, { prepareClaimedPaymentNotification: changed.preparePaid, pinClaimedPaymentNotification: changed.pin })).toMatchObject({ sent: 0 });
    expect(transport.send).toHaveBeenCalledTimes(2);
    expect(changed.rpc.mock.calls.some(([name]) => name === "ap_complete_outbox_message")).toBe(false);
  });
});

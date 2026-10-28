import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const transport = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("resend", () => ({ Resend: class { emails = { send: transport.send }; } }));
import { processChunk4Outbox } from "@/lib/commerce/outbox";
import * as notices from "@/lib/commerce/owner-draft-notification";
const id = (n: number) => `a1060000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.parse("2026-10-28T12:00:00Z"), recipient = "approved-owner@example.invalid";
function database(options: { obsolete?: boolean; complete?: unknown; completeError?: boolean; suppressError?: boolean; malformedSuppress?: boolean;
  secondPrepareObsolete?: boolean; pinError?: boolean; renewError?: boolean; leaseReceipt?: unknown; onPin?: () => void; suppressionReason?: string;
  retained?: { recipient: string | null; digest: string | null }; firstSubmitted?: string } = {}) {
  const pin = options.retained ?? { recipient: null, digest: null }, calls: string[] = [];
  let prepares = 0, suppressed = false, completed = false;
  const key = `owner-draft-ready:${id(3)}:${id(4)}:SOURCE_READY:v1`;
  const message = { id: id(1), customer_id: id(2), order_id: null, payload_ref: null, recipient_ref: id(4), message_kind: notices.OWNER_DRAFT_NOTICE_KIND,
    provider_idempotency_key: key, attempts: 1, first_submitted_at: options.firstSubmitted ?? new Date(now - 1000).toISOString() };
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    calls.push(name);
    if (name === "ap_claim_outbox_messages") return { data: [message], error: null };
    if (name === "ap_renew_outbox_lease") return { data: Object.hasOwn(options, "leaseReceipt") ? options.leaseReceipt : new Date(now + 300000).toISOString(), error: options.renewError ? { message: "lease unavailable" } : null };
    if (name === "ap_prepare_owner_draft_notification") {
      prepares += 1;
      if (pin.recipient && pin.recipient !== args?.p_recipient_email) return { data: null, error: { message: "recipient changed" } };
      pin.recipient ??= String(args?.p_recipient_email);
      if (options.obsolete || options.secondPrepareObsolete && prepares === 2) return { data: { disposition: "OBSOLETE", messageId: id(1), reason: "VERSION_SUPERSEDED" }, error: null };
      return { data: { disposition: "SEND", messageId: id(1), customerId: id(2), jobId: id(3), draftVersionId: id(4), phase: "SOURCE_READY",
        recipientEmail: pin.recipient, providerIdempotencyKey: key, templateVersion: "owner-draft-notice-v1" }, error: null };
    }
    if (name === "ap_pin_owner_draft_delivery") {
      if (options.pinError || pin.recipient !== args?.p_recipient_email || pin.digest && pin.digest !== args?.p_payload_sha256) return { data: null, error: { message: "pin mismatch" } };
      pin.digest ??= String(args?.p_payload_sha256);
      options.onPin?.();
      return { data: { messageId: id(1), payloadSha256: pin.digest }, error: null };
    }
    if (name === "ap_suppress_owner_draft_notification") {
      if (options.suppressError || pin.digest) return { data: null, error: { message: "suppression rejected" } };
      suppressed = true;
      return { data: options.malformedSuppress ? true : { disposition: "SUPPRESSED", messageId: id(1), reason: options.suppressionReason ?? "VERSION_SUPERSEDED" }, error: null };
    }
    if (name === "ap_complete_outbox_message") {
      if (options.completeError) return { data: null, error: { message: "response lost" } };
      completed = options.complete === undefined || options.complete === true;
      return { data: options.complete === undefined ? true : options.complete, error: null };
    }
    if (name === "ap_fail_outbox_message") return { data: true, error: null };
    throw new Error("Unexpected customer or capability RPC");
  });
  const from = vi.fn(() => { throw new Error("Owner notification must not read customer records or decrypt private data"); });
  return { admin: { rpc, from } as unknown as Parameters<typeof processChunk4Outbox>[0], rpc, from, pin, calls,
    state: () => ({ suppressed, completed }) };
}
describe("owner-ready outbox dispatch", () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(now); transport.send.mockReset(); transport.send.mockResolvedValue({ data: { id: "fictional-accepted" }, error: null });
    for (const [key, value] of Object.entries({ NEXT_PUBLIC_APP_URL: "https://applypack.work", RESEND_API_KEY: "fictional-test-only",
      EMAIL_FROM_ADDRESS: "orders@applypack.work", EMAIL_REPLY_TO: "help@applypack.work", APP_PAYMENT_MODE: "test",
      APP_SAFE_TEST_EMAILS: `${recipient},other@example.invalid`, APP_ADMIN_ALERT_EMAIL: recipient })) vi.stubEnv(key, value);
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
  it("uses default SDK adapters, pins before send, and counts only confirmed completion", async () => {
    const f = database();
    transport.send.mockImplementation(async () => { expect(f.pin.digest).toMatch(/^[a-f0-9]{64}$/); return { data: { id: "fictional-accepted" }, error: null }; });
    expect(await processChunk4Outbox(f.admin, "worker")).toEqual({ status: "enabled", attempted: 1, sent: 1, suppressed: 0 });
    expect(f.rpc).toHaveBeenCalledWith("ap_prepare_owner_draft_notification", { p_message_id: id(1), p_lease_owner: "worker", p_recipient_email: recipient });
    expect(f.rpc).toHaveBeenCalledWith("ap_pin_owner_draft_delivery", expect.objectContaining({ p_message_id: id(1), p_lease_owner: "worker", p_recipient_email: recipient }));
    const [body, opts] = transport.send.mock.calls[0]; expect(Object.keys(body).sort()).toEqual(["from", "html", "replyTo", "subject", "text", "to"]);
    expect(body.to).toBe(recipient); expect(opts.idempotencyKey).toBe(`owner-draft-ready:${id(3)}:${id(4)}:SOURCE_READY:v1`);
    for (const value of [id(1), id(2), id(3), id(4), recipient]) expect(body.text + body.html).not.toContain(value);
    expect(f.from).not.toHaveBeenCalled(); expect(f.state().completed).toBe(true);
  });
  it.each([false, true])("counts confirmed obsolete suppression without provider submission (late=%s)", async late => {
    const f = database(late ? { secondPrepareObsolete: true } : { obsolete: true });
    expect(await processChunk4Outbox(f.admin, "worker")).toEqual({ status: "enabled", attempted: 1, sent: 0, suppressed: 1 });
    expect(transport.send).not.toHaveBeenCalled(); expect(f.pin.digest).toBeNull();
    expect(f.calls).not.toContain("ap_complete_outbox_message"); expect(f.calls).not.toContain("ap_fail_outbox_message");
  });
  it.each([{ suppressError: true }, { malformedSuppress: true }])("does not count unconfirmed suppression %j", async changed => {
    const f = database({ obsolete: true, ...changed });
    expect(await processChunk4Outbox(f.admin, "worker")).toMatchObject({ sent: 0, suppressed: 0 }); expect(transport.send).not.toHaveBeenCalled();
  });
  it("uses the suppression transaction's current reason rather than an earlier obsolete classification", async () => {
    const f = database({ obsolete: true, suppressionReason: "PHASE_COMPLETED" });
    expect(await processChunk4Outbox(f.admin, "worker")).toMatchObject({ sent: 0, suppressed: 1 }); expect(transport.send).not.toHaveBeenCalled();
  });
  it.each(["recipient", "allowlist", "expiry"])("checks %s again after awaiting the envelope pin", async kind => {
    const f = database({ onPin: () => {
      if (kind === "recipient") vi.stubEnv("APP_ADMIN_ALERT_EMAIL", "");
      if (kind === "allowlist") vi.stubEnv("APP_SAFE_TEST_EMAILS", "");
      if (kind === "expiry") vi.setSystemTime(now + 24 * 60 * 60_000);
    } });
    expect(await processChunk4Outbox(f.admin, "worker")).toMatchObject({ sent: 0, suppressed: 0 });
    expect(f.pin.digest).not.toBeNull(); expect(transport.send).not.toHaveBeenCalled(); expect(f.calls).not.toContain("ap_complete_outbox_message");
  });
  it("reuses the exact six-field body/key after accepted send with lost completion response", async () => {
    const first = database({ completeError: true });
    expect(await processChunk4Outbox(first.admin, "worker")).toMatchObject({ sent: 0, suppressed: 0 });
    const acceptedCall = structuredClone(transport.send.mock.calls[0]);
    const retry = database({ retained: first.pin }); expect(await processChunk4Outbox(retry.admin, "worker")).toMatchObject({ sent: 1 });
    expect(transport.send.mock.calls[1]).toEqual(acceptedCall); expect(retry.pin).toEqual(first.pin);
  });
  it.each(["origin", "from", "replyTo", "recipient", "template", "revoked"])("never retargets or re-bodies a pinned request when %s changes", async field => {
    const first = database({ completeError: true }); await processChunk4Outbox(first.admin, "worker"); const pinned = { ...first.pin };
    if (field === "origin") vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.applypack.work");
    if (field === "from") vi.stubEnv("EMAIL_FROM_ADDRESS", "updates@applypack.work");
    if (field === "replyTo") vi.stubEnv("EMAIL_REPLY_TO", "different@applypack.work");
    if (field === "recipient") vi.stubEnv("APP_ADMIN_ALERT_EMAIL", "other@example.invalid");
    if (field === "revoked") vi.stubEnv("APP_ADMIN_ALERT_EMAIL", "");
    if (field === "template") { const original = notices.renderOwnerDraftNotice; vi.spyOn(notices, "renderOwnerDraftNotice").mockImplementation((...args) => ({ ...original(...args), subject: "Changed template" })); }
    const retry = database({ retained: first.pin }); expect(await processChunk4Outbox(retry.admin, "worker")).toMatchObject({ sent: 0, suppressed: 0 });
    expect(transport.send).toHaveBeenCalledOnce(); expect(retry.pin).toEqual(pinned); expect(retry.calls).not.toContain("ap_complete_outbox_message");
  });
  it.each([null, false, "true", {}])("does not count malformed completion %j", async complete => {
    const f = database({ complete }); expect(await processChunk4Outbox(f.admin, "worker")).toMatchObject({ sent: 0 }); expect(f.state().completed).toBe(false);
  });
  it.each([{ data: null, error: null }, { data: { id: "" }, error: null }, { data: { id: "ignored" }, error: { message: "provider rejected" } }])("requires actual provider acceptance id %j", async result => {
    transport.send.mockResolvedValue(result); const f = database(); expect(await processChunk4Outbox(f.admin, "worker")).toMatchObject({ sent: 0 }); expect(f.calls).not.toContain("ap_complete_outbox_message");
  });
  it.each([{ pinError: true }, { renewError: true }])("fails before network on an invalid lease or pin %j", async option => {
    const f = database(option); expect(await processChunk4Outbox(f.admin, "worker")).toMatchObject({ sent: 0 }); expect(transport.send).not.toHaveBeenCalled();
  });
  it.each([null, true, false, "future", new Date(now).toISOString(), new Date(now - 1).toISOString()])("rejects non-current or malformed lease receipt %j", async leaseReceipt => {
    const f = database({ leaseReceipt });
    expect(await processChunk4Outbox(f.admin, "worker")).toMatchObject({ sent: 0, suppressed: 0 });
    expect(transport.send).not.toHaveBeenCalled(); expect(f.calls).not.toContain("ap_complete_outbox_message");
  });
  it("rejects unsafe test recipient and expired guarantee without sending or exposing private error details", async () => {
    vi.stubEnv("APP_SAFE_TEST_EMAILS", "someone-else@example.invalid"); let f = database();
    expect(await processChunk4Outbox(f.admin, "worker")).toMatchObject({ sent: 0 }); expect(transport.send).not.toHaveBeenCalled();
    vi.stubEnv("APP_SAFE_TEST_EMAILS", recipient); f = database({ firstSubmitted: new Date(now - 24 * 60 * 60_000).toISOString() });
    expect(await processChunk4Outbox(f.admin, "worker")).toMatchObject({ sent: 0 }); expect(transport.send).not.toHaveBeenCalled();
    expect(f.rpc).toHaveBeenCalledWith("ap_fail_outbox_message", expect.objectContaining({ p_error_code: "OWNER_NOTICE_DELIVERY_UNCONFIRMED", p_dead_letter: true }));
  });
});

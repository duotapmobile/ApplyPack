import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { ownerDraftNoticeContext, ownerDraftNoticeStatus, ownerDraftSuppressionReceipt, pinOwnerDraftEnvelope,
  renderOwnerDraftNotice } from "@/lib/commerce/owner-draft-notification";
import { intakeNotificationEnvelopeSha256 } from "@/lib/commerce/intake-notification";
const id = (n: number) => `a1060000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = Date.parse("2026-10-28T12:00:00Z"), recipient = "approved-owner@example.invalid";
function fixture() {
  const key = `owner-draft-ready:${id(3)}:${id(4)}:SOURCE_READY:v1`;
  return { message: { id: id(1), customer_id: id(2), order_id: null, payload_ref: null, recipient_ref: id(4),
    message_kind: "OWNER_DRAFT_REVIEW_REQUIRED", provider_idempotency_key: key, first_submitted_at: new Date(now - 1000).toISOString() },
  context: { disposition: "SEND", messageId: id(1), customerId: id(2), jobId: id(3), draftVersionId: id(4), phase: "SOURCE_READY",
    recipientEmail: recipient, providerIdempotencyKey: key, templateVersion: "owner-draft-notice-v1" } };
}
describe("owner notice contract", () => {
  it("accepts only exact event/subject/version/key/configuration bindings", () => {
    const f = fixture(); expect(ownerDraftNoticeContext(f.message, f.context, recipient, now)).toEqual(f.context);
    for (const field of ["messageId", "customerId", "jobId", "draftVersionId", "recipientEmail", "providerIdempotencyKey"]) {
      expect(() => ownerDraftNoticeContext(f.message, { ...f.context, [field]: field === "recipientEmail" ? "other@example.invalid" : id(99) }, recipient, now)).toThrow();
    }
    for (const changed of [{ order_id: id(9) }, { payload_ref: id(9) }, { customer_id: null }, { message_kind: "MATERIALS_DELIVERED" }]) {
      expect(() => ownerDraftNoticeContext({ ...f.message, ...changed }, f.context, recipient, now)).toThrow();
    }
  });
  it.each(["SOURCE_READY", "REVIEW_READY"] as const)("renders stable private-safe historical %s wording", phase => {
    const body = renderOwnerDraftNotice(phase, "https://applypack.work");
    expect(renderOwnerDraftNotice(phase, "https://applypack.work")).toEqual(body);
    expect(body.text).toContain("https://applypack.work/admin/document-drafts"); expect(body.text).toContain("reached owner review");
    expect(body.text).toContain("current status");
    for (const value of [recipient, id(1), id(2), id(3), id(4), "?", "#", "ready now"]) expect(JSON.stringify(body)).not.toContain(value);
  });
  it.each(["https://applypack.work/path", "https://applypack.work?token=secret", "https://user:secret@applypack.work", "http://applypack.work", "ftp://applypack.work"])("rejects unsafe origin %s", origin => {
    expect(() => renderOwnerDraftNotice("SOURCE_READY", origin)).toThrow();
  });
  it.each(["question", "document", "actionUrl", "templateData"])("rejects private or unsupported context field %s", field => {
    const f = fixture(); expect(() => ownerDraftNoticeContext(f.message, { ...f.context, [field]: "untrusted" }, recipient, now)).toThrow();
  });
  it("rejects unknown template, malformed submission and expired guarantee", () => {
    const f = fixture();
    expect(() => ownerDraftNoticeContext(f.message, { ...f.context, templateVersion: "future" }, recipient, now)).toThrow();
    expect(() => ownerDraftNoticeContext({ ...f.message, first_submitted_at: null }, f.context, recipient, now)).toThrow();
    expect(() => ownerDraftNoticeContext(f.message, f.context, recipient, now - 1001)).toThrow("retry_window_expired");
    expect(() => ownerDraftNoticeContext(f.message, f.context, recipient, now - 1000 + 24 * 60 * 60_000)).toThrow("retry_window_expired");
  });
  it("distinguishes obsolete preparation from atomically confirmed suppression", () => {
    const f = fixture(), obsolete = { disposition: "OBSOLETE", messageId: id(1), reason: "VERSION_SUPERSEDED" };
    expect(ownerDraftNoticeContext(f.message, obsolete, recipient, now)).toEqual(obsolete);
    expect(() => ownerDraftSuppressionReceipt(obsolete, id(1))).toThrow();
    const receipt = { ...obsolete, disposition: "SUPPRESSED" };
    expect(ownerDraftSuppressionReceipt(receipt, id(1))).toEqual(receipt);
    expect(() => ownerDraftSuppressionReceipt(receipt, id(2))).toThrow();
    expect(ownerDraftSuppressionReceipt({ ...receipt, reason: "PHASE_COMPLETED" }, id(1))).toMatchObject({ reason: "PHASE_COMPLETED" });
    expect(() => ownerDraftSuppressionReceipt({ ...receipt, reason: "private free text" }, id(1))).toThrow();
  });
  it("pins every provider field and requires exact confirmation", async () => {
    const body = { from: "ApplyPack <orders@applypack.work>", to: recipient, replyTo: "help@applypack.work", ...renderOwnerDraftNotice("SOURCE_READY", "https://applypack.work") };
    const digest = intakeNotificationEnvelopeSha256(body), pin = vi.fn(async () => ({ data: { messageId: id(1), payloadSha256: digest }, error: null }));
    await pinOwnerDraftEnvelope(pin, id(1), "worker", recipient, body);
    expect(pin).toHaveBeenCalledWith(id(1), "worker", recipient, digest);
    for (const field of ["from", "to", "replyTo", "subject", "text", "html"] as const) expect(intakeNotificationEnvelopeSha256({ ...body, [field]: body[field] + "changed" })).not.toBe(digest);
    await expect(pinOwnerDraftEnvelope(undefined, id(1), "worker", recipient, body)).rejects.toThrow();
    for (const data of [true, null, { messageId: id(2), payloadSha256: digest }, { messageId: id(1), payloadSha256: "0".repeat(64) }]) {
      await expect(pinOwnerDraftEnvelope(async () => ({ data, error: null }), id(1), "worker", recipient, body)).rejects.toThrow();
    }
  });
});

describe("current-version owner notice status", () => {
  const expected = { jobId: id(3), versionId: id(4), customerId: id(2) };
  const row = { message_id: id(1), job_id: id(3), draft_version_id: id(4), phase: "SOURCE_READY", suppression_reason: null, suppressed_at: null };
  const message = { id: id(1), customer_id: id(2), recipient_ref: id(4), message_kind: "OWNER_DRAFT_REVIEW_REQUIRED", state: "SENT", provider_message_id: "accepted-id", reconciliation_state: "RECONCILED" };
  it("reports provider acceptance without projecting recipient, provider id or private identity", () => {
    const result = ownerDraftNoticeStatus([row], [message], expected);
    expect(result).toEqual({ status: "AVAILABLE", versionId: id(4), notices: [{ phase: "SOURCE_READY", state: "PROVIDER_ACCEPTED", reason: null }] });
    expect(JSON.stringify(result)).not.toContain("accepted-id"); expect(JSON.stringify(result)).not.toContain(id(2));
  });
  it("rejects foreign, missing, duplicate or contradictory joins", () => {
    for (const rows of [[{ ...row, job_id: id(99) }], [{ ...row, draft_version_id: id(99) }], [row, row]]) expect(() => ownerDraftNoticeStatus(rows, [message], expected)).toThrow();
    for (const messages of [[], [message, message], [{ ...message, customer_id: id(99) }], [{ ...message, provider_message_id: null }], [{ ...message, state: "RETRY" }]]) {
      expect(() => ownerDraftNoticeStatus([row], messages, expected)).toThrow();
    }
  });
  it("requires durable suppression metadata and no provider acceptance", () => {
    const suppressed = { ...row, suppression_reason: "NO_LONGER_READY", suppressed_at: new Date(now).toISOString() };
    const unsent = { ...message, state: "SUPPRESSED", provider_message_id: null, reconciliation_state: "NOT_REQUIRED" };
    expect(ownerDraftNoticeStatus([suppressed], [unsent], expected)).toMatchObject({ notices: [{ state: "SUPPRESSED", reason: "NO_LONGER_READY" }] });
    expect(() => ownerDraftNoticeStatus([row], [unsent], expected)).toThrow();
    expect(() => ownerDraftNoticeStatus([suppressed], [{ ...unsent, provider_message_id: "accepted" }], expected)).toThrow();
  });
});

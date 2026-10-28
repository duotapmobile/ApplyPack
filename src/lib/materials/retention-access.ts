import { z } from "zod";

export const ONE_OFF_RETENTION_POLICY = "one_off_30d_v1";
export const SEARCH_ACTIONS_EXPIRED_MESSAGE = "The 30-day window to start a document-set purchase or report a criteria conflict for this search has ended. An already-started checkout keeps its original expiry.";
export const PRIVATE_ACCESS_EXPIRED_MESSAGE = "The 30-day private access window has ended. Your payment and service records remain available.";

const timestamp = z.iso.datetime({ offset: true }).nullable();
const orderAccess = z.object({
  order_id: z.uuid(), policy_version: z.literal(ONE_OFF_RETENTION_POLICY),
  action_expires_at: timestamp, access_expires_at: timestamp,
  access_expired: z.boolean(), action_expired: z.boolean(), purged_at: timestamp,
}).strict();
const materialAccess = z.object({
  material_line_id: z.uuid(), order_id: z.uuid(), policy_version: z.literal(ONE_OFF_RETENTION_POLICY),
  access_expires_at: timestamp, access_expired: z.boolean(),
}).strict();
export const customerRetentionAccessSchema = z.object({
  policyVersion: z.literal(ONE_OFF_RETENTION_POLICY),
  orders: z.array(orderAccess).max(10_000), materials: z.array(materialAccess).max(10_000),
}).strict().superRefine((value, context) => {
  if (new Set(value.orders.map((order) => order.order_id)).size !== value.orders.length
    || new Set(value.materials.map((line) => line.material_line_id)).size !== value.materials.length) {
    context.addIssue({ code: "custom", message: "Duplicate access record" });
  }
});
export type CustomerRetentionAccess = z.infer<typeof customerRetentionAccessSchema>;
export type OrderRetentionAccess = CustomerRetentionAccess["orders"][number];
export type MaterialRetentionAccess = CustomerRetentionAccess["materials"][number];

// A null deadline is an undelivered service; it never invents an expiry for a
// historical order. Unknown/malformed non-null dates fail closed.
export function accessDeadlineExpired(deadline: string | null | undefined, now = Date.now()) {
  return deadline != null && (!Number.isFinite(Date.parse(deadline)) || Date.parse(deadline) <= now);
}

export function privateAccessExpired(record: OrderRetentionAccess | MaterialRetentionAccess | undefined, now = Date.now()) {
  return Boolean(record && (record.access_expired || accessDeadlineExpired(record.access_expires_at, now)
    || ("purged_at" in record && record.purged_at)));
}

export function searchActionsExpired(record: OrderRetentionAccess | undefined, now = Date.now()) {
  return Boolean(record && (record.action_expired || accessDeadlineExpired(record.action_expires_at, now)
    || record.purged_at));
}

export function privateDownloadSeconds(expiresAt: unknown, maximum: number, now = Date.now()) {
  if (expiresAt == null) return maximum;
  if (typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt))) return 0;
  return Math.max(0, Math.min(maximum, Math.floor((Date.parse(expiresAt) - now) / 1_000)));
}

export function retentionErrorMessage(error: unknown) {
  const code = error && typeof error === "object" && "message" in error ? String(error.message) : "";
  if (code.includes("service_retention_action_expired")) return SEARCH_ACTIONS_EXPIRED_MESSAGE;
  if (code.includes("service_retention_access_expired")) return PRIVATE_ACCESS_EXPIRED_MESSAGE;
  return null;
}

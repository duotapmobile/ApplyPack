export const boardSubscriptionStates = ["PENDING", "ACTIVE", "CANCEL_AT_PERIOD_END", "PAST_DUE", "EXPIRED", "CANCELED", "REFUNDED", "DISPUTED"] as const;
export type BoardSubscriptionState = (typeof boardSubscriptionStates)[number];

export function boardSubscriptionStateFromProvider(input: {
  eventType: "customer.subscription.created" | "customer.subscription.updated" | "customer.subscription.deleted";
  subscriptionStatus: string;
  cancelAtPeriodEnd: boolean;
  latestInvoicePaid: boolean;
}): "PENDING" | "ACTIVE" | "CANCEL_AT_PERIOD_END" | "PAST_DUE" | "CANCELED" {
  if (input.eventType === "customer.subscription.deleted") return "CANCELED";
  if (input.eventType === "customer.subscription.created" && !input.latestInvoicePaid) return "PENDING";
  if (input.cancelAtPeriodEnd && input.latestInvoicePaid) return "CANCEL_AT_PERIOD_END";
  if (input.subscriptionStatus === "active" && input.latestInvoicePaid) return "ACTIVE";
  return "PAST_DUE";
}

export type BoardEntitlement = {
  state: BoardSubscriptionState;
  accessEndsAt: string | null;
  lastProviderEventCreated: number;
};

export type BoardEntitlementEvent = {
  kind: "CHECKOUT_BOUND" | "INVOICE_PAID" | "PAYMENT_FAILED" | "CANCEL_SCHEDULED" | "SUBSCRIPTION_ENDED" | "REFUNDED" | "DISPUTED";
  providerCreated: number;
  periodEnd?: string | null;
};

export function transitionBoardEntitlement(current: BoardEntitlement, event: BoardEntitlementEvent): BoardEntitlement {
  if (event.providerCreated < current.lastProviderEventCreated) return current;
  if (event.providerCreated === current.lastProviderEventCreated && event.kind === "INVOICE_PAID"
    && !["PENDING", "ACTIVE"].includes(current.state)) return current;
  const next = { ...current, lastProviderEventCreated: event.providerCreated };
  if (event.kind === "CHECKOUT_BOUND") return { ...next, state: "PENDING" };
  if (event.kind === "INVOICE_PAID") {
    if (!event.periodEnd) throw new Error("paid_period_end_required");
    return { ...next, state: "ACTIVE", accessEndsAt: event.periodEnd };
  }
  if (event.kind === "CANCEL_SCHEDULED") return { ...next, state: "CANCEL_AT_PERIOD_END" };
  if (event.kind === "PAYMENT_FAILED") return { ...next, state: "PAST_DUE" };
  if (event.kind === "REFUNDED") return { ...next, state: "REFUNDED", accessEndsAt: null };
  if (event.kind === "DISPUTED") return { ...next, state: "DISPUTED", accessEndsAt: null };
  return { ...next, state: event.kind === "SUBSCRIPTION_ENDED" ? "CANCELED" : "EXPIRED", accessEndsAt: null };
}

export function hasBoardAccess(entitlement: Pick<BoardEntitlement, "state" | "accessEndsAt">, now = new Date()) {
  return (entitlement.state === "ACTIVE" || entitlement.state === "CANCEL_AT_PERIOD_END")
    && Boolean(entitlement.accessEndsAt)
    && Date.parse(entitlement.accessEndsAt!) > now.getTime();
}

export type LegacyBoardEntitlement = Pick<BoardEntitlement, "state" | "accessEndsAt" | "lastProviderEventCreated"> & {
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  lastProviderEventId: string | null;
  refundState: "NONE" | "PARTIAL" | "FULL" | "FAILED";
  providerDisputeId: string | null;
};

export function hasProviderConfirmedLegacyBoardAccess(entitlement: LegacyBoardEntitlement, now = new Date()) {
  return hasBoardAccess(entitlement, now)
    && Boolean(entitlement.providerCustomerId?.trim())
    && Boolean(entitlement.providerSubscriptionId?.trim())
    && Boolean(entitlement.lastProviderEventId?.trim())
    && entitlement.lastProviderEventCreated > 0
    && !["PARTIAL", "FULL"].includes(entitlement.refundState)
    && !entitlement.providerDisputeId;
}

type PersistableBoardState = "PENDING" | "ACTIVE" | "CANCEL_AT_PERIOD_END" | "PAST_DUE" | "CANCELED";

export function legacyBoardProviderProjection(input: {
  requestedState: PersistableBoardState;
  subscriptionStatus: string;
  cancelAtPeriodEnd: boolean;
  periodEnd: string;
  currentState: BoardSubscriptionState;
  refundState: "NONE" | "PARTIAL" | "FULL" | "FAILED";
  providerDisputeId: string | null;
}) {
  const terminalFinancialState = ["REFUNDED", "DISPUTED"].includes(input.currentState)
    || ["PARTIAL", "FULL"].includes(input.refundState)
    || Boolean(input.providerDisputeId);
  const providerState: PersistableBoardState = ["canceled", "incomplete_expired"].includes(input.subscriptionStatus)
    ? "CANCELED"
    : input.requestedState === "ACTIVE" && input.cancelAtPeriodEnd
      ? "CANCEL_AT_PERIOD_END"
      : input.requestedState;
  const state = terminalFinancialState ? input.currentState : providerState;
  return {
    state,
    accessEndsAt: terminalFinancialState || !["ACTIVE", "CANCEL_AT_PERIOD_END"].includes(state)
      ? null
      : input.periodEnd,
  };
}

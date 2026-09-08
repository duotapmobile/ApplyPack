export const boardSubscriptionStates = ["PENDING", "ACTIVE", "CANCEL_AT_PERIOD_END", "PAST_DUE", "EXPIRED", "CANCELED", "REFUNDED", "DISPUTED"] as const;
export type BoardSubscriptionState = (typeof boardSubscriptionStates)[number];

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

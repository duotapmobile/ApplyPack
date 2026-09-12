export const SEARCH_PRICE_CENTS = 2_000;
export const SEARCH_PRICE_LABEL = "$20";
export const SEARCH_CHECKOUT_CTA = "Pay $20 and Start My Search";
export const CHECKOUT_RESERVATION_MINUTES = 30;
export const ACCESS_LINK_MINUTES = 15;
export const RELEASE_VERIFICATION_MINUTES = 60;
export const DISPLAY_TIME_ZONE = "America/New_York";

export type FeasibilityView = {
  state: "PENDING" | "COMPLETE" | "STALE" | "ERROR";
  outcome: "LIKELY" | "LIMITED" | "INFEASIBLE" | null;
  checkoutEligible: boolean;
  capacityAvailable?: boolean;
  reasons?: string[];
  primaryReason?: string | null;
  preliminarilyDeliverableCount?: number | null;
  reviewableCount?: number | null;
  snapshotId?: string | null;
  assessmentId?: string | null;
};

export type FeasibilityPresentation = {
  title: string;
  message: string;
  canCheckout: boolean;
  showEdit: boolean;
  showHumanReview: boolean;
  showLeave: boolean;
};

const reasonText: Record<string, string> = {
  INVENTORY_SHORTAGE: "We could not confirm enough current listings under the selected settings.",
  QUALIFICATION_GAP: "The current evidence does not support enough listings under their stated requirements.",
  EVIDENCE_GAP: "Some candidate or employer evidence still needs confirmation.",
  CONSTRAINT_COLLISION: "The selected requirements do not currently produce a workable search.",
  COMPENSATION_BELOW_MINIMUM: "We could not confirm 10 current jobs that meet all must-haves, including minimum compensation.",
  COMPENSATION_UNCONFIRMED: "Enough listings did not publish compensation that can be compared with the selected minimum.",
};

export function feasibilityPresentation(value: FeasibilityView): FeasibilityPresentation {
  if (value.state === "PENDING") {
    return { title: "Checking your search", message: "We are checking current inventory and evidence. No payment has started.", canCheckout: false, showEdit: false, showHumanReview: false, showLeave: true };
  }
  if (value.state === "STALE") {
    return { title: "Your search needs a fresh check", message: "The intake, source inventory, or matching rules changed. We will not use an old result or create Checkout.", canCheckout: false, showEdit: true, showHumanReview: true, showLeave: true };
  }
  if (value.state === "ERROR") {
    return { title: "We could not finish the check", message: "A required source, rule, or system check did not complete. No payment has started.", canCheckout: false, showEdit: true, showHumanReview: true, showLeave: true };
  }
  if (value.outcome === "LIKELY") {
    if (!value.capacityAvailable) {
      return { title: "Your search looks feasible", message: "The evidence supports the search, but no current 24-hour production slot is available. No payment has started.", canCheckout: false, showEdit: true, showHumanReview: false, showLeave: true };
    }
    if (!value.checkoutEligible) {
      return { title: "Your search looks feasible", message: "A required checkout, legal, tax, access-email, or provider setting is not ready. No payment can start.", canCheckout: false, showEdit: true, showHumanReview: false, showLeave: true };
    }
    return { title: "Your search looks feasible", message: "Current capacity can be reserved for 30 minutes. Your exact 24-hour deadline is recorded only after verified payment.", canCheckout: true, showEdit: true, showHumanReview: false, showLeave: true };
  }
  const explanation = reasonText[value.primaryReason || ""] || (value.reasons || []).map((reason) => reasonText[reason]).find(Boolean)
    || "We could not confirm 10 current jobs under the selected must-haves.";
  if (value.outcome === "LIMITED") {
    return { title: "We cannot confirm ten yet", message: explanation, canCheckout: false, showEdit: true, showHumanReview: true, showLeave: true };
  }
  return { title: "This search is not feasible as entered", message: explanation, canCheckout: false, showEdit: true, showHumanReview: true, showLeave: true };
}

export type CheckoutProjection =
  | "CONFIRMING_PAYMENT" | "SEARCH_ACTIVE" | "CAPACITY_EXCEPTION" | "ADJUSTMENT_REQUIRED"
  | "REFUND_PROCESSING" | "REFUNDED" | "REFUND_PROBLEM" | "DELIVERED"
  | "CANCELED" | "EXPIRED" | "FAILED";

export function checkoutStatusPresentation(state: CheckoutProjection, deadline?: string | null) {
  const due = deadline ? ` The exact deadline is ${formatEasternDeadline(deadline)}.` : "";
  switch (state) {
    case "SEARCH_ACTIVE": return { title: "Your search has started", message: `Payment is verified and the search is active.${due}` };
    case "CAPACITY_EXCEPTION": return { title: "Capacity changed after payment", message: "Work did not start. A full refund is processing automatically." };
    case "ADJUSTMENT_REQUIRED": return { title: "Your input is needed", message: "We cannot confirm ten without an explicit criteria choice. Review the precise proposal in My ApplyPack." };
    case "REFUND_PROCESSING": return { title: "Refund processing", message: "A required full refund has started. We will update the order after the provider confirms it." };
    case "REFUNDED": return { title: "Refunded", message: "The provider confirmed the full refund." };
    case "REFUND_PROBLEM": return { title: "Refund problem", message: "The full refund needs staff attention. The amount and retry state are preserved in My ApplyPack." };
    case "DELIVERED": return { title: "Your 10 matches are ready", message: "The immutable exact-ten release is available in My ApplyPack." };
    case "CANCELED": return { title: "Checkout was cancelled", message: "No browser cancellation is treated as payment." };
    case "EXPIRED": return { title: "Checkout expired", message: "The unused reservation was released. Start a fresh checkout when ready." };
    case "FAILED": return { title: "Checkout could not be completed", message: "No unverified payment is treated as an active search." };
    default: return { title: "Confirming your payment", message: "The browser return is not proof of payment. Your search starts only after the signed payment webhook is durably verified." };
  }
}

export function formatEasternDeadline(value: string | Date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: DISPLAY_TIME_ZONE,
    timeZoneName: "short",
  }).format(typeof value === "string" ? new Date(value) : value);
}

export function safeOrderDestination(value: unknown, orderId?: string) {
  const fallback = orderId ? `/my-applypack?order=${encodeURIComponent(orderId)}` : "/my-applypack";
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  try {
    const parsed = new URL(value, "https://applypack.invalid");
    if (parsed.origin !== "https://applypack.invalid") return fallback;
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return fallback;
  }
}

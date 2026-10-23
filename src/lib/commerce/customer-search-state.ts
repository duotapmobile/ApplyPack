export function customerSearchState(
  service: { fulfillment: string; adjustment: string; capacity_exception_at: string | null; refund_started_at: string | null },
  refundState: "NONE" | "PENDING" | "FAILED" | "SUCCEEDED",
  released: boolean,
) {
  if (refundState === "SUCCEEDED") return { label: "Refunded", message: released || service.fulfillment === "DELIVERED"
    ? "The payment provider confirmed the full refund. Your search was delivered before the refund."
    : "The payment provider confirmed the full refund. No search release was committed." };
  if (refundState === "PENDING") return { label: "Refund processing", message: "A required full refund is in progress. Its durable provider state is preserved here." };
  if (refundState === "FAILED") return { label: "Refund problem", message: "The full refund needs staff attention. The order and retry record remain preserved." };
  if (released || service.fulfillment === "DELIVERED") return { label: "Delivered", message: "The immutable exact-ten release is available below." };
  if (service.adjustment === "PROPOSED" || service.fulfillment === "ADJUSTMENT_REQUIRED") return { label: "Adjustment required", message: "We could not verify ten jobs under the active criteria. Review the precise proposal below." };
  if (service.capacity_exception_at) return { label: "Capacity problem", message: "Work did not start after payment because capacity could not be confirmed. A full refund is required." };
  if (service.refund_started_at) return { label: "Refund processing", message: "A required full refund has started and no release will be committed." };
  if (service.fulfillment === "HUMAN_REVIEW") return { label: "Human review", message: "A staff reviewer is checking eligibility evidence, liveness, provenance, and the exact-ten package." };
  if (service.fulfillment === "READY_TO_RELEASE") return { label: "Final release review", message: "Ten eligible jobs are ready for the final human release decision." };
  return { label: "Researching", message: "Payment and capacity are verified. We are researching and checking current listings against the active criteria." };
}
